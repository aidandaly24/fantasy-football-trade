#!/usr/bin/env python3
"""Evaluate sportsbook features as a point-in-time weekly PPR challenger.

The input is a private JSONL tape. This module never downloads odds, never
publishes raw book data, and never edits player market values. It compares the
existing production forecast, sportsbook-only features, and a combined model
on the latest untouched season for two independently timed anchors.
"""

from __future__ import annotations

import argparse
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_TAPE = ROOT / "data" / "raw" / "sportsbook" / "snapshots.jsonl"
REPORT_JSON = ROOT / "ml" / "reports" / "sportsbook-model-health.json"
PUBLIC_JSON = ROOT / "public" / "data" / "sportsbook-model-health.json"

MARKETS = (
    "player_pass_yds", "player_pass_tds", "player_pass_interceptions",
    "player_rush_yds", "player_rush_attempts", "player_receptions",
    "player_reception_yds", "player_anytime_td",
)
GAME_FEATURES = ("game_total", "team_spread", "implied_team_total")
ANCHORS = {
    "early-week": (48.0, 168.0),
    "pregame": (0.0, 6.0),
}


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def number(value: Any) -> float:
    try:
        parsed = float(value)
        return parsed if math.isfinite(parsed) else math.nan
    except (TypeError, ValueError):
        return math.nan


def parse_time(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def flatten_record(raw: dict[str, Any]) -> dict[str, Any] | None:
    observed = parse_time(raw.get("observedAt"))
    kickoff = parse_time(raw.get("kickoffAt"))
    actual = number(raw.get("actualPpr"))
    baseline = number(raw.get("baselinePpg"))
    season = int(number(raw.get("season"))) if math.isfinite(number(raw.get("season"))) else 0
    position = str(raw.get("position") or "").upper()
    if not observed or not kickoff or observed >= kickoff or not season or position not in {"QB", "RB", "WR", "TE"}:
        return None
    if not math.isfinite(actual) or not math.isfinite(baseline):
        return None
    lead_hours = (kickoff - observed).total_seconds() / 3600
    markets = raw.get("markets") if isinstance(raw.get("markets"), dict) else {}
    row: dict[str, Any] = {
        "season": season,
        "week": int(number(raw.get("week"))) if math.isfinite(number(raw.get("week"))) else 0,
        "observed_at": observed.isoformat(),
        "kickoff_at": kickoff.isoformat(),
        "lead_hours": lead_hours,
        "player_id": str(raw.get("playerId") or ""),
        "position": position,
        "actual_ppr": actual,
        "baseline_ppg": baseline,
        "game_total": number(raw.get("gameTotal")),
        "team_spread": number(raw.get("teamSpread")),
        "implied_team_total": number(raw.get("impliedTeamTotal")),
    }
    for market in MARKETS:
        values = markets.get(market) if isinstance(markets.get(market), dict) else {}
        row[f"{market}_line"] = number(values.get("line"))
        row[f"{market}_probability"] = number(values.get("overProbability", values.get("yesProbability")))
    return row


def load_tape(path: Path = DEFAULT_TAPE) -> tuple[pd.DataFrame, dict[str, int]]:
    if not path.exists():
        return pd.DataFrame(), {"rawRows": 0, "eligibleRows": 0, "rejectedRows": 0}
    rows: list[dict[str, Any]] = []
    raw_rows = 0
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        raw_rows += 1
        try:
            raw = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(raw, dict):
            flattened = flatten_record(raw)
            if flattened:
                rows.append(flattened)
    return pd.DataFrame(rows), {
        "rawRows": raw_rows,
        "eligibleRows": len(rows),
        "rejectedRows": raw_rows - len(rows),
    }


def feature_columns(include_baseline: bool) -> list[str]:
    columns = list(GAME_FEATURES)
    for market in MARKETS:
        columns.extend([f"{market}_line", f"{market}_probability"])
    return (["baseline_ppg"] if include_baseline else []) + columns


def fit_predict(train: pd.DataFrame, test: pd.DataFrame, columns: list[str]) -> np.ndarray:
    pipeline = Pipeline([
        ("imputer", SimpleImputer(strategy="median", keep_empty_features=True)),
        ("scale", StandardScaler()),
        ("model", Ridge(alpha=10.0)),
    ])
    pipeline.fit(train[columns], train["actual_ppr"])
    return pipeline.predict(test[columns])


def evaluate_anchor(frame: pd.DataFrame, anchor: str) -> dict[str, Any]:
    minimum, maximum = ANCHORS[anchor]
    eligible = frame[(frame["lead_hours"] >= minimum) & (frame["lead_hours"] <= maximum)].copy() if "lead_hours" in frame else pd.DataFrame()
    seasons = sorted(int(value) for value in eligible["season"].unique()) if not eligible.empty else []
    base = {
        "anchor": anchor,
        "rows": int(len(eligible)),
        "trainRows": 0,
        "testRows": 0,
        "seasons": seasons,
        "positions": sorted(str(value) for value in eligible["position"].unique()) if not eligible.empty else [],
        "baselineMae": None,
        "sportsbookOnlyMae": None,
        "combinedMae": None,
        "combinedLift": None,
        "enabled": False,
        "status": "needs-data",
    }
    if len(seasons) < 2:
        return base
    test_season = seasons[-1]
    train = eligible[eligible["season"] < test_season]
    test = eligible[eligible["season"] == test_season]
    base.update({"trainRows": int(len(train)), "testRows": int(len(test))})
    if train.empty or test.empty:
        return base
    actual = test["actual_ppr"].to_numpy()
    baseline_mae = float(mean_absolute_error(actual, test["baseline_ppg"].to_numpy()))
    sportsbook_mae = float(mean_absolute_error(actual, fit_predict(train, test, feature_columns(False))))
    combined_mae = float(mean_absolute_error(actual, fit_predict(train, test, feature_columns(True))))
    lift = (baseline_mae - combined_mae) / baseline_mae if baseline_mae > 0 else 0.0
    positions = set(base["positions"])
    gates = len(train) >= 250 and len(test) >= 75 and positions == {"QB", "RB", "WR", "TE"} and lift > 0
    base.update({
        "baselineMae": baseline_mae,
        "sportsbookOnlyMae": sportsbook_mae,
        "combinedMae": combined_mae,
        "combinedLift": lift,
        "enabled": gates,
        "status": "validated" if gates else "shadow",
    })
    return base


def build_report(frame: pd.DataFrame, audit: dict[str, int]) -> dict[str, Any]:
    evaluations = [evaluate_anchor(frame, anchor) for anchor in ANCHORS]
    seasons = sorted(int(value) for value in frame["season"].unique()) if not frame.empty else []
    early = evaluations[0]
    gates = [
        {"id": "point-in-time", "label": "Point-in-time snapshots", "requirement": "Every eligible line predates kickoff.", "passed": audit["eligibleRows"] > 0 and audit["rejectedRows"] == 0, "actual": audit["eligibleRows"]},
        {"id": "multi-season", "label": "Chronological seasons", "requirement": "At least two seasons with the latest untouched for testing.", "passed": len(seasons) >= 2, "actual": len(seasons)},
        {"id": "coverage", "label": "Position coverage", "requirement": "Held-out QB, RB, WR, and TE coverage.", "passed": set(early["positions"]) == {"QB", "RB", "WR", "TE"}, "actual": len(early["positions"])},
        {"id": "incremental-lift", "label": "Incremental held-out lift", "requirement": "Combined features beat the existing forecast on the untouched season.", "passed": bool(early["combinedLift"] is not None and early["combinedLift"] > 0), "actual": early["combinedLift"]},
    ]
    enabled = all(bool(gate["passed"]) for gate in gates) and all(bool(item["enabled"]) for item in evaluations)
    return {
        "version": "sportsbook-shadow-v1",
        "generatedAt": utc_now(),
        "status": "validated" if enabled else "shadow" if audit["eligibleRows"] else "needs-data",
        "enabled": enabled,
        "target": "Incremental weekly PPR accuracy over the existing production model",
        "rows": audit["eligibleRows"],
        "trainRows": early["trainRows"],
        "testRows": early["testRows"],
        "seasons": seasons,
        "anchors": list(ANCHORS),
        "metrics": {
            "baselineMae": early["baselineMae"],
            "sportsbookOnlyMae": early["sportsbookOnlyMae"],
            "combinedMae": early["combinedMae"],
            "combinedLift": early["combinedLift"],
        },
        "gates": gates,
        "evaluations": evaluations,
        "inputAudit": audit,
        "notes": [
            "Current lines may be displayed as shadow evidence but contribute zero recommendation weight.",
            "Early-week and final pregame models are evaluated independently to prevent closing-line leakage.",
            "A betting line is a market threshold, not an expected mean or a long-term dynasty valuation.",
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tape", type=Path, default=DEFAULT_TAPE)
    parser.add_argument("--output", type=Path, default=REPORT_JSON)
    args = parser.parse_args()
    frame, audit = load_tape(args.tape)
    report = build_report(frame, audit)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    PUBLIC_JSON.parent.mkdir(parents=True, exist_ok=True)
    PUBLIC_JSON.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"status": report["status"], "rows": report["rows"], "enabled": report["enabled"]}))


if __name__ == "__main__":
    main()
