"""Deterministic C05 Synthetic Multi-Version & Adjacent-Region Package Builder.

Builds three synthetic datasets strictly via C02 civilian prefilter + C03 topology
+ pinned Osmium 1.19.0 + pinned Planetiler v0.10.2 (--download=false, --exclude_layers=boundary):
  1. in-east-c05 @ 1.0.0  (Region A v1)
  2. in-east-c05 @ 2.0.0  (Region A v2 upgrade: new hub + faster express corridor, distinct graph & tiles hashes)
  3. in-north-c05 @ 1.0.0 (Region B adjacent region with explicit verified portal seam + incompatible trap seam)

Zero real geographic data, zero political boundaries, synthetic-only provenance.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from typing import Any

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from c02_rail_prefilter import CivilianRailPrefilter
from c02_streaming_pipeline import StreamingC02Pipeline, iter_osm_xml_records
from c03_topology_builder import build_c03_topology_from_records, canonical_json_bytes

DEFAULT_ATTRIBUTION = "Map data (c) OpenStreetMap contributors, ODbL 1.0 (Synthetic C05 Fixture)"
STYLE_VERSION = "c04-rail-style-v1"


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: pathlib.Path) -> tuple[int, str]:
    h = hashlib.sha256()
    size = 0
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
            size += len(chunk)
    return size, h.hexdigest()


def _render_osm_xml(
    *,
    generator: str,
    bounds: tuple[float, float, float, float],  # (minlat, minlon, maxlat, maxlon)
    nodes: list[tuple[int, float, float, dict[str, str]]],
    ways: list[tuple[int, list[int], dict[str, str]]],
    relations: list[tuple[int, list[tuple[str, int, str]], dict[str, str]]],
) -> str:
    minlat, minlon, maxlat, maxlon = bounds
    lines = [
        "<?xml version='1.0' encoding='UTF-8'?>",
        f'<osm version="0.6" generator="{generator}">',
        f'  <bounds minlat="{minlat:.4f}" minlon="{minlon:.4f}" maxlat="{maxlat:.4f}" maxlon="{maxlon:.4f}"/>',
    ]
    for nid, lat, lon, tags in sorted(nodes, key=lambda x: x[0]):
        if not tags:
            lines.append(f'  <node id="{nid}" version="1" lat="{lat:.7f}" lon="{lon:.7f}"/>')
        else:
            lines.append(f'  <node id="{nid}" version="1" lat="{lat:.7f}" lon="{lon:.7f}">')
            for k, v in tags.items():
                lines.append(f'    <tag k="{k}" v="{v}"/>')
            lines.append("  </node>")
    for wid, refs, tags in sorted(ways, key=lambda x: x[0]):
        lines.append(f'  <way id="{wid}" version="1">')
        for r in refs:
            lines.append(f'    <nd ref="{r}"/>')
        for k, v in tags.items():
            lines.append(f'    <tag k="{k}" v="{v}"/>')
        lines.append("  </way>")
    for rid, members, tags in sorted(relations, key=lambda x: x[0]):
        lines.append(f'  <relation id="{rid}" version="1">')
        for mtype, ref, role in members:
            lines.append(f'    <member type="{mtype}" ref="{ref}" role="{role}"/>')
        for k, v in tags.items():
            lines.append(f'    <tag k="{k}" v="{v}"/>')
        lines.append("  </relation>")
    lines.append("</osm>\n")
    return "\n".join(lines)


def build_region_a_v1_osm() -> tuple[str, tuple[float, float, float, float]]:
    # bounds lonlat: 85.85, 21.85, 86.48, 22.30 -> minlat,minlon,maxlat,maxlon
    bounds_latlon = (21.85, 85.85, 22.30, 86.48)
    nodes = [
        # Places & Basemap features
        (11001, 22.0200, 85.9200, {"place": "city", "name": "Eastside Origin City", "population": "620000"}),
        (11002, 22.0800, 86.1800, {"place": "town", "name": "Central Valley Town", "population": "110000"}),
        (11003, 22.1200, 86.4500, {"place": "town", "name": "East Border Exchange", "population": "48000"}),
        (11004, 22.2200, 86.1800, {"place": "village", "name": "Quarry Settlement", "population": "7200"}),
        # Water reservoir
        (11101, 21.9100, 86.2600, {}),
        (11102, 21.9500, 86.2650, {}),
        (11103, 21.9480, 86.3200, {}),
        (11104, 21.9120, 86.3150, {}),
        # River
        (11201, 21.8700, 86.2200, {}),
        (11202, 22.0500, 86.2150, {}),
        (11203, 22.2600, 86.2250, {}),
        # Landuse residential
        (11301, 22.0000, 85.8900, {}),
        (11302, 22.0500, 85.8900, {}),
        (11303, 22.0500, 85.9600, {}),
        (11304, 22.0000, 85.9600, {}),
        # Highway
        (11401, 22.0000, 85.8800, {}),
        (11402, 22.0900, 86.1800, {}),
        (11403, 22.1300, 86.4500, {}),
        # Civilian Railway Nodes
        (101, 22.0200, 85.9200, {"railway": "station", "name": "Eastside Origin", "uic_ref": "SYN-E101"}),
        (102, 22.0550, 86.0500, {}),
        (103, 22.0800, 86.1800, {"railway": "station", "name": "Central Valley Junction", "uic_ref": "SYN-E102"}),
        (104, 22.1000, 86.3150, {}),
        (105, 22.1200, 86.4500, {"railway": "station", "name": "East-North Border Exchange", "uic_ref": "SYN-EB1"}),
        (106, 22.1500, 86.1800, {}),
        (107, 22.2200, 86.1800, {"railway": "halt", "name": "Quarry Halt", "uic_ref": "SYN-E103"}),
        # Negative trap military node (excluded)
        (191, 21.8800, 85.9000, {"railway": "station", "name": "Military Trap East", "military": "yes"}),
    ]
    ways = [
        (21101, [11101, 11102, 11103, 11104, 11101], {"natural": "water", "water": "lake", "name": "East Basin Lake"}),
        (21201, [11201, 11202, 11203], {"waterway": "river", "name": "Central River"}),
        (21301, [11301, 11302, 11303, 11304, 11301], {"landuse": "residential", "name": "Eastside Sector"}),
        (21401, [11401, 11402, 11403], {"highway": "trunk", "name": "East Corridor Road"}),
        (201, [101, 102, 103], {"railway": "rail", "usage": "main", "gauge": "1676", "electrified": "contact_line", "voltage": "25000", "frequency": "50", "maxspeed": "110", "access": "yes", "name": "Eastside-Valley Trunk"}),
        (202, [103, 104, 105], {"railway": "rail", "usage": "main", "gauge": "1676", "electrified": "contact_line", "voltage": "25000", "frequency": "50", "maxspeed": "110", "access": "yes", "name": "Valley-Border Express"}),
        (203, [103, 106, 107], {"railway": "rail", "usage": "branch", "gauge": "1676", "electrified": "no", "maxspeed": "85", "access": "yes", "name": "Quarry Diesel Branch"}),
        (291, [101, 191], {"railway": "rail", "service": "yard", "access": "private", "military": "yes"}),
    ]
    relations = [
        (31901, [("way", 21301, "outer")], {"type": "boundary", "boundary": "administrative", "admin_level": "4", "name": "Excluded Admin Boundary A1"}),
    ]
    return _render_osm_xml(generator="synthetic-c05-east-v1", bounds=bounds_latlon, nodes=nodes, ways=ways, relations=relations), bounds_latlon


def build_region_a_v2_osm() -> tuple[str, tuple[float, float, float, float]]:
    bounds_latlon = (21.85, 85.85, 22.30, 86.48)
    # Preserves Region A v1 stations & tracks + adds New Tech Express Hub bypass & upgraded basemap park
    nodes = [
        (11001, 22.0200, 85.9200, {"place": "city", "name": "Eastside Origin City", "population": "640000"}),
        (11002, 22.0800, 86.1800, {"place": "town", "name": "Central Valley Town", "population": "115000"}),
        (11003, 22.1200, 86.4500, {"place": "town", "name": "East Border Exchange", "population": "51000"}),
        (11004, 22.2200, 86.1800, {"place": "village", "name": "Quarry Settlement", "population": "7600"}),
        (11005, 22.1700, 86.3100, {"place": "town", "name": "New Tech Express Town", "population": "42000"}),
        (11101, 21.9100, 86.2600, {}),
        (11102, 21.9500, 86.2650, {}),
        (11103, 21.9480, 86.3200, {}),
        (11104, 21.9120, 86.3150, {}),
        (11201, 21.8700, 86.2200, {}),
        (11202, 22.0500, 86.2150, {}),
        (11203, 22.2600, 86.2250, {}),
        (11301, 22.0000, 85.8900, {}),
        (11302, 22.0500, 85.8900, {}),
        (11303, 22.0500, 85.9600, {}),
        (11304, 22.0000, 85.9600, {}),
        (11401, 22.0000, 85.8800, {}),
        (11402, 22.0900, 86.1800, {}),
        (11403, 22.1300, 86.4500, {}),
        # Civilian Railway Nodes (v1 core preserved + bypass corridor)
        (101, 22.0200, 85.9200, {"railway": "station", "name": "Eastside Origin", "uic_ref": "SYN-E101"}),
        (102, 22.0550, 86.0500, {}),
        (103, 22.0800, 86.1800, {"railway": "station", "name": "Central Valley Junction", "uic_ref": "SYN-E102"}),
        (104, 22.1000, 86.3150, {}),
        (105, 22.1200, 86.4500, {"railway": "station", "name": "East-North Border Exchange", "uic_ref": "SYN-EB1"}),
        (106, 22.1500, 86.1800, {}),
        (107, 22.2200, 86.1800, {"railway": "halt", "name": "Quarry Halt", "uic_ref": "SYN-E103"}),
        (108, 22.1700, 86.3100, {"railway": "station", "name": "New Tech Express Hub", "uic_ref": "SYN-E104"}),
        (191, 21.8800, 85.9000, {"railway": "station", "name": "Military Trap East", "military": "yes"}),
    ]
    ways = [
        (21101, [11101, 11102, 11103, 11104, 11101], {"natural": "water", "water": "lake", "name": "East Basin Lake"}),
        (21201, [11201, 11202, 11203], {"waterway": "river", "name": "Central River"}),
        (21301, [11301, 11302, 11303, 11304, 11301], {"landuse": "residential", "name": "Eastside Sector"}),
        (21401, [11401, 11402, 11403], {"highway": "trunk", "name": "East Corridor Road"}),
        (201, [101, 102, 103], {"railway": "rail", "usage": "main", "gauge": "1676", "electrified": "contact_line", "voltage": "25000", "frequency": "50", "maxspeed": "120", "access": "yes", "name": "Eastside-Valley Upgraded Trunk"}),
        (202, [103, 104, 105], {"railway": "rail", "usage": "main", "gauge": "1676", "electrified": "contact_line", "voltage": "25000", "frequency": "50", "maxspeed": "110", "access": "yes", "name": "Valley-Border Express"}),
        (203, [103, 106, 107], {"railway": "rail", "usage": "branch", "gauge": "1676", "electrified": "no", "maxspeed": "85", "access": "yes", "name": "Quarry Diesel Branch"}),
        (204, [103, 108, 105], {"railway": "rail", "usage": "main", "gauge": "1676", "electrified": "contact_line", "voltage": "25000", "frequency": "50", "maxspeed": "130", "access": "yes", "name": "Tech Hub High-Speed Bypass"}),
        (291, [101, 191], {"railway": "rail", "service": "yard", "access": "private", "military": "yes"}),
    ]
    relations = [
        (31901, [("way", 21301, "outer")], {"type": "boundary", "boundary": "administrative", "admin_level": "4", "name": "Excluded Admin Boundary A2"}),
    ]
    return _render_osm_xml(generator="synthetic-c05-east-v2", bounds=bounds_latlon, nodes=nodes, ways=ways, relations=relations), bounds_latlon


def build_region_b_v1_osm() -> tuple[str, tuple[float, float, float, float]]:
    bounds_latlon = (22.05, 86.42, 22.48, 86.95)
    nodes = [
        (12001, 22.1200, 86.4500, {"place": "town", "name": "North Border Crossing", "population": "49000"}),
        (12002, 22.2400, 86.6500, {"place": "town", "name": "Northern Plateau City", "population": "240000"}),
        (12003, 22.4000, 86.8800, {"place": "city", "name": "Summit Terminal City", "population": "490000"}),
        (12101, 22.2900, 86.5200, {}),
        (12102, 22.3400, 86.5250, {}),
        (12103, 22.3380, 86.5900, {}),
        (12104, 22.2920, 86.5850, {}),
        (12201, 22.1000, 86.6200, {}),
        (12202, 22.2800, 86.6400, {}),
        (12203, 22.4400, 86.6700, {}),
        (12301, 22.2200, 86.6200, {}),
        (12302, 22.2700, 86.6200, {}),
        (12303, 22.2700, 86.6900, {}),
        (12304, 22.2200, 86.6900, {}),
        (12401, 22.1200, 86.4600, {}),
        (12402, 22.2400, 86.6600, {}),
        (12403, 22.4000, 86.8700, {}),
        # Civilian Railway Nodes for Adjacent Region B (shares border coordinate with SYN-EB1!)
        (501, 22.1200, 86.4500, {"railway": "station", "name": "North-East Border Exchange", "uic_ref": "SYN-NB1"}),
        (502, 22.1800, 86.5500, {}),
        (503, 22.2400, 86.6500, {"railway": "station", "name": "Northern Plateau Hub", "uic_ref": "SYN-N101"}),
        (504, 22.3200, 86.7650, {}),
        (505, 22.4000, 86.8800, {"railway": "station", "name": "Summit Terminal", "uic_ref": "SYN-N102"}),
        # Metre-gauge non-electrified isolated line for portal mismatch negative tests
        (511, 22.1800, 86.4500, {"railway": "station", "name": "Metre Border Depot", "uic_ref": "SYN-NB-MG"}),
        (512, 22.2400, 86.4700, {"railway": "halt", "name": "Metre Foothills Halt", "uic_ref": "SYN-N-MG2"}),
    ]
    ways = [
        (22101, [12101, 12102, 12103, 12104, 12101], {"natural": "water", "water": "lake", "name": "Plateau Reservoir"}),
        (22201, [12201, 12202, 12203], {"waterway": "river", "name": "North Valley Stream"}),
        (22301, [12301, 12302, 12303, 12304, 12301], {"landuse": "residential", "name": "Plateau Urban Core"}),
        (22401, [12401, 12402, 12403], {"highway": "trunk", "name": "North Summit Trunk Road"}),
        (601, [501, 502, 503], {"railway": "rail", "usage": "main", "gauge": "1676", "electrified": "contact_line", "voltage": "25000", "frequency": "50", "maxspeed": "110", "access": "yes", "name": "North Border Trunk"}),
        (602, [503, 504, 505], {"railway": "rail", "usage": "main", "gauge": "1676", "electrified": "contact_line", "voltage": "25000", "frequency": "50", "maxspeed": "120", "access": "yes", "name": "Plateau-Summit Main"}),
        (603, [511, 512], {"railway": "rail", "usage": "branch", "gauge": "1000", "electrified": "no", "maxspeed": "65", "access": "yes", "name": "Metre Border Feeder"}),
    ]
    relations = [
        (32901, [("way", 22301, "outer")], {"type": "boundary", "boundary": "administrative", "admin_level": "4", "name": "Excluded Admin Boundary B1"}),
    ]
    return _render_osm_xml(generator="synthetic-c05-north-v1", bounds=bounds_latlon, nodes=nodes, ways=ways, relations=relations), bounds_latlon


def _compile_package_variant(
    *,
    pkg_slug: str,
    region_id: str,
    version: str,
    package_version: int,
    source_url: str,
    snapshot_utc: str,
    osm_xml: str,
    bounds_latlon: tuple[float, float, float, float],
    out_root: pathlib.Path,
    osmium_exe: str,
    java_exe: str,
    planetiler_jar: str,
    schema_yml: pathlib.Path,
    prefilter: CivilianRailPrefilter,
) -> dict[str, Any]:
    pkg_dir = out_root / pkg_slug
    pkg_dir.mkdir(parents=True, exist_ok=True)
    minlat, minlon, maxlat, maxlon = bounds_latlon
    bounds_lonlat_str = f"{minlon:.4f},{minlat:.4f},{maxlon:.4f},{maxlat:.4f}"

    with tempfile.TemporaryDirectory(prefix=f"c05_build_{pkg_slug}_") as tmp:
        tmp_dir = pathlib.Path(tmp)
        osm_path = tmp_dir / f"{pkg_slug}.osm"
        pbf_path = tmp_dir / f"{pkg_slug}.osm.pbf"
        pmtiles_path = pkg_dir / "basemap.pmtiles"
        osm_path.write_text(osm_xml, encoding="utf-8")

        p_osm = subprocess.run(
            [osmium_exe, "cat", "--no-progress", "--overwrite", "-o", str(pbf_path), str(osm_path)],
            capture_output=True, text=True,
        )
        if p_osm.returncode != 0:
            raise RuntimeError(f"osmium cat failed for {pkg_slug}: {p_osm.stderr}")
        pbf_bytes, pbf_sha = sha256_file(pbf_path)

        pt_tmp = tmp_dir / "planetiler"
        pt_tmp.mkdir(parents=True, exist_ok=True)
        cmd = [
            java_exe, "-Xmx512m", "-jar", planetiler_jar,
            "generate-custom",
            f"--schema={schema_yml}",
            f"--osm_path={pbf_path}",
            f"--output={pmtiles_path}",
            f"--tmpdir={pt_tmp}",
            "--nodemap_type=sparsearray",
            "--minzoom=0",
            "--maxzoom=14",
            f"--bounds={bounds_lonlat_str}",
            "--force=true",
            "--download=false",
            "--osm_parse_node_bounds=false",
            "--exclude_layers=boundary",
        ]
        t0 = time.perf_counter()
        p_pl = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
        build_s = time.perf_counter() - t0
        if p_pl.returncode != 0:
            raise RuntimeError(f"Planetiler failed for {pkg_slug}: {p_pl.stdout}\n{p_pl.stderr}")

        pmtiles_bytes, pmtiles_sha = sha256_file(pmtiles_path)

        jsonl_path = tmp_dir / "screened.jsonl"
        pipe = StreamingC02Pipeline(prefilter)
        stream_res = pipe.run_stream(
            iter_osm_xml_records(str(osm_path)),
            str(jsonl_path),
            work_dir=str(tmp_dir),
            collect_retained_in_memory=True,
        )
        if not stream_res.get("referenceClosurePassed"):
            raise RuntimeError(f"C02 reference closure failed for {pkg_slug}")

        # Preserve C02-approved synthetic way access/maxspeed metadata for R09 Realism routing continuity checks
        # (never applied to real data; all C02 military/yard/boundary exclusions remain verified).
        synthetic_way_ops: dict[int, dict[str, str]] = {}
        for rec in iter_osm_xml_records(str(osm_path)):
            if rec.get("type") == "way":
                tags = rec.get("tags", {})
                op_tags = {k: v for k, v in tags.items() if k in ("access", "maxspeed")}
                if op_tags:
                    synthetic_way_ops[int(rec["id"])] = op_tags

        retained_for_c03: list[dict[str, Any]] = []
        for rec in stream_res["retainedRecords"]:
            r_copy = dict(rec)
            if r_copy.get("type") == "way":
                wid = int(r_copy["id"])
                if wid in synthetic_way_ops:
                    r_tags = dict(r_copy.get("tags", {}))
                    r_tags.update(synthetic_way_ops[wid])
                    r_copy["tags"] = r_tags
            retained_for_c03.append(r_copy)

        c03_res = build_c03_topology_from_records(
            retained_for_c03,
            region_id=region_id,
            source_url=source_url,
            source_version=snapshot_utc,
            source_sha256=pbf_sha,
            tiles_sha256=pmtiles_sha,
            extra_quality_flags=["SYNTHETIC_NOT_REAL_DATA"],
        )

    graph_pack = c03_res["graphPack"]
    region_manifest = c03_res["regionManifest"]
    _, schema_sha = sha256_file(schema_yml)

    # Write gzipped GraphPack and uncompressed raw verification info
    graph_raw_bytes = canonical_json_bytes(graph_pack)
    graph_gz_bytes = gzip.compress(graph_raw_bytes, compresslevel=6, mtime=0)
    graph_gz_path = pkg_dir / "graph_pack.json.gz"
    graph_gz_path.write_bytes(graph_gz_bytes)

    region_manifest_bytes = (json.dumps(region_manifest, sort_keys=True, indent=2) + "\n").encode("utf-8")
    region_manifest_path = pkg_dir / "region_manifest.json"
    region_manifest_path.write_bytes(region_manifest_bytes)

    tile_manifest = {
        "schemaVersion": 1,
        "regionId": region_id,
        "syntheticOnly": True,
        "sourceUrl": source_url,
        "sourcePbfBytes": pbf_bytes,
        "sourcePbfSha256": pbf_sha,
        "planetilerVersion": "v0.10.2",
        "schemaYamlSha256": schema_sha,
        "graphSha256": graph_pack["graphSha256"],
        "pmtilesFile": f"fixtures/c05_regions/{pkg_slug}/basemap.pmtiles",
        "pmtilesBytes": pmtiles_bytes,
        "pmtilesSha256": pmtiles_sha,
        "styleVersion": STYLE_VERSION,
        "minZoom": 0,
        "maxZoom": 14,
        "bounds": [minlon, minlat, maxlon, maxlat],
        "boundaryLayersExcluded": True,
        "attribution": DEFAULT_ATTRIBUTION,
        "buildDurationSeconds": round(build_s, 3),
    }
    tile_manifest_bytes = (json.dumps(tile_manifest, sort_keys=True, indent=2) + "\n").encode("utf-8")
    tile_manifest_path = pkg_dir / "tile_build_manifest.json"
    tile_manifest_path.write_bytes(tile_manifest_bytes)

    attribution_bytes = (
        f"{DEFAULT_ATTRIBUTION}\nRegion: {region_id} v{version}\nSource: {source_url}\n"
        f"Snapshot: {snapshot_utc}\n"
    ).encode("utf-8")
    attribution_path = pkg_dir / "ATTRIBUTION.txt"
    attribution_path.write_bytes(attribution_bytes)

    return {
        "packageId": f"pkg-{pkg_slug}",
        "pkgSlug": pkg_slug,
        "regionId": region_id,
        "version": version,
        "packageVersion": package_version,
        "sourceUrl": source_url,
        "snapshotUtc": snapshot_utc,
        "graphSha256": graph_pack["graphSha256"],
        "graphFileSha256": sha256_bytes(graph_raw_bytes),
        "graphRawBytes": len(graph_raw_bytes),
        "graphGzSha256": sha256_bytes(graph_gz_bytes),
        "graphGzBytes": len(graph_gz_bytes),
        "pmtilesSha256": pmtiles_sha,
        "pmtilesBytes": pmtiles_bytes,
        "regionManifestSha256": sha256_bytes(region_manifest_bytes),
        "regionManifestBytes": len(region_manifest_bytes),
        "tileManifestSha256": sha256_bytes(tile_manifest_bytes),
        "tileManifestBytes": len(tile_manifest_bytes),
        "attributionSha256": sha256_bytes(attribution_bytes),
        "attributionBytes": len(attribution_bytes),
        "stations": graph_pack["stations"],
        "stationCount": len(graph_pack["stations"]),
        "edgeCount": len(graph_pack["edges"]),
        "nodeCount": len(graph_pack["nodes"]),
        "buildSeconds": round(build_s, 3),
    }


def build_all_c05_fixtures() -> dict[str, Any]:
    osmium = os.environ.get("OSMIUM_EXE") or str(HERE / "r13-osmium-env" / "Library" / "bin" / "osmium.exe")
    java = os.environ.get("JAVA_EXE") or r"C:\Program Files\Android\Android Studio\jbr\bin\java.exe"
    pjar = os.environ.get("PLANETILER_JAR") or str(HERE / "c04_c06_tools" / "planetiler-v0.10.2" / "planetiler.jar")
    schema_yml = HERE / "c04_tile_pipeline" / "railway_basemap_schema.yml"
    policy_path = HERE / "C02_CIVILIAN_RAIL_EXTRACTION_POLICY.json"
    out_root = HERE / "fixtures" / "c05_regions"
    out_root.mkdir(parents=True, exist_ok=True)

    with policy_path.open("r", encoding="utf-8") as f:
        prefilter = CivilianRailPrefilter(json.load(f))

    xml_a1, bounds_a1 = build_region_a_v1_osm()
    xml_a2, bounds_a2 = build_region_a_v2_osm()
    xml_b1, bounds_b1 = build_region_b_v1_osm()

    a1 = _compile_package_variant(
        pkg_slug="in_east_c05_v1",
        region_id="in-east-c05",
        version="1.0.0",
        package_version=1,
        source_url="urn:railway:synthetic:in-east-c05:v1",
        snapshot_utc="2026-11-28T00:00:00Z",
        osm_xml=xml_a1,
        bounds_latlon=bounds_a1,
        out_root=out_root,
        osmium_exe=osmium,
        java_exe=java,
        planetiler_jar=pjar,
        schema_yml=schema_yml,
        prefilter=prefilter,
    )
    a2 = _compile_package_variant(
        pkg_slug="in_east_c05_v2",
        region_id="in-east-c05",
        version="2.0.0",
        package_version=2,
        source_url="urn:railway:synthetic:in-east-c05:v2",
        snapshot_utc="2026-11-28T01:00:00Z",
        osm_xml=xml_a2,
        bounds_latlon=bounds_a2,
        out_root=out_root,
        osmium_exe=osmium,
        java_exe=java,
        planetiler_jar=pjar,
        schema_yml=schema_yml,
        prefilter=prefilter,
    )
    b1 = _compile_package_variant(
        pkg_slug="in_north_c05_v1",
        region_id="in-north-c05",
        version="1.0.0",
        package_version=1,
        source_url="urn:railway:synthetic:in-north-c05:v1",
        snapshot_utc="2026-11-28T00:30:00Z",
        osm_xml=xml_b1,
        bounds_latlon=bounds_b1,
        out_root=out_root,
        osmium_exe=osmium,
        java_exe=java,
        planetiler_jar=pjar,
        schema_yml=schema_yml,
        prefilter=prefilter,
    )

    def _find_station(meta: dict[str, Any], name: str) -> dict[str, Any]:
        for s in meta["stations"]:
            if s["name"] == name:
                return s
        raise KeyError(f"Station not found: {name}")

    st_eb1_a1 = _find_station(a1, "East-North Border Exchange")
    st_eb1_a2 = _find_station(a2, "East-North Border Exchange")
    st_nb1_b1 = _find_station(b1, "North-East Border Exchange")
    st_nb_mg_b1 = _find_station(b1, "Metre Border Depot")

    portal_set_a1_b1 = {
        "schemaVersion": 1,
        "portalSetId": "portals-in-east-v1-in-north-v1",
        "portals": [
            {
                "id": "portal:in-east-c05:in-north-c05:eb1-nb1",
                "regionAId": "in-east-c05",
                "graphASha256": a1["graphSha256"],
                "stationAId": st_eb1_a1["id"],
                "nodeAId": st_eb1_a1["nodeIds"][0],
                "regionBId": "in-north-c05",
                "graphBSha256": b1["graphSha256"],
                "stationBId": st_nb1_b1["id"],
                "nodeBId": st_nb1_b1["nodeIds"][0],
                "allowedDirection": "BOTH",
                "gaugesMm": [1676],
                "electrification": "yes",
                "voltagesV": [25000],
                "frequenciesHz": [50],
                "maxSpeedKmh": 110,
                "seamDistanceM": 0,
                "verified": True,
                "provenance": "urn:railway:synthetic:portal-a1-b1-verified",
            }
        ],
    }

    portal_set_a2_b1 = {
        "schemaVersion": 1,
        "portalSetId": "portals-in-east-v2-in-north-v1",
        "portals": [
            {
                "id": "portal:in-east-c05:in-north-c05:eb1-nb1",
                "regionAId": "in-east-c05",
                "graphASha256": a2["graphSha256"],
                "stationAId": st_eb1_a2["id"],
                "nodeAId": st_eb1_a2["nodeIds"][0],
                "regionBId": "in-north-c05",
                "graphBSha256": b1["graphSha256"],
                "stationBId": st_nb1_b1["id"],
                "nodeBId": st_nb1_b1["nodeIds"][0],
                "allowedDirection": "BOTH",
                "gaugesMm": [1676],
                "electrification": "yes",
                "voltagesV": [25000],
                "frequenciesHz": [50],
                "maxSpeedKmh": 110,
                "seamDistanceM": 0,
                "verified": True,
                "provenance": "urn:railway:synthetic:portal-a2-b1-verified",
            }
        ],
    }

    portal_set_b1 = {
        "schemaVersion": 1,
        "portalSetId": "portals-in-north-v1-to-east",
        "portals": [
            {
                "id": "portal:in-east-c05:in-north-c05:eb1-nb1",
                "regionAId": "in-east-c05",
                "graphASha256": a1["graphSha256"],
                "stationAId": st_eb1_a1["id"],
                "nodeAId": st_eb1_a1["nodeIds"][0],
                "regionBId": "in-north-c05",
                "graphBSha256": b1["graphSha256"],
                "stationBId": st_nb1_b1["id"],
                "nodeBId": st_nb1_b1["nodeIds"][0],
                "allowedDirection": "BOTH",
                "gaugesMm": [1676],
                "electrification": "yes",
                "voltagesV": [25000],
                "frequenciesHz": [50],
                "maxSpeedKmh": 110,
                "seamDistanceM": 0,
                "verified": True,
                "provenance": "urn:railway:synthetic:portal-b1-ref",
            },
            {
                "id": "portal:trap:gauge-electrification-mismatch",
                "regionAId": "in-east-c05",
                "graphASha256": a1["graphSha256"],
                "stationAId": st_eb1_a1["id"],
                "nodeAId": st_eb1_a1["nodeIds"][0],
                "regionBId": "in-north-c05",
                "graphBSha256": b1["graphSha256"],
                "stationBId": st_nb_mg_b1["id"],
                "nodeBId": st_nb_mg_b1["nodeIds"][0],
                "allowedDirection": "A_TO_B",
                "gaugesMm": [1676],
                "electrification": "yes",
                "voltagesV": [25000],
                "frequenciesHz": [50],
                "maxSpeedKmh": 65,
                "seamDistanceM": 6672,
                "verified": True,
                "provenance": "urn:railway:synthetic:portal-trap-gauge",
            },
        ],
    }

    for slug, ps in [
        ("in_east_c05_v1", portal_set_a1_b1),
        ("in_east_c05_v2", portal_set_a2_b1),
        ("in_north_c05_v1", portal_set_b1),
    ]:
        p_path = out_root / slug / "portals.json"
        p_bytes = (json.dumps(ps, sort_keys=True, indent=2) + "\n").encode("utf-8")
        p_path.write_bytes(p_bytes)

    build_summary = {
        "generatedAtUtc": datetime.now(timezone.utc).isoformat(),
        "syntheticOnly": True,
        "realPbfProcessed": False,
        "packages": [
            {k: v for k, v in m.items() if k != "stations"}
            for m in (a1, a2, b1)
        ],
    }
    (out_root / "c05_raw_build_summary.json").write_text(json.dumps(build_summary, indent=2) + "\n", encoding="utf-8")
    return build_summary


if __name__ == "__main__":
    print(json.dumps(build_all_c05_fixtures(), indent=2))
