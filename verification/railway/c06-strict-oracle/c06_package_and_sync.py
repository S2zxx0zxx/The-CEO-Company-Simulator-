#!/usr/bin/env python3
"""Build verified C06 single-ZIP deliverable, re-verify from fresh temp extraction, and push isolated GitHub snapshot."""

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
EXPECTED_HEAD = "461efa45ea8a21a9b509c071e7df8fa3fa4f5b0d"
PROTECTED_REFS = {
    "refs/heads/main": "8268c8dcd6ef46fc35e300c14d8491bfbb3656e1",
    "refs/heads/feat/company-simulator-v3": "fefd995fd189506502ae59230b9ee9c408faa544",
}
GIT_PREFIX = "verification/railway/c06-strict-oracle/"
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


def check_clean_text(rel_path: str, raw: bytes) -> None:
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        return
    low = text.lower()
    for marker in FORBIDDEN_MARKERS:
        if marker in low:
            raise RuntimeError(f"Forbidden secret/host-path marker ({marker}) found in {rel_path}")


def collect_zip_files(ws: pathlib.Path) -> list[tuple[str, pathlib.Path]]:
    files: list[tuple[str, pathlib.Path]] = []

    def add_tree(sub: str, *, exclude_suffixes: tuple[str, ...] = ()) -> None:
        base = ws / sub
        if not base.exists():
            return
        for p in sorted(base.rglob("*")):
            if p.is_file():
                rel = p.relative_to(ws).as_posix()
                if "__pycache__" in rel or rel.endswith(exclude_suffixes):
                    continue
                files.append((rel, p))

    add_tree("src")
    add_tree("tests")
    add_tree("assets/fonts")
    add_tree("assets/sprites")
    add_tree("fixtures/c05_regions")
    add_tree("fixtures/c06_oracle")
    add_tree("c06_oracle/java/src")

    fixed_rel_files = [
        "c06_oracle/java/c06-strict-oracle.jar",
        "c06_oracle/import_metrics.json",
        "c06_oracle/c06_test_output.json",
        "fixtures/c02_synthetic_smoke.osm",
        "fixtures/c03_synthetic_scale_pack.json",
        "fixtures/c04_synthetic_basemap.osm",
        "fixtures/c04_synthetic_basemap.pmtiles",
        "fixtures/c04_synthetic_graph_bundle.json",
        "fixtures/c04_tile_build_manifest.json",
        "c04_tile_pipeline/railway_basemap_schema.yml",
        "C02_CIVILIAN_RAIL_EXTRACTION_POLICY.json",
        "C04_ASSET_LICENSE_MANIFEST.json",
        "c02_rail_prefilter.py",
        "c02_streaming_pipeline.py",
        "c02_downstream_adapter.py",
        "verify_downstream_graphpack.mjs",
        "test_c02_prefilter_synthetic.py",
        "test_c02_pipeline_synthetic.py",
        "c03_station_attachment.py",
        "c03_topology_builder.py",
        "test_c03_topology_and_stations.py",
        "test_c03_runtime_ts.mjs",
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
        "docs/C05_REGION_INSTALLATION_AND_PORTALS_ARCHITECTURE.md",
        "docs/C05_VERIFICATION_MATRIX.md",
        "docs/C06_STRICT_ORACLE_ARCHITECTURE.md",
        "docs/C06_VERIFICATION_MATRIX.md",
        "C05_TRACEABILITY_MATRIX.json",
        "C05_C08_READINESS_CHECKLIST.json",
        "C05_PERFORMANCE_BENCHMARK_REPORT.json",
        "C05_VERIFICATION_REPORT.json",
        "C05_FIX_01_VERIFICATION_REPORT.json",
        "C05_FIX_02_VERIFICATION_REPORT.json",
        "C06_TRACEABILITY_MATRIX.json",
        "C06_PERFORMANCE_BENCHMARK_REPORT.json",
        "C06_VERIFICATION_REPORT.json",
        "README.md",
        "EXECUTION_SUMMARY.md",
    ]
    for rel in fixed_rel_files:
        p = ws / rel
        if not p.is_file():
            raise FileNotFoundError(f"Required ZIP artifact missing: {rel}")
        files.append((rel, p))

    by_rel: dict[str, pathlib.Path] = {}
    for rel, p in files:
        by_rel[rel] = p
    return sorted(by_rel.items(), key=lambda x: x[0])


def build_verified_zip(ws: pathlib.Path, out_zip: pathlib.Path) -> dict[str, object]:
    entries = collect_zip_files(ws)
    manifest_lines: list[str] = []
    for rel, p in entries:
        raw = p.read_bytes()
        check_clean_text(rel, raw)
        digest = sha256_bytes(raw)
        manifest_lines.append(f"{digest}  {rel}")

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
        parsed_manifest: dict[str, str] = {}
        for line in zf.read("MANIFEST.sha256").decode("utf-8").splitlines():
            if not line.strip():
                continue
            d, n = line.split(None, 1)
            parsed_manifest[n.lstrip("*")] = d
        actual_non_manifest = set(names) - {"MANIFEST.sha256"}
        assert actual_non_manifest == set(parsed_manifest), "Manifest set mismatch"
        for n, d in parsed_manifest.items():
            assert sha256_bytes(zf.read(n)) == d, f"Hash mismatch after write: {n}"

    zip_bytes = out_zip.stat().st_size
    zip_sha = sha256_bytes(out_zip.read_bytes())
    return {
        "zipPath": str(out_zip),
        "zipBytes": zip_bytes,
        "zipSha256": zip_sha,
        "entryCount": len(entries) + 1,
        "manifestCount": len(parsed_manifest),
        "crc": "PASS",
    }


def collect_git_snapshot_files(ws: pathlib.Path) -> dict[str, bytes]:
    rels = [
        "src/rail/c06-oracle/contracts.ts",
        "src/rail/c06-oracle/validator.ts",
        "src/rail/c06-oracle/client.ts",
        "src/rail/c06-oracle/harness.ts",
        "src/rail/c06-oracle/index.ts",
        "c06_oracle/java/src/com/railwayceo/c06/StrictEnums.java",
        "c06_oracle/java/src/com/railwayceo/c06/StrictParsers.java",
        "c06_oracle/java/src/com/railwayceo/c06/StrictOracleRunner.java",
        "c06_oracle/import_metrics.json",
        "c06_oracle/c06_test_output.json",
        "fixtures/c06_oracle/c06_c02_metadata_audit.json",
        "fixtures/c06_oracle/c06_fixture_manifest.json",
        "fixtures/c06_oracle/c07_synthetic_calibration_template.json",
        "c06_fixture_builder.py",
        "test_c06_strict_oracle.mjs",
        "c06_package_and_sync.py",
        "docs/C06_STRICT_ORACLE_ARCHITECTURE.md",
        "docs/C06_VERIFICATION_MATRIX.md",
        "C06_TRACEABILITY_MATRIX.json",
        "C06_PERFORMANCE_BENCHMARK_REPORT.json",
        "C06_VERIFICATION_REPORT.json",
    ]
    out: dict[str, bytes] = {}
    for rel in rels:
        p = ws / rel
        raw = p.read_bytes()
        check_clean_text(rel, raw)
        out[rel] = raw

    snap_manifest = {
        "schemaVersion": 1,
        "task": "C06",
        "originalTask": "R16",
        "masterRequirement": "MR-005",
        "baseline": EXPECTED_HEAD,
        "openRailRoutingPin": "e5112194fde4cc8ec36e2b0093e250df89ef4845",
        "realPbfProcessed": False,
        "releaseAllowed": False,
        "scope": "Isolated C06 strict offline routing oracle synthetic preparation snapshot; leaves c04-*, c05-*, root runtime, PR #1 and main untouched.",
        "sourceFiles": {
            rel: {
                "bytes": len(raw),
                "sha256": sha256_bytes(raw),
                "gitBlobSha1": hashlib.sha1(f"blob {len(raw)}\0".encode("utf-8") + raw).hexdigest(),
            }
            for rel, raw in sorted(out.items())
        },
    }
    out["SNAPSHOT_MANIFEST.json"] = (json.dumps(snap_manifest, indent=2, sort_keys=True) + "\n").encode("utf-8")
    return out


def git_run(repo: pathlib.Path, *args: str, env: dict[str, str] | None = None, stdin: bytes | None = None) -> bytes:
    git_exe = os.environ.get("GIT_EXE", "git")
    p = subprocess.run([git_exe, "-C", str(repo), *args], input=stdin, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
    if p.returncode != 0:
        raise RuntimeError(f"git {args[0]} failed (exit {p.returncode}): {p.stderr.decode('utf-8', errors='replace')}")
    return p.stdout


def push_isolated_snapshot(ws: pathlib.Path, repo: pathlib.Path) -> dict[str, object]:
    selected = collect_git_snapshot_files(ws)
    origin = git_run(repo, "remote", "get-url", "origin").decode("utf-8").strip().rstrip("/")
    if origin not in (REPO_URL, REPO_URL[:-4], "git@github.com:S2zxx0zxx/Railway-Ceo-.git"):
        raise RuntimeError(f"Unexpected origin remote: {origin}")

    ls_out = git_run(repo, "ls-remote", "origin", f"refs/heads/{BRANCH}", *PROTECTED_REFS.keys()).decode("utf-8")
    remote_refs = {ref: sha for sha, ref in (line.split() for line in ls_out.splitlines() if line.strip())}
    branch_ref = f"refs/heads/{BRANCH}"
    if remote_refs.get(branch_ref) != EXPECTED_HEAD:
        raise RuntimeError(f"Remote {BRANCH} mismatch: expected {EXPECTED_HEAD}, got {remote_refs.get(branch_ref)}")
    for k, v in PROTECTED_REFS.items():
        if remote_refs.get(k) != v:
            raise RuntimeError(f"Protected ref {k} changed! Expected {v}, got {remote_refs.get(k)}")

    with tempfile.TemporaryDirectory(prefix="c06_git_idx_") as td:
        tmp_idx = pathlib.Path(td) / "index"
        env = os.environ.copy()
        env["GIT_INDEX_FILE"] = str(tmp_idx)
        git_run(repo, "fetch", "origin", BRANCH, env=env)
        git_run(repo, "read-tree", EXPECTED_HEAD, env=env)
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
            EXPECTED_HEAD,
            "-m",
            "chore(railway): preserve verified C06 strict offline routing oracle snapshot",
            env=env,
        ).decode("utf-8").strip()

        changed = git_run(repo, "diff-tree", "--no-commit-id", "--name-only", "-r", EXPECTED_HEAD, commit).decode("utf-8").splitlines()
        expected_paths = {GIT_PREFIX + rel for rel in selected}
        if set(changed) != expected_paths:
            raise RuntimeError(f"Unexpected diff paths: {set(changed) ^ expected_paths}")

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
        "previousHead": EXPECTED_HEAD,
        "newCommitSha": commit,
        "snapshotPrefix": GIT_PREFIX,
        "snapshotFilesVerified": len(selected),
        "protectedRefsUnchanged": True,
        "postPushByteVerification": "100%",
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--workspace", type=pathlib.Path, default=pathlib.Path(__file__).resolve().parent)
    ap.add_argument("--out-zip", type=pathlib.Path, default=pathlib.Path.home() / "Downloads" / "RAILWAY_CEO_C06_STRICT_ORACLE_VERIFICATION.zip")
    ap.add_argument("--repo", type=pathlib.Path, default=pathlib.Path(os.environ.get("RAILWAY_GIT_REPO", "C:/RailwayCEO-Git")))
    ap.add_argument("--push", action="store_true")
    args = ap.parse_args()

    zip_info = build_verified_zip(args.workspace.resolve(), args.out_zip.resolve())
    git_info = push_isolated_snapshot(args.workspace.resolve(), args.repo.resolve()) if args.push else {"pushed": False}
    print(json.dumps({"zip": zip_info, "git": git_info}, indent=2))


if __name__ == "__main__":
    main()
