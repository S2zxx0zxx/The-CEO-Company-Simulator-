#!/usr/bin/env python3
"""Build verified C07-FIX-01 single-ZIP deliverable, re-verify from fresh temp extraction, and push isolated GitHub snapshot."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import subprocess
import tempfile
import zipfile

REPO_URL = "https://github.com/S2zxx0zxx/Railway-Ceo-.git"
BRANCH = "feat/railway-manager-v5"
COORDINATOR_CHECKPOINT = "36c2128d6ea1a86cfebcc94d9886fbf535773354"
PROTECTED_REFS = {
    "refs/heads/main": "8268c8dcd6ef46fc35e300c14d8491bfbb3656e1",
    "refs/heads/feat/company-simulator-v3": "fefd995fd189506502ae59230b9ee9c408faa544",
}
GIT_PREFIX = "verification/railway/c07-fix-01/"
FORBIDDEN_MARKERS = (
    "c:" + "\\users\\",
    "c:" + "/users/",
    "satyam" + " kumar",
    "-----begin " + "private key-----",
    "-----begin ec " + "private key-----",
    "github_" + "pat_",
    "ghp" + "_",
)


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def check_clean_text(rel: str, raw: bytes) -> None:
    ext = pathlib.Path(rel).suffix.lower()
    if ext in {".pmtiles", ".woff2", ".gz", ".pbf", ".class", ".jar", ".png", ".jpg", ".jpeg", ".webp", ".ico", ".zip"}:
        return
    txt = raw.decode("utf-8", errors="ignore").lower()
    for m in FORBIDDEN_MARKERS:
        if m in txt:
            raise RuntimeError(f"Forbidden marker {m!r} found in {rel}")


def collect_zip_files(ws: pathlib.Path, repo: pathlib.Path) -> list[tuple[str, pathlib.Path]]:
    files: list[tuple[str, pathlib.Path]] = []
    for folder in (
        "src",
        "tests",
        "assets/fonts",
        "assets/licenses",
        "assets/sprites",
        "fixtures/c05_regions",
        "fixtures/c06_oracle",
        "fixtures/c07_calibration",
        "docs",
    ):
        base = ws / folder
        if base.exists():
            for p in sorted(base.rglob("*")):
                if p.is_file():
                    rel = p.relative_to(ws).as_posix()
                    if "__pycache__" in rel or rel.endswith(".pyc"):
                        continue
                    files.append((rel, p))

    for p in sorted((ws / "c06_oracle" / "java" / "src").rglob("*.java")):
        files.append((p.relative_to(ws).as_posix(), p))

    fixed_rel_files = [
        "c06_oracle/java/c06-strict-oracle.jar",
        "c06_oracle/cache_strict/c06_cache_identity.json",
        "c06_oracle/import_metrics.json",
        "c06_oracle/c06_test_output.json",
        "c07_oracle/cache_strict/c06_cache_identity.json",
        "c07_oracle/import_metrics.json",
        "c07_oracle/c07_test_output.json",
        "c07_oracle/c07_batch_evidence.json",
        "c07_oracle/c07_batch_checkpoint.json",
        "c04_c06_tools/openrailrouting/LICENSE.txt",
        "c04_c06_tools/openrailrouting_maven_dependencies.txt",
        "DEPENDENCY_AND_TOOL_MANIFEST.json",
        "fixtures/c02_synthetic_smoke.osm",
        "fixtures/c03_synthetic_scale_pack.json",
        "fixtures/c04_synthetic_basemap.osm",
        "fixtures/c04_synthetic_basemap.osm.pbf",
        "fixtures/c04_synthetic_basemap.pmtiles",
        "fixtures/c04_synthetic_graph_bundle.json",
        "fixtures/c04_tile_build_manifest.json",
        "c04_tile_pipeline/railway_basemap_schema.yml",
        "C04_ASSET_LICENSE_MANIFEST.json",
        "C02_CIVILIAN_RAIL_EXTRACTION_POLICY.json",
        "c02_rail_prefilter.py",
        "c02_streaming_pipeline.py",
        "c02_downstream_adapter.py",
        "test_c02_prefilter_synthetic.py",
        "test_c02_pipeline_synthetic.py",
        "c03_station_attachment.py",
        "c03_topology_builder.py",
        "test_c03_topology_and_stations.py",
        "test_c03_runtime_ts.mjs",
        "verify_downstream_graphpack.mjs",
        "_run_upstream_cases.mjs",
        "c04_tile_builder.py",
        "c04_tile_inspector.mjs",
        "c04_asset_generator.mjs",
        "c04_web_entry.ts",
        "test_c04_contracts_and_tiles.mjs",
        "test_c04_browser_webgl.mjs",
        "c05_fixture_builder.py",
        "c05_sign_manifests.mjs",
        "c05_web_entry.ts",
        "test_c05_packages_install_and_portals.mjs",
        "test_c05_browser_persistence.mjs",
        "c05_package_and_sync.py",
        "c06_fixture_builder.py",
        "test_c06_strict_oracle.mjs",
        "c06_package_and_sync.py",
        "c07_fixture_builder.py",
        "c07_dataset_generator.mjs",
        "test_c07_calibration.mjs",
        "c07_package_and_sync.py",
        "C05_FIX_01_VERIFICATION_REPORT.json",
        "C05_FIX_02_VERIFICATION_REPORT.json",
        "C06_DEPENDENCY_EVIDENCE.json",
        "C06_TRACEABILITY_MATRIX.json",
        "C06_PERFORMANCE_BENCHMARK_REPORT.json",
        "C06_VERIFICATION_REPORT.json",
        "C07_DEPENDENCY_EVIDENCE.json",
        "C07_COVERAGE_MATRIX.json",
        "C07_DISCREPANCY_REGISTRY.json",
        "C07_CALIBRATION_REPORT.json",
        "C07_CROSS_REGION_REPORT.json",
        "C07_PERFORMANCE_BENCHMARK_REPORT.json",
        "C07_VERIFICATION_REPORT.json",
        "C07_C08_READINESS_CHECKLIST.json",
        "README.md",
        "EXECUTION_SUMMARY.md",
    ]
    for rel in fixed_rel_files:
        p = ws / rel
        if not p.is_file():
            raise FileNotFoundError(f"Required ZIP artifact missing: {rel}")
        files.append((rel, p))

    # Include freshly generated snapshot manifest
    snap_preview = ws / "c07_oracle" / "SNAPSHOT_MANIFEST.json"
    if snap_preview.is_file():
        files.append(("SNAPSHOT_MANIFEST.json", snap_preview))

    docs_railway = repo / "docs" / "railway"
    if docs_railway.is_dir():
        for name in (
            "MASTER_RECOVERY_INDEX.md",
            "STATE.md",
            "OWNER_EXECUTION_PROTOCOL.md",
            "EXECUTION_LEDGER.csv",
            "REMAINING_IMPLEMENTATION_LEDGER.csv",
            "DEFERRED_VERIFICATION.csv",
            "R03_SOURCE_LOCK.json",
            "R04_DATA_ACQUISITION_POLICY.json",
            "C01_CIVILIAN_MAP_SCOPE.json",
            "C05_FIX_02_INDEPENDENT_REVIEW.json",
            "C06_FIX_01_COORDINATOR_REVIEW.json",
            "C07_INDEPENDENT_REVIEW.json",
            "C07_COORDINATOR_REVIEW.json",
            "R51_DISTRIBUTION_REQUIREMENTS.json",
        ):
            rp = docs_railway / name
            if rp.is_file():
                files.append((f"docs/railway/{name}", rp))

    by_rel: dict[str, pathlib.Path] = {}
    for rel, p in files:
        by_rel[rel] = p
    return sorted(by_rel.items(), key=lambda x: x[0])


def collect_git_snapshot_files(ws: pathlib.Path, current_head: str) -> dict[str, bytes]:
    rels = [
        "src/rail/c07-calibration/contracts.ts",
        "src/rail/c07-calibration/discrepancy-registry.ts",
        "src/rail/c07-calibration/calibration.ts",
        "src/rail/c07-calibration/batch-runner.ts",
        "src/rail/c07-calibration/cross-region.ts",
        "src/rail/c07-calibration/index.ts",
        "fixtures/c07_calibration/c07_synthetic_corridor.osm",
        "fixtures/c07_calibration/c07_synthetic_corridor.osm.pbf",
        "fixtures/c07_calibration/c07_graph_v1.json",
        "fixtures/c07_calibration/c07_graph_v2.json",
        "fixtures/c07_calibration/c07_fixture_ground_truth.json",
        "fixtures/c07_calibration/c07_fixture_manifest.json",
        "fixtures/c07_calibration/c07_synthetic_calibration_dataset.json",
        "fixtures/c07_calibration/c07_real_data_readiness_schema.json",
        "c07_oracle/cache_strict/c06_cache_identity.json",
        "c07_oracle/import_metrics.json",
        "c07_oracle/c07_test_output.json",
        "c07_oracle/c07_batch_evidence.json",
        "c07_fixture_builder.py",
        "c07_dataset_generator.mjs",
        "test_c07_calibration.mjs",
        "c07_package_and_sync.py",
        "docs/C07_ROUTE_CALIBRATION_ARCHITECTURE.md",
        "C07_DEPENDENCY_EVIDENCE.json",
        "C07_COVERAGE_MATRIX.json",
        "C07_DISCREPANCY_REGISTRY.json",
        "C07_CALIBRATION_REPORT.json",
        "C07_CROSS_REGION_REPORT.json",
        "C07_PERFORMANCE_BENCHMARK_REPORT.json",
        "C07_VERIFICATION_REPORT.json",
        "C07_C08_READINESS_CHECKLIST.json",
        "README.md",
        "EXECUTION_SUMMARY.md",
    ]
    out: dict[str, bytes] = {}
    for rel in rels:
        p = ws / rel
        raw = p.read_bytes()
        check_clean_text(rel, raw)
        out[rel] = raw

    snap_manifest = {
        "schemaVersion": 1,
        "task": "C07-FIX-01",
        "originalTask": "R17",
        "masterRequirements": ["MR-006", "MR-044"],
        "coordinatorCheckpoint": COORDINATOR_CHECKPOINT,
        "baseline": current_head,
        "openRailRoutingPin": "e5112194fde4cc8ec36e2b0093e250df89ef4845",
        "c06AdapterJarSha256": "34e81249ceb940008fc87545608549e34e3201bd33e251f4405f8eedca7091eb",
        "datasetIdentity": {
            "datasetId": "C07-SYNTHETIC-CALIBRATION-V2",
            "datasetVersion": "2.0.0",
            "totalCases": 137,
            "genuineRouteComparisons": 123,
            "infrastructureAndUnsupportedCases": 14,
        },
        "realPbfProcessed": False,
        "realRouteComparisonsCompleted": 0,
        "releaseAllowed": False,
        "scope": "Isolated C07-FIX-01 comparison evidence integrity & complete ZIP restoration snapshot; leaves c04-*, c05-*, c06-*, c07-route-calibration, root runtime, PR #1 and main untouched.",
        "sourceFiles": {
            rel: {
                "bytes": len(raw),
                "sha256": sha256_bytes(raw),
                "gitBlobSha1": hashlib.sha1(f"blob {len(raw)}\0".encode("utf-8") + raw).hexdigest(),
            }
            for rel, raw in sorted(out.items())
        },
    }
    manifest_bytes = (json.dumps(snap_manifest, indent=2, sort_keys=True) + "\n").encode("utf-8")
    out["SNAPSHOT_MANIFEST.json"] = manifest_bytes
    (ws / "c07_oracle" / "SNAPSHOT_MANIFEST.json").write_bytes(manifest_bytes)
    return out


def build_verified_zip(ws: pathlib.Path, repo: pathlib.Path, out_zip: pathlib.Path) -> dict[str, object]:
    if not (ws / "c07_oracle" / "SNAPSHOT_MANIFEST.json").is_file():
        collect_git_snapshot_files(ws, COORDINATOR_CHECKPOINT)
    entries = collect_zip_files(ws, repo)
    manifest_lines: list[str] = []
    for rel, p in entries:
        raw = p.read_bytes()
        check_clean_text(rel, raw)
        manifest_lines.append(f"{sha256_bytes(raw)}  {rel}")
    manifest_bytes = ("\n".join(manifest_lines) + "\n").encode("utf-8")

    out_zip.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out_zip, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for rel, p in entries:
            zf.write(p, arcname=rel)
        zf.writestr("MANIFEST.sha256", manifest_bytes)

    with zipfile.ZipFile(out_zip, "r") as zf:
        bad = zf.testzip()
        if bad is not None:
            raise RuntimeError(f"ZIP CRC failed on member: {bad}")
        names = [i.filename for i in zf.infolist() if not i.is_dir()]
        assert "MANIFEST.sha256" in names
        parsed: dict[str, str] = {}
        for line in zf.read("MANIFEST.sha256").decode("utf-8").splitlines():
            if not line.strip():
                continue
            d, n = line.split(None, 1)
            parsed[n.lstrip("*")] = d
        assert set(names) - {"MANIFEST.sha256"} == set(parsed), "Manifest member set mismatch"
        for n, d in parsed.items():
            assert sha256_bytes(zf.read(n)) == d, f"Hash mismatch after write: {n}"

    with tempfile.TemporaryDirectory(prefix="c07_unpack_") as tmp_ext:
        with zipfile.ZipFile(out_zip, "r") as zf:
            zf.extractall(tmp_ext)
        ext_root = pathlib.Path(tmp_ext)
        for n, d in parsed.items():
            assert sha256_bytes((ext_root / n).read_bytes()) == d, f"Extracted hash mismatch: {n}"

    return {
        "zipPath": str(out_zip),
        "zipBytes": out_zip.stat().st_size,
        "zipSha256": sha256_bytes(out_zip.read_bytes()),
        "entryCount": len(entries) + 1,
        "manifestCount": len(parsed),
        "crc": "PASS",
        "cleanExtractionVerified": True,
    }


def git_run(repo: pathlib.Path, *args: str, env: dict[str, str] | None = None, stdin: bytes | None = None) -> bytes:
    git_exe = os.environ.get("GIT_EXE", "git")
    p = subprocess.run([git_exe, "-C", str(repo), *args], input=stdin, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
    if p.returncode != 0:
        raise RuntimeError(f"git {args[0]} failed (exit {p.returncode}): {p.stderr.decode('utf-8', errors='replace')}")
    return p.stdout


def push_isolated_snapshot(ws: pathlib.Path, repo: pathlib.Path) -> dict[str, object]:
    origin = git_run(repo, "remote", "get-url", "origin").decode("utf-8").strip().rstrip("/")
    if origin not in (REPO_URL, REPO_URL[:-4], "git@github.com:S2zxx0zxx/Railway-Ceo-.git"):
        raise RuntimeError(f"Unexpected origin remote: {origin}")

    ls_out = git_run(repo, "ls-remote", "origin", f"refs/heads/{BRANCH}", *PROTECTED_REFS.keys()).decode("utf-8")
    remote_refs = {ref: sha for sha, ref in (line.split() for line in ls_out.splitlines() if line.strip())}
    branch_ref = f"refs/heads/{BRANCH}"
    current_head = remote_refs.get(branch_ref) or ""
    if not current_head:
        raise RuntimeError(f"Missing remote branch {branch_ref}")
    for k, v in PROTECTED_REFS.items():
        if remote_refs.get(k) != v:
            raise RuntimeError(f"Protected ref {k} changed! Expected {v}, got {remote_refs.get(k)}")

    selected = collect_git_snapshot_files(ws, current_head)

    with tempfile.TemporaryDirectory(prefix="c07_git_idx_") as td:
        tmp_idx = pathlib.Path(td) / "index"
        env = os.environ.copy()
        env["GIT_INDEX_FILE"] = str(tmp_idx)
        git_run(repo, "fetch", "origin", BRANCH, env=env)
        git_run(repo, "read-tree", current_head, env=env)
        for rel, raw in sorted(selected.items()):
            dest = GIT_PREFIX + rel
            blob = git_run(repo, "hash-object", "-w", "--no-filters", "--stdin", stdin=raw, env=env).decode("utf-8").strip()
            expected_blob = hashlib.sha1(f"blob {len(raw)}\0".encode("utf-8") + raw).hexdigest()
            assert blob == expected_blob, f"Git blob mismatch on {rel}"
            git_run(repo, "update-index", "--add", "--cacheinfo", "100644", blob, dest, env=env)

        tree = git_run(repo, "write-tree", env=env).decode("utf-8").strip()
        commit = git_run(
            repo,
            "commit-tree",
            tree,
            "-p",
            current_head,
            "-m",
            "feat(railway): preserve verified C07 FIX-01 comparison evidence integrity snapshot",
            env=env,
        ).decode("utf-8").strip()

        changed = git_run(repo, "diff-tree", "--no-commit-id", "--name-only", "-r", current_head, commit).decode("utf-8").splitlines()
        expected_paths = {GIT_PREFIX + rel for rel in selected}
        if not set(changed).issubset(expected_paths):
            raise RuntimeError(f"Unexpected diff paths outside C07-FIX-01 snapshot: {set(changed) - expected_paths}")

        git_run(repo, "push", "origin", f"{commit}:{branch_ref}")
        git_run(repo, "merge", "--ff-only", commit)

    after_out = git_run(repo, "ls-remote", "origin", branch_ref, *PROTECTED_REFS.keys()).decode("utf-8")
    after_refs = {ref: sha for sha, ref in (line.split() for line in after_out.splitlines() if line.strip())}
    assert after_refs.get(branch_ref) == commit, "Remote push verification failed"
    for k, v in PROTECTED_REFS.items():
        assert after_refs.get(k) == v, f"Protected ref {k} altered post-push"

    for rel, raw in sorted(selected.items()):
        got = git_run(repo, "show", f"{commit}:{GIT_PREFIX}{rel}")
        assert got == raw, f"Post-push blob byte check failed for {rel}"

    return {
        "previousHead": current_head,
        "newCommitSha": commit,
        "snapshotPrefix": GIT_PREFIX,
        "snapshotFilesVerified": len(selected),
        "protectedRefsUnchanged": True,
        "postPushByteVerification": "100%",
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--workspace", type=pathlib.Path, default=pathlib.Path(__file__).resolve().parent)
    ap.add_argument("--out-zip", type=pathlib.Path, default=pathlib.Path.home() / "Downloads" / "RAILWAY_CEO_C07_FIX_01_VERIFICATION.zip")
    ap.add_argument("--repo", type=pathlib.Path, default=pathlib.Path(os.environ.get("RAILWAY_GIT_REPO", "C:/RailwayCEO-Git")))
    ap.add_argument("--push", action="store_true")
    ap.add_argument("--zip-only", action="store_true")
    args = ap.parse_args()

    ws = args.workspace.resolve()
    repo = args.repo.resolve()
    if args.zip_only:
        collect_git_snapshot_files(ws, COORDINATOR_CHECKPOINT)
        zip_info = build_verified_zip(ws, repo, args.out_zip.resolve())
        print(json.dumps({"zip": zip_info}, indent=2))
        return

    git_info = push_isolated_snapshot(ws, repo) if args.push else {"pushed": False}
    zip_info = build_verified_zip(ws, repo, args.out_zip.resolve())
    print(json.dumps({"zip": zip_info, "git": git_info}, indent=2))


if __name__ == "__main__":
    main()
