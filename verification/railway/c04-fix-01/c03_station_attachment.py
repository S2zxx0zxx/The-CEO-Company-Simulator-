"""Production-grade C03 Station-to-Track Attachment Engine.

Associates OSM civilian station nodes, station ways, and public_transport=stop_area / route
relations onto verified track nodes without fabricating physical railway edges.
Standalone stations located separately from track geometry are ranked deterministically
within a configured attachment radius; ambiguous candidates and disconnected stations are
explicitly quarantined and never admitted as routable stops.
"""

from __future__ import annotations

import math
from collections import defaultdict
from typing import Any


def haversine_metres(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    """Compute WGS84 geodesic distance in metres between two [lon, lat] points."""
    r = 6371000.0
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2.0) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2.0) ** 2
    return 2.0 * r * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1.0 - a)))


def is_station_tags(tags: dict[str, str]) -> bool:
    """Return True if tags identify an ordinary civilian passenger rail station or halt."""
    rw = tags.get("railway")
    if rw in ("station", "halt"):
        return True
    return tags.get("public_transport") == "station" and tags.get("train") == "yes"


def _ecma_num(val: float) -> int | float:
    """Normalize integer-valued finite floats so JSON matches ECMA-262 Number serialization."""
    f = float(val)
    if f == 0.0:
        return 0
    return int(f) if f.is_integer() else f


def _make_provenance(
    source_url: str,
    source_id: str,
    source_version: str,
    license_name: str,
    quality_flags: list[str],
) -> dict[str, Any]:
    return {
        "sourceUrl": source_url,
        "sourceId": source_id,
        "sourceVersion": source_version,
        "license": license_name,
        "qualityFlags": sorted(set(quality_flags)),
    }


class _UnionFind:
    """Disjoint-set union over integer track node IDs to track topological components."""

    def __init__(self) -> None:
        self.parent: dict[int, int] = {}

    def find(self, x: int) -> int:
        p = self.parent.setdefault(x, x)
        while self.parent[p] != p:
            self.parent[p] = self.parent[self.parent[p]]
            p = self.parent[p]
        root = p
        while self.parent[x] != root:
            nxt = self.parent[x]
            self.parent[x] = root
            x = nxt
        return root

    def union(self, a: int, b: int) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            if ra < rb:
                self.parent[rb] = ra
            else:
                self.parent[ra] = rb


def attach_stations(
    *,
    nodes_by_id: dict[int, dict[str, Any]],
    track_ways: list[dict[str, Any]],
    station_nodes: list[dict[str, Any]],
    station_ways: list[dict[str, Any]],
    relations: list[dict[str, Any]],
    topo_node_ids: set[int],
    region_id: str,
    source_url: str,
    source_version: str,
    license_name: str = "ODbL-1.0",
    extra_quality_flags: list[str] | None = None,
    max_attachment_distance_m: float = 250.0,
    ambiguity_margin_m: float = 25.0,
    duplicate_merge_radius_m: float = 250.0,
    conflicting_duplicate_distance_m: float = 2000.0,
    allow_spatial_ranking: bool = True,
) -> dict[str, Any]:
    """Attach eligible civilian stations to track nodes deterministically.

    Returns a dictionary with:
    - stations: validated GraphPack station dicts
    - promoted_topo_node_ids: set[int] of existing OSM track nodes promoted as stop anchors
    - attached_records: detailed attachment provenance & confidence records
    - quarantined_records: disconnected / ambiguous / duplicate quarantined station records
    - duplicate_merges: summary of deterministically merged multi-object stations
    """
    base_flags = list(extra_quality_flags or [])

    # 1. Index all track vertices and build connected components strictly via shared OSM node IDs
    uf = _UnionFind()
    track_vertex_to_ways: dict[int, set[int]] = defaultdict(set)
    track_vertex_names: dict[int, set[str]] = defaultdict(set)
    for w in track_ways:
        wid = int(w["id"])
        refs = [int(r) for r in w["node_refs"]]
        wname = w.get("tags", {}).get("name", "").strip().lower()
        for idx, nid in enumerate(refs):
            track_vertex_to_ways[nid].add(wid)
            if wname:
                track_vertex_names[nid].add(wname)
            if idx > 0:
                uf.union(refs[idx - 1], nid)

    track_vertex_ids = set(track_vertex_to_ways.keys())
    track_components = {nid: uf.find(nid) for nid in track_vertex_ids}

    # Build a ~0.01 deg spatial grid (~1.1 km) for fast bounded radius candidate lookups
    grid_step = 0.01
    grid: dict[tuple[int, int], list[int]] = defaultdict(list)
    for nid in sorted(track_vertex_ids):
        n = nodes_by_id.get(nid)
        if not n:
            continue
        gx = math.floor(float(n["lon"]) / grid_step)
        gy = math.floor(float(n["lat"]) / grid_step)
        grid[(gx, gy)].append(nid)

    # 2. Index stop_area and route relations linking stations with track stop nodes/ways
    # Map ("node"|"way", osm_id) -> set of linked track node IDs via stop_area
    stop_area_track_links: dict[tuple[str, int], set[int]] = defaultdict(set)
    stop_area_groups: list[set[tuple[str, int]]] = []
    for rel in sorted(relations, key=lambda r: int(r["id"])):
        tags = rel.get("tags", {})
        if not (
            (tags.get("public_transport") == "stop_area" and tags.get("train") == "yes")
            or (tags.get("type") == "route" and tags.get("route") in ("train", "railway", "light_rail", "subway"))
        ):
            continue
        members = rel.get("members", [])
        station_members: set[tuple[str, int]] = set()
        stop_track_nids: set[int] = set()
        for m in members:
            mtype = m.get("type")
            mid = m.get("ref")
            role = (m.get("role") or "").strip().lower()
            if not isinstance(mid, int):
                continue
            if mtype == "node":
                node_obj = nodes_by_id.get(mid)
                if node_obj and is_station_tags(node_obj.get("tags", {})):
                    station_members.add(("node", mid))
                if mid in track_vertex_ids and (
                    role in ("stop", "stop_entry_only", "stop_exit_only")
                    or (tags.get("public_transport") == "stop_area" and (
                        (node_obj and node_obj.get("tags", {}).get("public_transport") == "stop_position")
                        or not (node_obj and is_station_tags(node_obj.get("tags", {})))
                    ))
                ):
                    stop_track_nids.add(mid)
            elif mtype == "way":
                if any(int(sw["id"]) == mid for sw in station_ways):
                    station_members.add(("way", mid))
                for tw in track_ways:
                    if int(tw["id"]) == mid:
                        for r in tw["node_refs"]:
                            if int(r) in topo_node_ids:
                                stop_track_nids.add(int(r))
        if station_members and stop_track_nids:
            for sm in station_members:
                stop_area_track_links[sm].update(stop_track_nids)
            if tags.get("public_transport") == "stop_area":
                stop_area_groups.append(station_members)

    # 3. Collect raw station candidates & detect exact raw ID duplicates
    raw_candidates: list[dict[str, Any]] = []
    seen_raw_ids: set[str] = set()
    quarantined_records: list[dict[str, Any]] = []

    for sn in sorted(station_nodes, key=lambda x: int(x["id"])):
        nid = int(sn["id"])
        raw_id = f"s:node:{nid}"
        if raw_id in seen_raw_ids:
            quarantined_records.append({
                "stationId": raw_id,
                "sourceId": f"osm:node:{nid}",
                "name": sn.get("tags", {}).get("name", ""),
                "reason": "QUARANTINE_DUPLICATE_STATION_ID",
                "nonRoutable": True,
                "candidateCount": 0,
                "nearestDistanceM": None,
            })
            continue
        seen_raw_ids.add(raw_id)
        tags = sn.get("tags", {})
        direct = {nid} if nid in track_vertex_ids else set()
        rel_links = set(stop_area_track_links.get(("node", nid), set()))
        raw_candidates.append({
            "kind": "node",
            "osmId": nid,
            "rawKey": ("node", nid),
            "stationId": raw_id,
            "sourceId": f"osm:node:{nid}",
            "name": tags.get("name", "").strip(),
            "ref": tags.get("ref", "").strip(),
            "uicRef": tags.get("uic_ref", "").strip(),
            "lon": float(sn["lon"]),
            "lat": float(sn["lat"]),
            "directTrackNodes": direct,
            "relationTrackNodes": rel_links,
            "sourceIds": [f"osm:node:{nid}"],
            "methodHint": "SHARED_TRACK_NODE",
        })

    for sw in sorted(station_ways, key=lambda x: int(x["id"])):
        wid = int(sw["id"])
        raw_id = f"s:way:{wid}"
        if raw_id in seen_raw_ids:
            quarantined_records.append({
                "stationId": raw_id,
                "sourceId": f"osm:way:{wid}",
                "name": sw.get("tags", {}).get("name", ""),
                "reason": "QUARANTINE_DUPLICATE_STATION_ID",
                "nonRoutable": True,
                "candidateCount": 0,
                "nearestDistanceM": None,
            })
            continue
        seen_raw_ids.add(raw_id)
        refs = [int(r) for r in sw["node_refs"]]
        pts = [(float(nodes_by_id[r]["lon"]), float(nodes_by_id[r]["lat"])) for r in refs if r in nodes_by_id]
        if not pts:
            quarantined_records.append({
                "stationId": raw_id,
                "sourceId": f"osm:way:{wid}",
                "name": sw.get("tags", {}).get("name", ""),
                "reason": "QUARANTINE_UNRESOLVED_STATION_GEOMETRY",
                "nonRoutable": True,
                "candidateCount": 0,
                "nearestDistanceM": None,
            })
            continue
        lon_c = sum(p[0] for p in pts) / len(pts)
        lat_c = sum(p[1] for p in pts) / len(pts)
        tags = sw.get("tags", {})
        direct = {r for r in refs if r in track_vertex_ids}
        rel_links = set(stop_area_track_links.get(("way", wid), set()))
        raw_candidates.append({
            "kind": "way",
            "osmId": wid,
            "rawKey": ("way", wid),
            "stationId": raw_id,
            "sourceId": f"osm:way:{wid}",
            "name": tags.get("name", "").strip(),
            "ref": tags.get("ref", "").strip(),
            "uicRef": tags.get("uic_ref", "").strip(),
            "lon": lon_c,
            "lat": lat_c,
            "directTrackNodes": direct,
            "relationTrackNodes": rel_links,
            "sourceIds": [f"osm:way:{wid}"],
            "methodHint": "STATION_WAY_ANCHOR",
        })

    # 4. Handle duplicates: detect conflicting duplicates with same ref/uic_ref far apart,
    #    and merge coherent multi-object representations of the same station deterministically.
    by_code: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for cand in raw_candidates:
        code = cand["uicRef"] or (f"ref:{cand['ref'].lower()}" if cand["ref"] else "")
        if code:
            by_code[code].append(cand)

    conflicted_ids: set[str] = set()
    for code, items in sorted(by_code.items()):
        if len(items) < 2:
            continue
        max_pair_d = 0.0
        for i in range(len(items)):
            for j in range(i + 1, len(items)):
                d = haversine_metres(items[i]["lon"], items[i]["lat"], items[j]["lon"], items[j]["lat"])
                max_pair_d = max(max_pair_d, d)
        if max_pair_d > conflicting_duplicate_distance_m:
            for item in items:
                conflicted_ids.add(item["stationId"])
                quarantined_records.append({
                    "stationId": item["stationId"],
                    "sourceId": item["sourceId"],
                    "name": item["name"],
                    "reason": "QUARANTINE_CONFLICTING_DUPLICATE_STATION",
                    "nonRoutable": True,
                    "candidateCount": 0,
                    "nearestDistanceM": round(max_pair_d, 2),
                })

    active_candidates = [c for c in raw_candidates if c["stationId"] not in conflicted_ids]
    active_candidates.sort(key=lambda c: c["stationId"])

    # Build stop_area lookup for grouping
    same_stop_area: dict[tuple[str, int], int] = {}
    for gid, grp in enumerate(stop_area_groups):
        for member in grp:
            same_stop_area.setdefault(member, gid)

    merged_groups: list[dict[str, Any]] = []
    duplicate_merges: list[dict[str, Any]] = []
    consumed: set[str] = set()

    for i, base in enumerate(active_candidates):
        if base["stationId"] in consumed:
            continue
        consumed.add(base["stationId"])
        group = dict(base)
        group["directTrackNodes"] = set(base["directTrackNodes"])
        group["relationTrackNodes"] = set(base["relationTrackNodes"])
        group["sourceIds"] = list(base["sourceIds"])
        group["mergedFrom"] = [base["stationId"]]

        for other in active_candidates[i + 1:]:
            if other["stationId"] in consumed:
                continue
            dist = haversine_metres(base["lon"], base["lat"], other["lon"], other["lat"])
            same_area = (
                base["rawKey"] in same_stop_area
                and other["rawKey"] in same_stop_area
                and same_stop_area[base["rawKey"]] == same_stop_area[other["rawKey"]]
            )
            same_identity = (
                bool(base["uicRef"] and base["uicRef"] == other["uicRef"])
                or (
                    bool(base["name"] and base["name"].lower() == other["name"].lower())
                    and dist <= duplicate_merge_radius_m
                )
            )
            if same_area or same_identity:
                consumed.add(other["stationId"])
                group["directTrackNodes"].update(other["directTrackNodes"])
                group["relationTrackNodes"].update(other["relationTrackNodes"])
                group["sourceIds"].extend(other["sourceIds"])
                group["mergedFrom"].append(other["stationId"])

        if len(group["mergedFrom"]) > 1:
            duplicate_merges.append({
                "canonicalStationId": group["stationId"],
                "mergedStationIds": sorted(group["mergedFrom"]),
                "sourceIds": sorted(set(group["sourceIds"])),
            })
        merged_groups.append(group)

    # 5. Rank & resolve track node anchors cleanly for each merged station
    lat_deg_margin = (max_attachment_distance_m / 111000.0) + 0.005
    stations: list[dict[str, Any]] = []
    attached_records: list[dict[str, Any]] = []
    promoted_topo_node_ids: set[int] = set()

    for st in sorted(merged_groups, key=lambda x: x["stationId"]):
        explicit_nodes = sorted(st["directTrackNodes"] | st["relationTrackNodes"])
        if explicit_nodes:
            # Explicit Tier 1 attachment: direct shared node, station way anchor, or stop_area relation
            promoted_topo_node_ids.update(explicit_nodes)
            anchor_dists = [
                haversine_metres(
                    st["lon"], st["lat"],
                    float(nodes_by_id[nid]["lon"]), float(nodes_by_id[nid]["lat"]),
                )
                for nid in explicit_nodes
            ]
            max_anchor_d = max(anchor_dists)
            if st["directTrackNodes"] and st["relationTrackNodes"]:
                method = "MULTI_PLATFORM_COMBINED"
            elif st["relationTrackNodes"]:
                method = "STOP_AREA_RELATION"
            elif st["kind"] == "way":
                method = "STATION_WAY_ANCHOR"
            else:
                method = "SHARED_TRACK_NODE"

            qflags = list(base_flags) + ["c03_station_attached", f"method:{method}"]
            if len(explicit_nodes) > 1:
                qflags.append("multi_platform_anchors")
            if len(st["mergedFrom"]) > 1:
                qflags.append("merged_duplicate_station")

            node_id_strs = sorted({f"n:{nid}" for nid in explicit_nodes})
            stations.append({
                "id": st["stationId"],
                "name": st["name"],
                "coordinates": [_ecma_num(st["lon"]), _ecma_num(st["lat"])],
                "regionId": region_id,
                "nodeIds": node_id_strs,
                "provenance": _make_provenance(
                    source_url, st["sourceId"], source_version, license_name, qflags
                ),
            })
            attached_records.append({
                "stationId": st["stationId"],
                "sourceId": st["sourceId"],
                "name": st["name"],
                "status": "ATTACHED",
                "method": method,
                "confidence": 1.0,
                "attachmentDistanceM": round(max_anchor_d, 2),
                "candidateCount": len(explicit_nodes),
                "nodeIds": node_id_strs,
                "sourceIds": sorted(set(st["sourceIds"])),
            })
            continue

        # Tier 2: Standalone station located separately from track geometry
        if not allow_spatial_ranking:
            quarantined_records.append({
                "stationId": st["stationId"],
                "sourceId": st["sourceId"],
                "name": st["name"],
                "reason": "DISCONNECTED_STATION",
                "nonRoutable": True,
                "candidateCount": 0,
                "nearestDistanceM": None,
            })
            continue

        lon_deg_margin = lat_deg_margin / max(0.2, math.cos(math.radians(st["lat"])))
        gx_min = math.floor((st["lon"] - lon_deg_margin) / grid_step)
        gx_max = math.floor((st["lon"] + lon_deg_margin) / grid_step)
        gy_min = math.floor((st["lat"] - lat_deg_margin) / grid_step)
        gy_max = math.floor((st["lat"] + lat_deg_margin) / grid_step)

        st_name_low = st["name"].lower()
        candidates: list[dict[str, Any]] = []
        for gx in range(gx_min, gx_max + 1):
            for gy in range(gy_min, gy_max + 1):
                for nid in grid.get((gx, gy), ()):
                    tn = nodes_by_id[nid]
                    d = haversine_metres(st["lon"], st["lat"], float(tn["lon"]), float(tn["lat"]))
                    if d <= max_attachment_distance_m:
                        name_match = 0 if (st_name_low and any(st_name_low in wn for wn in track_vertex_names[nid])) else 1
                        topo_pref = 0 if nid in topo_node_ids else 1
                        candidates.append({
                            "nid": nid,
                            "dist": d,
                            "nameMatch": name_match,
                            "topoPref": topo_pref,
                            "component": track_components[nid],
                            "ways": sorted(track_vertex_to_ways[nid]),
                        })

        if not candidates:
            quarantined_records.append({
                "stationId": st["stationId"],
                "sourceId": st["sourceId"],
                "name": st["name"],
                "reason": "DISCONNECTED_STATION",
                "nonRoutable": True,
                "candidateCount": 0,
                "nearestDistanceM": None,
            })
            continue

        candidates.sort(key=lambda c: (round(c["dist"], 3), c["nameMatch"], c["topoPref"], f"n:{c['nid']}"))
        best = candidates[0]

        # Ambiguity rejection: reject if near-best candidates span multiple disconnected
        # components OR distinct non-matching ways within ambiguity_margin_m.
        near_best = [c for c in candidates if c["dist"] <= best["dist"] + ambiguity_margin_m]
        distinct_comps = {c["component"] for c in near_best}
        best_ways = set(best["ways"])
        competing_other_ways = [
            c for c in near_best[1:]
            if not (set(c["ways"]) & best_ways)
            and (c["nameMatch"] == best["nameMatch"])
            and abs(c["dist"] - best["dist"]) <= ambiguity_margin_m
        ]
        if len(distinct_comps) > 1 or competing_other_ways:
            quarantined_records.append({
                "stationId": st["stationId"],
                "sourceId": st["sourceId"],
                "name": st["name"],
                "reason": "AMBIGUOUS_CANDIDATES",
                "nonRoutable": True,
                "candidateCount": len(candidates),
                "nearestDistanceM": round(best["dist"], 2),
                "competingNodeIds": [f"n:{c['nid']}" for c in near_best[:5]],
            })
            continue

        # Clear unambiguous candidate: promote existing real OSM track node without creating fake edge
        chosen_nid = best["nid"]
        promoted_topo_node_ids.add(chosen_nid)
        confidence = round(max(0.5, 1.0 - (best["dist"] / (max_attachment_distance_m * 2.0))), 4)
        qflags = list(base_flags) + ["c03_station_attached", "method:SPATIAL_CANDIDATE_RANKED"]
        if len(st["mergedFrom"]) > 1:
            qflags.append("merged_duplicate_station")

        node_id_strs = [f"n:{chosen_nid}"]
        stations.append({
            "id": st["stationId"],
            "name": st["name"],
            "coordinates": [_ecma_num(st["lon"]), _ecma_num(st["lat"])],
            "regionId": region_id,
            "nodeIds": node_id_strs,
            "provenance": _make_provenance(
                source_url, st["sourceId"], source_version, license_name, qflags
            ),
        })
        attached_records.append({
            "stationId": st["stationId"],
            "sourceId": st["sourceId"],
            "name": st["name"],
            "status": "ATTACHED",
            "method": "SPATIAL_CANDIDATE_RANKED",
            "confidence": confidence,
            "attachmentDistanceM": round(best["dist"], 2),
            "candidateCount": len(candidates),
            "nodeIds": node_id_strs,
            "sourceIds": sorted(set(st["sourceIds"])),
        })

    quarantined_records.sort(key=lambda x: (x["stationId"], x["reason"]))
    attached_records.sort(key=lambda x: x["stationId"])
    stations.sort(key=lambda x: x["id"])

    return {
        "stations": stations,
        "promoted_topo_node_ids": promoted_topo_node_ids,
        "attached_records": attached_records,
        "quarantined_records": quarantined_records,
        "duplicate_merges": duplicate_merges,
        "attachment_report": {
            "schemaVersion": 1,
            "regionId": region_id,
            "maxAttachmentDistanceM": max_attachment_distance_m,
            "ambiguityMarginM": ambiguity_margin_m,
            "attachedCount": len(attached_records),
            "quarantinedCount": len(quarantined_records),
            "duplicateMergeCount": len(duplicate_merges),
            "attached": attached_records,
            "quarantined": quarantined_records,
        },
    }
