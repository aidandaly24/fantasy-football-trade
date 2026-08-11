#!/usr/bin/env python3
"""Build and audit the V6.4 same-horizon future-rookie evidence tape."""

from __future__ import annotations

import argparse
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

try:
    from ml.future_rookie_data import (
        POSITIONS,
        build_college_seasons,
        build_same_horizon_tape,
        collect_future_rookie_sources,
        load_identity_outcomes,
        load_rosters,
        manifest_is_complete,
    )
except ModuleNotFoundError:  # Direct invocation from the repository root.
    from future_rookie_data import (
        POSITIONS,
        build_college_seasons,
        build_same_horizon_tape,
        collect_future_rookie_sources,
        load_identity_outcomes,
        load_rosters,
        manifest_is_complete,
    )


ROOT = Path(__file__).resolve().parents[1]
RAW_ROOT = ROOT / "data" / "raw" / "future-rookies-v6.4"
PROCESSED_ROOT = ROOT / "data" / "processed" / "future-rookies-v6.4"
REPORT_ROOT = ROOT / "ml" / "reports"
REPORT_JSON = REPORT_ROOT / "future-rookie-evidence-v6.4.json"
REPORT_MARKDOWN = REPORT_ROOT / "future-rookie-evidence-v6.4.md"
TAPE_PATH = PROCESSED_ROOT / "same-horizon-tape.csv"

VERSION = "future-rookie-evidence-v6.4"
AUDIT_DRAFT_YEARS = tuple(range(2019, 2027))
EVALUABLE_DRAFT_YEARS = tuple(range(2020, 2026))
CURRENT_TARGET_DRAFT_YEAR = 2027
MIN_IDENTITY_RECOVERY = 0.85


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _rate(numerator: int, denominator: int) -> float | None:
    return float(numerator / denominator) if denominator else None


def _json_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _json_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_value(item) for item in value]
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating, float)):
        return float(value) if math.isfinite(float(value)) else None
    if isinstance(value, (np.bool_,)):
        return bool(value)
    if value is pd.NA or (not isinstance(value, (str, bool)) and pd.isna(value)):
        return None
    return value


def _source_evidence(manifest: dict[str, Any]) -> dict[str, Any]:
    evidence: dict[str, Any] = {}
    for group in ("rosters", "collegeProduction", "nflIdentityOutcomes"):
        source = manifest.get(group, {})
        evidence[group] = {
            "provider": source.get("provider"),
            "license": source.get("license"),
            "sourceRef": source.get("sourceRef"),
            "files": [
                {
                    "name": Path(item.get("path", "")).name,
                    "effectiveSeason": item.get("effectiveSeason"),
                    "sha256": item.get("sha256"),
                    "url": item.get("url"),
                    "sourceMeaning": item.get("sourceMeaning"),
                }
                for item in source.get("files", [])
            ],
        }
    return evidence


def _spot_checks(class_tape: pd.DataFrame) -> dict[str, list[dict[str, Any]]]:
    entered = class_tape[class_tape["entered_target_nfl_class"]].copy()
    drafted = entered[entered["target_class_draft_overall"].notna()].nsmallest(
        3, "target_class_draft_overall"
    )
    non_entrants = class_tape[
        class_tape["plausibly_eligible"]
        & ~class_tape["entered_target_nfl_class"]
        & class_tape["prior_college_data_present"]
    ].nlargest(3, "prior_career_scrimmage_yards")

    fields = [
        "athlete_id", "player_name", "position", "team",
        "prior_career_scrimmage_yards", "target_class_draft_overall",
    ]
    return {
        "enteredTargetClass": _json_value(drafted[fields].to_dict("records")),
        # This is target-class membership only. A player may enter in a later year.
        "didNotEnterTargetClass": _json_value(non_entrants[fields].to_dict("records")),
    }


def _class_audit(
    tape: pd.DataFrame,
    identities: pd.DataFrame,
    target_draft_year: int,
) -> dict[str, Any]:
    class_tape = tape[tape["target_draft_year"].eq(target_draft_year)].copy()
    plausible = class_tape[class_tape["plausibly_eligible"]].copy()
    known_entrants = identities[identities["draft_year"].eq(target_draft_year)]
    recovered = set(known_entrants["athlete_id"]) & set(class_tape["athlete_id"])
    feature_max = pd.to_numeric(class_tape["feature_max_season"], errors="coerce")
    feature_cutoff = pd.to_numeric(class_tape["feature_cutoff_season"], errors="coerce")
    leakage_rows = class_tape[feature_max.notna() & feature_max.gt(feature_cutoff)]

    positions = []
    for position in POSITIONS:
        slice_tape = plausible[plausible["position"].eq(position)]
        positions.append({
            "position": position,
            "candidateRows": int(len(slice_tape)),
            "priorProductionCoverage": _rate(
                int(slice_tape["prior_college_data_present"].sum()), len(slice_tape)
            ),
            "enteredTargetClass": int(slice_tape["entered_target_nfl_class"].sum()),
        })

    return {
        "targetDraftYear": target_draft_year,
        "snapshotSeason": target_draft_year - 1,
        "featureCutoffSeason": target_draft_year - 2,
        "candidateRows": int(len(class_tape)),
        "plausiblyEligibleRows": int(len(plausible)),
        "knownEntrants": int(len(known_entrants)),
        "knownEntrantsRecovered": int(len(recovered)),
        "identityRecovery": _rate(len(recovered), len(known_entrants)),
        "priorProductionCoverage": _rate(
            int(plausible["prior_college_data_present"].sum()), len(plausible)
        ),
        "rosterYearCoverage": _rate(int(plausible["roster_year_known"].sum()), len(plausible)),
        "recruitingCoverage": _rate(
            int(plausible["recruiting_data_present"].sum()), len(plausible)
        ),
        "rosterIdentityAmbiguities": int(plausible["roster_identity_ambiguous"].sum()),
        "enteredTargetClass": int(plausible["entered_target_nfl_class"].sum()),
        "draftedInTargetClass": int(plausible["drafted_in_target_class"].sum()),
        "didNotEnterTargetClass": int((~plausible["entered_target_nfl_class"]).sum()),
        "leakageRows": int(len(leakage_rows)),
        "positions": positions,
        "spotChecks": _spot_checks(class_tape),
    }


def build_report(
    tape: pd.DataFrame,
    identities: pd.DataFrame,
    identity_audit: dict[str, Any],
    manifest: dict[str, Any],
    *,
    generated_at: str | None = None,
) -> dict[str, Any]:
    classes = [
        _class_audit(tape, identities, year)
        for year in AUDIT_DRAFT_YEARS
        if tape["target_draft_year"].eq(year).any()
    ]
    evaluable = [item for item in classes if item["targetDraftYear"] in EVALUABLE_DRAFT_YEARS]
    total_leakage = sum(item["leakageRows"] for item in classes)
    recovery_pass = (
        len(evaluable) == len(EVALUABLE_DRAFT_YEARS)
        and all(
            item["identityRecovery"] is not None
            and item["identityRecovery"] >= MIN_IDENTITY_RECOVERY
            for item in evaluable
        )
    )
    coverage_slices_pass = all(
        {item["position"] for item in class_audit["positions"]} == set(POSITIONS)
        and all(
            item["candidateRows"] > 0 and item["priorProductionCoverage"] is not None
            for item in class_audit["positions"]
        )
        for class_audit in evaluable
    )
    outcomes_retained = all(
        item["enteredTargetClass"] > 0 and item["didNotEnterTargetClass"] > 0
        for item in evaluable
    )
    gates = [
        {
            "id": "pinned-source-provenance",
            "passed": manifest_is_complete(manifest),
            "detail": "Every source file has a pinned revision, URL, and SHA-256 digest.",
        },
        {
            "id": "six-completed-classes",
            "passed": len(evaluable) == len(EVALUABLE_DRAFT_YEARS),
            "detail": "Draft years 2020-2025 are present for later rolling evaluation.",
        },
        {
            "id": "same-horizon-no-leakage",
            "passed": total_leakage == 0,
            "detail": f"{total_leakage} rows use production after their declared cutoff.",
        },
        {
            "id": "identity-recovery",
            "passed": recovery_pass,
            "detail": f"Each completed class recovers at least {MIN_IDENTITY_RECOVERY:.0%} of known entrants.",
        },
        {
            "id": "coverage-slices-reported",
            "passed": coverage_slices_pass,
            "detail": "QB, RB, WR, and TE candidate and production coverage is reported per class.",
        },
        {
            "id": "non-entrants-retained",
            "passed": outcomes_retained,
            "detail": "Completed classes retain both entrants and players who did not enter that target class.",
        },
    ]
    phase_passed = all(gate["passed"] for gate in gates)

    report = {
        "version": VERSION,
        "generatedAt": generated_at or utc_now(),
        "decision": {
            "phase": "V6.4 same-horizon evidence tape",
            "phasePassed": phase_passed,
            "trainingEnabled": False,
            "downstreamEnabled": False,
            "reason": (
                "The historical tape passed its construction gates; model selection remains V6.5 work."
                if phase_passed
                else "The historical tape failed at least one construction gate."
            ),
        },
        "currentClass": {
            "targetDraftYear": CURRENT_TARGET_DRAFT_YEAR,
            "status": "blocked",
            "reason": "No version-pinned 2026 roster snapshot is available in the selected public archive.",
        },
        "scope": {
            "targetDefinition": "No prediction target in V6.4; target-class entry and draft fields are retrospective audit labels only.",
            "candidateDefinition": "All rostered QB/RB/WR/TE players; plausible eligibility is roster year 2+ or unknown.",
            "snapshotDateRule": "August 10 of the season before the target NFL draft year.",
            "featureCutoffRule": "College seasons through target draft year minus two only.",
            "retrospectiveLabels": [
                "identity match", "target-class entry", "target-class draft overall",
            ],
            "excludedFromFeatures": [
                "final college season", "NFL combine", "NFL draft capital",
                "post-snapshot dynasty market values", "future NFL production",
            ],
        },
        "gates": gates,
        "tape": {
            "rowCount": int(len(tape)),
            "draftYears": sorted(int(year) for year in tape["target_draft_year"].unique()),
            "evaluableDraftYears": list(EVALUABLE_DRAFT_YEARS),
            "classes": classes,
        },
        "identityAudit": identity_audit,
        "sourceManifest": {
            "schemaVersion": manifest.get("schemaVersion"),
            "retrievedAt": manifest.get("retrievedAt"),
        },
        "sources": _source_evidence(manifest),
        "limitations": [
            "Roster files are retrospective season records, not untouched August snapshots.",
            "Roster year is an eligibility proxy and cannot resolve every redshirt or age case.",
            "A missing target-class identity means did not enter that class, not permanent failure.",
            "Prior production is missing for some candidates and is retained as explicit missingness.",
            "Recruiting identifiers are audited but not used as a feature because coverage is inadequate.",
        ],
        "nextExperiment": (
            "V6.5 may compare small same-horizon baselines with rolling class holdouts only after review."
            if phase_passed
            else "Repair failed V6.4 gates before any model experiment."
        ),
    }
    return _json_value(report)


def render_markdown(report: dict[str, Any]) -> str:
    yes_no = lambda value: "PASS" if value else "FAIL"
    lines = [
        "# Future rookie evidence tape V6.4",
        "",
        f"Generated: `{report['generatedAt']}`",
        "",
        f"**Phase decision: {yes_no(report['decision']['phasePassed'])}.** "
        f"Training enabled: `{str(report['decision']['trainingEnabled']).lower()}`; "
        f"downstream enabled: `{str(report['decision']['downstreamEnabled']).lower()}`.",
        "",
        report["decision"]["reason"],
        "",
        "## Gates",
        "",
        "| Gate | Status | Detail |",
        "| --- | --- | --- |",
    ]
    for gate in report["gates"]:
        lines.append(f"| {gate['id']} | {yes_no(gate['passed'])} | {gate['detail']} |")

    lines.extend([
        "",
        "## Historical class coverage",
        "",
        "| Draft | Candidates | Plausible | Identity recovery | Prior production | Entrants | Did not enter | Leakage |",
        "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ])
    for item in report["tape"]["classes"]:
        recovery = "n/a" if item["identityRecovery"] is None else f"{item['identityRecovery']:.1%}"
        production = (
            "n/a" if item["priorProductionCoverage"] is None
            else f"{item['priorProductionCoverage']:.1%}"
        )
        lines.append(
            f"| {item['targetDraftYear']} | {item['candidateRows']} | "
            f"{item['plausiblyEligibleRows']} | {recovery} | {production} | "
            f"{item['enteredTargetClass']} | {item['didNotEnterTargetClass']} | "
            f"{item['leakageRows']} |"
        )

    lines.extend([
        "",
        "## Point-in-time contract",
        "",
        f"- Candidate population: {report['scope']['candidateDefinition']}",
        f"- Snapshot: {report['scope']['snapshotDateRule']}",
        f"- Feature cutoff: {report['scope']['featureCutoffRule']}",
        f"- Excluded features: {', '.join(report['scope']['excludedFromFeatures'])}.",
        "",
        "## Current class",
        "",
        f"The {report['currentClass']['targetDraftYear']} class is **{report['currentClass']['status']}**: "
        f"{report['currentClass']['reason']}",
        "",
        "## Limitations",
        "",
    ])
    lines.extend(f"- {limitation}" for limitation in report["limitations"])
    lines.extend(["", "## Next experiment", "", report["nextExperiment"], ""])
    return "\n".join(lines)


def build_and_audit(*, refresh: bool, offline: bool) -> dict[str, Any]:
    manifest = collect_future_rookie_sources(
        RAW_ROOT, refresh=refresh, offline=offline
    )
    rosters = load_rosters(RAW_ROOT)
    college_seasons = build_college_seasons(RAW_ROOT, PROCESSED_ROOT)
    identities, identity_audit = load_identity_outcomes(
        RAW_ROOT / "dynastyprocess" / "db_playerids.csv"
    )
    tape = build_same_horizon_tape(rosters, college_seasons, identities)

    PROCESSED_ROOT.mkdir(parents=True, exist_ok=True)
    tape.to_csv(TAPE_PATH, index=False)
    report = build_report(tape, identities, identity_audit, manifest)
    REPORT_ROOT.mkdir(parents=True, exist_ok=True)
    REPORT_JSON.write_text(json.dumps(report, indent=2) + "\n")
    REPORT_MARKDOWN.write_text(render_markdown(report))
    return report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("collect", "refresh"), nargs="?", default="refresh")
    parser.add_argument("--refresh", action="store_true", help="replace cached pinned files")
    parser.add_argument("--offline", action="store_true", help="require all sources in local cache")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.action == "collect":
        manifest = collect_future_rookie_sources(
            RAW_ROOT, refresh=args.refresh, offline=args.offline
        )
        print(f"Collected {sum(len(value['files']) for key, value in manifest.items() if isinstance(value, dict) and 'files' in value)} pinned source files.")
        return 0

    report = build_and_audit(refresh=args.refresh, offline=args.offline)
    print(f"Wrote {TAPE_PATH}")
    print(f"Wrote {REPORT_JSON}")
    print(f"Wrote {REPORT_MARKDOWN}")
    print(f"V6.4 phase passed: {report['decision']['phasePassed']}")
    return 0 if report["decision"]["phasePassed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
