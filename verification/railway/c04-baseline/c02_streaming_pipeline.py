"""Memory-efficient, deterministic C02 streaming extraction pipeline.

Uses disk-backed SQLite staging and the verified V3 CivilianRailPrefilter so large
candidate datasets stream with bounded Python heap memory, deterministic ordering,
conflict quarantine, and verified final reference closure.

Real PBF execution remains hard-gated behind compliance_gate_cleared and
coordinator_c01_accepted flags.
"""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import subprocess
import tempfile
import tracemalloc
import xml.etree.ElementTree as ET
from collections import Counter
from typing import Any, Iterable

from c02_rail_prefilter import CivilianRailPrefilter, _is_valid_id


class ComplianceGateError(RuntimeError):
    """Raised when attempting real PBF extraction before C01 gates clear."""


_CLOUD_SYNC_MARKERS = ("onedrive", "crossdevice", "dropbox", "google drive", "icloud")
_CLOUD_ENV_KEYS = ("ONEDRIVE", "ONEDRIVECONSUMER", "ONEDRIVECOMMERCIAL", "DROPBOX", "GOOGLEDRIVE")
_SYNTHETIC_FIXTURE_MAX_BYTES = 10 * 1024 * 1024  # 10 MB hard cap for synthetic smoke files


def _real_ancestors(path_str: str) -> list[str]:
    """Return both lexical and symlink-resolved absolute paths and all ancestors."""
    candidates = [os.path.abspath(path_str), os.path.realpath(os.path.abspath(path_str))]
    seen: list[str] = []
    for base in candidates:
        cur = base
        while True:
            if cur not in seen:
                seen.append(cur)
            parent = os.path.dirname(cur)
            if parent == cur:
                break
            cur = parent
    return seen


def assert_workspace_private_and_non_sync(path_to_check: str) -> str:
    """Fail closed if lexical or resolved path is inside Git or cloud-sync folders.

    Returns the resolved canonical path. Note: local filesystem inspection enforces
    private directory boundaries only and does not independently attest physical geolocation.
    """
    abs_path = os.path.abspath(path_to_check)
    real_path = os.path.realpath(abs_path)

    cloud_roots = [
        os.path.realpath(os.path.abspath(os.environ[k]))
        for k in _CLOUD_ENV_KEYS
        if os.environ.get(k)
    ]

    for candidate in (abs_path, real_path):
        low = candidate.lower()
        if any(marker in low for marker in _CLOUD_SYNC_MARKERS):
            raise ComplianceGateError(f"Path violates non-cloud-sync restriction: {candidate}")
        for cr in cloud_roots:
            cr_low = cr.lower().rstrip("\\/")
            if low == cr_low or low.startswith(cr_low + os.sep):
                raise ComplianceGateError(f"Path lies under host cloud-sync root: {candidate}")

    for ancestor in _real_ancestors(path_to_check):
        if os.path.exists(os.path.join(ancestor, ".git")):
            raise ComplianceGateError(f"Path violates outside-Git restriction (.git found at {ancestor})")

    return real_path


def assert_real_data_intake_allowed(
    input_pbf: str,
    output_dir: str,
    *,
    compliance_gate_cleared: bool = False,
    coordinator_c01_accepted: bool = False,
    self_certification_verified: bool = False,
    safe_civilian_scope_approved: bool = False,
) -> tuple[str, str]:
    """Fail closed if any C01 compliance, coordinator, or resolved workspace boundary fails."""
    missing: list[str] = []
    if not compliance_gate_cleared:
        missing.append("compliance_gate_cleared")
    if not coordinator_c01_accepted:
        missing.append("coordinator_c01_accepted")
    if not self_certification_verified:
        missing.append("self_certification_verified")
    if not safe_civilian_scope_approved:
        missing.append("safe_civilian_scope_approved")
    if missing:
        raise ComplianceGateError(
            "Real PBF intake blocked; unmet prerequisites: " + ", ".join(missing)
        )
    real_out = assert_workspace_private_and_non_sync(output_dir)
    real_in = os.path.realpath(os.path.abspath(input_pbf))
    assert_workspace_private_and_non_sync(os.path.dirname(real_in))
    if not os.path.isfile(real_in):
        raise FileNotFoundError(f"Real PBF input not found: {real_in}")
    if real_out == os.path.dirname(real_in):
        raise ComplianceGateError("Output directory must remain separate from immutable raw PBF directory.")
    return real_in, real_out


def _build_osmium_tags_filter_args(osmium_exe: str, input_pbf: str, output_pbf: str) -> list[str]:
    return [
        osmium_exe,
        "tags-filter",
        "--no-progress",
        "--overwrite",
        "-o",
        output_pbf,
        input_pbf,
        "w/railway=rail,narrow_gauge,light_rail,subway,station,halt",
        "n/railway=station,halt",
        "nw/public_transport=station",
        "r/type=route",
        "r/type=public_transport",
    ]


def build_osmium_tags_filter_command(
    osmium_exe: str,
    input_pbf: str,
    output_pbf: str,
    *,
    compliance_gate_cleared: bool = False,
    coordinator_c01_accepted: bool = False,
    self_certification_verified: bool = False,
    safe_civilian_scope_approved: bool = False,
) -> list[str]:
    """Build pinned Osmium tags-filter command for real PBF extraction.

    All four C01 compliance and coordinator gates default to False (denied).
    """
    if not (
        compliance_gate_cleared
        and coordinator_c01_accepted
        and self_certification_verified
        and safe_civilian_scope_approved
    ):
        raise ComplianceGateError(
            "Real PBF extraction is blocked until compliance_gate_cleared, "
            "coordinator_c01_accepted, self_certification_verified, and "
            "safe_civilian_scope_approved are all True."
        )
    return _build_osmium_tags_filter_args(osmium_exe, input_pbf, output_pbf)


def build_osmium_check_refs_command(
    osmium_exe: str,
    input_pbf: str,
    *,
    compliance_gate_cleared: bool = False,
    coordinator_c01_accepted: bool = False,
    self_certification_verified: bool = False,
    safe_civilian_scope_approved: bool = False,
) -> list[str]:
    """Build pinned Osmium check-refs command (real-data gates default to denied)."""
    if not (
        compliance_gate_cleared
        and coordinator_c01_accepted
        and self_certification_verified
        and safe_civilian_scope_approved
    ):
        raise ComplianceGateError("Real PBF check-refs command blocked until all C01 gates are True.")
    return [osmium_exe, "check-refs", "--no-progress", "-r", input_pbf]


def build_osmium_cat_command(
    osmium_exe: str,
    input_path: str,
    output_path: str,
    *,
    output_format: str | None = None,
    compliance_gate_cleared: bool = False,
    coordinator_c01_accepted: bool = False,
    self_certification_verified: bool = False,
    safe_civilian_scope_approved: bool = False,
) -> list[str]:
    """Build pinned Osmium cat command (real-data gates default to denied)."""
    if not (
        compliance_gate_cleared
        and coordinator_c01_accepted
        and self_certification_verified
        and safe_civilian_scope_approved
    ):
        raise ComplianceGateError("Real PBF cat command blocked until all C01 gates are True.")
    cmd = [osmium_exe, "cat", "--no-progress", "--overwrite"]
    if output_format:
        cmd.extend(["-f", output_format])
    cmd.extend(["-o", output_path, input_path])
    return cmd


def _parse_xml_coord(raw_val: str | None) -> float | str | None:
    """Safely parse XML numeric coordinate without raising ValueError/OverflowError."""
    if raw_val is None:
        return None
    try:
        return float(raw_val)
    except (ValueError, OverflowError):
        # Return raw invalid string so downstream prefilter cleanly records REJECT_INVALID_COORDINATE
        return raw_val


def _parse_xml_ref(raw_val: str | None) -> int | str | None:
    """Safely parse XML integer ref without silently dropping malformed references."""
    if raw_val is None:
        return None
    try:
        return int(raw_val)
    except ValueError:
        # Preserve malformed string so _validate_way_refs / _evaluate_relation quarantines the object
        return raw_val


def iter_osm_xml_records(osm_xml_path: str) -> Iterable[dict[str, Any]]:
    """Stream OSM XML elements in O(1) tree memory, preserving malformed coords/refs for rejection."""
    root: ET.Element | None = None
    for event, elem in ET.iterparse(osm_xml_path, events=("start", "end")):
        if event == "start":
            if root is None:
                root = elem
            continue

        tag_name = elem.tag
        if tag_name not in ("node", "way", "relation"):
            continue

        raw_id = elem.attrib.get("id")
        obj_id = _parse_xml_ref(raw_id)

        tags: dict[str, str] = {}
        node_refs: list[Any] = []
        members: list[dict[str, Any]] = []
        for child in elem:
            if child.tag == "tag":
                k = child.attrib.get("k", "")
                v = child.attrib.get("v", "")
                tags[k] = v
            elif child.tag == "nd" and tag_name == "way":
                node_refs.append(_parse_xml_ref(child.attrib.get("ref")))
            elif child.tag == "member" and tag_name == "relation":
                members.append({
                    "type": child.attrib.get("type", ""),
                    "ref": _parse_xml_ref(child.attrib.get("ref")),
                    "role": child.attrib.get("role", ""),
                })

        if tag_name == "node":
            lat = _parse_xml_coord(elem.attrib.get("lat"))
            lon = _parse_xml_coord(elem.attrib.get("lon"))
            yield {"type": "node", "id": obj_id, "lat": lat, "lon": lon, "tags": tags}
        elif tag_name == "way":
            yield {"type": "way", "id": obj_id, "node_refs": node_refs, "tags": tags}
        elif tag_name == "relation":
            yield {"type": "relation", "id": obj_id, "members": members, "tags": tags}

        elem.clear()
        if root is not None:
            root.remove(elem)


class StreamingC02Pipeline:
    """Disk-backed SQLite streaming multi-pass C02 extraction pipeline."""

    def __init__(self, prefilter: CivilianRailPrefilter) -> None:
        self.prefilter = prefilter

    @classmethod
    def from_policy(cls, policy_path: str) -> "StreamingC02Pipeline":
        return cls(CivilianRailPrefilter.from_file(policy_path))

    @staticmethod
    def _init_db(conn: sqlite3.Connection) -> None:
        cur = conn.cursor()
        cur.executescript(
            """
            PRAGMA journal_mode = OFF;
            PRAGMA synchronous = OFF;
            PRAGMA temp_store = FILE;

            CREATE TABLE raw_objects (
                obj_type TEXT NOT NULL,
                obj_id INTEGER NOT NULL,
                seq INTEGER NOT NULL,
                payload TEXT NOT NULL
            );
            CREATE INDEX idx_raw_type_id ON raw_objects(obj_type, obj_id, seq);

            CREATE TABLE valid_nodes (
                id INTEGER PRIMARY KEY,
                kind TEXT NOT NULL,
                payload TEXT NOT NULL
            );

            CREATE TABLE excluded_nodes (
                id INTEGER PRIMARY KEY
            );

            CREATE TABLE approved_ways (
                id INTEGER PRIMARY KEY,
                payload TEXT NOT NULL
            );

            CREATE TABLE excluded_ways (
                id INTEGER PRIMARY KEY
            );

            CREATE TABLE approved_relations (
                id INTEGER PRIMARY KEY,
                payload TEXT NOT NULL
            );

            CREATE TABLE referenced_geom (
                id INTEGER PRIMARY KEY
            );
            """
        )
        conn.commit()

    @staticmethod
    def _iter_groups(
        conn: sqlite3.Connection,
        obj_type: str,
    ) -> Iterable[tuple[int, list[dict[str, Any]]]]:
        cur = conn.cursor()
        cur.execute(
            "SELECT obj_id, payload FROM raw_objects WHERE obj_type = ? ORDER BY obj_id ASC, seq ASC",
            (obj_type,),
        )
        current_id: int | None = None
        group: list[dict[str, Any]] = []
        for oid, payload_str in cur:
            obj = json.loads(payload_str)
            if current_id is None:
                current_id = oid
                group = [obj]
            elif oid == current_id:
                group.append(obj)
            else:
                yield current_id, group
                current_id = oid
                group = [obj]
        if current_id is not None:
            yield current_id, group

    @staticmethod
    def _lookup_node_status(
        conn: sqlite3.Connection,
        node_ids: list[int],
    ) -> tuple[set[int], set[int]]:
        """Lookup only the specific node IDs referenced by a way or batch of ways."""
        unique_ids = sorted({nid for nid in node_ids if _is_valid_id(nid)})
        if not unique_ids:
            return set(), set()
        valid: set[int] = set()
        excluded: set[int] = set()
        cur = conn.cursor()
        chunk_size = 500
        for i in range(0, len(unique_ids), chunk_size):
            chunk = unique_ids[i : i + chunk_size]
            ph = ",".join("?" for _ in chunk)
            cur.execute(f"SELECT id FROM valid_nodes WHERE id IN ({ph})", chunk)
            valid.update(row[0] for row in cur)
            cur.execute(f"SELECT id FROM excluded_nodes WHERE id IN ({ph})", chunk)
            excluded.update(row[0] for row in cur)
        return valid, excluded

    @staticmethod
    def _lookup_way_status(
        conn: sqlite3.Connection,
        way_ids: list[int],
    ) -> tuple[set[int], set[int]]:
        unique_ids = sorted({wid for wid in way_ids if _is_valid_id(wid)})
        if not unique_ids:
            return set(), set()
        approved: set[int] = set()
        excluded: set[int] = set()
        cur = conn.cursor()
        chunk_size = 500
        for i in range(0, len(unique_ids), chunk_size):
            chunk = unique_ids[i : i + chunk_size]
            ph = ",".join("?" for _ in chunk)
            cur.execute(f"SELECT id FROM approved_ways WHERE id IN ({ph})", chunk)
            approved.update(row[0] for row in cur)
            cur.execute(f"SELECT id FROM excluded_ways WHERE id IN ({ph})", chunk)
            excluded.update(row[0] for row in cur)
        return approved, excluded

    def run_stream(
        self,
        records: Iterable[Any],
        output_jsonl_path: str,
        *,
        work_dir: str | None = None,
        collect_retained_in_memory: bool = False,
    ) -> dict[str, Any]:
        """Stream records through SQLite staging into deterministic JSONL output."""
        tracemalloc.start()
        reason_counts: Counter[str] = Counter()
        total_input = 0

        os.makedirs(os.path.dirname(os.path.abspath(output_jsonl_path)), exist_ok=True)
        with tempfile.TemporaryDirectory(dir=work_dir) as tmpdir:
            db_path = os.path.join(tmpdir, "c02_staging.sqlite")
            conn = sqlite3.connect(db_path)
            try:
                self._init_db(conn)
                cur = conn.cursor()

                # Pass 0: Safe structural intake
                batch_rows: list[tuple[str, int, int, str]] = []
                for seq, rec in enumerate(records):
                    total_input += 1
                    if not isinstance(rec, dict):
                        reason_counts["REJECT_MALFORMED_RECORD"] += 1
                        continue
                    obj_id = rec.get("id")
                    if not _is_valid_id(obj_id):
                        reason_counts["REJECT_INVALID_OR_MISSING_ID"] += 1
                        continue
                    obj_type = rec.get("type")
                    if obj_type not in ("node", "way", "relation"):
                        reason_counts["REJECT_INVALID_OBJECT_TYPE"] += 1
                        continue
                    batch_rows.append(
                        (obj_type, obj_id, seq, json.dumps(rec, separators=(",", ":"), allow_nan=True))
                    )
                    if len(batch_rows) >= 2000:
                        cur.executemany(
                            "INSERT INTO raw_objects(obj_type, obj_id, seq, payload) VALUES (?, ?, ?, ?)",
                            batch_rows,
                        )
                        batch_rows.clear()
                if batch_rows:
                    cur.executemany(
                        "INSERT INTO raw_objects(obj_type, obj_id, seq, payload) VALUES (?, ?, ?, ?)",
                        batch_rows,
                    )
                    batch_rows.clear()
                conn.commit()

                # Pass 1: Nodes
                for nid, group in self._iter_groups(conn, "node"):
                    evals = [self.prefilter.evaluate_record(rec) for rec in group]
                    kept_code, kept_obj = self.prefilter._resolve_id_group(
                        evals,
                        conflict_code="QUARANTINE_CONFLICTING_NODE_IDENTITY",
                        dedup_code="DEDUPLICATE_IDENTICAL_NODE",
                        reason_counts=reason_counts,
                    )
                    if kept_code is None or kept_obj is None:
                        cur.execute("INSERT INTO excluded_nodes(id) VALUES (?)", (nid,))
                    elif kept_code == "ALLOW_CIVILIAN_STATION":
                        cur.execute(
                            "INSERT INTO valid_nodes(id, kind, payload) VALUES (?, ?, ?)",
                            (nid, "station", json.dumps(kept_obj, sort_keys=True, separators=(",", ":"))),
                        )
                        reason_counts[kept_code] += 1
                    elif kept_code == "ALLOW_GEOMETRY_NODE":
                        cur.execute(
                            "INSERT INTO valid_nodes(id, kind, payload) VALUES (?, ?, ?)",
                            (nid, "geom", json.dumps(kept_obj, sort_keys=True, separators=(",", ":"))),
                        )
                conn.commit()

                # Pass 2: Ways (on-demand SQLite lookup for referenced node IDs)
                for wid, group in self._iter_groups(conn, "way"):
                    ref_ids: list[int] = []
                    for rec in group:
                        nrefs = rec.get("node_refs")
                        if isinstance(nrefs, list):
                            ref_ids.extend(n for n in nrefs if _is_valid_id(n))
                    valid_n, excl_n = self._lookup_node_status(conn, ref_ids)
                    evals = [
                        self.prefilter.evaluate_record(
                            rec,
                            excluded_node_ids=excl_n,
                            valid_node_ids=valid_n,
                        )
                        for rec in group
                    ]
                    kept_code, kept_obj = self.prefilter._resolve_id_group(
                        evals,
                        conflict_code="QUARANTINE_CONFLICTING_WAY_IDENTITY",
                        dedup_code="DEDUPLICATE_IDENTICAL_WAY",
                        reason_counts=reason_counts,
                    )
                    if kept_code is None or kept_obj is None:
                        cur.execute("INSERT INTO excluded_ways(id) VALUES (?)", (wid,))
                    else:
                        cur.execute(
                            "INSERT INTO approved_ways(id, payload) VALUES (?, ?)",
                            (wid, json.dumps(kept_obj, sort_keys=True, separators=(",", ":"))),
                        )
                        reason_counts[kept_code] += 1
                conn.commit()

                # Pass 3: Relations
                for rid, group in self._iter_groups(conn, "relation"):
                    ref_nids: list[int] = []
                    ref_wids: list[int] = []
                    for rec in group:
                        members = rec.get("members")
                        if isinstance(members, list):
                            for m in members:
                                if isinstance(m, dict) and _is_valid_id(m.get("ref")):
                                    if m.get("type") == "node":
                                        ref_nids.append(m["ref"])
                                    elif m.get("type") == "way":
                                        ref_wids.append(m["ref"])
                    valid_n, excl_n = self._lookup_node_status(conn, ref_nids)
                    appr_w, excl_w = self._lookup_way_status(conn, ref_wids)
                    evals = [
                        self.prefilter.evaluate_record(
                            rec,
                            excluded_node_ids=excl_n,
                            valid_node_ids=valid_n,
                            excluded_way_ids=excl_w,
                            approved_way_ids=appr_w,
                        )
                        for rec in group
                    ]
                    kept_code, kept_obj = self.prefilter._resolve_id_group(
                        evals,
                        conflict_code="QUARANTINE_CONFLICTING_RELATION_IDENTITY",
                        dedup_code="DEDUPLICATE_IDENTICAL_RELATION",
                        reason_counts=reason_counts,
                    )
                    if kept_code is None or kept_obj is None:
                        pass
                    else:
                        cur.execute(
                            "INSERT INTO approved_relations(id, payload) VALUES (?, ?)",
                            (rid, json.dumps(kept_obj, sort_keys=True, separators=(",", ":"))),
                        )
                        reason_counts[kept_code] += 1
                conn.commit()

                # Pass 4: Mark referenced geometry nodes ONLY from surviving ways and relations
                read_cur = conn.cursor()
                write_cur = conn.cursor()
                for (payload_str,) in read_cur.execute("SELECT payload FROM approved_ways ORDER BY id ASC"):
                    way_obj = json.loads(payload_str)
                    for nid in way_obj["node_refs"]:
                        write_cur.execute("INSERT OR IGNORE INTO referenced_geom(id) VALUES (?)", (nid,))
                for (payload_str,) in read_cur.execute("SELECT payload FROM approved_relations ORDER BY id ASC"):
                    rel_obj = json.loads(payload_str)
                    for m in rel_obj["members"]:
                        if m["type"] == "node":
                            write_cur.execute("INSERT OR IGNORE INTO referenced_geom(id) VALUES (?)", (m["ref"],))
                conn.commit()

                # Emit deterministic JSONL ordered identically to V3 run_batch:
                # station nodes -> referenced geom nodes -> approved ways -> approved relations
                retained_count = 0
                retained_list: list[dict[str, Any]] = []
                out_hash = hashlib.sha256()

                with open(output_jsonl_path, "w", encoding="utf-8", newline="\n") as out_f:
                    def emit(obj_str: str) -> None:
                        nonlocal retained_count
                        line = obj_str + "\n"
                        out_f.write(line)
                        out_hash.update(line.encode("utf-8"))
                        retained_count += 1
                        if collect_retained_in_memory:
                            retained_list.append(json.loads(obj_str))

                    for (payload_str,) in read_cur.execute(
                        "SELECT payload FROM valid_nodes WHERE kind = 'station' ORDER BY id ASC"
                    ):
                        emit(payload_str)

                    for nid, kind, payload_str, is_ref in read_cur.execute(
                        """
                        SELECT v.id, v.kind, v.payload, r.id IS NOT NULL
                        FROM valid_nodes v
                        LEFT JOIN referenced_geom r ON r.id = v.id
                        WHERE v.kind = 'geom'
                        ORDER BY v.id ASC
                        """
                    ):
                        if is_ref:
                            reason_counts["ALLOW_GEOMETRY_NODE"] += 1
                            emit(payload_str)
                        else:
                            reason_counts["DROP_UNREFERENCED_GEOMETRY_NODE"] += 1

                    for (payload_str,) in read_cur.execute("SELECT payload FROM approved_ways ORDER BY id ASC"):
                        emit(payload_str)

                    for (payload_str,) in read_cur.execute("SELECT payload FROM approved_relations ORDER BY id ASC"):
                        emit(payload_str)

                # Pass 5: Reference closure audit over SQLite tables
                closure_errors = 0
                for (payload_str,) in read_cur.execute("SELECT payload FROM approved_ways"):
                    way_obj = json.loads(payload_str)
                    nrefs = way_obj["node_refs"]
                    ph = ",".join("?" for _ in nrefs)
                    found = write_cur.execute(
                        f"""
                        SELECT COUNT(*) FROM valid_nodes v
                        LEFT JOIN referenced_geom r ON r.id = v.id
                        WHERE v.id IN ({ph}) AND (v.kind = 'station' OR r.id IS NOT NULL)
                        """,
                        nrefs,
                    ).fetchone()[0]
                    if found != len(set(nrefs)):
                        closure_errors += 1

                for (payload_str,) in read_cur.execute("SELECT payload FROM approved_relations"):
                    rel_obj = json.loads(payload_str)
                    for m in rel_obj["members"]:
                        if m["type"] == "node":
                            ok = write_cur.execute(
                                """
                                SELECT 1 FROM valid_nodes v
                                LEFT JOIN referenced_geom r ON r.id = v.id
                                WHERE v.id = ? AND (v.kind = 'station' OR r.id IS NOT NULL)
                                """,
                                (m["ref"],),
                            ).fetchone()
                            if not ok:
                                closure_errors += 1
                        elif m["type"] == "way":
                            ok = write_cur.execute(
                                "SELECT 1 FROM approved_ways WHERE id = ?",
                                (m["ref"],),
                            ).fetchone()
                            if not ok:
                                closure_errors += 1

                if closure_errors > 0:
                    raise AssertionError(f"Reference closure audit failed with {closure_errors} errors.")

                _, peak_bytes = tracemalloc.get_traced_memory()
            finally:
                tracemalloc.stop()
                conn.close()

        assert sum(reason_counts.values()) == total_input, "Reason counts must sum to totalInput"
        result = {
            "totalInput": total_input,
            "retainedCount": retained_count,
            "excludedCount": total_input - retained_count,
            "reasonCounts": dict(sorted(reason_counts.items())),
            "outputJsonlSha256": out_hash.hexdigest(),
            "outputJsonlBytes": os.path.getsize(output_jsonl_path),
            "referenceClosurePassed": True,
            "peakPythonHeapBytes": peak_bytes,
        }
        if collect_retained_in_memory:
            result["retainedRecords"] = retained_list
        return result

    def run_synthetic_osm_file_smoke(
        self,
        osmium_exe: str,
        fixture_osm_path: str,
        expected_fixture_sha256: str,
        work_dir: str,
    ) -> dict[str, Any]:
        """Run end-to-end Osmium PBF -> tags-filter -> check-refs -> stream on a verified synthetic fixture."""
        real_work = assert_workspace_private_and_non_sync(work_dir)
        real_fixture = os.path.realpath(os.path.abspath(fixture_osm_path))
        assert_workspace_private_and_non_sync(os.path.dirname(real_fixture))

        if "eastern-zone" in os.path.basename(real_fixture).lower():
            raise ComplianceGateError("Real dataset filenames are prohibited in synthetic smoke runner.")
        if not os.path.isfile(real_fixture):
            raise FileNotFoundError(f"Synthetic fixture not found: {real_fixture}")
        if os.path.getsize(real_fixture) > _SYNTHETIC_FIXTURE_MAX_BYTES:
            raise ComplianceGateError("Fixture exceeds synthetic size cap; refusing intake.")

        h = hashlib.sha256()
        with open(real_fixture, "rb") as f:
            while ch := f.read(65536):
                h.update(ch)
        actual_fixture_sha = h.hexdigest()
        if actual_fixture_sha != expected_fixture_sha256.lower():
            raise ComplianceGateError(
                f"Synthetic fixture SHA-256 mismatch: expected {expected_fixture_sha256}, got {actual_fixture_sha}"
            )

        # Verify explicit synthetic generator provenance in root <osm> element
        gen_ok = False
        for event, elem in ET.iterparse(real_fixture, events=("start",)):
            if elem.tag == "osm":
                gen = elem.attrib.get("generator", "")
                gen_ok = gen.startswith("synthetic-")
            break
        if not gen_ok:
            raise ComplianceGateError("Fixture root <osm> missing synthetic- generator provenance attribute.")

        raw_pbf = os.path.join(real_work, "synthetic_raw.osm.pbf")
        flt_pbf = os.path.join(real_work, "synthetic_filtered.osm.pbf")
        flt_osm = os.path.join(real_work, "synthetic_filtered.osm")
        out_jsonl = os.path.join(real_work, "synthetic_c02_extracted.jsonl")

        env = os.environ.copy()
        osmium_bin_dir = os.path.dirname(os.path.abspath(osmium_exe))
        env["PATH"] = (
            osmium_bin_dir
            + os.pathsep
            + r"C:\Windows\System32;C:\Windows;"
            + env.get("PATH", "")
        )

        steps = [
            ("cat_to_pbf", [osmium_exe, "cat", "--no-progress", "--overwrite", "-f", "pbf", "-o", raw_pbf, real_fixture]),
            ("tags_filter", _build_osmium_tags_filter_args(osmium_exe, raw_pbf, flt_pbf)),
            ("check_refs", [osmium_exe, "check-refs", "--no-progress", "-r", flt_pbf]),
            ("cat_to_osm", [osmium_exe, "cat", "--no-progress", "--overwrite", "-f", "osm", "-o", flt_osm, flt_pbf]),
        ]
        step_results: list[dict[str, Any]] = []
        for label, cmd in steps:
            proc = subprocess.run(cmd, env=env, capture_output=True, text=True)
            step_results.append({"step": label, "exitCode": proc.returncode, "command": cmd[1:]})
            if proc.returncode != 0:
                raise RuntimeError(f"Osmium smoke step '{label}' failed RC={proc.returncode}: {proc.stderr}")

        stream_res = self.run_stream(
            iter_osm_xml_records(flt_osm),
            out_jsonl,
            work_dir=real_work,
            collect_retained_in_memory=True,
        )
        return {
            "fixtureSha256": actual_fixture_sha,
            "osmiumSteps": step_results,
            "filteredPbfBytes": os.path.getsize(flt_pbf),
            "outputJsonlPath": out_jsonl,
            "streamResult": stream_res,
        }

    def run_real_pbf_pipeline(
        self,
        osmium_exe: str,
        input_pbf: str,
        output_dir: str,
        *,
        compliance_gate_cleared: bool = False,
        coordinator_c01_accepted: bool = False,
        self_certification_verified: bool = False,
        safe_civilian_scope_approved: bool = False,
    ) -> dict[str, Any]:
        """Gated entry point for real PBF extraction; refuses to run until all C01 gates pass."""
        real_in, real_out = assert_real_data_intake_allowed(
            input_pbf,
            output_dir,
            compliance_gate_cleared=compliance_gate_cleared,
            coordinator_c01_accepted=coordinator_c01_accepted,
            self_certification_verified=self_certification_verified,
            safe_civilian_scope_approved=safe_civilian_scope_approved,
        )
        os.makedirs(real_out, exist_ok=True)
        flt_pbf = os.path.join(real_out, "c02_tags_filtered.osm.pbf")
        flt_osm = os.path.join(real_out, "c02_tags_filtered.osm")
        out_jsonl = os.path.join(real_out, "c02_extracted_rail.jsonl")

        gate_kwargs = {
            "compliance_gate_cleared": compliance_gate_cleared,
            "coordinator_c01_accepted": coordinator_c01_accepted,
            "self_certification_verified": self_certification_verified,
            "safe_civilian_scope_approved": safe_civilian_scope_approved,
        }
        for cmd in [
            build_osmium_tags_filter_command(osmium_exe, real_in, flt_pbf, **gate_kwargs),
            build_osmium_check_refs_command(osmium_exe, flt_pbf, **gate_kwargs),
            build_osmium_cat_command(osmium_exe, flt_pbf, flt_osm, output_format="osm", **gate_kwargs),
        ]:
            proc = subprocess.run(cmd, capture_output=True, text=True)
            if proc.returncode != 0:
                raise RuntimeError(f"Real PBF Osmium step failed RC={proc.returncode}: {proc.stderr}")

        return self.run_stream(iter_osm_xml_records(flt_osm), out_jsonl, work_dir=real_out)
