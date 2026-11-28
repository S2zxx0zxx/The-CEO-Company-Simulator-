"""Production-grade C03 Railway Topology Engine and GraphPack Builder.

Constructs a deterministic directed railway multigraph (matching src/domain/models.ts
and src/rail/graph/index.ts) from C02 extracted JSONL records or validated record
streams, with shared-node-only connectivity, junction/switch turn-rule generation,
conservative compatibility attribute normalization (preserving unknown states explicitly),
connected-component analysis, source provenance, and canonical SHA-256 graph hashing.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import math
import os
import re
import sqlite3
import tempfile
from collections import defaultdict
from typing import Any, Iterable

from c03_station_attachment import (
    _ecma_num,
    attach_stations,
    haversine_metres,
    is_station_tags,
)


def canonical_json_bytes(obj: Any) -> bytes:
    """Serialize JSON canonically with sorted keys and minimal separators."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def compute_canonical_graph_sha256(graph_pack: dict[str, Any]) -> str:
    """Compute canonical SHA-256 over the normalized GraphPack structure (excluding graphSha256)."""
    body = {
        "schemaVersion": graph_pack["schemaVersion"],
        "regionId": graph_pack["regionId"],
        "nodes": graph_pack["nodes"],
        "stations": graph_pack["stations"],
        "edges": graph_pack["edges"],
        "turnRules": graph_pack["turnRules"],
    }
    return hashlib.sha256(canonical_json_bytes(body)).hexdigest()


def serialize_compact_pack(graph_pack: dict[str, Any], compresslevel: int = 6) -> bytes:
    """Serialize GraphPack cleanly to gzip-compressed canonical UTF-8 JSON."""
    return gzip.compress(canonical_json_bytes(graph_pack), compresslevel=compresslevel)


def deserialize_compact_pack(blob: bytes, *, verify_sha256: bool = True) -> dict[str, Any]:
    """Deserialize compact GraphPack and optionally verify canonical graphSha256."""
    pack = json.loads(gzip.decompress(blob).decode("utf-8"))
    if verify_sha256:
        actual = compute_canonical_graph_sha256(pack)
        if actual != pack.get("graphSha256"):
            raise ValueError(
                f"GraphPack SHA-256 mismatch: expected {pack.get('graphSha256')}, got {actual}"
            )
    return pack


def _parse_pos_int_list(raw: str | None, *, min_val: int = 1, unit_scale_kv: bool = False) -> list[int] | None:
    if not raw:
        return None
    s_raw = raw.strip().lower()
    if s_raw in ("unknown", "none", ""):
        return None
    vals: list[int] = []
    for part in s_raw.replace(",", ";").split(";"):
        part = part.strip()
        if not part:
            continue
        if unit_scale_kv and part.endswith("kv"):
            try:
                num_f = float(part[:-2].strip()) * 1000.0
                if not num_f.is_integer():
                    return None
                num = int(num_f)
            except ValueError:
                return None
        else:
            if part in ("dc", "0hz", "0 hz"):
                num = 0
            else:
                cleaned = re.sub(r"\s*(v|hz|mm)$", "", part)
                try:
                    num_f = float(cleaned)
                except ValueError:
                    return None
                if not num_f.is_integer():
                    return None
                num = int(num_f)
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
        voltages = _parse_pos_int_list(tags.get("voltage"), min_val=1, unit_scale_kv=True)
        freqs = _parse_pos_int_list(tags.get("frequency"), min_val=0)
        return "yes", voltages, freqs
    return "unknown", None, None


def _parse_speed_kmh(raw: str | None) -> int | None:
    if not raw:
        return None
    s = raw.strip().lower()
    if not s or s in ("unknown", "signals", "none"):
        return None
    mph = False
    if "mph" in s:
        mph = True
        s = s.replace("mph", "").strip()
    else:
        s = re.sub(r"\s*(km/h|kmh|kph)$", "", s).strip()
    try:
        val = float(s)
    except ValueError:
        return None
    if not math.isfinite(val) or val <= 0:
        return None
    if mph:
        val *= 1.609344
    kmh = int(round(val))
    return kmh if kmh >= 1 else None


def _parse_access(tags: dict[str, str]) -> str:
    raw = tags.get("access", "").strip().lower()
    if raw in ("yes", "permissive", "designated", "public"):
        return "allowed"
    if raw in ("no", "private", "military", "restricted", "customers", "delivery"):
        return "restricted"
    return "unknown"


def _parse_active(tags: dict[str, str]) -> bool:
    rw = tags.get("railway", "").strip().lower()
    if rw in ("construction", "proposed", "disused", "abandoned", "razed"):
        return False
    if tags.get("disused:railway") or tags.get("abandoned:railway"):
        return False
    if tags.get("active", "").strip().lower() in ("false", "no", "0"):
        return False
    return True


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


def _deflection_angle_deg(p_in_prev: list[float], p_node: list[float], p_out_next: list[float]) -> float:
    """Compute unsigned deflection angle (0=straight, 180=U-turn) at p_node."""
    cos_lat = max(0.2, math.cos(math.radians(p_node[1])))
    vx1 = (p_node[0] - p_in_prev[0]) * cos_lat
    vy1 = p_node[1] - p_in_prev[1]
    vx2 = (p_out_next[0] - p_node[0]) * cos_lat
    vy2 = p_out_next[1] - p_node[1]
    mag1 = math.hypot(vx1, vy1)
    mag2 = math.hypot(vx2, vy2)
    if mag1 == 0.0 or mag2 == 0.0:
        return 180.0
    cos_theta = max(-1.0, min(1.0, (vx1 * vx2 + vy1 * vy2) / (mag1 * mag2)))
    return math.degrees(math.acos(cos_theta))


def _tarjan_scc_iterative(node_ids: list[str], adj: dict[str, list[str]]) -> list[list[str]]:
    """Compute strongly connected components iteratively without recursion-depth risk."""
    index_counter = 0
    indices: dict[str, int] = {}
    lowlink: dict[str, int] = {}
    on_stack: set[str] = set()
    scc_stack: list[str] = []
    sccs: list[list[str]] = []

    for start in node_ids:
        if start in indices:
            continue
        call_stack: list[tuple[str, int]] = [(start, 0)]
        indices[start] = lowlink[start] = index_counter
        index_counter += 1
        scc_stack.append(start)
        on_stack.add(start)

        while call_stack:
            v, idx = call_stack[-1]
            neighbors = adj.get(v, [])
            if idx < len(neighbors):
                w = neighbors[idx]
                call_stack[-1] = (v, idx + 1)
                if w not in indices:
                    indices[w] = lowlink[w] = index_counter
                    index_counter += 1
                    scc_stack.append(w)
                    on_stack.add(w)
                    call_stack.append((w, 0))
                elif w in on_stack:
                    if indices[w] < lowlink[v]:
                        lowlink[v] = indices[w]
            else:
                call_stack.pop()
                if call_stack:
                    parent = call_stack[-1][0]
                    if lowlink[v] < lowlink[parent]:
                        lowlink[parent] = lowlink[v]
                if lowlink[v] == indices[v]:
                    comp: list[str] = []
                    while True:
                        w = scc_stack.pop()
                        on_stack.remove(w)
                        comp.append(w)
                        if w == v:
                            break
                    sccs.append(sorted(comp))

    sccs.sort(key=lambda c: (-len(c), c[0]))
    return sccs


def _weak_components(node_ids: list[str], out_adj: dict[str, list[str]], in_adj: dict[str, list[str]]) -> list[list[str]]:
    visited: set[str] = set()
    comps: list[list[str]] = []
    for root in node_ids:
        if root in visited:
            continue
        q = [root]
        visited.add(root)
        i = 0
        while i < len(q):
            cur = q[i]
            i += 1
            for nxt in out_adj.get(cur, ()):
                if nxt not in visited:
                    visited.add(nxt)
                    q.append(nxt)
            for prv in in_adj.get(cur, ()):
                if prv not in visited:
                    visited.add(prv)
                    q.append(prv)
        comps.append(sorted(q))
    comps.sort(key=lambda c: (-len(c), c[0]))
    return comps


def build_c03_topology_from_records(
    records: Iterable[dict[str, Any]],
    *,
    region_id: str = "in-east-pilot",
    source_url: str = "urn:railway:c03:synthetic-fixture",
    source_version: str = "2026-11-28T00:00:00Z",
    source_sha256: str = "0" * 64,
    license_name: str = "ODbL-1.0",
    tiles_sha256: str | None = None,
    extra_quality_flags: list[str] | None = None,
    max_attachment_distance_m: float = 250.0,
    ambiguity_margin_m: float = 25.0,
    allow_spatial_ranking: bool = True,
    max_through_deflection_deg: float = 135.0,
    straight_threshold_deg: float = 15.0,
    turnout_penalty_s: int = 15,
    reversal_penalty_s: int = 120,
    use_sqlite_staging: bool = False,
    staging_dir: str | None = None,
) -> dict[str, Any]:
    """Compile validated C02 records into a production C03 GraphPack & inspection suite.

    Enforces:
    - Exact schema compliance with src/domain/models.ts and src/rail/graph/index.ts
    - Shared-node-only connectivity (no visual crossing joins, no coincident node merges)
    - Explicit zero-length / duplicate / missing-ref quarantine
    - Conservative unknown attribute preservation (never defaulting gauge/power/access)
    - Deterministic junction TurnRule generation with restriction relation support
    - Station attachment via node/way/stop_area/spatial ranking with ambiguity quarantine
    """
    if not (source_url.startswith("https://") or source_url.startswith("urn:railway:")):
        raise ValueError(f"Invalid sourceUrl provenance: {source_url}")

    base_flags = list(extra_quality_flags or [])
    quarantined_topology: list[dict[str, Any]] = []

    db_conn: sqlite3.Connection | None = None
    db_path: str | None = None
    nodes_by_id: dict[int, dict[str, Any]] = {}
    raw_ways: dict[int, dict[str, Any]] = {}
    raw_relations: dict[int, dict[str, Any]] = {}
    conflicted_node_ids: set[int] = set()
    conflicted_way_ids: set[int] = set()

    try:
        if use_sqlite_staging:
            fd, db_path = tempfile.mkstemp(prefix="c03_topo_", suffix=".sqlite", dir=staging_dir)
            os.close(fd)
            db_conn = sqlite3.connect(db_path)
            db_conn.execute("CREATE TABLE nodes (id INTEGER PRIMARY KEY, payload TEXT NOT NULL)")
            db_conn.execute("CREATE TABLE ways (id INTEGER PRIMARY KEY, payload TEXT NOT NULL)")
            db_conn.execute("CREATE TABLE relations (id INTEGER PRIMARY KEY, payload TEXT NOT NULL)")

        for rec in records:
            if not isinstance(rec, dict):
                quarantined_topology.append({"reason": "REJECT_NON_OBJECT_RECORD"})
                continue
            rtype = rec.get("type")
            rid = rec.get("id")
            if not isinstance(rid, int) or isinstance(rid, bool) or rid <= 0:
                quarantined_topology.append({"reason": "REJECT_INVALID_OBJECT_ID", "id": repr(rid)})
                continue
            tags = rec.get("tags") or {}
            if rtype == "node":
                lat = rec.get("lat")
                lon = rec.get("lon")
                if (
                    not isinstance(lat, (int, float))
                    or not isinstance(lon, (int, float))
                    or isinstance(lat, bool)
                    or isinstance(lon, bool)
                    or not (math.isfinite(lat) and math.isfinite(lon))
                    or not (-90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0)
                ):
                    quarantined_topology.append({"type": "node", "id": rid, "reason": "REJECT_INVALID_COORDINATE"})
                    continue
                if use_sqlite_staging and db_conn is not None:
                    cur = db_conn.execute("SELECT payload FROM nodes WHERE id=?", (rid,)).fetchone()
                    if cur is not None:
                        prev = json.loads(cur[0])
                        if prev != rec:
                            conflicted_node_ids.add(rid)
                            quarantined_topology.append({"type": "node", "id": rid, "reason": "QUARANTINE_DUPLICATE_NODE_CONFLICT"})
                        continue
                    db_conn.execute("INSERT INTO nodes (id, payload) VALUES (?, ?)", (rid, json.dumps(rec, separators=(",", ":"))))
                else:
                    if rid in nodes_by_id:
                        if nodes_by_id[rid] != rec:
                            conflicted_node_ids.add(rid)
                            quarantined_topology.append({"type": "node", "id": rid, "reason": "QUARANTINE_DUPLICATE_NODE_CONFLICT"})
                        continue
                    nodes_by_id[rid] = rec
            elif rtype == "way":
                refs = rec.get("node_refs")
                if not isinstance(refs, list) or len(refs) < 2 or not all(isinstance(r, int) and not isinstance(r, bool) for r in refs):
                    quarantined_topology.append({"type": "way", "id": rid, "reason": "REJECT_INVALID_WAY_REFS"})
                    continue
                if rid in raw_ways:
                    if raw_ways[rid] != rec:
                        conflicted_way_ids.add(rid)
                        quarantined_topology.append({"type": "way", "id": rid, "reason": "QUARANTINE_DUPLICATE_WAY_CONFLICT"})
                    continue
                raw_ways[rid] = rec
                if use_sqlite_staging and db_conn is not None:
                    db_conn.execute("INSERT OR IGNORE INTO ways (id, payload) VALUES (?, ?)", (rid, json.dumps(rec, separators=(",", ":"))))
            elif rtype == "relation":
                if rid in raw_relations and raw_relations[rid] != rec:
                    quarantined_topology.append({"type": "relation", "id": rid, "reason": "QUARANTINE_DUPLICATE_RELATION_CONFLICT"})
                    continue
                raw_relations[rid] = rec

        if use_sqlite_staging and db_conn is not None:
            db_conn.commit()
            for row_id, payload in db_conn.execute("SELECT id, payload FROM nodes ORDER BY id"):
                if row_id not in conflicted_node_ids:
                    nodes_by_id[row_id] = json.loads(payload)
    finally:
        if db_conn is not None:
            db_conn.close()
        if db_path and os.path.exists(db_path):
            os.unlink(db_path)

    for cid in sorted(conflicted_node_ids):
        nodes_by_id.pop(cid, None)
    for wid in sorted(conflicted_way_ids):
        raw_ways.pop(wid, None)

    # Separate station ways vs track ways and validate all way node references
    track_ways: list[dict[str, Any]] = []
    station_ways: list[dict[str, Any]] = []
    way_by_id: dict[int, dict[str, Any]] = {}
    for wid in sorted(raw_ways.keys()):
        w = raw_ways[wid]
        refs = [int(r) for r in w["node_refs"]]
        missing = [r for r in refs if r not in nodes_by_id]
        if missing:
            quarantined_topology.append({
                "type": "way",
                "id": wid,
                "reason": "QUARANTINE_MISSING_NODE_REF",
                "missingNodeCount": len(missing),
            })
            continue
        tags = w.get("tags", {})
        if is_station_tags(tags):
            if not tags.get("name", "").strip():
                quarantined_topology.append({"type": "way", "id": wid, "reason": "QUARANTINE_STATION_MISSING_NAME"})
                continue
            station_ways.append(w)
            way_by_id[wid] = w
        else:
            # Verify track way has at least 2 distinct spatial coordinates (reject zero-length degenerate ways)
            pts = [(float(nodes_by_id[r]["lon"]), float(nodes_by_id[r]["lat"])) for r in refs]
            collapsed = [pts[0]]
            for pt in pts[1:]:
                if pt != collapsed[-1]:
                    collapsed.append(pt)
            if len(collapsed) < 2:
                quarantined_topology.append({"type": "way", "id": wid, "reason": "REJECT_ZERO_LENGTH_GEOMETRY"})
                continue
            track_ways.append(w)
            way_by_id[wid] = w

    station_nodes: list[dict[str, Any]] = []
    for nid in sorted(nodes_by_id.keys()):
        n = nodes_by_id[nid]
        tags = n.get("tags", {})
        if is_station_tags(tags):
            if not tags.get("name", "").strip():
                quarantined_topology.append({"type": "node", "id": nid, "reason": "QUARANTINE_STATION_MISSING_NAME"})
                continue
            station_nodes.append(n)

    # Initial topological degree analysis across track_ways
    degree: dict[int, int] = defaultdict(int)
    for w in track_ways:
        refs = [int(r) for r in w["node_refs"]]
        degree[refs[0]] += 1
        degree[refs[-1]] += 1
        for mid in refs[1:-1]:
            degree[mid] += 2

    topo_node_ids: set[int] = set()
    for w in track_ways:
        refs = [int(r) for r in w["node_refs"]]
        topo_node_ids.add(refs[0])
        topo_node_ids.add(refs[-1])
        for mid in refs[1:-1]:
            if degree[mid] != 2:
                topo_node_ids.add(mid)

    relations_list = [raw_relations[rid] for rid in sorted(raw_relations.keys())]

    # Station Attachment Engine
    attach_res = attach_stations(
        nodes_by_id=nodes_by_id,
        track_ways=track_ways,
        station_nodes=station_nodes,
        station_ways=station_ways,
        relations=relations_list,
        topo_node_ids=topo_node_ids,
        region_id=region_id,
        source_url=source_url,
        source_version=source_version,
        license_name=license_name,
        extra_quality_flags=base_flags,
        max_attachment_distance_m=max_attachment_distance_m,
        ambiguity_margin_m=ambiguity_margin_m,
        allow_spatial_ranking=allow_spatial_ranking,
    )
    topo_node_ids.update(attach_res["promoted_topo_node_ids"])
    stations = attach_res["stations"]

    # Emit topological RailNodes
    rail_nodes: list[dict[str, Any]] = []
    for nid in sorted(topo_node_ids):
        n = nodes_by_id[nid]
        rail_nodes.append({
            "id": f"n:{nid}",
            "coordinates": [_ecma_num(n["lon"]), _ecma_num(n["lat"])],
            "regionId": region_id,
            "provenance": _make_provenance(
                source_url,
                f"osm:node:{nid}",
                source_version,
                license_name,
                base_flags + ["c03_verified_node"],
            ),
        })

    # Split track ways cleanly at topological nodes and construct directed TrackEdges
    edges: list[dict[str, Any]] = []
    seen_edge_ids: set[str] = set()
    # Keep track of (way_id, seg_idx, direction, edge_dict) for turn rule generation
    edge_meta: dict[str, dict[str, Any]] = {}

    for w in track_ways:
        wid = int(w["id"])
        refs = [int(r) for r in w["node_refs"]]
        tags = w.get("tags", {})

        gauge_mm = _parse_pos_int_list(tags.get("gauge"), min_val=1)
        electrification, voltage_v, freq_hz = _parse_electrification(tags)
        max_speed_kmh = _parse_speed_kmh(tags.get("maxspeed"))
        access = _parse_access(tags)
        active = _parse_active(tags)
        oneway = tags.get("oneway", "").strip().lower()

        qflags = list(base_flags) + ["c03_verified_track"]
        if gauge_mm is None:
            qflags.append("unknown_gauge")
        if electrification == "unknown":
            qflags.append("unknown_electrification")
        elif electrification == "yes":
            if voltage_v is None:
                qflags.append("unknown_voltage")
            if freq_hz is None:
                qflags.append("unknown_frequency")
        if max_speed_kmh is None:
            qflags.append("unknown_speed")
        if access == "unknown":
            qflags.append("unknown_access")
        if tags.get("bridge") in ("yes", "viaduct"):
            qflags.append("structure:bridge")
        if tags.get("tunnel") == "yes":
            qflags.append("structure:tunnel")
        qflags.sort()

        segments: list[list[int]] = []
        cur_seg = [refs[0]]
        for nid in refs[1:]:
            cur_seg.append(nid)
            if nid in topo_node_ids:
                segments.append(cur_seg)
                cur_seg = [nid]

        for seg_idx, seg in enumerate(segments):
            raw_coords = [[_ecma_num(nodes_by_id[nid]["lon"]), _ecma_num(nodes_by_id[nid]["lat"])] for nid in seg]
            geom: list[list[float]] = [raw_coords[0]]
            for pt in raw_coords[1:]:
                if pt[0] != geom[-1][0] or pt[1] != geom[-1][1]:
                    geom.append(pt)
            if len(geom) < 2:
                quarantined_topology.append({
                    "type": "edge_segment",
                    "wayId": wid,
                    "segmentIndex": seg_idx,
                    "reason": "REJECT_ZERO_LENGTH_GEOMETRY",
                })
                continue

            total_m = 0.0
            for i in range(1, len(geom)):
                total_m += haversine_metres(geom[i - 1][0], geom[i - 1][1], geom[i][0], geom[i][1])
            length_m = int(round(total_m))
            if length_m <= 0:
                length_m = 1

            base_edge = {
                "gaugeMm": gauge_mm,
                "electrification": electrification,
                "voltageV": voltage_v,
                "frequencyHz": freq_hz,
                "maxSpeedKmh": max_speed_kmh,
                "active": active,
                "access": access,
                "lengthM": length_m,
                "provenance": _make_provenance(
                    source_url,
                    f"osm:way:{wid}",
                    source_version,
                    license_name,
                    qflags,
                ),
            }

            if oneway != "-1":
                eid_fwd = f"e:{wid}:{seg_idx}:fwd"
                if eid_fwd in seen_edge_ids:
                    quarantined_topology.append({"type": "edge", "id": eid_fwd, "reason": "REJECT_DUPLICATE_EDGE"})
                else:
                    seen_edge_ids.add(eid_fwd)
                    ed = {
                        **base_edge,
                        "id": eid_fwd,
                        "from": f"n:{seg[0]}",
                        "to": f"n:{seg[-1]}",
                        "geometry": geom,
                    }
                    edges.append(ed)
                    edge_meta[eid_fwd] = {"wayId": wid, "segIdx": seg_idx, "dir": "fwd", "edge": ed}

            if oneway not in ("yes", "true", "1"):
                eid_rev = f"e:{wid}:{seg_idx}:rev"
                if eid_rev in seen_edge_ids:
                    quarantined_topology.append({"type": "edge", "id": eid_rev, "reason": "REJECT_DUPLICATE_EDGE"})
                else:
                    seen_edge_ids.add(eid_rev)
                    rev_geom = list(reversed(geom))
                    ed = {
                        **base_edge,
                        "id": eid_rev,
                        "from": f"n:{seg[-1]}",
                        "to": f"n:{seg[0]}",
                        "geometry": rev_geom,
                    }
                    edges.append(ed)
                    edge_meta[eid_rev] = {"wayId": wid, "segIdx": seg_idx, "dir": "rev", "edge": ed}

    # Parse explicit turn restriction relations cleanly
    # Map (via_node_id_str, from_way_id) -> {"no": set[to_way_id], "only": set[to_way_id]}
    turn_restrictions: dict[tuple[str, int], dict[str, set[int]]] = defaultdict(
        lambda: {"no": set(), "only": set()}
    )
    for rel in relations_list:
        tags = rel.get("tags", {})
        if tags.get("type") != "restriction":
            continue
        rval = (tags.get("restriction") or "").strip().lower()
        if not (rval.startswith("no_") or rval.startswith("only_")):
            quarantined_topology.append({
                "type": "relation",
                "id": rel["id"],
                "reason": "QUARANTINED_UNSUPPORTED_TURN_RESTRICTION",
            })
            continue
        members = rel.get("members", [])
        from_ways = [m.get("ref") for m in members if m.get("type") == "way" and m.get("role") == "from"]
        to_ways = [m.get("ref") for m in members if m.get("type") == "way" and m.get("role") == "to"]
        via_nodes = [m.get("ref") for m in members if m.get("type") == "node" and m.get("role") == "via"]
        if len(from_ways) != 1 or len(to_ways) != 1 or len(via_nodes) != 1:
            quarantined_topology.append({
                "type": "relation",
                "id": rel["id"],
                "reason": "QUARANTINED_MALFORMED_TURN_RESTRICTION",
            })
            continue
        from_wid, to_wid, via_nid = from_ways[0], to_ways[0], via_nodes[0]
        if not (isinstance(from_wid, int) and isinstance(to_wid, int) and isinstance(via_nid, int)):
            quarantined_topology.append({
                "type": "relation",
                "id": rel["id"],
                "reason": "QUARANTINED_MALFORMED_TURN_RESTRICTION",
            })
            continue
        via_str = f"n:{via_nid}"
        kind = "no" if rval.startswith("no_") else "only"
        turn_restrictions[(via_str, from_wid)][kind].add(to_wid)

    # Index incoming & outgoing edges per node for deterministic TurnRule generation
    incoming_by_node: dict[str, list[dict[str, Any]]] = defaultdict(list)
    outgoing_by_node: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for ed in edges:
        incoming_by_node[ed["to"]].append(ed)
        outgoing_by_node[ed["from"]].append(ed)

    turn_rules: list[dict[str, Any]] = []
    for node_dict in rail_nodes:
        nid_str = node_dict["id"]
        inc_edges = sorted(incoming_by_node.get(nid_str, ()), key=lambda e: e["id"])
        out_edges = sorted(outgoing_by_node.get(nid_str, ()), key=lambda e: e["id"])
        for e_in in inc_edges:
            m_in = edge_meta[e_in["id"]]
            restr = turn_restrictions.get((nid_str, m_in["wayId"]))
            g_in = e_in["geometry"]
            for e_out in out_edges:
                m_out = edge_meta[e_out["id"]]
                g_out = e_out["geometry"]

                # Check exact opposite reversal onto twin segment of same physical segment
                is_reverse_twin = (
                    e_in["from"] == e_out["to"]
                    and e_in["from"] != e_in["to"]
                    and m_in["wayId"] == m_out["wayId"]
                    and m_in["segIdx"] == m_out["segIdx"]
                )
                is_direct_return = e_in["from"] == e_out["to"] and e_in["from"] != e_in["to"]

                if restr:
                    out_wid = m_out["wayId"]
                    explicitly_blocked = (out_wid in restr["no"]) or (
                        bool(restr["only"]) and out_wid not in restr["only"]
                    )
                    if explicitly_blocked:
                        turn_rules.append({
                            "incoming": e_in["id"],
                            "outgoing": e_out["id"],
                            "permitted": False,
                            "penaltyS": 0,
                            "reversal": bool(is_direct_return),
                        })
                        continue

                if is_reverse_twin:
                    turn_rules.append({
                        "incoming": e_in["id"],
                        "outgoing": e_out["id"],
                        "permitted": True,
                        "penaltyS": int(reversal_penalty_s),
                        "reversal": True,
                    })
                    continue

                if is_direct_return:
                    # Distinct parallel/loop return edge back to origin node
                    turn_rules.append({
                        "incoming": e_in["id"],
                        "outgoing": e_out["id"],
                        "permitted": True,
                        "penaltyS": int(reversal_penalty_s),
                        "reversal": True,
                    })
                    continue

                defl = _deflection_angle_deg(g_in[-2], g_in[-1], g_out[1])
                if defl > max_through_deflection_deg:
                    # Acute hairpin switchback onto a different edge without reversing
                    turn_rules.append({
                        "incoming": e_in["id"],
                        "outgoing": e_out["id"],
                        "permitted": False,
                        "penaltyS": 0,
                        "reversal": False,
                    })
                else:
                    same_way_forward = m_in["wayId"] == m_out["wayId"]
                    penalty = 0 if (same_way_forward or defl <= straight_threshold_deg) else int(turnout_penalty_s)
                    turn_rules.append({
                        "incoming": e_in["id"],
                        "outgoing": e_out["id"],
                        "permitted": True,
                        "penaltyS": penalty,
                        "reversal": False,
                    })

    # Canonical deterministic ordering matching src/rail/graph/index.ts normalize()
    rail_nodes.sort(key=lambda x: x["id"])
    stations.sort(key=lambda x: x["id"])
    edges.sort(key=lambda x: x["id"])
    turn_rules.sort(key=lambda x: (x["incoming"], x["outgoing"]))

    graph_pack: dict[str, Any] = {
        "schemaVersion": 1,
        "regionId": region_id,
        "graphSha256": "0" * 64,
        "nodes": rail_nodes,
        "stations": stations,
        "edges": edges,
        "turnRules": turn_rules,
    }
    graph_sha = compute_canonical_graph_sha256(graph_pack)
    graph_pack["graphSha256"] = graph_sha

    # Compute structural diagnostics & compatibility summary
    node_id_list = [n["id"] for n in rail_nodes]
    out_adj: dict[str, list[str]] = {nid: [e["to"] for e in outgoing_by_node.get(nid, ())] for nid in node_id_list}
    in_adj: dict[str, list[str]] = {nid: [e["from"] for e in incoming_by_node.get(nid, ())] for nid in node_id_list}

    weak_comps = _weak_components(node_id_list, out_adj, in_adj)
    sccs = _tarjan_scc_iterative(node_id_list, out_adj)

    dead_ends = sorted(
        nid for nid in node_id_list
        if len({e["to"] for e in outgoing_by_node.get(nid, ())} | {e["from"] for e in incoming_by_node.get(nid, ())}) == 1
    )
    isolated_nodes = sorted(
        nid for nid in node_id_list
        if not outgoing_by_node.get(nid) and not incoming_by_node.get(nid)
    )
    junction_nodes = sorted(
        nid for nid in node_id_list
        if len({e["to"] for e in outgoing_by_node.get(nid, ())} | {e["from"] for e in incoming_by_node.get(nid, ())}) >= 3
    )

    pair_groups: dict[tuple[str, str], list[str]] = defaultdict(list)
    for ed in edges:
        pair_groups[(ed["from"], ed["to"])].append(ed["id"])
    parallel_corridors = [
        {"from": k[0], "to": k[1], "edgeIds": sorted(v)}
        for k, v in sorted(pair_groups.items())
        if len(v) > 1
    ]

    mode_change_boundary_nodes: list[str] = []
    for nid in node_id_list:
        inc_els = {e["electrification"] for e in incoming_by_node.get(nid, ())}
        out_els = {e["electrification"] for e in outgoing_by_node.get(nid, ())}
        all_els = inc_els | out_els
        if "yes" in all_els and "no" in all_els:
            mode_change_boundary_nodes.append(nid)

    quarantined_topology.sort(key=lambda x: (str(x.get("reason", "")), str(x.get("id", ""))))

    topology_report = {
        "schemaVersion": 1,
        "regionId": region_id,
        "graphSha256": graph_sha,
        "counts": {
            "nodes": len(rail_nodes),
            "edges": len(edges),
            "stations": len(stations),
            "turnRules": len(turn_rules),
            "permittedTurnRules": sum(1 for t in turn_rules if t["permitted"]),
            "forbiddenTurnRules": sum(1 for t in turn_rules if not t["permitted"]),
            "reversalTurnRules": sum(1 for t in turn_rules if t["reversal"]),
            "weakComponentCount": len(weak_comps),
            "stronglyConnectedComponentCount": len(sccs),
            "deadEndNodeCount": len(dead_ends),
            "isolatedNodeCount": len(isolated_nodes),
            "junctionNodeCount": len(junction_nodes),
            "parallelCorridorCount": len(parallel_corridors),
            "modeChangeBoundaryNodeCount": len(mode_change_boundary_nodes),
            "quarantinedTopologyCount": len(quarantined_topology),
            "quarantinedStationCount": attach_res["attachment_report"]["quarantinedCount"],
        },
        "compatibilityCoverage": {
            "gaugeKnownEdges": sum(1 for e in edges if e["gaugeMm"] is not None),
            "gaugeUnknownEdges": sum(1 for e in edges if e["gaugeMm"] is None),
            "electrifiedYesEdges": sum(1 for e in edges if e["electrification"] == "yes"),
            "electrifiedNoEdges": sum(1 for e in edges if e["electrification"] == "no"),
            "electrifiedUnknownEdges": sum(1 for e in edges if e["electrification"] == "unknown"),
            "speedKnownEdges": sum(1 for e in edges if e["maxSpeedKmh"] is not None),
            "speedUnknownEdges": sum(1 for e in edges if e["maxSpeedKmh"] is None),
            "accessAllowedEdges": sum(1 for e in edges if e["access"] == "allowed"),
            "accessRestrictedEdges": sum(1 for e in edges if e["access"] == "restricted"),
            "accessUnknownEdges": sum(1 for e in edges if e["access"] == "unknown"),
            "inactiveEdges": sum(1 for e in edges if not e["active"]),
        },
        "weakComponents": [{"size": len(c), "nodeIds": c[:25]} for c in weak_comps],
        "deadEndNodeIds": dead_ends,
        "isolatedNodeIds": isolated_nodes,
        "junctionNodeIds": junction_nodes,
        "modeChangeBoundaryNodeIds": mode_change_boundary_nodes,
        "parallelCorridors": parallel_corridors,
        "quarantinedTopology": quarantined_topology,
        "stationAttachment": attach_res["attachment_report"],
    }

    quality_report_sha = hashlib.sha256(canonical_json_bytes(topology_report)).hexdigest()
    zero_sha = "0" * 64
    region_manifest = {
        "id": region_id,
        "schemaVersion": 1,
        "sourceUrl": source_url,
        "snapshotUtc": source_version,
        "sourceSha256": source_sha256,
        "graphSha256": graph_sha,
        "tilesSha256": tiles_sha256 or zero_sha,
        "license": license_name,
        "attribution": "Map data (c) OpenStreetMap contributors, licensed under ODbL 1.0.",
        "stationCount": len(stations),
        "edgeCount": len(edges),
        "qualityReportSha256": quality_report_sha,
    }

    return {
        "graphPack": graph_pack,
        "regionManifest": region_manifest,
        "topologyReport": topology_report,
        "attachmentReport": attach_res["attachment_report"],
        "compactPackBytes": serialize_compact_pack(graph_pack),
    }


def build_c03_topology_from_jsonl(jsonl_path: str, **kwargs: Any) -> dict[str, Any]:
    """Stream C02 approved JSONL records directly into build_c03_topology_from_records."""
    def _iter_jsonl() -> Iterable[dict[str, Any]]:
        with open(jsonl_path, "r", encoding="utf-8") as f:
            for line in f:
                s = line.strip()
                if s:
                    yield json.loads(s)

    return build_c03_topology_from_records(_iter_jsonl(), **kwargs)
