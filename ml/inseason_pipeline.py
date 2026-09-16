"""Run the advanced in-season data audition and publish aggregate research.

Usage: .venv/bin/python -m ml.inseason_pipeline [--offline]
Raw tape and predictions stay ignored; no browser artifact or live weights.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import platform
import subprocess
from pathlib import Path

import numpy as np
import pandas as pd
import sklearn

from ml.inseason_data import POSITIONS, Sources, collect, digest, now, write_json
from ml.inseason_features import build_panel, feature_sets
from ml.inseason_model import evaluate

ROOT = Path(__file__).resolve().parents[1]
VERSION = "in-season-advanced-v1"
BLOCKERS = [
    "Historical features are reconstructed from revised end-of-game data. Original pre-kickoff publication vintages are unavailable.",
    "Timestamped historical weekly expert projections and dynasty market baselines have not been joined; incremental advantage over those sources is untested.",
    "True all-route participation, untargeted separation, press/man/zone route wins and ESPN Open Score are unavailable in this tape.",
    "Outcomes are realized offensive points per NFL calendar week including byes and absences, not conditional weekly starter forecasts or dynasty market returns.",
    "Never-observed players and preseason injury status are uncovered. Current-season rollout and prospective calibration require a separate review.",
]


def clean(value):
    if isinstance(value, dict):
        return {str(k): clean(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [clean(v) for v in value]
    if isinstance(value, (float, np.floating)):
        return round(float(value), 7) if np.isfinite(value) else None
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, np.bool_):
        return bool(value)
    return value


def markdown(report: dict) -> str:
    lines = ["# In-season advanced-data audition", "", f"Generated: {report['generatedAt']}",
             f"Dataset: `{report['datasetId']}`", "", "Status: **shadow; enabled: false**.", "",
             "This report compares historical forecasting experiments. It does not change player values, trade grades, waiver ordering or lineup advice.", "",
             f"Scoring recipe: `{json.dumps(report['scoring'], sort_keys=True)}`. Two-point conversions are included; kicking, defense, special-team returns and custom bonuses are outside this recipe.", "",
             "## Design and evidence boundaries", "", *[f"- {b}" for b in BLOCKERS], "",
             "Features end at the anchor week. Targets are the mean of the following one or four NFL calendar weeks. Missing appearances and byes remain zero once full-season game coverage is verified. Players enter only after their first observed offensive opportunity and remain after disappearance.", "",
             "Hyperparameters, baseline and advanced family are selected in the validation season before evaluating the final season. Every family uses the same rows within its cohort. FTN-era experiments use 2022 onward; compare their lift to their own reference, not to the larger core cohort.", "",
             "## Held-out results", "",
             "| Cohort | Position | Weeks | Test rows | Reference | Advanced selected on validation | Reference MAE | Advanced MAE | Lift | Research gates |",
             "|---|---|---:|---:|---|---|---:|---:|---:|---|"]
    for result in report["experiments"]:
        selected = result.get("selectedAdvanced")
        if not selected:
            lines.append(f"| {result['cohort']} | {result['position']} | {result['horizonWeeks']} | {result['testRows']} | unavailable | unavailable | — | — | — | needs data |")
            continue
        test = result["families"][selected]["test"]
        lines.append(f"| {result['cohort']} | {result['position']} | {result['horizonWeeks']} | {result['testRows']} | {result['reference']} | {selected} | {result['referenceTest']['mae']:.3f} | {test['mae']:.3f} | {test['liftVsReference']:.1%} | {'pass' if result['researchGatesPassed'] else 'fail'} |")
    lines += ["", "MAE is fantasy points per calendar week. Positive lift is lower error. A research gate pass does not clear the source-vintage, benchmark or deployment blockers.", "",
              "## Does separation add information?", "",
              "Difference in MAE between NGS without separation and NGS with separation, using identical rows. Positive is improvement; 90% paired player-season block interval is descriptive, without multiple-comparison adjustment. aDOT and cushion remain in both families; this does not identify intrinsic route skill.", "",
              "| Cohort | Position | Weeks | MAE gain | 90% interval |", "|---|---|---:|---:|---|"]
    for result in report["experiments"]:
        ablation = result.get("separationAblation")
        if ablation:
            lines.append(f"| {result['cohort']} | {result['position']} | {result['horizonWeeks']} | {ablation['meanMaeGain']:.3f} | {ablation['lower90']:.3f} to {ablation['upper90']:.3f} |")
    lines += ["", "## Coverage", "", f"Player-week panel rows (historical plus current evidence): {report['panelAudit']['rows']:,}. Retained no-opportunity weeks: {report['panelAudit']['retainedNoOpportunityWeeks']:,}.", "",
              "NGS has volume qualification thresholds. Missing advanced stats stay missing, with sample counts and coverage indicators. Recent means are opportunity-weighted; no same-season summary rows (week 0) enter features.", "",
              "FTN first-read target share measures a player's share of known first-read throws, not his share of all designed first reads. Unknown read order is excluded. FTN game/play identity joins and known-read counts are in the JSON report.", "",
              "| Current evidence | Value |", "|---|---|",
              *[f"| {key} | {value} |" for key, value in report["currentEvidence"].items() if not isinstance(value, (dict, list))], "",
              "Source errors: " + ("none." if not report["sourceErrors"] else "; ".join(f"{e['source']}: {e['error']}" for e in report["sourceErrors"])), "",
              "## Unavailable capabilities", "", "| Capability | Status / next requirement |", "|---|---|",
              "| All-route participation and target/yard rates per route | Needs a permitted all-route source; snaps cannot substitute |",
              "| Context-adjusted route winning / ESPN Open Score | No current and historical permitted input joined |",
              "| Expected fantasy points | No play-opportunity xFP model trained; EPA is not expected fantasy points |",
              "| Forward dynasty return | Separate target, labels and exact-horizon validation required |",
              "| Weekly expert / price benchmark | Needs dated historical observations before a claim of advantage |", "",
              "## Reproduce", "", "`npm run ml:inseason` collects and evaluates; `npm run ml:inseason:offline` verifies pinned hashes and reruns. `--refresh-sources` explicitly selects new immutable input versions. The JSON records URLs, hashes, retrieval times, training features, selection metrics, test slices, runtime and code hashes.", "",
              "## Sources and attribution", "",
              "- [NFL Next Gen Stats via nflverse](https://nflreadr.nflverse.com/reference/load_nextgen_stats.html)",
              "- [nflverse player statistics](https://github.com/nflverse/nflverse-data/releases/tag/stats_player)",
              "- [FTN Data via nflverse](https://nflreadr.nflverse.com/reference/load_ftn_charting.html): CC BY-SA 4.0. FTN-derived aggregates in this report are provided under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), with transformations (identity joins, player-week aggregation, rolling features and model evaluation) described above.", ""]
    return "\n".join(lines)


def run(args) -> dict:
    seasons = list(range(args.start_season, args.test_season + 1))
    if not args.start_season < args.validation_season < args.test_season:
        raise ValueError("Need training seasons < validation season < test season")
    if args.current_season and args.current_season <= args.test_season:
        raise ValueError("Current evidence season must follow the test season")
    scoring = {"ppr": args.ppr, "tep": args.tep, "passTd": args.pass_td, "passInt": args.pass_int}
    if not all(np.isfinite(v) for v in scoring.values()):
        raise ValueError("Scoring coefficients must be finite")
    sources = Sources(args.cache, args.offline, args.refresh_sources)
    print("Collecting pinned weekly stats, Next Gen Stats and FTN charting...", flush=True)
    data = collect(sources, seasons, args.current_season)
    print("Building time-ordered player-week evidence...", flush=True)
    panel, audit = build_panel(data, seasons, scoring, args.current_season)
    source_ids = sorted((row["name"], row["sha256"]) for row in sources.manifest)
    code_hashes = {name: digest((Path(__file__).parent / name).read_bytes()) for name in
                   ("inseason_data.py", "inseason_features.py", "inseason_model.py", "inseason_pipeline.py")}
    dataset_id = "sha256:" + hashlib.sha256(json.dumps({"sources": source_ids, "scoring": scoring,
                "seasons": seasons, "version": VERSION, "code": code_hashes}, sort_keys=True).encode()).hexdigest()
    args.processed.mkdir(parents=True, exist_ok=True)
    panel.to_parquet(args.processed / "player-weeks.parquet", index=False)
    experiments, predictions = [], []
    for cohort in ("core", "ftn-era"):
        for position in POSITIONS:
            for horizon in (1, 4):
                print(f"Evaluating {cohort} / {position} / {horizon} week(s)...", flush=True)
                result, pred = evaluate(panel[panel.season.isin(seasons)], position, horizon, cohort,
                                        args.validation_season, args.test_season)
                experiments.append(result)
                predictions.append(pred)
    pd.concat(predictions, ignore_index=True).to_parquet(args.processed / "heldout-predictions.parquet", index=False)
    current = panel[panel.season.eq(args.current_season)] if args.current_season else panel.iloc[:0]
    last = int(current.week.max()) if len(current) else None
    current = current[current.week.eq(last)]
    ngs_cols = [c for c in panel if c.startswith("ngs_") and c.endswith("_3") and "samples" not in c]
    ftn_cols = [c for c in panel if c.startswith("ftn_") and c.endswith("_3") and "samples" not in c and "coverage" not in c]
    evidence_cols = [c for c in panel if c.startswith(("ngs_", "ftn_")) and c.endswith("_3")]
    coverage = {"season": args.current_season, "week": last, "observedPlayers": len(current),
                "playersWithNgs": int(current[ngs_cols].notna().any(axis=1).sum()) if ngs_cols else 0,
                "playersWithFtn": int(current[ftn_cols].notna().any(axis=1).sum()) if ftn_cols else 0,
                "use": "descriptive evidence only; no current model forecasts exported"}
    fields = list(dict.fromkeys(["player_id", "player_display_name", "position", "team", "season", "week",
                                *feature_sets(panel, "WR", 1)["opportunity"], *evidence_cols]))
    write_json(args.processed / "current-evidence.json", clean({"datasetId": dataset_id, "enabled": False,
               "coverage": coverage, "players": current[fields].to_dict("records")}))
    try:
        revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    except (OSError, subprocess.CalledProcessError):
        revision = "unknown"
    report = clean({"version": VERSION, "generatedAt": now(), "datasetId": dataset_id,
                    "status": "shadow", "enabled": False, "scoring": scoring,
                    "split": {"validationSeason": args.validation_season, "testSeason": args.test_season},
                    "sourceManifest": sources.manifest, "sourceErrors": data["sourceErrors"],
                    "panelAudit": audit, "ftnJoinAudit": data["ftnAudit"], "currentEvidence": coverage,
                    "experiments": experiments, "promotionBlockers": BLOCKERS,
                    "runtime": {"python": platform.python_version(), "pandas": pd.__version__,
                                "sklearn": sklearn.__version__, "numpy": np.__version__},
                    "code": {"baseRevision": revision, "sha256": code_hashes},
                    "attribution": "NFL Next Gen Stats and nflverse; FTN Data via nflverse (CC BY-SA 4.0); FTN-derived report aggregates CC BY-SA 4.0"})
    write_json(args.report.with_suffix(".json"), report)
    args.report.with_suffix(".md").write_text(markdown(report))
    print(f"Saved aggregate report: {args.report.with_suffix('.md')}", flush=True)
    return report


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--offline", action="store_true")
    p.add_argument("--refresh-sources", action="store_true")
    p.add_argument("--start-season", type=int, default=2018)
    p.add_argument("--validation-season", type=int, default=2024)
    p.add_argument("--test-season", type=int, default=2025)
    p.add_argument("--current-season", type=int, default=2026)
    p.add_argument("--ppr", type=float, default=1.)
    p.add_argument("--tep", type=float, default=.5)
    p.add_argument("--pass-td", type=float, default=4.)
    p.add_argument("--pass-int", type=float, default=-1.)
    p.add_argument("--cache", type=Path, default=ROOT / "data/raw/inseason")
    p.add_argument("--processed", type=Path, default=ROOT / "data/processed/inseason")
    p.add_argument("--report", type=Path, default=ROOT / "ml/reports/inseason-advanced-health")
    return p


if __name__ == "__main__":
    run(parser().parse_args())
