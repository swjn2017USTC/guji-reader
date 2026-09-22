from scripts.build_annotation_quality_report import build_report


def test_quality_report_keeps_partial_coverage_distinct() -> None:
    report = build_report()
    assert report["schemaVersion"] == "g4-1"
    assert report["totals"]["passages"] > 0
    assert report["totals"]["reviewedPassages"] >= 0
    vol01 = next(row for row in report["volumes"] if row["volumeId"] == "vol01")
    assert vol01["passageCount"] > vol01["reviewedPassages"]
    assert vol01["unreviewedCandidatePassages"] >= 0
    assert report["releaseGate"]["passed"] is True
