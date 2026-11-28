"""V3 hardened synthetic preflight test suite for C02 civilian railway extraction policy.

Executes:
1. Original 11 regression tests (preserved intact).
2. V2 7 acceptance checks (preserved intact).
3. All 16 coordinator extended regression checks (5 previously passing + 11 remediated),
   plus additional reference-closure & geometry-recomputation invariants.

Uses purely synthetic records only; never touches real geographic datasets.
"""

from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from c02_rail_prefilter import CivilianRailPrefilter

POLICY_PATH = os.path.join(os.path.dirname(__file__), "C02_CIVILIAN_RAIL_EXTRACTION_POLICY.json")


def build_synthetic_cases() -> list[tuple[str, dict, str]]:
    """Return original 11 synthetic cases: (case_name, synthetic_record, expected_reason_code)."""
    return [
        (
            "allow_mainline_civilian_rail",
            {
                "type": "way",
                "id": 900001,
                "node_refs": [101, 102],
                "tags": {
                    "railway": "rail",
                    "name": "Synthetic Mainline",
                    "usage": "main",
                    "gauge": "1676",
                    "electrified": "contact_line",
                    "voltage": "25000",
                    "frequency": "50",
                    "source": "survey_synthetic",
                },
            },
            "ALLOW_CIVILIAN_RAIL_WAY",
        ),
        (
            "allow_rail_normalizes_unknown_gauge_electrified",
            {
                "type": "way",
                "id": 900002,
                "node_refs": [101, 102],
                "tags": {
                    "railway": "rail",
                    "name": "Synthetic Branch Line",
                },
            },
            "ALLOW_CIVILIAN_RAIL_WAY",
        ),
        (
            "allow_civilian_station_strips_extra_tags",
            {
                "type": "node",
                "id": 900101,
                "lat": 0.0,
                "lon": 0.0,
                "tags": {
                    "railway": "station",
                    "name": "Synthetic Junction",
                    "ref": "SYNJ",
                    "operator": "Public Rail",
                    "building": "train_station",
                    "note": "strip_me",
                },
            },
            "ALLOW_CIVILIAN_STATION",
        ),
        (
            "deny_private_access_rail",
            {
                "type": "way",
                "id": 900003,
                "node_refs": [101, 102],
                "tags": {
                    "railway": "rail",
                    "access": "private",
                    "name": "Private Siding",
                },
            },
            "DENY_RESTRICTED_ACCESS",
        ),
        (
            "deny_uncertain_spur_service",
            {
                "type": "way",
                "id": 900004,
                "node_refs": [101, 102],
                "tags": {
                    "railway": "rail",
                    "service": "spur",
                },
            },
            "DENY_EXCLUDED_OR_UNCERTAIN_SERVICE",
        ),
        (
            "deny_military_usage_rail",
            {
                "type": "way",
                "id": 900005,
                "node_refs": [101, 102],
                "tags": {
                    "railway": "rail",
                    "usage": "military",
                },
            },
            "DENY_SENSITIVE_OR_RESTRICTED",
        ),
        (
            "deny_sensitive_facility_keyword_siding",
            {
                "type": "way",
                "id": 900006,
                "node_refs": [101, 102],
                "tags": {
                    "railway": "rail",
                    "name": "Synthetic Ordnance Depot Spur",
                },
            },
            "DENY_SENSITIVE_OR_RESTRICTED",
        ),
        (
            "deny_political_boundary",
            {
                "type": "way",
                "id": 900007,
                "node_refs": [101, 102],
                "tags": {
                    "boundary": "administrative",
                    "admin_level": "4",
                    "name": "Synthetic State Boundary",
                },
            },
            "DENY_POLITICAL_BOUNDARY",
        ),
        (
            "deny_unrelated_infrastructure_power",
            {
                "type": "node",
                "id": 900102,
                "lat": 0.0,
                "lon": 0.0,
                "tags": {
                    "power": "substation",
                    "name": "Synthetic Grid",
                },
            },
            "DENY_UNRELATED_INFRASTRUCTURE",
        ),
        (
            "deny_border_zone_tag",
            {
                "type": "way",
                "id": 900008,
                "node_refs": [101, 102],
                "tags": {
                    "railway": "rail",
                    "border": "international",
                },
            },
            "DENY_UNCERTAIN_TERRITORY",
        ),
        (
            "quarantine_way_referencing_excluded_node",
            {
                "type": "way",
                "id": 900009,
                "node_refs": [101, 900102],
                "tags": {
                    "railway": "rail",
                    "usage": "main",
                },
            },
            "QUARANTINE_EXCLUDED_OR_MISSING_REFERENCE",
        ),
    ]


def run_original_11_tests(pf: CivilianRailPrefilter) -> list[dict]:
    cases = build_synthetic_cases()
    excluded_nodes = {900102}
    valid_nodes = {101, 102, 900101}
    results = []
    for case_name, rec, expected in cases:
        actual, out = pf.evaluate_record(
            rec,
            excluded_node_ids=excluded_nodes,
            valid_node_ids=valid_nodes,
        )
        passed = actual == expected
        if actual == "ALLOW_CIVILIAN_RAIL_WAY" and out is not None:
            if "source" in out["tags"]:
                passed = False
            if case_name == "allow_rail_normalizes_unknown_gauge_electrified":
                if out["tags"].get("gauge") != "unknown" or out["tags"].get("electrified") != "unknown":
                    passed = False
        if actual == "ALLOW_CIVILIAN_STATION" and out is not None:
            if "building" in out["tags"] or "note" in out["tags"]:
                passed = False
        results.append({"case": case_name, "expected": expected, "actual": actual, "passed": passed})
    return results


def run_additional_7_acceptance_checks(pf: CivilianRailPrefilter) -> list[dict]:
    """V2 7 acceptance checks (preserved intact)."""
    results = []

    batch1 = pf.run_batch([
        {"type": "node", "id": 101, "lat": 22.1, "lon": 86.1, "tags": {}},
        {"type": "node", "id": 102, "lat": 22.2, "lon": 86.2, "tags": {}},
        {"type": "node", "id": 103, "lat": 22.3, "lon": 86.3, "tags": {}},
        {
            "type": "way",
            "id": 201,
            "node_refs": [101, 102],
            "tags": {"railway": "rail", "usage": "main", "name": "Synthetic Track"},
        },
    ])
    retained_ids1 = {r["id"] for r in batch1["retainedRecords"]}
    results.append({
        "case": "accept_referenced_untagged_geometry_nodes_with_track",
        "passed": (
            retained_ids1 == {101, 102, 201}
            and batch1["reasonCounts"].get("ALLOW_CIVILIAN_RAIL_WAY") == 1
            and batch1["reasonCounts"].get("ALLOW_GEOMETRY_NODE") == 2
            and batch1["reasonCounts"].get("DROP_UNREFERENCED_GEOMETRY_NODE") == 1
        ),
        "detail": batch1["reasonCounts"],
    })

    batch2 = pf.run_batch([
        {"type": "node", "id": 101, "lat": 22.1, "lon": 86.1, "tags": {}},
        {
            "type": "way",
            "id": 202,
            "node_refs": [101, 999999],
            "tags": {"railway": "rail", "usage": "main"},
        },
    ])
    results.append({
        "case": "reject_missing_node_references",
        "passed": (
            batch2["retainedCount"] == 0
            and batch2["reasonCounts"].get("QUARANTINE_MISSING_NODE_REFERENCE") == 1
            and batch2["reasonCounts"].get("DROP_UNREFERENCED_GEOMETRY_NODE") == 1
        ),
        "detail": batch2["reasonCounts"],
    })

    code3, out3 = pf.evaluate_record({
        "type": "node",
        "id": 301,
        "lat": 23.45,
        "lon": 87.65,
        "tags": {"railway": "station", "name": "Synthetic Station", "note": "drop"},
    })
    results.append({
        "case": "preserve_station_node_geometry",
        "passed": (
            code3 == "ALLOW_CIVILIAN_STATION"
            and out3 is not None
            and out3.get("lat") == 23.45
            and out3.get("lon") == 87.65
            and "note" not in out3["tags"]
        ),
        "detail": {"code": code3, "hasLatLon": out3 is not None and "lat" in out3 and "lon" in out3},
    })

    batch4 = pf.run_batch([
        {"type": "node", "id": 401, "lat": 22.10, "lon": 86.10, "tags": {}},
        {"type": "node", "id": 402, "lat": 22.11, "lon": 86.11, "tags": {}},
        {"type": "node", "id": 403, "lat": 22.12, "lon": 86.10, "tags": {}},
        {
            "type": "way",
            "id": 410,
            "node_refs": [401, 402, 403, 401],
            "tags": {"railway": "station", "name": "Synthetic Terminal Area", "building": "yes"},
        },
    ])
    station_ways = [r for r in batch4["retainedRecords"] if r["type"] == "way" and r["id"] == 410]
    results.append({
        "case": "preserve_station_way_node_refs",
        "passed": (
            len(station_ways) == 1
            and station_ways[0].get("node_refs") == [401, 402, 403, 401]
            and "building" not in station_ways[0]["tags"]
            and batch4["reasonCounts"].get("ALLOW_GEOMETRY_NODE") == 3
        ),
        "detail": batch4["reasonCounts"],
    })

    bad_coords = [
        {"type": "node", "id": 501, "lat": 91.0, "lon": 86.0, "tags": {}},
        {"type": "node", "id": 502, "lat": 22.0, "lon": 181.0, "tags": {}},
        {"type": "node", "id": 503, "lat": float("nan"), "lon": 86.0, "tags": {"railway": "station", "name": "Bad"}},
        {"type": "node", "id": 504, "lat": float("inf"), "lon": 86.0, "tags": {}},
        {"type": "node", "id": 505, "lat": True, "lon": 86.0, "tags": {}},
        {"type": "node", "id": 506, "lat": "22.0", "lon": 86.0, "tags": {}},
        {"type": "node", "id": 507, "lat": None, "lon": 86.0, "tags": {}},
    ]
    coord_codes = [pf.evaluate_record(r)[0] for r in bad_coords]
    results.append({
        "case": "reject_invalid_coordinates",
        "passed": all(c == "REJECT_INVALID_COORDINATE" for c in coord_codes),
        "detail": coord_codes,
    })

    bad_ids = [
        {"type": "node", "lat": 22.0, "lon": 86.0, "tags": {}},
        {"type": "node", "id": None, "lat": 22.0, "lon": 86.0, "tags": {}},
        {"type": "node", "id": 0, "lat": 22.0, "lon": 86.0, "tags": {}},
        {"type": "way", "id": -5, "node_refs": [101, 102], "tags": {"railway": "rail"}},
        {"type": "node", "id": True, "lat": 22.0, "lon": 86.0, "tags": {}},
        {"type": "relation", "id": "999", "members": [], "tags": {"type": "route", "route": "train"}},
    ]
    id_codes = [pf.evaluate_record(r)[0] for r in bad_ids]
    results.append({
        "case": "reject_missing_or_invalid_object_ids",
        "passed": all(c == "REJECT_INVALID_OR_MISSING_ID" for c in id_codes),
        "detail": id_codes,
    })

    batch7 = pf.run_batch([
        {"type": "node", "id": 701, "lat": 22.1, "lon": 86.1, "tags": {"railway": "station", "name": "Start"}},
        {"type": "node", "id": 702, "lat": 22.2, "lon": 86.2, "tags": {}},
        {"type": "node", "id": 703, "lat": 22.3, "lon": 86.3, "tags": {"power": "substation", "name": "RestrictedPower"}},
        {"type": "way", "id": 710, "node_refs": [701, 702], "tags": {"railway": "rail", "usage": "main"}},
        {"type": "way", "id": 711, "node_refs": [701, 702], "tags": {"railway": "rail", "usage": "military"}},
        {
            "type": "relation",
            "id": 720,
            "members": [
                {"type": "node", "ref": 701, "role": "stop"},
                {"type": "way", "ref": 710, "role": ""},
            ],
            "tags": {"type": "route", "route": "train", "name": "Synthetic Express", "colour": "blue"},
        },
        {
            "type": "relation",
            "id": 721,
            "members": [
                {"type": "node", "ref": 703, "role": "stop"},
                {"type": "way", "ref": 710, "role": ""},
            ],
            "tags": {"type": "route", "route": "train", "name": "Bad Excluded Node Member"},
        },
        {
            "type": "relation",
            "id": 722,
            "members": [{"type": "way", "ref": 711, "role": ""}],
            "tags": {"type": "route", "route": "train", "name": "Bad Excluded Way Member"},
        },
        {
            "type": "relation",
            "id": 723,
            "members": [{"type": "way", "ref": 999998, "role": ""}],
            "tags": {"type": "route", "route": "train", "name": "Missing Way Member"},
        },
        {
            "type": "relation",
            "id": 724,
            "members": [{"type": "way", "ref": 710, "role": ""}],
            "tags": {"type": "boundary", "boundary": "administrative", "admin_level": "4"},
        },
        {
            "type": "relation",
            "id": 725,
            "members": [],
            "tags": {"type": "route", "route": "train", "name": "Empty Members"},
        },
        {
            "type": "relation",
            "id": 726,
            "members": [{"type": "relation", "ref": 720, "role": "subroute"}],
            "tags": {"type": "route", "route": "train", "name": "Nested Relation"},
        },
    ])
    retained_rels = [r for r in batch7["retainedRecords"] if r["type"] == "relation"]
    results.append({
        "case": "enforce_explicit_relation_member_contract",
        "passed": (
            len(retained_rels) == 1
            and retained_rels[0]["id"] == 720
            and "colour" not in retained_rels[0]["tags"]
            and batch7["reasonCounts"].get("ALLOW_CIVILIAN_RELATION") == 1
            and batch7["reasonCounts"].get("QUARANTINE_EXCLUDED_RELATION_MEMBER") == 2
            and batch7["reasonCounts"].get("QUARANTINE_MISSING_OR_UNAPPROVED_RELATION_MEMBER") == 1
            and batch7["reasonCounts"].get("DENY_POLITICAL_BOUNDARY") == 1
            and batch7["reasonCounts"].get("REJECT_MALFORMED_OR_EMPTY_RELATION_MEMBERS") == 1
            and batch7["reasonCounts"].get("QUARANTINE_UNSUPPORTED_NESTED_RELATION_MEMBER") == 1
        ),
        "detail": batch7["reasonCounts"],
    })

    return results


def run_coordinator_16_regression_checks(pf: CivilianRailPrefilter) -> list[dict]:
    """Cover all 16 coordinator checks (5 previously passing + 11 V3 hardening fixes)."""
    results = []

    # 1. Node exclusion conflict rejected both orders (previously PASS)
    n_allow = {"type": "node", "id": 1001, "lat": 22.1, "lon": 86.1, "tags": {"railway": "station", "name": "S"}}
    n_deny = {"type": "node", "id": 1001, "lat": 22.1, "lon": 86.1, "tags": {"power": "substation", "name": "P"}}
    b1a = pf.run_batch([n_allow, n_deny])
    b1b = pf.run_batch([n_deny, n_allow])
    results.append({
        "case": "coord_01_node_exclusion_conflict_both_orders",
        "passed": b1a["retainedCount"] == 0 and b1b["retainedCount"] == 0 and b1a["reasonCounts"] == b1b["reasonCounts"],
        "detail": b1a["reasonCounts"],
    })

    # 2. Valid batch references accepted (previously PASS)
    b2 = pf.run_batch([
        {"type": "node", "id": 1011, "lat": 22.1, "lon": 86.1, "tags": {"railway": "station", "name": "A"}},
        {"type": "node", "id": 1012, "lat": 22.2, "lon": 86.2, "tags": {}},
        {"type": "way", "id": 1013, "node_refs": [1011, 1012], "tags": {"railway": "rail", "usage": "main"}},
        {"type": "relation", "id": 1014, "members": [{"type": "node", "ref": 1011, "role": "stop"}, {"type": "way", "ref": 1013, "role": ""}], "tags": {"type": "route", "route": "train", "name": "R"}},
    ])
    results.append({
        "case": "coord_02_valid_batch_references_accepted",
        "passed": b2["retainedCount"] == 4 and b2["excludedCount"] == 0,
        "detail": b2["reasonCounts"],
    })

    # 3. Missing relation member quarantined (previously PASS)
    b3 = pf.run_batch([
        {"type": "node", "id": 1021, "lat": 22.1, "lon": 86.1, "tags": {"railway": "station", "name": "A"}},
        {"type": "relation", "id": 1022, "members": [{"type": "node", "ref": 1021, "role": "stop"}, {"type": "way", "ref": 999123, "role": ""}], "tags": {"type": "route", "route": "train", "name": "R"}},
    ])
    results.append({
        "case": "coord_03_missing_relation_member_quarantined",
        "passed": b3["reasonCounts"].get("QUARANTINE_MISSING_OR_UNAPPROVED_RELATION_MEMBER") == 1 and all(r["type"] != "relation" for r in b3["retainedRecords"]),
        "detail": b3["reasonCounts"],
    })

    # 4. Unreferenced geometry dropped (previously PASS)
    b4 = pf.run_batch([{"type": "node", "id": 1031, "lat": 22.1, "lon": 86.1, "tags": {}}])
    results.append({
        "case": "coord_04_unreferenced_geometry_dropped",
        "passed": b4["retainedCount"] == 0 and b4["reasonCounts"].get("DROP_UNREFERENCED_GEOMETRY_NODE") == 1,
        "detail": b4["reasonCounts"],
    })

    # 5. Excluded node propagates to way and relation (previously PASS)
    b5 = pf.run_batch([
        {"type": "node", "id": 1041, "lat": 22.1, "lon": 86.1, "tags": {"military": "yes"}},
        {"type": "node", "id": 1042, "lat": 22.2, "lon": 86.2, "tags": {}},
        {"type": "way", "id": 1043, "node_refs": [1041, 1042], "tags": {"railway": "rail", "usage": "main"}},
        {"type": "relation", "id": 1044, "members": [{"type": "way", "ref": 1043, "role": ""}], "tags": {"type": "route", "route": "train", "name": "R"}},
    ])
    results.append({
        "case": "coord_05_excluded_node_propagates_to_way_and_relation",
        "passed": b5["retainedCount"] == 0 and b5["reasonCounts"].get("DROP_UNREFERENCED_GEOMETRY_NODE") == 1,
        "detail": b5["reasonCounts"],
    })

    # 6. Way exclusion conflict quarantined in both orderings (was FAIL #1)
    n1 = {"type": "node", "id": 1101, "lat": 22.1, "lon": 86.1, "tags": {}}
    n2 = {"type": "node", "id": 1102, "lat": 22.2, "lon": 86.2, "tags": {}}
    w_allow = {"type": "way", "id": 1105, "node_refs": [1101, 1102], "tags": {"railway": "rail", "usage": "main"}}
    w_deny = {"type": "way", "id": 1105, "node_refs": [1101, 1102], "tags": {"railway": "rail", "access": "private"}}
    b6a = pf.run_batch([n1, n2, w_allow, w_deny])
    b6b = pf.run_batch([n1, n2, w_deny, w_allow])
    results.append({
        "case": "coord_06_way_exclusion_conflict_both_orders",
        "passed": (
            b6a["retainedCount"] == 0
            and b6b["retainedCount"] == 0
            and b6a["reasonCounts"] == b6b["reasonCounts"]
            and b6a["reasonCounts"].get("DROP_UNREFERENCED_GEOMETRY_NODE") == 2
        ),
        "detail": b6a["reasonCounts"],
    })

    # 7. Relation exclusion conflict quarantined in both orderings (was FAIL #2)
    r_base = [
        {"type": "node", "id": 1201, "lat": 22.1, "lon": 86.1, "tags": {}},
        {"type": "node", "id": 1202, "lat": 22.2, "lon": 86.2, "tags": {}},
        {"type": "way", "id": 1205, "node_refs": [1201, 1202], "tags": {"railway": "rail", "usage": "main"}},
    ]
    rel_allow = {"type": "relation", "id": 1210, "members": [{"type": "way", "ref": 1205, "role": ""}], "tags": {"type": "route", "route": "train", "name": "R"}}
    rel_deny = {"type": "relation", "id": 1210, "members": [{"type": "way", "ref": 1205, "role": ""}], "tags": {"type": "boundary", "boundary": "administrative", "admin_level": "4"}}
    b7a = pf.run_batch(r_base + [rel_allow, rel_deny])
    b7b = pf.run_batch(r_base + [rel_deny, rel_allow])
    results.append({
        "case": "coord_07_relation_exclusion_conflict_both_orders",
        "passed": (
            all(r["type"] != "relation" for r in b7a["retainedRecords"])
            and all(r["type"] != "relation" for r in b7b["retainedRecords"])
            and b7a["reasonCounts"] == b7b["reasonCounts"]
        ),
        "detail": b7a["reasonCounts"],
    })

    # 8. Conflicting allowed node identities quarantined, not overwritten (was FAIL #3)
    b8 = pf.run_batch([
        {"type": "node", "id": 1301, "lat": 22.1, "lon": 86.1, "tags": {}},
        {"type": "node", "id": 1301, "lat": 22.9, "lon": 86.9, "tags": {}},
        {"type": "node", "id": 1302, "lat": 22.2, "lon": 86.2, "tags": {}},
        {"type": "way", "id": 1305, "node_refs": [1301, 1302], "tags": {"railway": "rail", "usage": "main"}},
    ])
    results.append({
        "case": "coord_08_conflicting_allowed_node_quarantined",
        "passed": (
            b8["retainedCount"] == 0
            and b8["reasonCounts"].get("QUARANTINE_CONFLICTING_NODE_IDENTITY") == 2
            and b8["reasonCounts"].get("QUARANTINE_EXCLUDED_OR_MISSING_REFERENCE") == 1
        ),
        "detail": b8["reasonCounts"],
    })

    # 9. Conflicting allowed way identities quarantined & geometry recomputed (was FAIL #4)
    b9 = pf.run_batch([
        {"type": "node", "id": 1401, "lat": 22.1, "lon": 86.1, "tags": {}},
        {"type": "node", "id": 1402, "lat": 22.2, "lon": 86.2, "tags": {}},
        {"type": "node", "id": 1403, "lat": 22.3, "lon": 86.3, "tags": {}},
        {"type": "way", "id": 1410, "node_refs": [1401, 1402], "tags": {"railway": "rail", "usage": "main"}},
        {"type": "way", "id": 1410, "node_refs": [1401, 1403], "tags": {"railway": "rail", "usage": "main"}},
    ])
    results.append({
        "case": "coord_09_conflicting_allowed_way_quarantined",
        "passed": (
            b9["retainedCount"] == 0
            and b9["reasonCounts"].get("QUARANTINE_CONFLICTING_WAY_IDENTITY") == 2
            and b9["reasonCounts"].get("DROP_UNREFERENCED_GEOMETRY_NODE") == 3
        ),
        "detail": b9["reasonCounts"],
    })

    # 10. Identical relations deduplicated deterministically (was FAIL #5)
    rel_dup = {"type": "relation", "id": 1510, "members": [{"type": "way", "ref": 1505, "role": ""}], "tags": {"type": "route", "route": "train", "name": "R"}}
    b10 = pf.run_batch([
        {"type": "node", "id": 1501, "lat": 22.1, "lon": 86.1, "tags": {}},
        {"type": "node", "id": 1502, "lat": 22.2, "lon": 86.2, "tags": {}},
        {"type": "way", "id": 1505, "node_refs": [1501, 1502], "tags": {"railway": "rail", "usage": "main"}},
        rel_dup,
        dict(rel_dup),
    ])
    rels10 = [r for r in b10["retainedRecords"] if r["type"] == "relation"]
    results.append({
        "case": "coord_10_identical_relations_deduplicated",
        "passed": (
            len(rels10) == 1
            and b10["reasonCounts"].get("ALLOW_CIVILIAN_RELATION") == 1
            and b10["reasonCounts"].get("DEDUPLICATE_IDENTICAL_RELATION") == 1
            and sum(b10["reasonCounts"].values()) == 5
        ),
        "detail": b10["reasonCounts"],
    })

    # 11. Direct way evaluation without reference context fails closed (was FAIL #6)
    c11, o11 = pf.evaluate_record({"type": "way", "id": 1601, "node_refs": [101, 102], "tags": {"railway": "rail", "usage": "main"}})
    results.append({
        "case": "coord_11_direct_way_without_context_fails_closed",
        "passed": c11 == "QUARANTINE_UNRESOLVED_REFERENCE_CONTEXT" and o11 is None,
        "detail": c11,
    })

    # 12. Direct relation evaluation without member context fails closed (was FAIL #7)
    c12, o12 = pf.evaluate_record({"type": "relation", "id": 1701, "members": [{"type": "way", "ref": 1601, "role": ""}], "tags": {"type": "route", "route": "train", "name": "R"}})
    results.append({
        "case": "coord_12_direct_relation_without_context_fails_closed",
        "passed": c12 == "QUARANTINE_UNRESOLVED_MEMBER_CONTEXT" and o12 is None,
        "detail": c12,
    })

    # 13. denyOperatorTypes wired and enforced on operator:type and operator (was FAIL #8)
    c13a, o13a = pf.evaluate_record({"type": "node", "id": 1801, "lat": 22.1, "lon": 86.1, "tags": {"railway": "station", "name": "Plant Station", "operator:type": "private_plant"}})
    c13b, o13b = pf.evaluate_record({"type": "node", "id": 1802, "lat": 22.1, "lon": 86.1, "tags": {"railway": "station", "name": "Ok Station", "operator:type": "public", "operator": "Indian Railways"}})
    results.append({
        "case": "coord_13_deny_operator_types_enforced",
        "passed": (
            c13a == "DENY_RESTRICTED_OPERATOR_TYPE"
            and o13a is None
            and c13b == "ALLOW_CIVILIAN_STATION"
            and o13b is not None
            and "operator:type" not in o13b["tags"]
        ),
        "detail": {"denied": c13a, "allowed": c13b},
    })

    # 14. Track allowedUsageValues enforced for unknown nonempty value (was FAIL #9)
    c14a, o14a = pf.evaluate_record(
        {"type": "way", "id": 1901, "node_refs": [101, 102], "tags": {"railway": "rail", "usage": "experimental_freight"}},
        valid_node_ids={101, 102},
    )
    c14b, o14b = pf.evaluate_record(
        {"type": "way", "id": 1902, "node_refs": [101, 102], "tags": {"railway": "rail", "usage": "branch"}},
        valid_node_ids={101, 102},
    )
    results.append({
        "case": "coord_14_track_allowed_usage_enforced",
        "passed": c14a == "DENY_UNAPPROVED_TRACK_USAGE" and o14a is None and c14b == "ALLOW_CIVILIAN_RAIL_WAY" and o14b is not None,
        "detail": {"unapproved": c14a, "approved": c14b},
    })

    # 15. Oversized numeric coordinates handled without OverflowError (was FAIL #10)
    c15a, o15a = pf.evaluate_record({"type": "node", "id": 2001, "lat": 10**400, "lon": 86.0, "tags": {}})
    c15b, o15b = pf.evaluate_record({"type": "node", "id": 2002, "lat": 22.0, "lon": -(10**400), "tags": {"railway": "station", "name": "Big"}})
    results.append({
        "case": "coord_15_oversized_numeric_coordinates_rejected_safely",
        "passed": c15a == "REJECT_INVALID_COORDINATE" and o15a is None and c15b == "REJECT_INVALID_COORDINATE" and o15b is None,
        "detail": [c15a, c15b],
    })

    # 16. Malformed non-object batch elements rejected safely without AttributeError (was FAIL #11)
    b16 = pf.run_batch([
        None,
        "bad_string",
        123,
        ["not", "dict"],
        {"type": "node", "id": 2101, "lat": 22.1, "lon": 86.1, "tags": {"railway": "station", "name": "Valid"}},
    ])
    results.append({
        "case": "coord_16_malformed_non_object_batch_records_rejected",
        "passed": (
            b16["retainedCount"] == 1
            and b16["reasonCounts"].get("REJECT_MALFORMED_RECORD") == 4
            and b16["reasonCounts"].get("ALLOW_CIVILIAN_STATION") == 1
            and sum(b16["reasonCounts"].values()) == 5
        ),
        "detail": b16["reasonCounts"],
    })

    return results


def run_extra_v3_closure_checks(pf: CivilianRailPrefilter) -> list[dict]:
    """Additional V3 checks for conflicting relation identities and end-to-end closure."""
    results = []

    rel1 = {"type": "relation", "id": 2210, "members": [{"type": "way", "ref": 2205, "role": ""}], "tags": {"type": "route", "route": "train", "name": "R1"}}
    rel2 = {"type": "relation", "id": 2210, "members": [{"type": "way", "ref": 2205, "role": "forward"}], "tags": {"type": "route", "route": "train", "name": "R1"}}
    b_rel_conflict = pf.run_batch([
        {"type": "node", "id": 2201, "lat": 22.1, "lon": 86.1, "tags": {}},
        {"type": "node", "id": 2202, "lat": 22.2, "lon": 86.2, "tags": {}},
        {"type": "way", "id": 2205, "node_refs": [2201, 2202], "tags": {"railway": "rail", "usage": "main"}},
        rel1,
        rel2,
    ])
    results.append({
        "case": "v3_conflicting_allowed_relation_quarantined",
        "passed": (
            all(r["type"] != "relation" for r in b_rel_conflict["retainedRecords"])
            and b_rel_conflict["reasonCounts"].get("QUARANTINE_CONFLICTING_RELATION_IDENTITY") == 2
            and sum(b_rel_conflict["reasonCounts"].values()) == 5
        ),
        "detail": b_rel_conflict["reasonCounts"],
    })

    # Identical nodes & ways deduplicated deterministically while conflicting station vs geom quarantined
    n_same = {"type": "node", "id": 2301, "lat": 22.1, "lon": 86.1, "tags": {}}
    n2 = {"type": "node", "id": 2302, "lat": 22.2, "lon": 86.2, "tags": {}}
    w_same = {"type": "way", "id": 2305, "node_refs": [2301, 2302], "tags": {"railway": "rail", "usage": "main"}}
    b_dedup = pf.run_batch([n_same, dict(n_same), n2, w_same, dict(w_same)])
    results.append({
        "case": "v3_identical_nodes_and_ways_deduplicated_deterministically",
        "passed": (
            b_dedup["retainedCount"] == 3
            and b_dedup["reasonCounts"].get("DEDUPLICATE_IDENTICAL_NODE") == 1
            and b_dedup["reasonCounts"].get("DEDUPLICATE_IDENTICAL_WAY") == 1
            and sum(b_dedup["reasonCounts"].values()) == 5
        ),
        "detail": b_dedup["reasonCounts"],
    })

    return results


def main() -> int:
    pf = CivilianRailPrefilter.from_file(POLICY_PATH)
    orig_results = run_original_11_tests(pf)
    v2_results = run_additional_7_acceptance_checks(pf)
    coord_results = run_coordinator_16_regression_checks(pf)
    v3_extra = run_extra_v3_closure_checks(pf)

    orig_pass = sum(1 for r in orig_results if r["passed"])
    v2_pass = sum(1 for r in v2_results if r["passed"])
    coord_pass = sum(1 for r in coord_results if r["passed"])
    extra_pass = sum(1 for r in v3_extra if r["passed"])

    existing_34_total = len(orig_results) + len(v2_results) + len(coord_results)
    existing_34_pass = orig_pass + v2_pass + coord_pass
    all_total = existing_34_total + len(v3_extra)
    all_pass = existing_34_pass + extra_pass

    summary = {
        "originalSuite": {"total": len(orig_results), "passed": orig_pass, "failed": len(orig_results) - orig_pass, "results": orig_results},
        "v2AcceptanceSuite": {"total": len(v2_results), "passed": v2_pass, "failed": len(v2_results) - v2_pass, "results": v2_results},
        "coordinator16Suite": {"total": len(coord_results), "passed": coord_pass, "failed": len(coord_results) - coord_pass, "results": coord_results},
        "v3ExtraClosureSuite": {"total": len(v3_extra), "passed": extra_pass, "failed": len(v3_extra) - extra_pass, "results": v3_extra},
        "existing34Combined": {"total": existing_34_total, "passed": existing_34_pass, "failed": existing_34_total - existing_34_pass},
        "combinedAll": {"total": all_total, "passed": all_pass, "failed": all_total - all_pass},
    }
    print(json.dumps(summary, indent=2))
    return 0 if all_pass == all_total else 1


if __name__ == "__main__":
    raise SystemExit(main())
