"""Deterministic C07 Supplementary Synthetic Corridor Fixture & Cache Builder.

Preserves all accepted C06 fixtures, caches, and c06-strict-oracle.jar untouched.
Creates a companion synthetic corridor (fixtures/c07_calibration/, inside [13.00..13.50 N, 43.00..43.80 E],
far outside India) covering standard gauge (1435mm), 750V/3000V/1500V DC, 25kV 50Hz / 15kV 16.7Hz AC,
unknown electrification, parallel loops, fast-vs-short distance/time trade-off bypass, dual switch junction,
and oneway steam/diesel branches, then imports into c07_oracle/cache_strict using the unmodified C06 FIX-01 JAR.
"""

from __future__ import annotations

import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import sys
from typing import Any

WORKSPACE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(WORKSPACE))

from c03_topology_builder import canonical_json_bytes, compute_canonical_graph_sha256
from c06_fixture_builder import parse_tags_to_r08_edge, way_len_m, write_osm_xml

OSMIUM_EXE = os.environ.get("OSMIUM_EXE", str(WORKSPACE / "r13-osmium-env" / "Library" / "bin" / "osmium.exe"))
PROV_URL = "https://synthetic.railway-ceo.local/c07-corridor-v1"


def build_c07_nodes_and_ways() -> tuple[dict[int, dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    nodes_def: list[tuple[int, float, float, dict[str, str] | None]] = [
        # Corridor 1: 1676mm 25kV AC mainline + distance-vs-time bypass + DC/diesel extension
        (201, 13.1000, 43.1000, {"railway": "station", "name": "SYN-C07-WEST-HUB"}),
        (202, 13.1000, 43.2000, {"railway": "station", "name": "SYN-C07-MID-JCT"}),
        (203, 13.1000, 43.3000, {"railway": "station", "name": "SYN-C07-CENTRAL"}),
        (204, 13.1000, 43.4000, {"railway": "station", "name": "SYN-C07-EAST-PORT"}),
        (205, 13.1000, 43.5000, {"railway": "station", "name": "SYN-C07-AC-TERM"}),
        (206, 13.1600, 43.2000, None),  # High-speed (160 km/h) slightly longer AC bypass 201 -> 206 -> 203
        (207, 13.0600, 43.2000, None),  # Slow branch (50 km/h) 201 -> 207 -> 203 (for direct distance vs time divergence vs 201->202->203)
        (224, 13.1000, 43.6000, {"railway": "station", "name": "SYN-C07-DC-SWITCH"}),
        (225, 13.1000, 43.7000, {"railway": "station", "name": "SYN-C07-STEAM-END"}),
        # Corridor 2: Standard Gauge 1435mm network (25kV AC, parallel loop, 750V DC, 3000V DC, non-electrified, oneway)
        (210, 13.2500, 43.1000, {"railway": "station", "name": "SYN-C07-SG-ALPHA"}),
        (211, 13.2500, 43.2000, {"railway": "station", "name": "SYN-C07-SG-BETA"}),
        (212, 13.2500, 43.3000, {"railway": "station", "name": "SYN-C07-SG-DC750"}),
        (213, 13.2500, 43.4000, {"railway": "station", "name": "SYN-C07-SG-DIESEL"}),
        (214, 13.3300, 43.2000, {"railway": "station", "name": "SYN-C07-SG-DC3000"}),
        (215, 13.2850, 43.1500, None),  # Parallel 1435mm 25kV loop apex between 210 and 211
        (226, 13.2500, 43.4800, {"railway": "station", "name": "SYN-C07-SG-ONEWAY-END"}),
        # Corridor 3: Switchback & forbidden turn (1676mm) + unknown electrification probe (227-228)
        (220, 13.4000, 43.1000, {"railway": "station", "name": "SYN-C07-JCT-WEST"}),
        (221, 13.3820, 43.1100, None),
        (222, 13.4000, 43.1200, {"railway": "station", "name": "SYN-C07-JCT-EAST"}),
        (223, 13.3500, 43.1100, {"railway": "station", "name": "SYN-C07-JCT-HEADSHUNT"}),
        (227, 13.4500, 43.3000, {"railway": "station", "name": "SYN-C07-UNKELEC-START"}),
        (228, 13.4500, 43.4000, {"railway": "station", "name": "SYN-C07-UNKELEC-END"}),
    ]

    nodes = {nid: {"id": nid, "lat": lat, "lon": lon, "tags": tags or {}} for nid, lat, lon, tags in nodes_def}

    ways_def: list[dict[str, Any]] = [
        # Slow mainline 201-202-203 (60 km/h, 21.7 km) vs high-speed bypass 201-206-203 (160 km/h, ~25.5 km)
        {"id": 2001, "refs": [201, 202], "tags": {"railway": "rail", "usage": "main", "gauge": "1676", "electrified": "contact_line", "voltage": "25000", "frequency": "50", "access": "allowed", "maxspeed": "60", "railway:active": "yes"}},
        {"id": 2002, "refs": [202, 203], "tags": {"railway": "rail", "usage": "main", "gauge": "1676", "electrified": "contact_line", "voltage": "25000", "frequency": "50", "access": "allowed", "maxspeed": "60", "railway:active": "yes"}},
        {"id": 2003, "refs": [203, 204], "tags": {"railway": "rail", "usage": "main", "gauge": "1676", "electrified": "contact_line", "voltage": "25000", "frequency": "50", "access": "allowed", "maxspeed": "130", "railway:active": "yes"}},
        {"id": 2004, "refs": [204, 205], "tags": {"railway": "rail", "usage": "main", "gauge": "1676", "electrified": "contact_line", "voltage": "25000", "frequency": "50", "access": "allowed", "maxspeed": "100", "railway:active": "yes"}},
        {"id": 2005, "refs": [201, 206, 203], "tags": {"railway": "rail", "usage": "main", "gauge": "1676", "electrified": "contact_line", "voltage": "25000", "frequency": "50", "access": "allowed", "maxspeed": "160", "railway:active": "yes"}},
        {"id": 2006, "refs": [201, 207, 203], "tags": {"railway": "rail", "usage": "branch", "gauge": "1676", "electrified": "contact_line", "voltage": "25000", "frequency": "50", "access": "allowed", "maxspeed": "50", "railway:active": "yes"}},
        {"id": 2023, "refs": [205, 224], "tags": {"railway": "rail", "usage": "main", "gauge": "1676", "electrified": "contact_line", "voltage": "1500", "frequency": "0", "access": "allowed", "maxspeed": "90", "railway:active": "yes"}},
        {"id": 2024, "refs": [224, 225], "tags": {"railway": "rail", "usage": "branch", "gauge": "1676", "electrified": "no", "access": "allowed", "maxspeed": "80", "railway:active": "yes"}},
        # 1435mm standard-gauge corridor
        {"id": 2010, "refs": [210, 211], "tags": {"railway": "rail", "usage": "main", "gauge": "1435", "electrified": "contact_line", "voltage": "25000", "frequency": "50", "access": "allowed", "maxspeed": "140", "railway:active": "yes"}},
        {"id": 2011, "refs": [211, 212], "tags": {"railway": "rail", "usage": "main", "gauge": "1435", "electrified": "rail", "voltage": "750", "frequency": "0", "access": "allowed", "maxspeed": "80", "railway:active": "yes"}},
        {"id": 2012, "refs": [212, 213], "tags": {"railway": "rail", "usage": "branch", "gauge": "1435", "electrified": "no", "access": "allowed", "maxspeed": "90", "railway:active": "yes"}},
        {"id": 2013, "refs": [211, 214], "tags": {"railway": "rail", "usage": "main", "gauge": "1435", "electrified": "contact_line", "voltage": "3000", "frequency": "0", "access": "allowed", "maxspeed": "100", "railway:active": "yes"}},
        {"id": 2014, "refs": [210, 215, 211], "tags": {"railway": "rail", "usage": "branch", "gauge": "1435", "electrified": "contact_line", "voltage": "25000", "frequency": "50", "access": "allowed", "maxspeed": "100", "railway:active": "yes"}},
        {"id": 2025, "refs": [213, 226], "tags": {"railway": "rail", "usage": "branch", "gauge": "1435", "electrified": "no", "access": "allowed", "maxspeed": "50", "oneway": "yes", "railway:preferred_direction": "forward", "railway:active": "yes"}},
        # Switchback & unknown electrification
        {"id": 2020, "refs": [220, 221], "tags": {"railway": "rail", "usage": "main", "gauge": "1676", "electrified": "no", "access": "allowed", "maxspeed": "80", "railway:active": "yes"}},
        {"id": 2021, "refs": [221, 222], "tags": {"railway": "rail", "usage": "main", "gauge": "1676", "electrified": "no", "access": "allowed", "maxspeed": "80", "railway:active": "yes"}},
        {"id": 2022, "refs": [221, 223], "tags": {"railway": "rail", "usage": "branch", "gauge": "1676", "electrified": "no", "access": "allowed", "maxspeed": "60", "railway:active": "yes"}},
        {"id": 2027, "refs": [227, 228], "tags": {"railway": "rail", "usage": "main", "gauge": "1676", "access": "allowed", "maxspeed": "100", "railway:active": "yes"}},  # Unknown electrification!
    ]

    return nodes, ways_def, []


def build_graph_pack(
    region_id: str,
    nodes: dict[int, dict[str, Any]],
    ways: list[dict[str, Any]],
    *,
    bump_speed_way_id: int | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    prov = {
        "sourceUrl": PROV_URL,
        "sourceId": "c07-corridor-v1",
        "sourceVersion": "1",
        "license": "Synthetic-QA-Only",
        "qualityFlags": ["SYNTHETIC_ONLY"],
    }
    gp_nodes = [
        {"id": f"n:{nid}", "coordinates": [nodes[nid]["lon"], nodes[nid]["lat"]], "regionId": region_id, "provenance": {**prov, "sourceId": f"node:{nid}"}}
        for nid in sorted(nodes.keys())
    ]
    gp_stations = [
        {
            "id": f"st:{nid}",
            "name": nodes[nid]["tags"]["name"],
            "coordinates": [nodes[nid]["lon"], nodes[nid]["lat"]],
            "regionId": region_id,
            "nodeIds": [f"n:{nid}"],
            "provenance": {**prov, "sourceId": f"station:{nid}"},
        }
        for nid in sorted(nodes.keys())
        if nodes[nid]["tags"].get("railway") == "station"
    ]
    gp_stations.sort(key=lambda s: s["id"])

    gp_edges = []
    adj_in: dict[str, list[dict[str, Any]]] = {}
    adj_out: dict[str, list[dict[str, Any]]] = {}
    raw_truth_edges: dict[str, Any] = {}

    for w in ways:
        tags = dict(w["tags"])
        if bump_speed_way_id == w["id"] and "maxspeed" in tags:
            tags["maxspeed"] = str(int(tags["maxspeed"]) + 10)
        parsed = parse_tags_to_r08_edge(tags)
        pts_fwd = [[nodes[r]["lon"], nodes[r]["lat"]] for r in w["refs"]]
        length_m = way_len_m([(nodes[r]["lon"], nodes[r]["lat"]) for r in w["refs"]])
        dirs = [("fwd", w["refs"][0], w["refs"][-1], pts_fwd)]
        if parsed["oneway"] != "yes":
            dirs.append(("bwd", w["refs"][-1], w["refs"][0], list(reversed(pts_fwd))))
        for d_name, u_nid, v_nid, geom in dirs:
            eid = f"e:{w['id']}:0:{d_name}"
            u_id, v_id = f"n:{u_nid}", f"n:{v_nid}"
            edge_obj = {
                "id": eid,
                "from": u_id,
                "to": v_id,
                "geometry": geom,
                "lengthM": length_m,
                "gaugeMm": parsed["gaugeMm"],
                "electrification": parsed["electrification"],
                "voltageV": parsed["voltageV"],
                "frequencyHz": parsed["frequencyHz"],
                "maxSpeedKmh": parsed["maxSpeedKmh"],
                "active": parsed["active"],
                "access": parsed["access"],
                "provenance": {**prov, "sourceId": f"way:{w['id']}"},
            }
            gp_edges.append(edge_obj)
            adj_out.setdefault(u_id, []).append(edge_obj)
            adj_in.setdefault(v_id, []).append(edge_obj)
            raw_truth_edges[eid] = {**edge_obj, "osmWayId": w["id"], "direction": d_name, "rawTags": tags}

    gp_edges.sort(key=lambda e: e["id"])

    turn_rules = []
    forbidden_pairs = {("e:2020:0:fwd", "e:2021:0:fwd"), ("e:2021:0:bwd", "e:2020:0:bwd")}
    for nid in sorted(nodes.keys()):
        u_id = f"n:{nid}"
        for e_in in sorted(adj_in.get(u_id, []), key=lambda e: e["id"]):
            for e_out in sorted(adj_out.get(u_id, []), key=lambda e: e["id"]):
                is_rev = e_in["from"] == e_out["to"]
                is_forbidden = (e_in["id"], e_out["id"]) in forbidden_pairs
                turn_rules.append({
                    "incoming": e_in["id"],
                    "outgoing": e_out["id"],
                    "permitted": not is_forbidden,
                    "penaltyS": 300 if is_rev else 0,
                    "reversal": is_rev,
                })

    pack = {
        "schemaVersion": 1,
        "regionId": region_id,
        "graphSha256": "",
        "nodes": gp_nodes,
        "stations": gp_stations,
        "edges": gp_edges,
        "turnRules": turn_rules,
    }
    pack["graphSha256"] = compute_canonical_graph_sha256(pack)
    truth = {
        "schemaVersion": 1,
        "regionId": region_id,
        "graphSha256": pack["graphSha256"],
        "nodes": {n["id"]: n["coordinates"] for n in gp_nodes},
        "stations": {s["id"]: {"name": s["name"], "coordinates": s["coordinates"], "nodeIds": s["nodeIds"]} for s in gp_stations},
        "edges": raw_truth_edges,
        "turnRules": {f"{t['incoming']}->{t['outgoing']}": t for t in turn_rules},
    }
    return pack, truth


def main() -> None:
    out_dir = WORKSPACE / "fixtures" / "c07_calibration"
    out_dir.mkdir(parents=True, exist_ok=True)
    nodes, ways, _ = build_c07_nodes_and_ways()

    osm_path = out_dir / "c07_synthetic_corridor.osm"
    pbf_path = out_dir / "c07_synthetic_corridor.osm.pbf"
    write_osm_xml(nodes, ways, osm_path)

    res = subprocess.run([OSMIUM_EXE, "cat", "--no-progress", "--overwrite", str(osm_path), "-o", str(pbf_path)], capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"osmium cat failed: {res.stderr}")

    pack_v1, truth_v1 = build_graph_pack("c07-corridor-v1", nodes, ways)
    pack_v2, _ = build_graph_pack("c07-corridor-v1", nodes, ways, bump_speed_way_id=2001)

    (out_dir / "c07_graph_v1.json").write_bytes(canonical_json_bytes(pack_v1))
    (out_dir / "c07_graph_v2.json").write_bytes(canonical_json_bytes(pack_v2))
    (out_dir / "c07_fixture_ground_truth.json").write_text(json.dumps(truth_v1, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    # Import into isolated c07_oracle/cache_strict using unmodified verified C06 FIX-01 JAR!
    java_exe = pathlib.Path(os.environ.get("JAVA_HOME", "C:/Program Files/Android/Android Studio/jbr")) / "bin" / "java.exe"
    cp_file = WORKSPACE / "c04_c06_tools" / "openrailrouting" / "target" / "runtime-classpath.txt"
    runtime_cp = cp_file.read_text(encoding="utf-8").strip()
    full_cp = ";".join([
        str(WORKSPACE / "c06_oracle" / "java" / "c06-strict-oracle.jar"),
        str(WORKSPACE / "c04_c06_tools" / "openrailrouting" / "target" / "railway_routing-1.2-thin.jar"),
        runtime_cp,
    ])
    c07_cache = WORKSPACE / "c07_oracle" / "cache_strict"
    shutil.rmtree(c07_cache, ignore_errors=True)
    c07_cache.parent.mkdir(parents=True, exist_ok=True)
    imp = subprocess.run(
        [
            str(java_exe), "-Xmx256m", "-cp", full_cp, "com.railwayceo.c06.StrictOracleRunner",
            "import", "--pbf", str(pbf_path), "--graph-sha256", pack_v1["graphSha256"],
            "--strict-cache", str(c07_cache), "--out", str(WORKSPACE / "c07_oracle" / "import_metrics.json"),
        ],
        capture_output=True, text=True,
    )
    if imp.returncode != 0:
        raise RuntimeError(f"C07 Java import failed: {imp.stderr}\n{imp.stdout}")

    summary = {
        "schemaVersion": 1,
        "regionId": "c07-corridor-v1",
        "osmSha256": hashlib.sha256(osm_path.read_bytes()).hexdigest(),
        "pbfBytes": pbf_path.stat().st_size,
        "pbfSha256": hashlib.sha256(pbf_path.read_bytes()).hexdigest(),
        "graphV1Sha256": pack_v1["graphSha256"],
        "graphV2Sha256": pack_v2["graphSha256"],
        "nodes": len(pack_v1["nodes"]),
        "stations": len(pack_v1["stations"]),
        "edges": len(pack_v1["edges"]),
        "turnRules": len(pack_v1["turnRules"]),
        "javaImport": json.loads(imp.stdout.strip().splitlines()[-1]),
    }
    (out_dir / "c07_fixture_manifest.json").write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
