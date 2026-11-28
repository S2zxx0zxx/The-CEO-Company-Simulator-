"""Conservative minimum-necessary civilian railway pre-filter (V3) for C02 preflight."""

from __future__ import annotations

import json
import math
import re
from collections import Counter, defaultdict
from typing import Any


def _is_valid_id(value: Any) -> bool:
    """Return True only for positive integer OSM-style object IDs."""
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def _validate_coord(value: Any, min_val: float, max_val: float) -> float | None:
    """Validate finite numeric coordinate in [min_val, max_val] without OverflowError."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if isinstance(value, int):
        if value < min_val or value > max_val:
            return None
    try:
        fval = float(value)
    except OverflowError:
        return None
    if not math.isfinite(fval) or fval < min_val or fval > max_val:
        return None
    return fval


def _normalize_token(value: str) -> str:
    """Normalize tag values for case-insensitive hyphen/space/underscore comparison."""
    return re.sub(r"[\s\-]+", "_", value.strip().lower())


def _canonical_signature(code: str, sanitized: dict[str, Any]) -> str:
    """Return a deterministic canonical signature for duplicate/conflict detection."""
    return json.dumps({"code": code, "record": sanitized}, sort_keys=True, separators=(",", ":"))


class CivilianRailPrefilter:
    """Evaluates candidate OSM-like records against C02 civilian extraction policy (V3).

    Precedence is strictly DENY > ALLOW. Conflicting duplicate IDs are quarantined,
    identical duplicates are deduplicated deterministically, missing reference/member
    contexts fail closed, retained geometry is recomputed after all conflicts, and
    excluded records are counted only by aggregate reason code.
    """

    def __init__(self, policy: dict[str, Any]) -> None:
        self.policy = policy
        ex = policy["exclusions"]
        self._boundary_keys = set(ex["politicalAndAdministrativeBoundaries"]["denyKeys"])
        self._boundary_places = set(ex["politicalAndAdministrativeBoundaries"]["denyPlaceValues"])
        self._unrelated_keys = set(ex["unrelatedInfrastructureKeys"])

        ra = ex["restrictedAccessAndUsage"]
        self._deny_access = set(ra["denyAccessValues"])
        self._deny_usage = set(ra["denyUsageValues"])
        self._deny_operator_types = {_normalize_token(v) for v in ra["denyOperatorTypes"]}

        self._deny_keys = set(ex["sensitiveCategoryTagsAndKeywords"]["denyKeys"])
        patterns = ex["sensitiveCategoryTagsAndKeywords"]["denyKeywordPatterns"]
        self._keyword_re = re.compile(
            "|".join(re.escape(p) for p in patterns),
            flags=re.IGNORECASE,
        )
        self._border_keys = set(ex["territoryAndProvenance"]["denyBorderZoneTagKeys"])

        al = policy["allowlist"]
        self._track_cfg = al["trackWays"]
        self._allowed_track_usage = {
            v.strip().lower()
            for v in self._track_cfg["allowedUsageValues"]
            if v is not None
        }
        self._station_cfg = al["stationsAndHalts"]
        self._rel_cfg = al["relations"]

    @classmethod
    def from_file(cls, path: str) -> "CivilianRailPrefilter":
        with open(path, "r", encoding="utf-8") as f:
            return cls(json.load(f))

    def _matches_sensitive_keyword(self, tags: dict[str, str]) -> bool:
        for k, v in tags.items():
            if self._keyword_re.search(str(k)) or self._keyword_re.search(str(v)):
                return True
        return False

    def _check_exclusions(self, tags: dict[str, str]) -> str | None:
        """Return denial code if record matches any exclusion rule, else None."""
        if any(k in tags for k in self._boundary_keys) or tags.get("place") in self._boundary_places:
            return "DENY_POLITICAL_BOUNDARY"
        if any(k in tags for k in self._border_keys):
            return "DENY_UNCERTAIN_TERRITORY"
        if any(k in tags for k in self._deny_keys) or self._matches_sensitive_keyword(tags):
            return "DENY_SENSITIVE_OR_RESTRICTED"

        access_val = tags.get("access", "").strip().lower()
        usage_val = tags.get("usage", "").strip().lower()
        if access_val in self._deny_access:
            return "DENY_RESTRICTED_ACCESS"
        if usage_val in self._deny_usage:
            return "DENY_RESTRICTED_USAGE"

        op_type_norm = _normalize_token(tags.get("operator:type", ""))
        op_norm = _normalize_token(tags.get("operator", ""))
        if op_type_norm in self._deny_operator_types or op_norm in self._deny_operator_types:
            return "DENY_RESTRICTED_OPERATOR_TYPE"
        if any(tok in op_norm.split("_") for tok in self._deny_operator_types if "_" not in tok):
            return "DENY_RESTRICTED_OPERATOR_TYPE"
        return None

    def _is_track_candidate(self, tags: dict[str, str]) -> bool:
        return tags.get("railway") in self._track_cfg["allowedValues"]

    def _is_station_candidate(self, tags: dict[str, str]) -> bool:
        if tags.get("railway") in ("station", "halt"):
            return True
        return tags.get("public_transport") == "station" and tags.get("train") == "yes"

    def _is_relation_candidate(self, tags: dict[str, str]) -> bool:
        rtype = tags.get("type")
        if rtype == "route" and tags.get("route") in ("train", "railway", "light_rail", "subway"):
            return True
        if rtype == "public_transport" and tags.get("public_transport") == "stop_area" and tags.get("train") == "yes":
            return True
        return False

    def _validate_way_refs(
        self,
        node_refs: Any,
        excluded_node_ids: set[int],
        valid_node_ids: set[int] | None,
        min_distinct: int = 2,
    ) -> tuple[str | None, list[int]]:
        """Validate way node_refs structure, exclusion safety, and completeness."""
        if valid_node_ids is None:
            return "QUARANTINE_UNRESOLVED_REFERENCE_CONTEXT", []
        if not isinstance(node_refs, list) or len(node_refs) < 2:
            return "QUARANTINE_DEGENERATE_OR_MISSING_NODE_REFS", []
        if not all(_is_valid_id(nid) for nid in node_refs):
            return "REJECT_INVALID_NODE_REFERENCE", []
        if any(nid in excluded_node_ids for nid in node_refs):
            return "QUARANTINE_EXCLUDED_OR_MISSING_REFERENCE", []
        if not all(nid in valid_node_ids for nid in node_refs):
            return "QUARANTINE_MISSING_NODE_REFERENCE", []
        if len(set(node_refs)) < min_distinct:
            return "QUARANTINE_DEGENERATE_WAY_GEOMETRY", []
        return None, list(node_refs)

    def _evaluate_relation(
        self,
        obj_id: int,
        tags: dict[str, str],
        record: dict[str, Any],
        excluded_node_ids: set[int],
        excluded_way_ids: set[int],
        approved_node_ids: set[int] | None,
        approved_way_ids: set[int] | None,
    ) -> tuple[str, dict[str, Any] | None]:
        """Validate civilian rail relation and member reference integrity (fail-closed)."""
        if not self._is_relation_candidate(tags):
            if any(k in tags for k in self._unrelated_keys):
                return "DENY_UNRELATED_INFRASTRUCTURE", None
            return "DENY_NON_ALLOWLISTED_RELATION", None

        for k in tags:
            if k in self._unrelated_keys:
                return "DENY_MIXED_UNRELATED_INFRASTRUCTURE", None

        if approved_node_ids is None or approved_way_ids is None:
            return "QUARANTINE_UNRESOLVED_MEMBER_CONTEXT", None

        members = record.get("members")
        if not isinstance(members, list) or len(members) < self._rel_cfg["minMembers"]:
            return "REJECT_MALFORMED_OR_EMPTY_RELATION_MEMBERS", None

        sanitized_members: list[dict[str, Any]] = []
        for m in members:
            if not isinstance(m, dict):
                return "REJECT_MALFORMED_RELATION_MEMBER", None
            m_type = m.get("type")
            m_ref = m.get("ref")
            m_role = m.get("role", "")
            if not isinstance(m_role, str):
                return "REJECT_MALFORMED_RELATION_MEMBER", None
            if m_type == "relation" and self._rel_cfg["disallowNestedRelationMembers"]:
                return "QUARANTINE_UNSUPPORTED_NESTED_RELATION_MEMBER", None
            if m_type not in self._rel_cfg["allowedMemberTypes"] or not _is_valid_id(m_ref):
                return "REJECT_MALFORMED_RELATION_MEMBER", None

            if m_type == "node":
                if m_ref in excluded_node_ids:
                    return "QUARANTINE_EXCLUDED_RELATION_MEMBER", None
                if m_ref not in approved_node_ids:
                    return "QUARANTINE_MISSING_OR_UNAPPROVED_RELATION_MEMBER", None
            elif m_type == "way":
                if m_ref in excluded_way_ids:
                    return "QUARANTINE_EXCLUDED_RELATION_MEMBER", None
                if m_ref not in approved_way_ids:
                    return "QUARANTINE_MISSING_OR_UNAPPROVED_RELATION_MEMBER", None

            sanitized_members.append({"type": m_type, "ref": m_ref, "role": m_role})

        retained_tags = {
            k: tags[k]
            for k in self._rel_cfg["retainedTags"]
            if k in tags
        }
        return "ALLOW_CIVILIAN_RELATION", {
            "type": "relation",
            "id": obj_id,
            "members": sanitized_members,
            "tags": retained_tags,
        }

    def evaluate_record(
        self,
        record: Any,
        excluded_node_ids: set[int] | None = None,
        valid_node_ids: set[int] | None = None,
        excluded_way_ids: set[int] | None = None,
        approved_way_ids: set[int] | None = None,
    ) -> tuple[str, dict[str, Any] | None]:
        """Evaluate one candidate record fail-closed.

        Ways require valid_node_ids context; relations require both valid_node_ids
        and approved_way_ids context. Missing context fails closed.
        """
        if not isinstance(record, dict):
            return "REJECT_MALFORMED_RECORD", None

        obj_id = record.get("id")
        if not _is_valid_id(obj_id):
            return "REJECT_INVALID_OR_MISSING_ID", None

        obj_type = record.get("type")
        if obj_type not in ("node", "way", "relation"):
            return "REJECT_INVALID_OBJECT_TYPE", None

        raw_tags = record.get("tags")
        if raw_tags is None:
            raw_tags = {}
        if not isinstance(raw_tags, dict):
            return "REJECT_MALFORMED_TAGS", None
        tags: dict[str, str] = {str(k): str(v) for k, v in raw_tags.items()}

        ex_nodes = excluded_node_ids or set()
        ex_ways = excluded_way_ids or set()

        # Exclusions always override allowlist
        deny_code = self._check_exclusions(tags)
        if deny_code is not None:
            return deny_code, None

        if obj_type == "node":
            lat = _validate_coord(record.get("lat"), -90.0, 90.0)
            lon = _validate_coord(record.get("lon"), -180.0, 180.0)
            if lat is None or lon is None:
                return "REJECT_INVALID_COORDINATE", None

            if self._is_station_candidate(tags):
                for k in tags:
                    if k in self._unrelated_keys and k != "building":
                        return "DENY_MIXED_UNRELATED_INFRASTRUCTURE", None
                if self._station_cfg.get("requireNonEmptyName") and not tags.get("name", "").strip():
                    return "DENY_MISSING_STATION_NAME", None
                retained = {k: tags[k] for k in self._station_cfg["retainedTags"] if k in tags}
                return "ALLOW_CIVILIAN_STATION", {
                    "type": "node",
                    "id": obj_id,
                    "lat": lat,
                    "lon": lon,
                    "tags": retained,
                }

            if len(tags) == 0:
                return "ALLOW_GEOMETRY_NODE", {
                    "type": "node",
                    "id": obj_id,
                    "lat": lat,
                    "lon": lon,
                    "tags": {},
                }

            if any(k in tags for k in self._unrelated_keys):
                return "DENY_UNRELATED_INFRASTRUCTURE", None
            return "DENY_NON_ALLOWLISTED_FEATURE", None

        if obj_type == "relation":
            return self._evaluate_relation(
                obj_id=obj_id,
                tags=tags,
                record=record,
                excluded_node_ids=ex_nodes,
                excluded_way_ids=ex_ways,
                approved_node_ids=valid_node_ids,
                approved_way_ids=approved_way_ids,
            )

        # Way branch: track way or station way
        is_track = self._is_track_candidate(tags)
        is_station = self._is_station_candidate(tags)
        if not (is_track or is_station):
            if any(k in tags for k in self._unrelated_keys):
                return "DENY_UNRELATED_INFRASTRUCTURE", None
            return "DENY_NON_ALLOWLISTED_FEATURE", None

        for k in tags:
            if k in self._unrelated_keys and k not in ("bridge", "tunnel", "building"):
                return "DENY_MIXED_UNRELATED_INFRASTRUCTURE", None
            if k == "building" and not is_station:
                return "DENY_MIXED_UNRELATED_INFRASTRUCTURE", None

        if is_track:
            usage_val = tags.get("usage", "").strip().lower()
            if usage_val and usage_val not in self._allowed_track_usage:
                return "DENY_UNAPPROVED_TRACK_USAGE", None

            service_val = tags.get("service", "").strip().lower()
            if service_val in self._track_cfg["excludedServiceValues"]:
                return "DENY_EXCLUDED_OR_UNCERTAIN_SERVICE", None
            if service_val and service_val not in ("main", "crossover"):
                return "DENY_UNCERTAIN_SERVICE", None

            err, refs = self._validate_way_refs(
                record.get("node_refs"),
                excluded_node_ids=ex_nodes,
                valid_node_ids=valid_node_ids,
                min_distinct=self._track_cfg["minDistinctNodeRefs"],
            )
            if err is not None:
                return err, None

            retained = {k: tags[k] for k in self._track_cfg["retainedTags"] if k in tags}
            for req_norm in self._track_cfg["normalizeMissingToUnknown"]:
                if req_norm not in retained or not str(retained[req_norm]).strip():
                    retained[req_norm] = "unknown"
            return "ALLOW_CIVILIAN_RAIL_WAY", {
                "type": "way",
                "id": obj_id,
                "node_refs": refs,
                "tags": retained,
            }

        # Station way
        if self._station_cfg.get("requireNonEmptyName") and not tags.get("name", "").strip():
            return "DENY_MISSING_STATION_NAME", None
        err, refs = self._validate_way_refs(
            record.get("node_refs"),
            excluded_node_ids=ex_nodes,
            valid_node_ids=valid_node_ids,
            min_distinct=self._station_cfg["minWayNodeRefs"],
        )
        if err is not None:
            return err, None

        retained = {k: tags[k] for k in self._station_cfg["retainedTags"] if k in tags}
        return "ALLOW_CIVILIAN_STATION", {
            "type": "way",
            "id": obj_id,
            "node_refs": refs,
            "tags": retained,
        }

    def _resolve_id_group(
        self,
        group: list[tuple[str, dict[str, Any] | None]],
        conflict_code: str,
        dedup_code: str,
        reason_counts: Counter[str],
    ) -> tuple[str | None, dict[str, Any] | None]:
        """Resolve duplicates/conflicts for one object ID deterministically.

        - Any exclusion/quarantine/rejection in the group poisons the entire ID.
        - Differing allowed records for the same ID are quarantined as conflicts.
        - Identical allowed records are deduplicated deterministically (keep 1).
        """
        allows = [(c, s) for c, s in group if c.startswith("ALLOW_") and s is not None]
        non_allows = [c for c, s in group if not (c.startswith("ALLOW_") and s is not None)]

        if non_allows:
            for c in non_allows:
                reason_counts[c] += 1
            for _ in allows:
                reason_counts[conflict_code] += 1
            return None, None

        sigs = {_canonical_signature(c, s) for c, s in allows}
        if len(sigs) > 1:
            reason_counts[conflict_code] += len(allows)
            return None, None

        kept_code, kept_obj = allows[0]
        if len(allows) > 1:
            reason_counts[dedup_code] += len(allows) - 1
        return kept_code, kept_obj

    def run_batch(self, records: list[Any]) -> dict[str, Any]:
        """Screen a batch with conflict quarantine, deduplication, and reference closure."""
        if not isinstance(records, (list, tuple)):
            raise TypeError("Batch records must be a list or tuple.")

        reason_counts: Counter[str] = Counter()
        node_groups: dict[int, list[dict[str, Any]]] = defaultdict(list)
        way_groups: dict[int, list[dict[str, Any]]] = defaultdict(list)
        rel_groups: dict[int, list[dict[str, Any]]] = defaultdict(list)

        # Pass 0: Safe structural partitioning
        for rec in records:
            if not isinstance(rec, dict):
                reason_counts["REJECT_MALFORMED_RECORD"] += 1
                continue
            obj_id = rec.get("id")
            if not _is_valid_id(obj_id):
                reason_counts["REJECT_INVALID_OR_MISSING_ID"] += 1
                continue
            obj_type = rec.get("type")
            if obj_type == "node":
                node_groups[obj_id].append(rec)
            elif obj_type == "way":
                way_groups[obj_id].append(rec)
            elif obj_type == "relation":
                rel_groups[obj_id].append(rec)
            else:
                reason_counts["REJECT_INVALID_OBJECT_TYPE"] += 1

        # Pass 1: Nodes (exclusion precedence + conflict quarantine + deduplication)
        excluded_node_ids: set[int] = set()
        station_nodes: dict[int, dict[str, Any]] = {}
        geometry_nodes: dict[int, dict[str, Any]] = {}

        for nid in sorted(node_groups):
            evals = [self.evaluate_record(rec) for rec in node_groups[nid]]
            kept_code, kept_obj = self._resolve_id_group(
                evals,
                conflict_code="QUARANTINE_CONFLICTING_NODE_IDENTITY",
                dedup_code="DEDUPLICATE_IDENTICAL_NODE",
                reason_counts=reason_counts,
            )
            if kept_code is None or kept_obj is None:
                excluded_node_ids.add(nid)
            elif kept_code == "ALLOW_CIVILIAN_STATION":
                station_nodes[nid] = kept_obj
                reason_counts[kept_code] += 1
            elif kept_code == "ALLOW_GEOMETRY_NODE":
                geometry_nodes[nid] = kept_obj

        valid_node_ids = set(station_nodes) | set(geometry_nodes)

        # Pass 2: Ways (exclusion precedence + conflict quarantine + deduplication)
        excluded_way_ids: set[int] = set()
        approved_ways: dict[int, dict[str, Any]] = {}

        for wid in sorted(way_groups):
            evals = [
                self.evaluate_record(
                    rec,
                    excluded_node_ids=excluded_node_ids,
                    valid_node_ids=valid_node_ids,
                )
                for rec in way_groups[wid]
            ]
            kept_code, kept_obj = self._resolve_id_group(
                evals,
                conflict_code="QUARANTINE_CONFLICTING_WAY_IDENTITY",
                dedup_code="DEDUPLICATE_IDENTICAL_WAY",
                reason_counts=reason_counts,
            )
            if kept_code is None or kept_obj is None:
                excluded_way_ids.add(wid)
            else:
                approved_ways[wid] = kept_obj
                reason_counts[kept_code] += 1

        approved_way_ids = set(approved_ways)

        # Pass 3: Relations (exclusion precedence + conflict quarantine + deduplication)
        excluded_relation_ids: set[int] = set()
        approved_relations: dict[int, dict[str, Any]] = {}

        for rid in sorted(rel_groups):
            evals = [
                self.evaluate_record(
                    rec,
                    excluded_node_ids=excluded_node_ids,
                    valid_node_ids=valid_node_ids,
                    excluded_way_ids=excluded_way_ids,
                    approved_way_ids=approved_way_ids,
                )
                for rec in rel_groups[rid]
            ]
            kept_code, kept_obj = self._resolve_id_group(
                evals,
                conflict_code="QUARANTINE_CONFLICTING_RELATION_IDENTITY",
                dedup_code="DEDUPLICATE_IDENTICAL_RELATION",
                reason_counts=reason_counts,
            )
            if kept_code is None or kept_obj is None:
                excluded_relation_ids.add(rid)
            else:
                approved_relations[rid] = kept_obj
                reason_counts[kept_code] += 1

        # Pass 4: Recompute retained geometry ONLY from final surviving ways & relations
        referenced_geom_ids: set[int] = set()
        for way_obj in approved_ways.values():
            for nid in way_obj["node_refs"]:
                if nid in geometry_nodes:
                    referenced_geom_ids.add(nid)
        for rel_obj in approved_relations.values():
            for m in rel_obj["members"]:
                if m["type"] == "node" and m["ref"] in geometry_nodes:
                    referenced_geom_ids.add(m["ref"])

        retained_records: list[dict[str, Any]] = []
        for nid in sorted(station_nodes):
            retained_records.append(station_nodes[nid])
        for nid in sorted(geometry_nodes):
            if nid in referenced_geom_ids:
                reason_counts["ALLOW_GEOMETRY_NODE"] += 1
                retained_records.append(geometry_nodes[nid])
            else:
                reason_counts["DROP_UNREFERENCED_GEOMETRY_NODE"] += 1
        for wid in sorted(approved_ways):
            retained_records.append(approved_ways[wid])
        for rid in sorted(approved_relations):
            retained_records.append(approved_relations[rid])

        # Final reference closure invariant check
        retained_node_ids = set(station_nodes) | referenced_geom_ids
        for way_obj in approved_ways.values():
            if not all(nid in retained_node_ids for nid in way_obj["node_refs"]):
                raise AssertionError("Reference closure violated in retained ways.")
        for rel_obj in approved_relations.values():
            for m in rel_obj["members"]:
                if m["type"] == "node" and m["ref"] not in retained_node_ids:
                    raise AssertionError("Reference closure violated for relation node member.")
                if m["type"] == "way" and m["ref"] not in approved_way_ids:
                    raise AssertionError("Reference closure violated for relation way member.")

        return {
            "totalInput": len(records),
            "retainedCount": len(retained_records),
            "excludedCount": len(records) - len(retained_records),
            "reasonCounts": dict(sorted(reason_counts.items())),
            "retainedRecords": retained_records,
        }
