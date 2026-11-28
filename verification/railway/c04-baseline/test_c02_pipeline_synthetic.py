"""Hardened portable synthetic verification suite for C02 intake, streaming XML, Osmium smoke, and C03 TS."""

from __future__ import annotations

import json
import os
import random
import shutil
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(__file__))
from c02_downstream_adapter import build_graph_pack_from_jsonl
from c02_rail_prefilter import CivilianRailPrefilter
from c02_streaming_pipeline import (
    ComplianceGateError,
    StreamingC02Pipeline,
    assert_real_data_intake_allowed,
    assert_workspace_private_and_non_sync,
    build_osmium_cat_command,
    build_osmium_check_refs_command,
    build_osmium_tags_filter_command,
    iter_osm_xml_records,
)

HERE = os.path.dirname(os.path.abspath(__file__))
POLICY_PATH = os.environ.get("RAILWAY_C02_POLICY", os.path.join(HERE, "C02_CIVILIAN_RAIL_EXTRACTION_POLICY.json"))
VERIFY_MJS = os.path.join(HERE, "verify_downstream_graphpack.mjs")
SMOKE_FIXTURE_PATH = os.path.join(HERE, "fixtures", "c02_synthetic_smoke.osm")
SMOKE_FIXTURE_SHA256 = "4277063323152c72a4498ed61df9826bd40dba30e6ea2c92a975357a22b5d3d3"


def resolve_node_exe() -> str | None:
    """Resolve Node.js executable portably across Windows and Linux."""
    for env_key in ("RAILWAY_NODE_EXE", "NODE_EXE"):
        cand = os.environ.get(env_key)
        if cand and os.path.exists(cand):
            return cand
    found = shutil.which("node")
    if found:
        return found
    win_default = r"C:\Program Files\nodejs\node.exe"
    if os.path.exists(win_default):
        return win_default
    return None


def resolve_repo_root() -> str | None:
    """Resolve repository root containing src/domain/models.ts portably."""
    env_root = os.environ.get("RAILWAY_REPO_ROOT")
    candidates = []
    if env_root:
        candidates.append(os.path.abspath(env_root))
    cur = os.getcwd()
    for _ in range(6):
        candidates.append(cur)
        parent = os.path.dirname(cur)
        if parent == cur:
            break
        cur = parent
    candidates.append(os.path.join(HERE, "upstream_docs", "af7ab9fa"))
    candidates.append(HERE)
    for cand in candidates:
        if os.path.exists(os.path.join(cand, "src", "domain", "models.ts")) and os.path.exists(
            os.path.join(cand, "src", "rail", "graph", "index.ts")
        ):
            return cand
    return None


def resolve_osmium_exe() -> str | None:
    """Resolve pinned Osmium executable portably."""
    env_osm = os.environ.get("OSMIUM_EXE")
    if env_osm and os.path.exists(env_osm):
        return env_osm
    pinned = os.path.join(HERE, "r13-osmium-env", "Library", "bin", "osmium.exe")
    if os.path.exists(pinned):
        return pinned
    return shutil.which("osmium")


def _get_process_rss_bytes() -> int | None:
    """Best-effort cross-platform process RSS measurement."""
    if sys.platform == "win32":
        try:
            import ctypes
            from ctypes import wintypes

            class PROCESS_MEMORY_COUNTERS(ctypes.Structure):
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

            pmc = PROCESS_MEMORY_COUNTERS()
            pmc.cb = ctypes.sizeof(PROCESS_MEMORY_COUNTERS)
            hproc = ctypes.windll.kernel32.GetCurrentProcess()
            if ctypes.windll.psapi.GetProcessMemoryInfo(hproc, ctypes.byref(pmc), pmc.cb):
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


def run_ts_verifier(bundle_path: str) -> tuple[int, dict]:
    node_exe = resolve_node_exe()
    repo_root = resolve_repo_root()
    if not node_exe or not repo_root:
        raise RuntimeError(f"Missing portable runtime/repo: node={node_exe}, repo_root={repo_root}")
    cmd = [node_exe, "--experimental-strip-types", VERIFY_MJS, bundle_path, repo_root]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        return proc.returncode, {"error": proc.stderr or proc.stdout}
    return 0, json.loads(proc.stdout)


def _expect_gate_error(fn, *args, **kwargs) -> bool:
    try:
        fn(*args, **kwargs)
    except ComplianceGateError:
        return True
    return False


def test_compliance_gates_and_osmium_flags(pipe: StreamingC02Pipeline) -> dict:
    # All three real-data command builders must default to denied
    blocked_tags_default = _expect_gate_error(build_osmium_tags_filter_command, "osmium", "in.osm.pbf", "out.osm.pbf")
    blocked_tags_partial = _expect_gate_error(
        build_osmium_tags_filter_command,
        "osmium",
        "in.osm.pbf",
        "out.osm.pbf",
        compliance_gate_cleared=True,
        coordinator_c01_accepted=True,
    )
    blocked_chk_default = _expect_gate_error(build_osmium_check_refs_command, "osmium", "in.osm.pbf")
    blocked_cat_default = _expect_gate_error(build_osmium_cat_command, "osmium", "in.osm.pbf", "out.osm")
    blocked_real_pipeline = _expect_gate_error(
        pipe.run_real_pbf_pipeline, "osmium", "eastern-zone-261101.osm.pbf", tempfile.gettempdir()
    )

    blocked_cloud_sync = _expect_gate_error(
        assert_workspace_private_and_non_sync, os.path.join(tempfile.gettempdir(), "OneDrive", "bad_ws")
    )
    blocked_crossdevice = _expect_gate_error(
        assert_workspace_private_and_non_sync, os.path.join(tempfile.gettempdir(), "CrossDevice", "bad_ws")
    )

    with tempfile.TemporaryDirectory() as tmpdir:
        os.makedirs(os.path.join(tmpdir, ".git"))
        blocked_git = _expect_gate_error(assert_workspace_private_and_non_sync, os.path.join(tmpdir, "sub"))

        # Test symlink/junction resolution when supported by OS privileges
        symlink_blocked = True
        link_path = os.path.join(tempfile.gettempdir(), f"c02_git_link_{os.getpid()}")
        try:
            if os.path.exists(link_path):
                os.unlink(link_path)
            os.symlink(os.path.join(tmpdir, "sub"), link_path, target_is_directory=True)
            symlink_blocked = _expect_gate_error(assert_workspace_private_and_non_sync, link_path)
        except OSError:
            symlink_blocked = True
        finally:
            if os.path.islink(link_path):
                os.unlink(link_path)

    # Distinct input/output dir check + 4-gate check
    with tempfile.TemporaryDirectory() as tmpdir:
        dummy_pbf = os.path.join(tmpdir, "dummy_approved.osm.pbf")
        open(dummy_pbf, "wb").write(b"dummy")
        blocked_same_dir = _expect_gate_error(
            assert_real_data_intake_allowed,
            dummy_pbf,
            tmpdir,
            compliance_gate_cleared=True,
            coordinator_c01_accepted=True,
            self_certification_verified=True,
            safe_civilian_scope_approved=True,
        )

    all_true = {
        "compliance_gate_cleared": True,
        "coordinator_c01_accepted": True,
        "self_certification_verified": True,
        "safe_civilian_scope_approved": True,
    }
    cmd_flt = build_osmium_tags_filter_command("osmium", "in.osm.pbf", "out.osm.pbf", **all_true)
    cmd_chk = build_osmium_check_refs_command("osmium", "out.osm.pbf", **all_true)
    cmd_cat = build_osmium_cat_command("osmium", "in.osm", "out.osm.pbf", output_format="pbf", **all_true)

    flags_ok = (
        "--no-progress" in cmd_flt
        and "--progress=false" not in cmd_flt
        and "--no-progress" in cmd_chk
        and "--no-progress" in cmd_cat
    )
    passed = (
        blocked_tags_default
        and blocked_tags_partial
        and blocked_chk_default
        and blocked_cat_default
        and blocked_real_pipeline
        and blocked_cloud_sync
        and blocked_crossdevice
        and blocked_git
        and symlink_blocked
        and blocked_same_dir
        and flags_ok
    )
    return {"case": "c02_01_compliance_gates_workspace_and_osmium_flags", "passed": passed}


def test_parity_with_v3_and_determinism(pf: CivilianRailPrefilter, pipe: StreamingC02Pipeline) -> dict:
    records = [
        None,
        "bad",
        {"type": "node", "id": 101, "lat": 22.50, "lon": 86.50, "tags": {"railway": "station", "name": "Alpha Junction", "operator": "Indian Railways"}},
        {"type": "node", "id": 102, "lat": 22.55, "lon": 86.55, "tags": {}},
        {"type": "node", "id": 103, "lat": 22.60, "lon": 86.60, "tags": {"railway": "station", "name": "Beta Halt", "operator": "Indian Railways"}},
        {"type": "node", "id": 104, "lat": 22.65, "lon": 86.65, "tags": {}},
        {"type": "node", "id": 105, "lat": 22.70, "lon": 86.70, "tags": {"power": "substation"}},
        {"type": "node", "id": 106, "lat": 22.71, "lon": 86.71, "tags": {}},
        {"type": "node", "id": 106, "lat": 22.72, "lon": 86.72, "tags": {}},
        {"type": "way", "id": 201, "node_refs": [101, 102, 103], "tags": {"railway": "rail", "usage": "main", "gauge": "1676", "electrified": "contact_line", "voltage": "25000", "frequency": "50"}},
        {"type": "way", "id": 202, "node_refs": [101, 105], "tags": {"railway": "rail", "usage": "main"}},
        {"type": "way", "id": 203, "node_refs": [101, 106], "tags": {"railway": "rail", "usage": "main"}},
        {"type": "way", "id": 204, "node_refs": [101, 103], "tags": {"railway": "rail", "usage": "branch"}},
        {"type": "way", "id": 204, "node_refs": [101, 103], "tags": {"railway": "rail", "access": "private"}},
        {"type": "relation", "id": 301, "members": [{"type": "node", "ref": 101, "role": "stop"}, {"type": "way", "ref": 201, "role": ""}, {"type": "node", "ref": 103, "role": "stop"}], "tags": {"type": "route", "route": "train", "name": "Alpha-Beta Line"}},
        {"type": "relation", "id": 301, "members": [{"type": "node", "ref": 101, "role": "stop"}, {"type": "way", "ref": 201, "role": ""}, {"type": "node", "ref": 103, "role": "stop"}], "tags": {"type": "route", "route": "train", "name": "Alpha-Beta Line"}},
        {"type": "relation", "id": 302, "members": [{"type": "way", "ref": 204, "role": ""}], "tags": {"type": "route", "route": "train", "name": "Quarantined"}},
    ]
    v3_res = pf.run_batch(records)
    shuffled = list(records)
    random.Random(42).shuffle(shuffled)

    with tempfile.TemporaryDirectory() as tmpdir:
        res_a = pipe.run_stream(records, os.path.join(tmpdir, "a.jsonl"), work_dir=tmpdir, collect_retained_in_memory=True)
        res_b = pipe.run_stream(shuffled, os.path.join(tmpdir, "b.jsonl"), work_dir=tmpdir, collect_retained_in_memory=True)

    passed = (
        res_a["retainedCount"] == v3_res["retainedCount"]
        and res_a["excludedCount"] == v3_res["excludedCount"]
        and res_a["reasonCounts"] == v3_res["reasonCounts"]
        and res_a["retainedRecords"] == v3_res["retainedRecords"]
        and res_a["outputJsonlSha256"] == res_b["outputJsonlSha256"]
        and res_a["reasonCounts"] == res_b["reasonCounts"]
        and res_a["referenceClosurePassed"]
    )
    return {
        "case": "c02_02_v3_parity_and_deterministic_replay",
        "passed": passed,
        "outputSha256": res_a["outputJsonlSha256"],
        "reasonCounts": res_a["reasonCounts"],
    }


def test_large_scale_streaming_memory(pipe: StreamingC02Pipeline) -> dict:
    num_nodes, num_ways, num_rels = 25000, 10000, 500

    def gen_records():
        for i in range(1, num_nodes + 1):
            lat = 20.0 + (i % 500) * 0.005
            lon = 84.0 + (i // 500) * 0.005
            if i % 100 == 1:
                yield {"type": "node", "id": i, "lat": lat, "lon": lon, "tags": {"railway": "station", "name": f"Station {i}"}}
            elif i % 100 == 99:
                yield {"type": "node", "id": i, "lat": lat, "lon": lon, "tags": {"power": "substation"}}
            else:
                yield {"type": "node", "id": i, "lat": lat, "lon": lon, "tags": {}}
        for w in range(1, num_ways + 1):
            yield {
                "type": "way",
                "id": 100000 + w,
                "node_refs": [(w * 2) % num_nodes + 1, (w * 2 + 1) % num_nodes + 1],
                "tags": {"railway": "rail", "usage": "main", "gauge": "1676"},
            }
        for r in range(1, num_rels + 1):
            yield {
                "type": "relation",
                "id": 200000 + r,
                "members": [{"type": "way", "ref": 100000 + r, "role": ""}],
                "tags": {"type": "route", "route": "train", "name": f"Route {r}"},
            }

    t0 = time.perf_counter()
    with tempfile.TemporaryDirectory() as tmpdir:
        res = pipe.run_stream(gen_records(), os.path.join(tmpdir, "scale.jsonl"), work_dir=tmpdir)
    elapsed_s = round(time.perf_counter() - t0, 3)
    passed = (
        res["totalInput"] == num_nodes + num_ways + num_rels
        and res["referenceClosurePassed"]
        and sum(res["reasonCounts"].values()) == res["totalInput"]
        and res["retainedCount"] == 29940
        and res["peakPythonHeapBytes"] < 20 * 1024 * 1024
    )
    return {
        "case": "c02_03_large_scale_streaming_memory_efficiency",
        "passed": passed,
        "totalInput": res["totalInput"],
        "retainedCount": res["retainedCount"],
        "excludedCount": res["excludedCount"],
        "peakPythonHeapBytes": res["peakPythonHeapBytes"],
        "elapsedSeconds": elapsed_s,
    }


def test_downstream_graphpack_and_ts_contract(pipe: StreamingC02Pipeline) -> dict:
    records = [
        {"type": "node", "id": 1, "lat": 22.5726, "lon": 88.3639, "tags": {"railway": "station", "name": "Synthetic Howrah", "operator": "Indian Railways"}},
        {"type": "node", "id": 2, "lat": 22.7500, "lon": 88.1000, "tags": {}},
        {"type": "node", "id": 3, "lat": 23.2324, "lon": 87.8615, "tags": {"railway": "station", "name": "Synthetic Bardhaman", "operator": "Indian Railways"}},
        {"type": "node", "id": 4, "lat": 23.5204, "lon": 87.3119, "tags": {"railway": "station", "name": "Synthetic Durgapur", "operator": "Indian Railways"}},
        {"type": "way", "id": 10, "node_refs": [1, 2, 3], "tags": {"railway": "rail", "usage": "main", "gauge": "1676", "electrified": "contact_line", "voltage": "25000", "frequency": "50"}},
        {"type": "way", "id": 11, "node_refs": [3, 4], "tags": {"railway": "rail", "usage": "branch"}},
        {"type": "relation", "id": 50, "members": [{"type": "node", "ref": 1, "role": "stop"}, {"type": "way", "ref": 10, "role": ""}, {"type": "way", "ref": 11, "role": ""}, {"type": "node", "ref": 4, "role": "stop"}], "tags": {"type": "route", "route": "train", "name": "Synthetic Corridor"}},
    ]
    with tempfile.TemporaryDirectory() as tmpdir:
        c02_jsonl = os.path.join(tmpdir, "c02.jsonl")
        res = pipe.run_stream(records, c02_jsonl, work_dir=tmpdir)
        pack, manifest = build_graph_pack_from_jsonl(c02_jsonl)
        bundle_path = os.path.join(tmpdir, "downstream_bundle.json")
        with open(bundle_path, "w", encoding="utf-8") as f:
            json.dump({"graphPack": pack, "regionManifest": manifest}, f)
        rc, ts_result = run_ts_verifier(bundle_path)

    passed = (
        rc == 0
        and res["referenceClosurePassed"]
        and ts_result.get("ok") is True
        and ts_result.get("nodeCount") == 3
        and ts_result.get("stationCount") == 3
        and ts_result.get("edgeCount") == 4
        and ts_result.get("weakComponentCount") == 1
        and ts_result.get("realismCompatCheck", {}).get("code") == "DATA_MISSING"
    )
    return {"case": "c02_04_downstream_ts_graphpack_compatibility", "passed": passed, "nodeExitCode": rc, "tsVerification": ts_result}


def test_downstream_edge_cases(pipe: StreamingC02Pipeline) -> dict:
    records = [
        {"type": "node", "id": 10, "lat": 22.5000, "lon": 88.3000, "tags": {"railway": "station", "name": "Synthetic Start"}},
        {"type": "node", "id": 11, "lat": 22.5000, "lon": 88.3000, "tags": {}},
        {"type": "node", "id": 12, "lat": 22.6000, "lon": 88.4000, "tags": {}},
        {"type": "node", "id": 13, "lat": 22.6000, "lon": 88.4000, "tags": {}},
        {"type": "way", "id": 20, "node_refs": [10, 11, 12], "tags": {"railway": "rail", "usage": "main", "oneway": "yes", "electrified": "no", "voltage": "25000", "frequency": "50"}},
        {"type": "way", "id": 21, "node_refs": [12, 13, 10], "tags": {"railway": "station", "name": "Synthetic Area Station"}},
    ]
    with tempfile.TemporaryDirectory() as tmpdir:
        c02_jsonl = os.path.join(tmpdir, "c02_edge.jsonl")
        pipe.run_stream(records, c02_jsonl, work_dir=tmpdir)
        pack, manifest = build_graph_pack_from_jsonl(c02_jsonl)
        bundle_path = os.path.join(tmpdir, "edge_bundle.json")
        with open(bundle_path, "w", encoding="utf-8") as f:
            json.dump({"graphPack": pack, "regionManifest": manifest}, f)
        rc, ts_result = run_ts_verifier(bundle_path)

    edge = pack["edges"][0] if pack["edges"] else {}
    passed = (
        rc == 0
        and ts_result.get("ok") is True
        and len(pack["edges"]) == 1
        and edge.get("id") == "e:20:0:fwd"
        and edge.get("electrification") == "no"
        and edge.get("voltageV") is None
        and edge.get("frequencyHz") is None
        and ts_result.get("stationCount") == 2
    )
    return {"case": "c02_05_downstream_oneway_nonelec_station_way", "passed": passed, "nodeExitCode": rc}


def test_e2e_synthetic_osmium_file_smoke(pipe: StreamingC02Pipeline) -> dict:
    osmium_exe = resolve_osmium_exe()
    if not osmium_exe:
        raise RuntimeError("Pinned osmium executable not found.")

    with tempfile.TemporaryDirectory() as tmp1, tempfile.TemporaryDirectory() as tmp2:
        res1 = pipe.run_synthetic_osm_file_smoke(osmium_exe, SMOKE_FIXTURE_PATH, SMOKE_FIXTURE_SHA256, tmp1)
        res2 = pipe.run_synthetic_osm_file_smoke(osmium_exe, SMOKE_FIXTURE_PATH, SMOKE_FIXTURE_SHA256, tmp2)
        pack, manifest = build_graph_pack_from_jsonl(res1["outputJsonlPath"])
        bundle_path = os.path.join(tmp1, "smoke_bundle.json")
        with open(bundle_path, "w", encoding="utf-8") as f:
            json.dump({"graphPack": pack, "regionManifest": manifest}, f)
        rc, ts_result = run_ts_verifier(bundle_path)

    sr1 = res1["streamResult"]
    sr2 = res2["streamResult"]
    retained_ids = {(r["type"], r["id"]) for r in sr1["retainedRecords"]}
    passed = (
        all(s["exitCode"] == 0 for s in res1["osmiumSteps"])
        and sr1["referenceClosurePassed"]
        and sr1["outputJsonlSha256"] == sr2["outputJsonlSha256"]
        and retained_ids == {("node", 1001), ("node", 1002), ("node", 1003), ("way", 2001), ("relation", 3001)}
        and rc == 0
        and ts_result.get("ok") is True
        and ts_result.get("nodeCount") == 2
        and ts_result.get("stationCount") == 2
        and ts_result.get("edgeCount") == 2
    )
    return {
        "case": "c02_06_e2e_synthetic_osmium_pbf_smoke",
        "passed": passed,
        "fixtureSha256": res1["fixtureSha256"],
        "osmiumSteps": [{"step": s["step"], "exitCode": s["exitCode"]} for s in res1["osmiumSteps"]],
        "filteredPbfBytes": res1["filteredPbfBytes"],
        "outputJsonlSha256": sr1["outputJsonlSha256"],
        "reasonCounts": sr1["reasonCounts"],
        "graphSha256": pack["graphSha256"],
        "nodeExitCode": rc,
    }


def test_xml_malformed_coords_and_refs_quarantined(pipe: StreamingC02Pipeline) -> dict:
    """Malformed XML numeric coords and malformed way/relation refs must reject/quarantine safely."""
    malformed_xml = """<?xml version='1.0' encoding='UTF-8'?>
<osm version="0.6" generator="synthetic-malformed-test">
  <node id="101" version="1" lat="22.1" lon="86.1"/>
  <node id="102" version="1" lat="22.2" lon="86.2"/>
  <node id="103" version="1" lat="not_a_float" lon="86.3"/>
  <node id="104" version="1" lat="22.4" lon="1e500"/>
  <node id="105" version="1" lat="22.5" lon="bad_lon">
    <tag k="railway" v="station"/>
    <tag k="name" v="BadCoordStation"/>
  </node>
  <way id="201" version="1">
    <nd ref="101"/>
    <nd ref="bad_node_ref"/>
    <nd ref="102"/>
    <tag k="railway" v="rail"/>
    <tag k="usage" v="main"/>
  </way>
  <way id="202" version="1">
    <nd ref="101"/>
    <nd ref="102"/>
    <tag k="railway" v="rail"/>
    <tag k="usage" v="main"/>
  </way>
  <relation id="301" version="1">
    <member type="way" ref="bad_way_ref" role=""/>
    <tag k="type" v="route"/>
    <tag k="route" v="train"/>
    <tag k="name" v="BadMemberRel"/>
  </relation>
</osm>
"""
    with tempfile.TemporaryDirectory() as tmpdir:
        xml_path = os.path.join(tmpdir, "malformed.osm")
        out_jsonl = os.path.join(tmpdir, "out.jsonl")
        with open(xml_path, "w", encoding="utf-8", newline="\n") as f:
            f.write(malformed_xml)
        res = pipe.run_stream(iter_osm_xml_records(xml_path), out_jsonl, work_dir=tmpdir, collect_retained_in_memory=True)

    retained_ids = {(r["type"], r["id"]) for r in res["retainedRecords"]}
    rc = res["reasonCounts"]
    # Way 201 (with bad_node_ref) MUST be rejected as REJECT_INVALID_NODE_REFERENCE, never truncated to [101, 102]!
    # Nodes 103, 104, 105 MUST be rejected as REJECT_INVALID_COORDINATE without ValueError!
    passed = (
        res["referenceClosurePassed"]
        and retained_ids == {("node", 101), ("node", 102), ("way", 202)}
        and rc.get("REJECT_INVALID_COORDINATE") == 3
        and rc.get("REJECT_INVALID_NODE_REFERENCE") == 1
        and rc.get("REJECT_MALFORMED_RELATION_MEMBER") == 1
        and rc.get("ALLOW_CIVILIAN_RAIL_WAY") == 1
        and rc.get("ALLOW_GEOMETRY_NODE") == 2
        and sum(rc.values()) == 8
    )
    return {"case": "c02_07_xml_malformed_coords_and_refs_quarantined", "passed": passed, "reasonCounts": rc}


def test_streaming_xml_memory_and_closure(pipe: StreamingC02Pipeline) -> dict:
    """Verify O(1) XML root clearing and reference closure over 12,000 streamed XML objects."""
    num_nodes = 8000
    num_ways = 3900
    num_rels = 100
    with tempfile.TemporaryDirectory() as tmpdir:
        xml_path = os.path.join(tmpdir, "stream_12k.osm")
        out_jsonl = os.path.join(tmpdir, "stream_12k.jsonl")
        with open(xml_path, "w", encoding="utf-8", newline="\n") as f:
            f.write("<?xml version='1.0' encoding='UTF-8'?>\n<osm version='0.6' generator='synthetic-stream-12k'>\n")
            for i in range(1, num_nodes + 1):
                lat = 21.0 + (i % 400) * 0.005
                lon = 85.0 + (i // 400) * 0.005
                if i % 100 == 0:
                    f.write(f'  <node id="{i}" version="1" lat="{lat:.6f}" lon="{lon:.6f}"><tag k="power" v="tower"/></node>\n')
                else:
                    f.write(f'  <node id="{i}" version="1" lat="{lat:.6f}" lon="{lon:.6f}"/>\n')
            for w in range(1, num_ways + 1):
                n1 = (w * 2) % num_nodes + 1
                n2 = (w * 2 + 1) % num_nodes + 1
                f.write(f'  <way id="{100000 + w}" version="1"><nd ref="{n1}"/><nd ref="{n2}"/><tag k="railway" v="rail"/><tag k="usage" v="main"/></way>\n')
            for r in range(1, num_rels + 1):
                f.write(f'  <relation id="{200000 + r}" version="1"><member type="way" ref="{100000 + r}" role=""/><tag k="type" v="route"/><tag k="route" v="train"/><tag k="name" v="Stream {r}"/></relation>\n')
            f.write("</osm>\n")

        t0 = time.perf_counter()
        res = pipe.run_stream(iter_osm_xml_records(xml_path), out_jsonl, work_dir=tmpdir)
        elapsed_s = round(time.perf_counter() - t0, 3)

    rss_bytes = _get_process_rss_bytes()
    passed = (
        res["totalInput"] == num_nodes + num_ways + num_rels
        and res["referenceClosurePassed"]
        and sum(res["reasonCounts"].values()) == res["totalInput"]
        and res["peakPythonHeapBytes"] < 15 * 1024 * 1024
    )
    return {
        "case": "c02_08_streaming_xml_o1_memory_and_closure",
        "passed": passed,
        "totalInput": res["totalInput"],
        "retainedCount": res["retainedCount"],
        "excludedCount": res["excludedCount"],
        "peakPythonHeapBytes": res["peakPythonHeapBytes"],
        "processRssBytes": rss_bytes,
        "elapsedSeconds": elapsed_s,
    }


def test_fixture_provenance_guards(pipe: StreamingC02Pipeline) -> dict:
    """Verify synthetic smoke rejects bad SHA-256, real-dataset filenames, and non-synthetic generators."""
    osmium_exe = resolve_osmium_exe() or "osmium"
    with tempfile.TemporaryDirectory() as tmpdir:
        bad_sha = _expect_gate_error(
            pipe.run_synthetic_osm_file_smoke, osmium_exe, SMOKE_FIXTURE_PATH, "0" * 64, tmpdir
        )
        fake_real = os.path.join(tmpdir, "eastern-zone-261101.osm")
        shutil.copyfile(SMOKE_FIXTURE_PATH, fake_real)
        bad_name = _expect_gate_error(
            pipe.run_synthetic_osm_file_smoke, osmium_exe, fake_real, SMOKE_FIXTURE_SHA256, tmpdir
        )
        non_syn = os.path.join(tmpdir, "non_synthetic.osm")
        raw = open(SMOKE_FIXTURE_PATH, "r", encoding="utf-8").read().replace("synthetic-c02-smoke-v1", "osmium/1.16.0")
        open(non_syn, "w", encoding="utf-8", newline="\n").write(raw)
        import hashlib
        non_syn_sha = hashlib.sha256(open(non_syn, "rb").read()).hexdigest()
        bad_gen = _expect_gate_error(
            pipe.run_synthetic_osm_file_smoke, osmium_exe, non_syn, non_syn_sha, tmpdir
        )
    return {
        "case": "c02_09_fixture_provenance_guards",
        "passed": bad_sha and bad_name and bad_gen,
    }


def main() -> int:
    pf = CivilianRailPrefilter.from_file(POLICY_PATH)
    pipe = StreamingC02Pipeline(pf)

    results = [
        test_compliance_gates_and_osmium_flags(pipe),
        test_parity_with_v3_and_determinism(pf, pipe),
        test_large_scale_streaming_memory(pipe),
        test_downstream_graphpack_and_ts_contract(pipe),
        test_downstream_edge_cases(pipe),
        test_e2e_synthetic_osmium_file_smoke(pipe),
        test_xml_malformed_coords_and_refs_quarantined(pipe),
        test_streaming_xml_memory_and_closure(pipe),
        test_fixture_provenance_guards(pipe),
    ]
    passed = sum(1 for r in results if r["passed"])
    summary = {
        "total": len(results),
        "passed": passed,
        "failed": len(results) - passed,
        "realPbfProcessed": False,
        "results": results,
    }
    print(json.dumps(summary, indent=2))
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
