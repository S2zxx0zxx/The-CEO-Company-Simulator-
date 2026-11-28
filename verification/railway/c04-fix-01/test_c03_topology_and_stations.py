"""Comprehensive deterministic C03 Python verification & synthetic scaling benchmark suite.

Covers topology construction, shared-node connectivity, visual crossing isolation,
parallel tracks, junctions/turn restrictions, circular loops, one-way rules,
zero-length/missing-ref/duplicate quarantine, station attachment (node/way/stop_area/
multi-platform/spatial ranking/ambiguity/disconnected/duplicates), conservative
unknown compatibility attributes, compact roundtrip serialization, C02 JSONL
pipeline integration, and synthetic scaling metrics.
"""

from __future__ import annotations

import ctypes
import json
import math
import os
import random
import sys
import tempfile
import time
import tracemalloc
from ctypes import wintypes

sys.path.insert(0, os.path.dirname(__file__))

from c02_rail_prefilter import CivilianRailPrefilter
from c02_streaming_pipeline import StreamingC02Pipeline
from c03_topology_builder import (
    build_c03_topology_from_jsonl,
    build_c03_topology_from_records,
    compute_canonical_graph_sha256,
    deserialize_compact_pack,
    serialize_compact_pack,
)

HERE = os.path.dirname(os.path.abspath(__file__))
POLICY_PATH = os.environ.get("RAILWAY_C02_POLICY", os.path.join(HERE, "C02_CIVILIAN_RAIL_EXTRACTION_POLICY.json"))


def _get_rss_bytes() -> int | None:
    if sys.platform == "win32":
        try:
            class PMC(ctypes.Structure):
                _fields_ = [
                    ("cb", wintypes.DWORD),
                    ("PageFaultCount", wintypes.DWORD),
                    ("PeakWorkingSetSize", ctypes.c_size_t),
                    ("WorkingSetSize", ctypes.c_size_t),
                    ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                    ("PagefileUsage", ctypes.c_size_t),
                    ("PeakPagefileUsage", ctypes.c_size_t),
                ]

            pmc = PMC()
            pmc.cb = ctypes.sizeof(PMC)
            k32 = ctypes.windll.kernel32
            k32.GetCurrentProcess.restype = wintypes.HANDLE
            hproc = k32.GetCurrentProcess()
            psapi = ctypes.windll.psapi
            psapi.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(PMC), wintypes.DWORD]
            psapi.GetProcessMemoryInfo.restype = wintypes.BOOL
            if psapi.GetProcessMemoryInfo(hproc, ctypes.byref(pmc), pmc.cb):
                return int(pmc.WorkingSetSize)
        except Exception:
            return None
    else:
        try:
            import resource
            return int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss) * 1024
        except Exception:
            return None
    return None


def _node(nid: int, lon: float, lat: float, tags: dict[str, str] | None = None) -> dict:
    return {"type": "node", "id": nid, "lat": lat, "lon": lon, "tags": tags or {}}


def _way(wid: int, refs: list[int], tags: dict[str, str]) -> dict:
    return {"type": "way", "id": wid, "node_refs": refs, "tags": tags}


def _rel(rid: int, members: list[dict], tags: dict[str, str]) -> dict:
    return {"type": "relation", "id": rid, "members": members, "tags": tags}


def test_c03_01_linear_junction_crossing_parallel_and_oneway() -> dict:
    """Linear, Y-junction, parallel tracks, non-connected bridge crossing, coincident nodes, and one-way."""
    recs = [
        # Main line n1 -> n2 -> n3 -> n4 with curved intermediate point n20 and parallel express n1 -> n3
        _node(1, 86.00, 22.00, {"railway": "station", "name": "Alpha"}),
        _node(2, 86.05, 22.00),
        _node(20, 86.075, 22.002),
        _node(3, 86.10, 22.00, {"railway": "station", "name": "Junction B"}),
        _node(4, 86.20, 22.00, {"railway": "station", "name": "Gamma"}),
        # Branch northward from n3 -> n5
        _node(5, 86.10, 22.10, {"railway": "halt", "name": "North Halt"}),
        # Crossing bridge way n10 -> n11 intersecting geometrically near (86.05, 22.00) WITHOUT sharing any node!
        _node(10, 86.05, 21.95, {"railway": "station", "name": "Bridge South"}),
        _node(11, 86.05, 22.05, {"railway": "station", "name": "Bridge North"}),
        # Coincident distinct node at exact Alpha coords [86.00, 22.00]
        _node(99, 86.00, 22.00),
        _node(100, 86.00, 21.96, {"railway": "station", "name": "Coincident Separate"}),

        _way(201, [1, 2, 20, 3], {"railway": "rail", "usage": "main", "gauge": "1676", "electrified": "contact_line", "voltage": "25000", "frequency": "50", "maxspeed": "110", "access": "yes", "oneway": "yes"}),
        _way(202, [1, 3], {"railway": "rail", "usage": "main", "gauge": "1676", "electrified": "contact_line", "voltage": "25 kV", "frequency": "50", "maxspeed": "130 km/h", "access": "yes"}),
        _way(203, [3, 4], {"railway": "rail", "usage": "main", "gauge": "1676", "electrified": "no", "maxspeed": "80", "access": "yes"}),
        _way(204, [3, 5], {"railway": "rail", "usage": "branch", "gauge": "1000", "maxspeed": "60 mph", "access": "permissive"}),
        _way(205, [10, 11], {"railway": "rail", "usage": "main", "bridge": "yes", "layer": "1", "gauge": "1676", "electrified": "no", "access": "yes", "oneway": "-1"}),
        _way(206, [99, 100], {"railway": "rail", "usage": "branch", "gauge": "1676", "access": "yes"}),
    ]

    out = build_c03_topology_from_records(recs, source_url="urn:railway:synthetic:c03-01")
    pack = out["graphPack"]
    topo = out["topologyReport"]

    edge_map = {e["id"]: e for e in pack["edges"]}
    turn_map = {(t["incoming"], t["outgoing"]): t for t in pack["turnRules"]}

    # n1->n3 has parallel corridor: e:201:0:fwd AND e:202:0:fwd
    assert "e:201:0:fwd" in edge_map and "e:201:0:rev" not in edge_map  # oneway=yes
    assert "e:202:0:fwd" in edge_map and "e:202:0:rev" in edge_map  # bidirectional
    assert "e:205:0:rev" in edge_map and "e:205:0:fwd" not in edge_map  # oneway=-1

    # Shared-node-only: 3 disconnected components: main+branch, bridge crossing, coincident separate
    assert topo["counts"]["weakComponentCount"] == 3
    assert "n:3" in topo["junctionNodeIds"]
    assert "n:3" in topo["modeChangeBoundaryNodeIds"]  # electric meets electrified=no!

    # Speed/unit conversions
    assert edge_map["e:202:0:fwd"]["voltageV"] == [25000]
    assert edge_map["e:202:0:fwd"]["maxSpeedKmh"] == 130
    assert edge_map["e:204:0:fwd"]["maxSpeedKmh"] == 97  # round(60 * 1.609344)
    assert edge_map["e:204:0:fwd"]["gaugeMm"] == [1000]

    # Turn rules: straight e:201->e:203 has 0s penalty; diverging turnout e:201->e:204 has 15s; reversal e:202 fwd->rev has reversal=True
    assert turn_map[("e:201:0:fwd", "e:203:0:fwd")]["permitted"] is True
    assert turn_map[("e:201:0:fwd", "e:203:0:fwd")]["penaltyS"] == 0
    assert turn_map[("e:201:0:fwd", "e:204:0:fwd")]["penaltyS"] == 15
    assert turn_map[("e:202:0:fwd", "e:202:0:rev")]["reversal"] is True

    # Curved length exceeds straight chord
    chord_m = math.hypot((86.10 - 86.00) * math.cos(math.radians(22.0)) * 111320, 0)
    assert edge_map["e:201:0:fwd"]["lengthM"] > edge_map["e:202:0:fwd"]["lengthM"]

    return {"case": "c03_01_linear_junction_crossing_parallel_oneway", "passed": True, "edgeCount": len(pack["edges"])}


def test_c03_02_circular_loops_and_turn_restrictions() -> dict:
    """Circular loops preserve non-degenerate geometry; turn restrictions & hairpin switchbacks enforced."""
    recs = [
        _node(1, 86.00, 22.00, {"railway": "station", "name": "Loop Hub"}),
        _node(2, 86.02, 22.02),
        _node(3, 86.04, 22.00),
        _node(4, 86.10, 22.00, {"railway": "station", "name": "East Terminal"}),
        _node(5, 86.00, 21.95, {"railway": "station", "name": "South Branch"}),
        _node(6, 86.03, 21.99),  # Acute switchback fork from node 1
        # Closed loop way 301 starting/ending at node 1 without junctions on 2,3
        _way(301, [1, 2, 3, 1], {"railway": "rail", "usage": "main", "gauge": "1676", "electrified": "no", "access": "yes", "oneway": "yes"}),
        _way(302, [1, 4], {"railway": "rail", "usage": "main", "gauge": "1676", "electrified": "no", "access": "yes"}),
        _way(303, [1, 5], {"railway": "rail", "usage": "branch", "gauge": "1676", "electrified": "no", "access": "yes"}),
        _way(304, [1, 6], {"railway": "rail", "usage": "branch", "gauge": "1676", "electrified": "no", "access": "yes"}),
        # Explicit turn restriction forbidding 301 -> 303 via node 1
        _rel(401, [
            {"type": "way", "ref": 301, "role": "from"},
            {"type": "node", "ref": 1, "role": "via"},
            {"type": "way", "ref": 303, "role": "to"},
        ], {"type": "restriction", "restriction": "no_right_turn"}),
        # Malformed turn restriction missing 'via' -> quarantined safely
        _rel(402, [
            {"type": "way", "ref": 301, "role": "from"},
            {"type": "way", "ref": 302, "role": "to"},
        ], {"type": "restriction", "restriction": "no_left_turn"}),
    ]
    out = build_c03_topology_from_records(recs, source_url="urn:railway:synthetic:c03-02")
    pack = out["graphPack"]
    topo = out["topologyReport"]
    turn_map = {(t["incoming"], t["outgoing"]): t for t in pack["turnRules"]}

    # Circular loop edge e:301:0:fwd connects n:1 -> n:1 with 4 geometry points
    loop_edge = next(e for e in pack["edges"] if e["id"] == "e:301:0:fwd")
    assert loop_edge["from"] == "n:1" and loop_edge["to"] == "n:1" and len(loop_edge["geometry"]) == 4

    # Restriction 401 blocks 301->303
    assert turn_map[("e:301:0:fwd", "e:303:0:fwd")]["permitted"] is False
    # Malformed restriction 402 quarantined cleanly
    assert any(q["reason"] == "QUARANTINED_MALFORMED_TURN_RESTRICTION" for q in topo["quarantinedTopology"])
    # Sharp hairpin switchback from 302 rev (4->1, westward) onto 304 fwd (1->6, ESE ~161 deg deflection) blocked!
    assert turn_map[("e:302:0:rev", "e:304:0:fwd")]["permitted"] is False

    return {"case": "c03_02_circular_loops_and_turn_restrictions", "passed": True}


def test_c03_03_station_attachment_quarantines_and_merges() -> dict:
    """Cover station node, station way, stop_area, spatial candidate ranking, ambiguity, disconnected, duplicates."""
    recs = [
        # Main east-west corridor nodes (~0.005 deg apart ~ 500 m)
        _node(1, 86.0000, 22.0000, {"railway": "station", "name": "Direct Node Station"}),
        _node(2, 86.0050, 22.0000),  # track vertex promoted by station way 20
        _node(3, 86.0100, 22.0000),  # track vertex linked by stop_area 30
        _node(4, 86.0150, 22.0000),  # track vertex for standalone clear station (~60m north)
        _node(5, 86.0200, 22.0000),  # parallel track 1 near ambiguous station
        _node(6, 86.0300, 22.0000),

        # Separate unconnected corridor nearby (10m away from standalone node 502)
        _node(15, 86.0200, 22.0002),
        _node(16, 86.0300, 22.0002),

        # Station way sharing node 2 (platform edge)
        _node(21, 86.0050, 22.0003),
        _way(20, [2, 21], {"railway": "station", "name": "Platform Way Station", "uic_ref": "IN-UIC-20"}),
        # Second platform object representing same station via stop_area & uic_ref -> deterministic merge!
        _node(22, 86.0051, 22.0004, {"railway": "halt", "name": "Platform Way Station", "uic_ref": "IN-UIC-20"}),

        # stop_area relation linking standalone station node 500 with track stop_position node 3
        _node(500, 86.0100, 22.0010, {"railway": "station", "name": "Stop Area Hub"}),
        _rel(30, [
            {"type": "node", "ref": 500, "role": "station"},
            {"type": "node", "ref": 3, "role": "stop"},
        ], {"public_transport": "stop_area", "train": "yes", "name": "Stop Area Hub"}),

        # Unambiguous standalone station (~60m north of node 4)
        _node(501, 86.0150, 22.00055, {"railway": "station", "name": "Standalone Ranked"}),

        # Ambiguous standalone station equidistant (~11m) between unconnected track components n5 and n15
        _node(502, 86.0200, 22.00010, {"railway": "station", "name": "Ambiguous Crossing Stop"}),

        # Disconnected station (5 km north of nearest track)
        _node(503, 86.0100, 22.0500, {"railway": "station", "name": "Distant Disconnected"}),

        # Conflicting duplicates sharing same uic_ref but > 2 km apart
        _node(504, 86.0000, 22.0001, {"railway": "station", "name": "Conflict A", "uic_ref": "DUP-999"}),
        _node(505, 86.0300, 22.0001, {"railway": "station", "name": "Conflict B", "uic_ref": "DUP-999"}),

        _way(100, [1, 2, 3, 4, 5, 6], {"railway": "rail", "usage": "main", "gauge": "1676", "access": "yes"}),
        _way(101, [15, 16], {"railway": "rail", "usage": "branch", "gauge": "1000", "access": "yes"}),
    ]

    out = build_c03_topology_from_records(recs, source_url="urn:railway:synthetic:c03-03")
    pack = out["graphPack"]
    att = out["attachmentReport"]
    attached_map = {r["stationId"]: r for r in att["attached"]}
    quarantined_map = {r["stationId"]: r for r in att["quarantined"]}
    station_ids_in_pack = {s["id"] for s in pack["stations"]}

    assert attached_map["s:node:1"]["method"] == "SHARED_TRACK_NODE" and attached_map["s:node:1"]["confidence"] == 1.0
    # s:node:22 merged into canonical s:node:22 vs s:way:20 (ASCII "s:node:22" < "s:way:20")
    assert "s:node:22" in attached_map and "n:2" in attached_map["s:node:22"]["nodeIds"]
    assert attached_map["s:node:500"]["method"] == "STOP_AREA_RELATION" and "n:3" in attached_map["s:node:500"]["nodeIds"]
    assert attached_map["s:node:501"]["method"] == "SPATIAL_CANDIDATE_RANKED"
    assert 0.5 <= attached_map["s:node:501"]["confidence"] < 1.0
    assert attached_map["s:node:501"]["nodeIds"] == ["n:4"]

    # Ambiguous, disconnected, and conflicting duplicate stations MUST be quarantined & excluded from routable pack
    assert quarantined_map["s:node:502"]["reason"] == "AMBIGUOUS_CANDIDATES"
    assert quarantined_map["s:node:503"]["reason"] == "DISCONNECTED_STATION"
    assert quarantined_map["s:node:504"]["reason"] == "QUARANTINE_CONFLICTING_DUPLICATE_STATION"
    assert quarantined_map["s:node:505"]["reason"] == "QUARANTINE_CONFLICTING_DUPLICATE_STATION"
    for qid in ("s:node:502", "s:node:503", "s:node:504", "s:node:505"):
        assert qid not in station_ids_in_pack

    # Track splitting occurred ONLY at existing track nodes promoted for stations (no fake edges created!)
    assert all(e["provenance"]["sourceId"].startswith("osm:way:") for e in pack["edges"])
    return {"case": "c03_03_station_attachment_quarantines_and_merges", "passed": True, "attached": att["attachedCount"], "quarantined": att["quarantinedCount"]}


def test_c03_04_quarantine_unknown_preservation_and_roundtrip() -> dict:
    """Verify unknown compatibility attributes never fabricate defaults, bad geometry/refs quarantine, and roundtrip hash."""
    recs = [
        _node(1, 86.0, 22.0, {"railway": "station", "name": "Start"}),
        _node(2, 86.1, 22.0, {"railway": "station", "name": "End"}),
        _node(3, 86.0, 22.0),  # Exact duplicate coords as node 1 -> zero-length way!
        _way(10, [1, 2], {"railway": "rail", "usage": "main"}),  # All compatibility tags absent -> unknown/null!
        _way(11, [1, 3], {"railway": "rail", "usage": "main"}),  # Zero-length geometry -> REJECT_ZERO_LENGTH_GEOMETRY
        _way(12, [1, 9999], {"railway": "rail", "usage": "main"}),  # Missing ref -> QUARANTINE_MISSING_NODE_REF
    ]
    out = build_c03_topology_from_records(recs, source_url="urn:railway:synthetic:c03-04")
    pack = out["graphPack"]
    topo = out["topologyReport"]

    # Unknown attributes strictly preserved (NEVER silent broad gauge 1676, DC 0Hz, or access='allowed')
    assert len(pack["edges"]) == 2  # fwd and rev of way 10 only
    for ed in pack["edges"]:
        assert ed["gaugeMm"] is None
        assert ed["electrification"] == "unknown"
        assert ed["voltageV"] is None
        assert ed["frequencyHz"] is None
        assert ed["maxSpeedKmh"] is None
        assert ed["access"] == "unknown"

    reasons = {q["reason"] for q in topo["quarantinedTopology"]}
    assert "REJECT_ZERO_LENGTH_GEOMETRY" in reasons
    assert "QUARANTINE_MISSING_NODE_REF" in reasons

    # Deterministic hashing & permutation invariance + compact gzip roundtrip
    out_rev = build_c03_topology_from_records(list(reversed(recs)), source_url="urn:railway:synthetic:c03-04")
    assert out["graphPack"]["graphSha256"] == out_rev["graphPack"]["graphSha256"]

    blob = out["compactPackBytes"]
    restored = deserialize_compact_pack(blob, verify_sha256=True)
    assert restored["graphSha256"] == pack["graphSha256"]

    # Tampered hash must raise ValueError
    tampered = json.loads(json.dumps(pack))
    tampered["edges"][0]["lengthM"] += 1
    try:
        deserialize_compact_pack(serialize_compact_pack(tampered), verify_sha256=True)
        raise AssertionError("Expected SHA-256 verification failure on tampered pack")
    except ValueError:
        pass

    return {"case": "c03_04_quarantine_unknown_preservation_and_roundtrip", "passed": True}


def test_c03_05_c02_jsonl_pipeline_handoff() -> dict:
    """End-to-end C02 CivilianRailPrefilter + StreamingC02Pipeline -> C03 Topology Builder."""
    with open(POLICY_PATH, "r", encoding="utf-8") as pf:
        prefilter = CivilianRailPrefilter(json.load(pf))
    pipe = StreamingC02Pipeline(prefilter)

    records = [
        _node(1, 86.00, 22.50, {"railway": "station", "name": "C02 East Origin"}),
        _node(2, 86.05, 22.52),
        _node(3, 86.10, 22.50, {"railway": "station", "name": "C02 East Junction"}),
        _node(4, 86.15, 22.50, {"railway": "station", "name": "C02 East Terminus"}),
        _node(90, 86.05, 22.55, {"railway": "station", "name": "Restricted Yard", "military": "yes"}),
        _way(201, [1, 2, 3], {"railway": "rail", "usage": "main", "gauge": "1676", "electrified": "contact_line", "voltage": "25000", "frequency": "50"}),
        _way(202, [3, 4], {"railway": "rail", "usage": "branch", "gauge": "1676", "electrified": "no"}),
        _way(290, [3, 90], {"railway": "rail", "service": "yard"}),
    ]
    with tempfile.TemporaryDirectory() as tmp:
        jsonl = os.path.join(tmp, "c02_out.jsonl")
        sr = pipe.run_stream(records, jsonl, work_dir=tmp)
        assert sr["referenceClosurePassed"]
        c03_res = build_c03_topology_from_jsonl(
            jsonl,
            region_id="in-east-pilot",
            source_url="urn:railway:synthetic:c02-c03-handoff",
            extra_quality_flags=["SYNTHETIC_NOT_REAL_DATA"],
        )
    pack = c03_res["graphPack"]
    assert len(pack["stations"]) == 3  # Restricted yard 90 excluded in C02!
    assert len(pack["edges"]) == 4  # fwd+rev for 201 and 202
    assert "n:3" in c03_res["topologyReport"]["modeChangeBoundaryNodeIds"]
    return {"case": "c03_05_c02_jsonl_pipeline_handoff", "passed": True, "graphSha256": pack["graphSha256"]}


def _build_synthetic_grid_records(cols: int, rows: int) -> list[dict]:
    """Generate a synthetic curved corridor grid with stations, dual-mode junction boundary, and parallel lines."""
    recs: list[dict] = []
    nid = 1
    grid_nids: dict[tuple[int, int], int] = {}
    rng = random.Random(20261128)
    for r in range(rows):
        for c in range(cols):
            lon = 85.0 + c * 0.04
            lat = 22.0 + r * 0.04
            tags = {"railway": "station", "name": f"Station {r}_{c}"} if (r + c) % 3 == 0 else {}
            recs.append(_node(nid, lon, lat, tags))
            grid_nids[(r, c)] = nid
            nid += 1

    wid = 100000
    for r in range(rows):
        for c in range(cols - 1):
            a = grid_nids[(r, c)]
            b = grid_nids[(r, c + 1)]
            mid_id = nid
            nid += 1
            lon_m = 85.0 + (c + 0.5) * 0.04
            lat_m = 22.0 + r * 0.04 + rng.uniform(0.002, 0.006)
            recs.append(_node(mid_id, lon_m, lat_m))
            el_tags = (
                {"electrified": "contact_line", "voltage": "25000", "frequency": "50"}
                if c < cols // 2
                else {"electrified": "no"}
            )
            recs.append(_way(wid, [a, mid_id, b], {
                "railway": "rail",
                "usage": "main",
                "gauge": "1676",
                "maxspeed": "110",
                "access": "yes",
                **el_tags,
            }))
            wid += 1

    for r in range(rows - 1):
        for c in range(cols):
            a = grid_nids[(r, c)]
            b = grid_nids[(r + 1, c)]
            recs.append(_way(wid, [a, b], {
                "railway": "rail",
                "usage": "branch",
                "gauge": "1676",
                "electrified": "contact_line",
                "voltage": "25000",
                "frequency": "50",
                "maxspeed": "90",
                "access": "yes",
            }))
            wid += 1
    return recs


def test_c03_06_scalability_and_benchmarks() -> dict:
    """Measure Python C03 topology build duration, memory, and compact size across synthetic grid scales."""
    scales = [(10, 10), (25, 20), (50, 40)]  # 100, 500, 2000 base grid nodes -> up to ~4000 nodes / ~7800 directed edges
    scale_metrics = []
    sample_500_pack = None

    for cols, rows in scales:
        recs = _build_synthetic_grid_records(cols, rows)
        tracemalloc.start()
        t0 = time.perf_counter()
        out = build_c03_topology_from_records(
            recs,
            region_id="in-east-pilot",
            source_url="urn:railway:synthetic:scale-benchmark",
            extra_quality_flags=["SYNTHETIC_NOT_REAL_DATA"],
            use_sqlite_staging=(cols >= 50),
        )
        elapsed_s = time.perf_counter() - t0
        _, peak_heap = tracemalloc.get_traced_memory()
        tracemalloc.stop()

        pack = out["graphPack"]
        raw_json_bytes = len(json.dumps(pack, separators=(",", ":")).encode("utf-8"))
        compact_bytes = len(out["compactPackBytes"])
        rss_bytes = _get_rss_bytes()

        if (cols, rows) == (25, 20):
            sample_500_pack = out

        scale_metrics.append({
            "grid": f"{cols}x{rows}",
            "sqliteStaged": cols >= 50,
            "nodeCount": len(pack["nodes"]),
            "edgeCount": len(pack["edges"]),
            "stationCount": len(pack["stations"]),
            "turnRuleCount": len(pack["turnRules"]),
            "buildDurationS": round(elapsed_s, 4),
            "rawJsonBytes": raw_json_bytes,
            "compactGzipBytes": compact_bytes,
            "peakTracedPythonHeapBytes": peak_heap,
            "processWorkingSetRssBytes": rss_bytes,
            "under50MbTarget": raw_json_bytes < 50 * 1024 * 1024,
        })

    # Write 500-grid GraphPack + Manifest + AttachmentReport into fixtures for TS benchmark consumption
    if sample_500_pack is not None:
        fix_dir = os.path.join(HERE, "fixtures")
        os.makedirs(fix_dir, exist_ok=True)
        with open(os.path.join(fix_dir, "c03_synthetic_scale_pack.json"), "w", encoding="utf-8") as f:
            json.dump(
                {
                    "graphPack": sample_500_pack["graphPack"],
                    "regionManifest": sample_500_pack["regionManifest"],
                    "attachmentReport": sample_500_pack["attachmentReport"],
                },
                f,
            )

    assert all(m["under50MbTarget"] for m in scale_metrics)
    return {
        "case": "c03_06_scalability_and_benchmarks",
        "passed": True,
        "syntheticBenchmarkOnly": True,
        "actualC08MobileAcceptanceClaimed": False,
        "scales": scale_metrics,
    }


def main() -> int:
    tests = [
        test_c03_01_linear_junction_crossing_parallel_and_oneway,
        test_c03_02_circular_loops_and_turn_restrictions,
        test_c03_03_station_attachment_quarantines_and_merges,
        test_c03_04_quarantine_unknown_preservation_and_roundtrip,
        test_c03_05_c02_jsonl_pipeline_handoff,
        test_c03_06_scalability_and_benchmarks,
    ]
    results = []
    passed = 0
    failed = 0
    for fn in tests:
        try:
            res = fn()
            results.append(res)
            passed += 1 if res.get("passed") else 0
            if not res.get("passed"):
                failed += 1
        except Exception as exc:
            failed += 1
            results.append({"case": fn.__name__, "passed": False, "error": f"{type(exc).__name__}: {exc}"})

    payload = {
        "suite": "c03_python_topology_and_stations",
        "total": len(tests),
        "passed": passed,
        "failed": failed,
        "realPbfProcessed": False,
        "results": results,
    }
    print(json.dumps(payload, indent=2))
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
