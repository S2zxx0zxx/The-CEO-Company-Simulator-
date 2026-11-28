"""Deterministic C06 Synthetic Railway Oracle Fixture & Provenance Builder.

Builds:
1. Synthetic multi-scenario OSM XML (clearly labeled SYN-C06-*, outside Indian territory)
   -> compiled via pinned osmium.exe into fixtures/c06_oracle/c06_synthetic_network.osm.pbf.
2. Paired V1 and V2 immutable GraphPacks (c06_graph_v1.json, c06_graph_v2.json) with identical
   provenance, coordinates, haversine distances, turn rules, and raw tag metadata for independent
   validation.
3. C02-derived metadata retention audit fixture (proving C02 strips access/maxspeed/restrictions
   and strict C06 refuses to invent missing metadata).
4. Ground-truth constraint sidecar (c06_fixture_ground_truth.json) used by the Independent Path
   Safety Validator (separate from RailCompatibility).
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import pathlib
import subprocess
import sys
import xml.etree.ElementTree as ET
from typing import Any

WORKSPACE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(WORKSPACE))

from c02_rail_prefilter import CivilianRailPrefilter
from c03_topology_builder import canonical_json_bytes, compute_canonical_graph_sha256

OSMIUM_EXE = os.environ.get("OSMIUM_EXE", str(WORKSPACE / "r13-osmium-env" / "Library" / "bin" / "osmium.exe"))
PROV_URL = "https://synthetic.railway-ceo.local/c06-oracle-v1"
SNAP_UTC = "2026-11-28T00:00:00Z"


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> int:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return max(1, int(round(2 * r * math.asin(math.sqrt(a)))))


def way_len_m(pts: list[tuple[float, float]]) -> int:
    total = 0
    for i in range(len(pts) - 1):
        # pts are [lon, lat]
        total += haversine_m(pts[i][1], pts[i][0], pts[i + 1][1], pts[i + 1][0])
    return total


def build_nodes_and_ways() -> tuple[dict[int, dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    # Synthetic corridor inside [12.00..12.46 N, 42.08..42.62 E], far from India.
    nodes_def: list[tuple[int, float, float, dict[str, str] | None]] = [
        # Core AC + parallel loop + DC + Mixed + Narrow + Negative probes
        (101, 12.1000, 42.1000, {"railway": "station", "name": "SYN-C06-HUB-A"}),
        (102, 12.1000, 42.2000, {"railway": "station", "name": "SYN-C06-EAST-B"}),
        (103, 12.1250, 42.1500, None),  # Parallel loop apex
        (104, 12.1400, 42.2800, {"railway": "station", "name": "SYN-C06-NORTH-C"}),
        (105, 12.1000, 42.3000, {"railway": "station", "name": "SYN-C06-DC-D"}),
        (106, 12.1600, 42.3600, {"railway": "station", "name": "SYN-C06-MIX-JUNCTION"}),
        (107, 12.1600, 42.4300, {"railway": "station", "name": "SYN-C06-DIESEL-END"}),
        # Explicit DC isolated corridor
        (108, 12.2500, 42.3000, {"railway": "station", "name": "SYN-C06-DC-START"}),
        (109, 12.2500, 42.4000, {"railway": "station", "name": "SYN-C06-DC-END"}),
        # Missing frequency vs DC probe corridor (25kV, NO frequency tag!)
        (110, 12.0000, 42.1000, {"railway": "station", "name": "SYN-C06-UNKFREQ-START"}),
        (111, 12.0000, 42.2000, {"railway": "station", "name": "SYN-C06-UNKFREQ-END"}),
        # Missing voltage probe corridor (50Hz, NO voltage tag!)
        (112, 12.0000, 42.3000, {"railway": "station", "name": "SYN-C06-UNKVOLT-START"}),
        (113, 12.0000, 42.4000, {"railway": "station", "name": "SYN-C06-UNKVOLT-END"}),
        # Ambiguous multi-value voltage;frequency corridor
        (114, 12.0000, 42.5000, {"railway": "station", "name": "SYN-C06-AMBIG-START"}),
        (115, 12.0000, 42.6000, {"railway": "station", "name": "SYN-C06-AMBIG-END"}),
        # Narrow gauge 1000mm corridor
        (116, 12.3000, 42.1000, {"railway": "station", "name": "SYN-C06-NARROW-START"}),
        (117, 12.3000, 42.2000, {"railway": "station", "name": "SYN-C06-NARROW-END"}),
        # Unknown gauge corridor (NO gauge tag!)
        (118, 12.3000, 42.3000, {"railway": "station", "name": "SYN-C06-UNKGAUGE-START"}),
        (119, 12.3000, 42.4000, {"railway": "station", "name": "SYN-C06-UNKGAUGE-END"}),
        # Restricted access corridor (access=private)
        (120, 12.3500, 42.1000, {"railway": "station", "name": "SYN-C06-PRIV-START"}),
        (121, 12.3500, 42.2000, {"railway": "station", "name": "SYN-C06-PRIV-END"}),
        # Unknown access corridor (NO access tag!)
        (122, 12.3500, 42.3000, {"railway": "station", "name": "SYN-C06-UNKACC-START"}),
        (123, 12.3500, 42.4000, {"railway": "station", "name": "SYN-C06-UNKACC-END"}),
        # Unknown maxspeed corridor (NO maxspeed tag!)
        (124, 12.3500, 42.5000, {"railway": "station", "name": "SYN-C06-UNKSPD-START"}),
        (125, 12.3500, 42.6000, {"railway": "station", "name": "SYN-C06-UNKSPD-END"}),
        # Inactive track corridor (railway:active=no)
        (126, 12.0500, 42.5000, {"railway": "station", "name": "SYN-C06-INACT-START"}),
        (127, 12.0500, 42.6000, {"railway": "station", "name": "SYN-C06-INACT-END"}),
        # Oneway forward corridor (oneway=yes)
        (128, 12.4000, 42.1000, {"railway": "station", "name": "SYN-C06-ONEWAY-A"}),
        (129, 12.4000, 42.2000, {"railway": "station", "name": "SYN-C06-ONEWAY-B"}),
        # Geometric crossing WITHOUT shared node at (12.15, 42.50)
        (130, 12.1500, 42.4500, {"railway": "station", "name": "SYN-C06-CROSS-W"}),
        (131, 12.1500, 42.5500, {"railway": "station", "name": "SYN-C06-CROSS-E"}),
        (132, 12.1200, 42.5000, {"railway": "station", "name": "SYN-C06-CROSS-S"}),
        (133, 12.1800, 42.5000, {"railway": "station", "name": "SYN-C06-CROSS-N"}),
        # Reversal stub switchback: NW(134) -> APEX(135) -> SOUTH_STUB(137), SE-ish NE(136)
        (134, 12.2980, 42.4900, {"railway": "station", "name": "SYN-C06-REV-IN"}),
        (135, 12.2800, 42.5000, None),
        (136, 12.2980, 42.5100, {"railway": "station", "name": "SYN-C06-REV-OUT"}),
        (137, 12.2500, 42.5000, {"railway": "station", "name": "SYN-C06-REV-STUB"}),
        # Disconnected island
        (138, 12.4500, 42.5000, {"railway": "station", "name": "SYN-C06-ISLAND-A"}),
        (139, 12.4500, 42.5500, {"railway": "station", "name": "SYN-C06-ISLAND-B"}),
        # Station with ambiguous multi-node platform attachment + distinct 1500V DC edge extension
        (140, 12.1000, 42.0800, None),  # Valid 25kV AC node for SYN-C06-MULTI-ST
        (141, 12.4500, 42.1000, None),  # Disconnected narrow gauge node attached to SYN-C06-MULTI-ST
        (142, 12.4500, 42.1500, {"railway": "station", "name": "SYN-C06-MULTI-NARROW-DEST"}),
        # 15kV 16.7Hz AC corridor (AC frequency mismatch test)
        (143, 12.0500, 42.1000, {"railway": "station", "name": "SYN-C06-AC167-START"}),
        (144, 12.0500, 42.2000, {"railway": "station", "name": "SYN-C06-AC167-END"}),
    ]

    nodes = {}
    for nid, lat, lon, tags in nodes_def:
        nodes[nid] = {"id": nid, "lat": lat, "lon": lon, "tags": tags or {}}

    ways_def: list[dict[str, Any]] = [
        {"id": 1001, "refs": [101, 102], "tags": {"railway": "rail", "usage": "main", "gauge": "1676", "electrified": "contact_line", "voltage": "25000", "frequency": "50", "access": "allowed", "maxspeed": "120", "railway:active": "yes"}},
        {"id": 1002, "refs": [101, 103, 102], "tags": {"railway": "rail", "usage": "branch", "gauge": "1676", "electrified": "contact_line", "voltage": "25000", "frequency": "50", "access": "allowed", "maxspeed": "100", "railway:active": "yes"}},
        {"id": 1003, "refs": [102, 104], "tags": {"railway": "rail", "usage": "main", "gauge": "1676", "electrified": "contact_line", "voltage": "25000", "frequency": "50", "access": "allowed", "maxspeed": "120", "railway:active": "yes"}},
        {"id": 1004, "refs": [102, 105], "tags": {"railway": "rail", "usage": "main", "gauge": "1676", "electrified": "contact_line", "voltage": "1500", "frequency": "0", "access": "allowed", "maxspeed": "100", "railway:active": "yes"}},
        {"id": 1005, "refs": [104, 106], "tags": {"railway": "rail", "usage": "main", "gauge": "1676", "electrified": "contact_line", "voltage": "25000", "frequency": "50", "access": "allowed", "maxspeed": "100", "railway:active": "yes"}},
        {"id": 1006, "refs": [106, 107], "tags": {"railway": "rail", "usage": "branch", "gauge": "1676", "electrified": "no", "access": "allowed", "maxspeed": "90", "railway:active": "yes"}},
        {"id": 1007, "refs": [108, 109], "tags": {"railway": "rail", "usage": "main", "gauge": "1676", "electrified": "contact_line", "voltage": "1500", "frequency": "0", "access": "allowed", "maxspeed": "90", "railway:active": "yes"}},
        {"id": 1008, "refs": [110, 111], "tags": {"railway": "rail", "usage": "main", "gauge": "1676", "electrified": "contact_line", "voltage": "1500", "access": "allowed", "maxspeed": "100", "railway:active": "yes"}},  # missing frequency on 1500V line
        {"id": 1009, "refs": [112, 113], "tags": {"railway": "rail", "usage": "main", "gauge": "1676", "electrified": "contact_line", "frequency": "50", "access": "allowed", "maxspeed": "100", "railway:active": "yes"}},  # missing voltage
        {"id": 1010, "refs": [114, 115], "tags": {"railway": "rail", "usage": "main", "gauge": "1676", "electrified": "contact_line", "voltage": "25000;1500", "frequency": "50;0", "access": "allowed", "maxspeed": "100", "railway:active": "yes"}},
        {"id": 1011, "refs": [116, 117], "tags": {"railway": "narrow_gauge", "usage": "branch", "gauge": "1000", "electrified": "no", "access": "allowed", "maxspeed": "60", "railway:active": "yes"}},
        {"id": 1012, "refs": [118, 119], "tags": {"railway": "rail", "usage": "main", "electrified": "no", "access": "allowed", "maxspeed": "80", "railway:active": "yes"}},  # missing gauge
        {"id": 1013, "refs": [120, 121], "tags": {"railway": "rail", "usage": "branch", "gauge": "1676", "electrified": "no", "access": "private", "maxspeed": "80", "railway:active": "yes"}},  # restricted access
        {"id": 1014, "refs": [122, 123], "tags": {"railway": "rail", "usage": "branch", "gauge": "1676", "electrified": "no", "maxspeed": "80", "railway:active": "yes"}},  # missing access
        {"id": 1015, "refs": [124, 125], "tags": {"railway": "rail", "usage": "branch", "gauge": "1676", "electrified": "no", "access": "allowed", "railway:active": "yes"}},  # missing maxspeed
        {"id": 1016, "refs": [126, 127], "tags": {"railway": "rail", "usage": "branch", "gauge": "1676", "electrified": "no", "access": "allowed", "maxspeed": "80", "railway:active": "no"}},  # inactive
        {"id": 1017, "refs": [128, 129], "tags": {"railway": "rail", "usage": "main", "gauge": "1676", "electrified": "no", "access": "allowed", "maxspeed": "90", "oneway": "yes", "railway:preferred_direction": "forward", "railway:active": "yes"}},
        {"id": 1018, "refs": [130, 131], "tags": {"railway": "rail", "usage": "main", "gauge": "1676", "electrified": "no", "access": "allowed", "maxspeed": "80", "railway:active": "yes"}},
        {"id": 1019, "refs": [132, 133], "tags": {"railway": "rail", "usage": "main", "gauge": "1676", "electrified": "no", "access": "allowed", "maxspeed": "80", "railway:active": "yes"}},
        {"id": 1020, "refs": [134, 135], "tags": {"railway": "rail", "usage": "main", "gauge": "1676", "electrified": "no", "access": "allowed", "maxspeed": "80", "railway:active": "yes"}},
        {"id": 1021, "refs": [135, 136], "tags": {"railway": "rail", "usage": "main", "gauge": "1676", "electrified": "no", "access": "allowed", "maxspeed": "80", "railway:active": "yes"}},
        {"id": 1022, "refs": [135, 137], "tags": {"railway": "rail", "usage": "branch", "gauge": "1676", "electrified": "no", "access": "allowed", "maxspeed": "60", "railway:active": "yes"}},
        {"id": 1023, "refs": [138, 139], "tags": {"railway": "rail", "usage": "branch", "gauge": "1676", "electrified": "no", "access": "allowed", "maxspeed": "80", "railway:active": "yes"}},
        {"id": 1024, "refs": [140, 101], "tags": {"railway": "rail", "usage": "main", "gauge": "1676", "electrified": "contact_line", "voltage": "25000", "frequency": "50", "access": "allowed", "maxspeed": "100", "railway:active": "yes"}},
        {"id": 1025, "refs": [141, 142], "tags": {"railway": "narrow_gauge", "usage": "branch", "gauge": "1000", "electrified": "no", "access": "allowed", "maxspeed": "60", "railway:active": "yes"}},
        {"id": 1026, "refs": [143, 144], "tags": {"railway": "rail", "usage": "main", "gauge": "1676", "electrified": "contact_line", "voltage": "15000", "frequency": "16.7", "access": "allowed", "maxspeed": "120", "railway:active": "yes"}},
    ]

    stations_extra = [
        {"id": "st:multi", "name": "SYN-C06-MULTI-ST", "nodeIds": ["n:140", "n:141"], "coordinates": [nodes[140]["lon"], nodes[140]["lat"]], "sourceId": "syn-multi-station"}
    ]
    return nodes, ways_def, stations_extra


def write_osm_xml(nodes: dict[int, dict[str, Any]], ways: list[dict[str, Any]], out_path: pathlib.Path) -> None:
    root = ET.Element("osm", {"version": "0.6", "generator": "railway-ceo-c06-fixture-builder"})
    for nid in sorted(nodes.keys()):
        n = nodes[nid]
        ne = ET.SubElement(root, "node", {"id": str(nid), "lat": f"{n['lat']:.7f}", "lon": f"{n['lon']:.7f}", "version": "1"})
        for k, v in sorted(n["tags"].items()):
            ET.SubElement(ne, "tag", {"k": k, "v": v})
    for w in ways:
        we = ET.SubElement(root, "way", {"id": str(w["id"]), "version": "1"})
        for r in w["refs"]:
            ET.SubElement(we, "nd", {"ref": str(r)})
        for k, v in sorted(w["tags"].items()):
            # For GraphHopper narrow_gauge strict railway_class == RAIL compatibility vs R08 RailGraph:
            # In OpenRailRouting rail.json, railway=narrow_gauge maps to RailwayClass.NARROW_GAUGE.
            # Keep exact railway tag on OSM so we test OpenRailRouting narrow_gauge behavior honestly!
            ET.SubElement(we, "tag", {"k": k, "v": v})
    tree = ET.ElementTree(root)
    ET.indent(tree, space="  ")
    tree.write(out_path, encoding="utf-8", xml_declaration=True)


def parse_tags_to_r08_edge(tags: dict[str, str]) -> dict[str, Any]:
    raw_el = tags.get("electrified", "unknown").strip().lower()
    if raw_el == "no":
        el, volts, freqs = "no", None, None
    elif raw_el in ("contact_line", "rail", "yes"):
        el = "yes"
        volts = [int(float(x)) for x in tags["voltage"].split(";")] if "voltage" in tags else None
        freqs = [int(round(float(x))) for x in tags["frequency"].split(";")] if "frequency" in tags else None
    else:
        el, volts, freqs = "unknown", None, None

    raw_acc = tags.get("access", "unknown").strip().lower()
    acc = "allowed" if raw_acc == "allowed" else ("restricted" if raw_acc in ("restricted", "private", "no") else "unknown")

    return {
        "gaugeMm": [int(tags["gauge"])] if "gauge" in tags else None,
        "electrification": el,
        "voltageV": volts,
        "frequencyHz": freqs,
        "maxSpeedKmh": int(tags["maxspeed"]) if "maxspeed" in tags else None,
        "active": tags.get("railway:active", "yes").lower() != "no",
        "access": acc,
        "oneway": tags.get("oneway", "no").lower(),
    }


def build_graph_pack(
    region_id: str,
    nodes: dict[int, dict[str, Any]],
    ways: list[dict[str, Any]],
    stations_extra: list[dict[str, Any]],
    *,
    bump_speed_way_id: int | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    prov = {"sourceUrl": PROV_URL, "sourceId": "c06-synthetic-v1", "sourceVersion": "1", "license": "Synthetic-QA-Only", "qualityFlags": ["SYNTHETIC_ONLY"]}

    gp_nodes = [
        {"id": f"n:{nid}", "coordinates": [nodes[nid]["lon"], nodes[nid]["lat"]], "regionId": region_id, "provenance": {**prov, "sourceId": f"node:{nid}"}}
        for nid in sorted(nodes.keys())
    ]

    gp_stations = []
    for nid in sorted(nodes.keys()):
        if nodes[nid]["tags"].get("railway") == "station":
            gp_stations.append({
                "id": f"st:{nid}",
                "name": nodes[nid]["tags"]["name"],
                "coordinates": [nodes[nid]["lon"], nodes[nid]["lat"]],
                "regionId": region_id,
                "nodeIds": [f"n:{nid}"],
                "provenance": {**prov, "sourceId": f"station:{nid}"},
            })
    for extra in stations_extra:
        gp_stations.append({
            "id": extra["id"],
            "name": extra["name"],
            "coordinates": extra["coordinates"],
            "regionId": region_id,
            "nodeIds": extra["nodeIds"],
            "provenance": {**prov, "sourceId": extra["sourceId"]},
        })
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

    # Generate deterministic turnRules:
    # - Returning edge (e1.from == e2.to) is marked reversal=True, permitted=True (policy.allowReversal governs).
    # - Acute V-junction at n:135 (w1020 <-> w1021) is FORBIDDEN (permitted=False) matching SwitchTurnCostTask!
    turn_rules = []
    forbidden_pairs = {("e:1020:0:fwd", "e:1021:0:fwd"), ("e:1021:0:bwd", "e:1020:0:bwd")}
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


def audit_c02_metadata_retention(nodes: dict[int, dict[str, Any]], ways: list[dict[str, Any]]) -> dict[str, Any]:
    prefilter = CivilianRailPrefilter.from_file(str(WORKSPACE / "C02_CIVILIAN_RAIL_EXTRACTION_POLICY.json"))
    batch = [
        {"type": "node", "id": nid, "lat": n["lat"], "lon": n["lon"], "tags": n["tags"]}
        for nid, n in sorted(nodes.items())
    ] + [
        {"type": "way", "id": w["id"], "node_refs": w["refs"], "tags": w["tags"]}
        for w in ways
    ]
    res = prefilter.run_batch(batch)
    retained = res["retainedRecords"]
    excluded = res["reasonCounts"]
    retained_ways = [r for r in retained if r["type"] == "way"]
    all_retained_keys = sorted({k for r in retained_ways for k in r.get("tags", {}).keys()})
    discarded_strict_keys = ["access", "maxspeed", "railway:active", "railway:preferred_direction"]
    present_after_c02 = [k for k in discarded_strict_keys if k in all_retained_keys]
    return {
        "schemaVersion": 1,
        "c02PolicyId": "C02-CIVILIAN-RAIL-MIN-NECESSARY-V3",
        "inputObjects": len(batch),
        "retainedObjects": len(retained),
        "excludedCounts": excluded,
        "retainedWayTagKeys": all_retained_keys,
        "discardedCriticalStrictKeys": discarded_strict_keys,
        "discardedKeysStillPresentAfterC02": present_after_c02,
        "conclusion": "C02 intentionally discards access, maxspeed, railway:active, and relation turn restrictions; strict oracle MUST keep these unknown/missing on C02-derived records rather than fabricating values.",
    }


def main() -> None:
    out_dir = WORKSPACE / "fixtures" / "c06_oracle"
    out_dir.mkdir(parents=True, exist_ok=True)
    nodes, ways, stations_extra = build_nodes_and_ways()

    osm_path = out_dir / "c06_synthetic_network.osm"
    pbf_path = out_dir / "c06_synthetic_network.osm.pbf"
    write_osm_xml(nodes, ways, osm_path)

    res = subprocess.run([OSMIUM_EXE, "cat", "--no-progress", "--overwrite", str(osm_path), "-o", str(pbf_path)], capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"osmium cat failed: {res.stderr}")

    pack_v1, truth_v1 = build_graph_pack("c06-synthetic-v1", nodes, ways, stations_extra)
    pack_v2, _ = build_graph_pack("c06-synthetic-v1", nodes, ways, stations_extra, bump_speed_way_id=1001)
    c02_audit = audit_c02_metadata_retention(nodes, ways)

    (out_dir / "c06_graph_v1.json").write_bytes(canonical_json_bytes(pack_v1))
    (out_dir / "c06_graph_v2.json").write_bytes(canonical_json_bytes(pack_v2))
    (out_dir / "c06_fixture_ground_truth.json").write_text(json.dumps(truth_v1, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    (out_dir / "c06_c02_metadata_audit.json").write_text(json.dumps(c02_audit, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    summary = {
        "osmPath": str(osm_path),
        "pbfPath": str(pbf_path),
        "pbfBytes": pbf_path.stat().st_size,
        "pbfSha256": hashlib.sha256(pbf_path.read_bytes()).hexdigest(),
        "osmSha256": hashlib.sha256(osm_path.read_bytes()).hexdigest(),
        "graphV1Sha256": pack_v1["graphSha256"],
        "graphV2Sha256": pack_v2["graphSha256"],
        "nodes": len(pack_v1["nodes"]),
        "stations": len(pack_v1["stations"]),
        "edges": len(pack_v1["edges"]),
        "turnRules": len(pack_v1["turnRules"]),
        "c02DiscardedKeysStillPresent": c02_audit["discardedKeysStillPresentAfterC02"],
    }
    (out_dir / "c06_fixture_manifest.json").write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
