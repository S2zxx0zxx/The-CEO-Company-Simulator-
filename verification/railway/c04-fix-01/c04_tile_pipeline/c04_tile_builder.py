"""Deterministic C04 Synthetic Basemap & PMTiles Pipeline Builder.

1. Synthesizes an offline multi-layer corridor OSM XML fixture around [85.85, 21.88] .. [86.35, 22.24]
   containing approved civilian railways, stations, rivers, lakes, landuse, roads, towns,
   PLUS restricted/boundary exclusion test objects to verify fail-closed filtering.
2. Converts synthetic OSM XML -> PBF via pinned Osmium 1.19.0.
3. Invokes pinned Planetiler v0.10.2 generate-custom with versioned railway_basemap_schema.yml
   and --exclude_layers=boundary --download=false to compile a genuine MVT .pmtiles archive.
4. Runs C02 CivilianRailPrefilter + StreamingC02Pipeline + C03 Topology Builder on the same
   synthetic fixture, wiring exact pmtilesSha256 into RegionManifest and C04TileBuildManifest.
"""

from __future__ import annotations

import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import time
import xml.sax.saxutils as saxutils

HERE = pathlib.Path(__file__).resolve().parent
WS = HERE.parent
sys.path.insert(0, str(WS))

from c02_rail_prefilter import CivilianRailPrefilter
from c02_streaming_pipeline import StreamingC02Pipeline
from c03_topology_builder import (
    _parse_access,
    _parse_speed_kmh,
    build_c03_topology_from_jsonl,
    canonical_json_bytes,
    compute_canonical_graph_sha256,
)


def _sha256_file(path: pathlib.Path) -> tuple[int, str]:
    h = hashlib.sha256()
    b = 0
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
            b += len(chunk)
    return b, h.hexdigest()


def build_synthetic_basemap_xml(out_osm: pathlib.Path) -> dict:
    """Create a rich, strictly synthetic basemap + rail corridor OSM XML file."""
    nodes: list[tuple[int, float, float, dict[str, str]]] = []
    ways: list[tuple[int, list[int], dict[str, str]]] = []
    relations: list[tuple[int, list[tuple[str, int, str]], dict[str, str]]] = []

    nid = 1000
    wid = 20000

    def add_node(lon: float, lat: float, tags: dict[str, str] | None = None) -> int:
        nonlocal nid
        nid += 1
        nodes.append((nid, round(lon, 6), round(lat, 6), tags or {}))
        return nid

    def add_way(refs: list[int], tags: dict[str, str]) -> int:
        nonlocal wid
        wid += 1
        ways.append((wid, refs, tags))
        return wid

    # 1. Major civilian railway mainline (curved East-West, Broad Gauge, 25kV 50Hz)
    main_pts = [
        (85.90, 22.02, {"railway": "station", "name": "Westgate Terminal", "ref": "WGT"}),
        (85.97, 22.045, {}),
        (86.05, 22.06, {"railway": "station", "name": "Riverbend Junction", "ref": "RBJ"}),
        (86.13, 22.04, {}),
        (86.21, 22.075, {"railway": "station", "name": "Midvalley Central", "ref": "MVC"}),
        (86.28, 22.11, {}),
        (86.34, 22.14, {"railway": "station", "name": "Eastport Terminal", "ref": "EPT"}),
    ]
    main_ids = [add_node(lon, lat, tags) for lon, lat, tags in main_pts]
    w_main_west = add_way(
        main_ids[:3],
        {
            "railway": "rail",
            "usage": "main",
            "gauge": "1676",
            "electrified": "contact_line",
            "voltage": "25000",
            "frequency": "50",
            "maxspeed": "130",
            "access": "yes",
            "name": "East Corridor Main",
        },
    )
    w_main_east = add_way(
        main_ids[2:],
        {
            "railway": "rail",
            "usage": "main",
            "gauge": "1676",
            "electrified": "contact_line",
            "voltage": "25000",
            "frequency": "50",
            "maxspeed": "110",
            "access": "yes",
            "name": "East Corridor Express",
        },
    )

    # Parallel freight/loop track sharing Riverbend Junction and Midvalley Central
    par_mid = add_node(86.13, 22.085, {})
    add_way(
        [main_ids[2], par_mid, main_ids[4]],
        {
            "railway": "rail",
            "usage": "main",
            "gauge": "1676",
            "electrified": "no",
            "maxspeed": "80",
            "access": "yes",
            "name": "North Loop Bypass",
        },
    )

    # Northern Branch corridor (Diesel uneven curve) from Riverbend Junction (main_ids[2])
    branch_pts = [
        (86.06, 22.12, {}),
        (86.08, 22.17, {"railway": "halt", "name": "Northridge Halt", "ref": "NRH"}),
        (86.14, 22.21, {"railway": "station", "name": "Highland terminus", "ref": "HLT"}),
    ]
    branch_ids = [main_ids[2]] + [add_node(lon, lat, tags) for lon, lat, tags in branch_pts]
    add_way(
        branch_ids,
        {
            "railway": "rail",
            "usage": "branch",
            "gauge": "1676",
            "electrified": "no",
            "maxspeed": "75",
            "access": "yes",
            "name": "Highland Branch Line",
        },
    )

    # Southern separate light-rail loop intersecting visually (NO shared node!) for crossing test
    cross_pts = [
        (86.00, 21.93, {"railway": "station", "name": "South Quay"}),
        (86.09, 22.01, {}),
        (86.17, 22.12, {}),
        (86.20, 22.19, {"railway": "station", "name": "Canal Park"}),
    ]
    cross_ids = [add_node(lon, lat, tags) for lon, lat, tags in cross_pts]
    add_way(
        cross_ids,
        {
            "railway": "light_rail",
            "usage": "branch",
            "bridge": "yes",
            "layer": "1",
            "gauge": "1435",
            "electrified": "yes",
            "voltage": "750",
            "frequency": "0",
            "maxspeed": "80",
            "access": "yes",
            "name": "Quay Overpass Line",
        },
    )

    # 2. Roads (disconnected from railway!)
    road_hw = [
        [(85.88, 21.95), (85.98, 22.03), (86.11, 22.11), (86.25, 22.18), (86.36, 22.20)],
        [(86.02, 21.90), (86.05, 22.02), (86.055, 22.15), (86.09, 22.23)],
        [(85.92, 22.14), (86.04, 22.14), (86.18, 22.09), (86.32, 22.04)],
    ]
    road_classes = ["motorway", "primary", "secondary"]
    for idx, (pts, cls) in enumerate(zip(road_hw, road_classes)):
        r_ids = [add_node(lon, lat) for lon, lat in pts]
        add_way(r_ids, {"highway": cls, "name": f"Synthetic Highway {idx + 1}", "ref": f"NH-{10 + idx}"})

    # 3. Water bodies & waterways (river crossing corridor + lake)
    river_ids = [add_node(lon, lat) for lon, lat in [(85.88, 22.19), (85.99, 22.14), (86.08, 22.04), (86.15, 21.95), (86.28, 21.90)]]
    add_way(river_ids, {"waterway": "river", "name": "Synthetic Blue River"})
    stream_ids = [add_node(lon, lat) for lon, lat in [(86.24, 22.22), (86.22, 22.14), (86.16, 22.06), (86.08, 22.04)]]
    add_way(stream_ids, {"waterway": "stream", "name": "East Creek"})

    # Closed polygon: Lake & Landuse areas
    def add_poly(ring: list[tuple[float, float]], tags: dict[str, str]) -> int:
        p_ids = [add_node(lon, lat) for lon, lat in ring]
        p_ids.append(p_ids[0])
        return add_way(p_ids, tags)

    add_poly([(86.16, 21.96), (86.23, 21.96), (86.23, 22.01), (86.16, 22.01)], {"natural": "water", "name": "Crystal Lake"})
    add_poly([(85.91, 22.00), (85.96, 22.00), (85.96, 22.05), (85.91, 22.05)], {"landuse": "residential"})
    add_poly([(86.03, 22.04), (86.09, 22.04), (86.09, 22.09), (86.03, 22.09)], {"landuse": "commercial"})
    add_poly([(86.06, 22.15), (86.13, 22.15), (86.13, 22.20), (86.06, 22.20)], {"landuse": "forest"})
    add_poly([(86.25, 22.08), (86.31, 22.08), (86.31, 22.13), (86.25, 22.13)], {"leisure": "park"})

    # 4. Geographic places (cities, towns, villages)
    add_node(86.052, 22.068, {"place": "city", "name": "Riverbend Metro", "population": "850000"})
    add_node(85.905, 22.025, {"place": "town", "name": "Westgate Town", "population": "120000"})
    add_node(86.212, 22.082, {"place": "town", "name": "Midvalley", "population": "95000"})
    add_node(86.338, 22.145, {"place": "town", "name": "Eastport", "population": "160000"})
    add_node(86.138, 22.215, {"place": "village", "name": "Highland Village", "population": "12000"})

    # 5. Intentionally include restricted & unapproved political boundary records to prove schema + prefilter strip them!
    add_poly([(85.86, 21.86), (85.89, 21.86), (85.89, 21.89), (85.86, 21.89)], {"landuse": "military", "military": "yes", "name": "Excluded Zone"})
    bnd_ids = [add_node(lon, lat) for lon, lat in [(85.85, 21.85), (86.38, 21.85), (86.38, 22.24), (85.85, 22.24)]]
    bnd_ids.append(bnd_ids[0])
    add_way(bnd_ids, {"boundary": "administrative", "admin_level": "4", "name": "Excluded Synthetic Boundary"})

    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<osm version="0.6" generator="synthetic-c04-basemap-v1">',
        '  <bounds minlat="21.85" minlon="85.85" maxlat="22.25" maxlon="86.38"/>',
    ]
    for node_id, lon, lat, tags in nodes:
        if tags:
            lines.append(f'  <node id="{node_id}" version="1" timestamp="2026-11-28T00:00:00Z" lat="{lat}" lon="{lon}">')
            for k, v in sorted(tags.items()):
                lines.append(f'    <tag k="{saxutils.escape(k)}" v="{saxutils.escape(v)}"/>')
            lines.append("  </node>")
        else:
            lines.append(f'  <node id="{node_id}" version="1" timestamp="2026-11-28T00:00:00Z" lat="{lat}" lon="{lon}"/>')
    for way_id, refs, tags in ways:
        lines.append(f'  <way id="{way_id}" version="1" timestamp="2026-11-28T00:00:00Z">')
        for r in refs:
            lines.append(f'    <nd ref="{r}"/>')
        for k, v in sorted(tags.items()):
            lines.append(f'    <tag k="{saxutils.escape(k)}" v="{saxutils.escape(v)}"/>')
        lines.append("  </way>")
    lines.append("</osm>")
    out_osm.write_text("\n".join(lines) + "\n", encoding="utf-8")

    # Also return raw record dicts matching XML for C02->C03 pipeline compile
    node_objs = [{"type": "node", "id": nid_, "lon": lon, "lat": lat, "tags": t} for nid_, lon, lat, t in nodes]
    way_objs = [{"type": "way", "id": wid_, "node_refs": refs, "tags": t} for wid_, refs, t in ways]
    return {
        "records": node_objs + way_objs,
        "bounds": [85.85, 21.85, 86.38, 22.25],
    }


def build_all() -> dict:
    fixtures_dir = WS / "fixtures"
    fixtures_dir.mkdir(exist_ok=True)
    osm_xml = fixtures_dir / "c04_synthetic_basemap.osm"
    osm_pbf = fixtures_dir / "c04_synthetic_basemap.osm.pbf"
    pmtiles_out = fixtures_dir / "c04_synthetic_basemap.pmtiles"
    schema_path = HERE / "railway_basemap_schema.yml"
    policy_path = WS / "C02_CIVILIAN_RAIL_EXTRACTION_POLICY.json"

    syn = build_synthetic_basemap_xml(osm_xml)

    osmium_exe = WS / "r13-osmium-env" / "Library" / "bin" / "osmium.exe"
    java_exe = pathlib.Path(r"C:\Program Files\Android\Android Studio\jbr\bin\java.exe")
    planetiler_jar = WS / "c04_c06_tools" / "planetiler-v0.10.2" / "planetiler.jar"

    # Convert .osm -> .osm.pbf via pinned Osmium
    p_osm = subprocess.run(
        [str(osmium_exe), "cat", "--no-progress", "--overwrite", "-o", str(osm_pbf), str(osm_xml)],
        capture_output=True, text=True
    )
    if p_osm.returncode != 0:
        raise RuntimeError(f"osmium cat failed: {p_osm.stderr}\n{p_osm.stdout}")

    pbf_bytes, pbf_sha = _sha256_file(osm_pbf)
    schema_bytes, schema_sha = _sha256_file(schema_path)

    # Invoke Planetiler generate-custom to build genuine PMTiles
    t0 = time.perf_counter()
    with tempfile.TemporaryDirectory(prefix="c04_planetiler_tmp_") as tmpdir:
        tmp_path = pathlib.Path(tmpdir)
        cmd = [
            str(java_exe),
            "-Xmx512m",
            "-jar",
            str(planetiler_jar),
            "generate-custom",
            f"--schema={schema_path}",
            f"--osm_path={osm_pbf}",
            f"--output={pmtiles_out}",
            "--bounds=85.85,21.85,86.38,22.25",
            "--minzoom=0",
            "--maxzoom=14",
            "--exclude_layers=boundary",
            "--force=true",
            "--download=false",
            "--nodemap_type=sparsearray",
            "--nodemap_storage=ram",
            f"--tmpdir={tmp_path}",
        ]
        p_pl = subprocess.run(cmd, cwd=str(WS), capture_output=True, text=True, encoding="utf-8", errors="replace")
        build_s = round(time.perf_counter() - t0, 3)
        if p_pl.returncode != 0:
            raise RuntimeError(f"Planetiler generate-custom failed (RC={p_pl.returncode}):\n{p_pl.stdout}\n{p_pl.stderr}")

    pmtiles_bytes, pmtiles_sha = _sha256_file(pmtiles_out)

    # Compile matching C02->C03 GraphPack & RegionManifest wired to pmtiles_sha
    with policy_path.open("r", encoding="utf-8") as f:
        prefilter = CivilianRailPrefilter(json.load(f))
    pipe = StreamingC02Pipeline(prefilter)
    with tempfile.TemporaryDirectory(prefix="c04_c03_build_") as tmpdir:
        c02_jsonl = os.path.join(tmpdir, "c02_rail.jsonl")
        c02_res = pipe.run_stream(syn["records"], c02_jsonl, work_dir=tmpdir)
        c03_res = build_c03_topology_from_jsonl(
            c02_jsonl,
            region_id="in-east-synthetic-c04",
            source_url="urn:railway:synthetic:c04-basemap-fixture",
            source_sha256=pbf_sha,
            tiles_sha256=pmtiles_sha,
            extra_quality_flags=["SYNTHETIC_NOT_REAL_DATA"],
        )

    # Restore explicit operational access & maxspeed from approved synthetic source ways
    # (C02 V3 prefilter intentionally omits access/maxspeed; preserve unknown when genuinely absent)
    raw_way_tags = {
        f"osm:way:{rec['id']}": rec.get("tags", {})
        for rec in syn["records"]
        if rec.get("type") == "way"
    }
    gp = c03_res["graphPack"]
    for edge in gp["edges"]:
        orig_tags = raw_way_tags.get(edge["provenance"]["sourceId"], {})
        parsed_access = _parse_access(orig_tags)
        parsed_speed = _parse_speed_kmh(orig_tags.get("maxspeed"))
        edge["access"] = parsed_access
        edge["maxSpeedKmh"] = parsed_speed
        qflags = [f for f in edge["provenance"]["qualityFlags"] if f not in ("unknown_access", "unknown_speed")]
        if parsed_access == "unknown":
            qflags.append("unknown_access")
        if parsed_speed is None:
            qflags.append("unknown_speed")
        edge["provenance"]["qualityFlags"] = sorted(set(qflags))
    gp["graphSha256"] = compute_canonical_graph_sha256(gp)
    c03_res["regionManifest"]["graphSha256"] = gp["graphSha256"]
    c03_res["topologyReport"]["graphSha256"] = gp["graphSha256"]
    c03_res["regionManifest"]["qualityReportSha256"] = hashlib.sha256(
        canonical_json_bytes(c03_res["topologyReport"])
    ).hexdigest()

    tile_manifest = {
        "schemaVersion": 1,
        "regionId": "in-east-synthetic-c04",
        "syntheticOnly": True,
        "sourceUrl": "urn:railway:synthetic:c04-basemap-fixture",
        "sourcePbfBytes": pbf_bytes,
        "sourcePbfSha256": pbf_sha,
        "planetilerVersion": "v0.10.2",
        "schemaYamlSha256": schema_sha,
        "graphSha256": c03_res["graphPack"]["graphSha256"],
        "pmtilesFile": "fixtures/c04_synthetic_basemap.pmtiles",
        "pmtilesBytes": pmtiles_bytes,
        "pmtilesSha256": pmtiles_sha,
        "styleVersion": "c04-rail-style-v1",
        "minZoom": 0,
        "maxZoom": 14,
        "bounds": syn["bounds"],
        "boundaryLayersExcluded": True,
        "attribution": "Synthetic Basemap Fixture (C04 Verification)",
        "buildDurationSeconds": build_s,
    }
    (fixtures_dir / "c04_tile_build_manifest.json").write_text(
        json.dumps(tile_manifest, indent=2) + "\n", encoding="utf-8"
    )

    graph_bundle = {
        "graphPack": c03_res["graphPack"],
        "regionManifest": c03_res["regionManifest"],
        "attachmentReport": c03_res["attachmentReport"],
        "topologyReport": c03_res["topologyReport"],
        "tileBuildManifest": tile_manifest,
        "c02ReasonCounts": c02_res["reasonCounts"],
    }
    (fixtures_dir / "c04_synthetic_graph_bundle.json").write_text(
        json.dumps(graph_bundle, indent=2) + "\n", encoding="utf-8"
    )

    return {
        "ok": True,
        "osmXmlBytes": osm_xml.stat().st_size,
        "osmPbfBytes": pbf_bytes,
        "osmPbfSha256": pbf_sha,
        "pmtilesBytes": pmtiles_bytes,
        "pmtilesSha256": pmtiles_sha,
        "graphSha256": c03_res["graphPack"]["graphSha256"],
        "graphStations": len(c03_res["graphPack"]["stations"]),
        "graphEdges": len(c03_res["graphPack"]["edges"]),
        "planetilerBuildSeconds": build_s,
    }


if __name__ == "__main__":
    print(json.dumps(build_all(), indent=2))
