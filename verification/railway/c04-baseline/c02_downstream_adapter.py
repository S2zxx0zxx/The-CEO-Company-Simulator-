"""Downstream C02 -> C03 GraphPack & RegionManifest adapter.

Transforms C02 extracted civilian rail JSONL records into deterministic GraphPack
and RegionManifest JSON structures strictly matching src/domain/models.ts and
src/rail/graph/index.ts (coordinate order [lon, lat], unit-safe integer metres,
conservative null/unknown metadata without fabrication, and canonical graphSha256).
"""

from __future__ import annotations

import hashlib
import json
import math
from collections import Counter
from typing import Any


def _haversine_metres(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    """Compute geodesic distance in metres between two [lon, lat] WGS84 points."""
    r = 6371000.0
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2.0) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2.0) ** 2
    return 2.0 * r * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1.0 - a)))


def _parse_pos_int_list(raw: str | None, *, min_val: int = 1) -> list[int] | None:
    if not raw or raw.strip().lower() == "unknown":
        return None
    vals: list[int] = []
    for part in raw.replace(",", ";").split(";"):
        part = part.strip()
        if not part:
            continue
        try:
            num = int(round(float(part)))
        except ValueError:
            return None
        if num < min_val:
            return None
        if num not in vals:
            vals.append(num)
    return sorted(vals) if vals else None


def _parse_electrification(tags: dict[str, str]) -> tuple[str, list[int] | None, list[int] | None]:
    raw_el = tags.get("electrified", "unknown").strip().lower()
    if raw_el == "no":
        return "no", None, None
    if raw_el in ("contact_line", "rail", "yes", "3rd_rail", "4th_rail"):
        voltages = _parse_pos_int_list(tags.get("voltage"), min_val=1)
        freqs = _parse_pos_int_list(tags.get("frequency"), min_val=0)
        return "yes", voltages, freqs
    return "unknown", None, None


def _make_provenance(
    source_url: str,
    source_id: str,
    source_version: str,
    quality_flags: list[str],
) -> dict[str, Any]:
    return {
        "sourceUrl": source_url,
        "sourceId": source_id,
        "sourceVersion": source_version,
        "license": "ODbL-1.0",
        "qualityFlags": sorted(set(quality_flags)),
    }


def build_graph_pack_from_jsonl(
    jsonl_path: str,
    *,
    region_id: str = "in-east-pilot",
    source_url: str = "https://download.geofabrik.de/asia/india/eastern-zone/eastern-zone-261101.osm.pbf",
    source_version: str = "2026-11-01T21:21:36Z",
    source_sha256: str = "6f84fd4d634839b12b96126debd9e9b0237af8c927c5d746a6e272407fa1363a",
    tiles_sha256: str | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Build deterministic GraphPack and RegionManifest from C02 extracted JSONL."""
    nodes_by_id: dict[int, dict[str, Any]] = {}
    station_records: list[dict[str, Any]] = []
    way_records: list[dict[str, Any]] = []

    with open(jsonl_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            rec = json.loads(line)
            rtype = rec["type"]
            if rtype == "node":
                nodes_by_id[rec["id"]] = rec
            elif rtype == "way":
                way_records.append(rec)

    # Identify station nodes & station ways
    track_ways: list[dict[str, Any]] = []
    station_ways: list[dict[str, Any]] = []
    for w in way_records:
        rw = w["tags"].get("railway")
        if rw in ("station", "halt") or (
            w["tags"].get("public_transport") == "station" and w["tags"].get("train") == "yes"
        ):
            station_ways.append(w)
        else:
            track_ways.append(w)

    # Compute node degree across track ways to find topological junction/endpoint nodes
    degree: Counter[int] = Counter()
    for w in track_ways:
        refs = w["node_refs"]
        degree[refs[0]] += 1
        degree[refs[-1]] += 1
        for mid in refs[1:-1]:
            degree[mid] += 2

    station_node_ids = {
        nid
        for nid, n in nodes_by_id.items()
        if n["tags"].get("railway") in ("station", "halt")
        or (n["tags"].get("public_transport") == "station" and n["tags"].get("train") == "yes")
    }

    topo_node_ids: set[int] = set(station_node_ids)
    for w in track_ways:
        refs = w["node_refs"]
        topo_node_ids.add(refs[0])
        topo_node_ids.add(refs[-1])
        for nid in refs[1:-1]:
            if degree[nid] != 2:
                topo_node_ids.add(nid)

    # For station ways, ensure at least their anchor node is topological
    for sw in station_ways:
        topo_node_ids.add(sw["node_refs"][0])

    # Emit RailNodes in deterministic order ([lon, lat] Coord order per src/domain/validation.ts)
    rail_nodes: list[dict[str, Any]] = []
    for nid in sorted(topo_node_ids):
        n = nodes_by_id[nid]
        rail_nodes.append({
            "id": f"n:{nid}",
            "coordinates": [float(n["lon"]), float(n["lat"])],
            "regionId": region_id,
            "provenance": _make_provenance(
                source_url,
                f"osm:node:{nid}",
                source_version,
                ["c02_verified_node"],
            ),
        })

    # Emit Stations (nodes and ways)
    stations: list[dict[str, Any]] = []
    for nid in sorted(station_node_ids):
        n = nodes_by_id[nid]
        stations.append({
            "id": f"s:node:{nid}",
            "name": n["tags"]["name"],
            "coordinates": [float(n["lon"]), float(n["lat"])],
            "regionId": region_id,
            "nodeIds": [f"n:{nid}"],
            "provenance": _make_provenance(
                source_url,
                f"osm:node:{nid}",
                source_version,
                ["c02_verified_station_node"],
            ),
        })
    for sw in sorted(station_ways, key=lambda x: x["id"]):
        anchor_nid = sw["node_refs"][0]
        anchor = nodes_by_id[anchor_nid]
        stations.append({
            "id": f"s:way:{sw['id']}",
            "name": sw["tags"]["name"],
            "coordinates": [float(anchor["lon"]), float(anchor["lat"])],
            "regionId": region_id,
            "nodeIds": [f"n:{anchor_nid}"],
            "provenance": _make_provenance(
                source_url,
                f"osm:way:{sw['id']}",
                source_version,
                ["c02_verified_station_way"],
            ),
        })

    # Split track ways at intermediate topological nodes and emit directed TrackEdges
    edges: list[dict[str, Any]] = []
    for w in sorted(track_ways, key=lambda x: x["id"]):
        refs = w["node_refs"]
        tags = w["tags"]
        gauge_mm = _parse_pos_int_list(tags.get("gauge"), min_val=1)
        electrification, voltage_v, freq_hz = _parse_electrification(tags)
        oneway = tags.get("oneway", "").strip().lower()
        qflags = ["c02_verified_track"]
        if gauge_mm is None:
            qflags.append("unknown_gauge")
        if electrification == "unknown":
            qflags.append("unknown_electrification")
        qflags.append("unknown_speed")
        qflags.append("unknown_access")

        # Partition refs into maximal segments between topological nodes
        segments: list[list[int]] = []
        cur_seg = [refs[0]]
        for nid in refs[1:]:
            cur_seg.append(nid)
            if nid in topo_node_ids:
                segments.append(cur_seg)
                cur_seg = [nid]

        for seg_idx, seg in enumerate(segments):
            raw_coords = [[float(nodes_by_id[nid]["lon"]), float(nodes_by_id[nid]["lat"])] for nid in seg]
            # Collapse zero-length consecutive segments while preserving exact endpoints
            geom: list[list[float]] = [raw_coords[0]]
            for pt in raw_coords[1:]:
                if pt[0] != geom[-1][0] or pt[1] != geom[-1][1]:
                    geom.append(pt)
            if len(geom) < 2:
                continue

            total_m = 0.0
            for i in range(1, len(geom)):
                total_m += _haversine_metres(geom[i - 1][0], geom[i - 1][1], geom[i][0], geom[i][1])
            length_m = max(1, int(round(total_m)))

            base_edge = {
                "gaugeMm": gauge_mm,
                "electrification": electrification,
                "voltageV": voltage_v,
                "frequencyHz": freq_hz,
                "maxSpeedKmh": None,
                "active": True,
                "access": "unknown",
                "lengthM": length_m,
                "provenance": _make_provenance(
                    source_url,
                    f"osm:way:{w['id']}",
                    source_version,
                    qflags,
                ),
            }

            if oneway != "-1":
                edges.append({
                    **base_edge,
                    "id": f"e:{w['id']}:{seg_idx}:fwd",
                    "from": f"n:{seg[0]}",
                    "to": f"n:{seg[-1]}",
                    "geometry": geom,
                })
            if oneway not in ("yes", "true", "1"):
                edges.append({
                    **base_edge,
                    "id": f"e:{w['id']}:{seg_idx}:rev",
                    "from": f"n:{seg[-1]}",
                    "to": f"n:{seg[0]}",
                    "geometry": list(reversed(geom)),
                })

    rail_nodes.sort(key=lambda x: x["id"])
    stations.sort(key=lambda x: x["id"])
    edges.sort(key=lambda x: x["id"])

    canonical_body = {
        "schemaVersion": 1,
        "regionId": region_id,
        "nodes": rail_nodes,
        "stations": stations,
        "edges": edges,
        "turnRules": [],
    }
    graph_sha = hashlib.sha256(
        json.dumps(canonical_body, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    graph_pack = {
        "schemaVersion": 1,
        "regionId": region_id,
        "graphSha256": graph_sha,
        "nodes": rail_nodes,
        "stations": stations,
        "edges": edges,
        "turnRules": [],
    }

    zero_sha = "0" * 64
    manifest = {
        "id": region_id,
        "schemaVersion": 1,
        "sourceUrl": source_url,
        "snapshotUtc": source_version,
        "sourceSha256": source_sha256,
        "graphSha256": graph_sha,
        "tilesSha256": tiles_sha256 or zero_sha,
        "license": "ODbL-1.0",
        "attribution": "Map data (c) OpenStreetMap contributors, licensed under ODbL 1.0.",
        "stationCount": len(stations),
        "edgeCount": len(edges),
        "qualityReportSha256": zero_sha,
    }
    return graph_pack, manifest
