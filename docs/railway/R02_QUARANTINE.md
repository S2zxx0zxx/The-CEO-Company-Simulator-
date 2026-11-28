# R02 — Quarantine and license register
Original V4 acceptance: "No proprietary assets, tokens or opaque binaries in product". Dependency R01 PASS. Scope is quarantine baseline and import policy, not final release legal clearance.
## Private evidence custody
Archive ebd171202005b8a680540c7f9add297298feb69ea11acc1b36f5c86c46b9f4ea CRC verified, 3059 non-directory files. V5 pack SHA256 ba177fb4ecbc7247696459e4794fec878adf2c0f0b6ebc07903339653376e41d, 23 screenshot hashes match private manifest. Original archive and screenshots stay outside product, no raw extraction to repo. Private per-file disposition register has 3059 entries and SHA256, retained in private checkpoint only.
| Evidence | Files | Disposition |
|---|---:|---|
| 01_apk_extracted | 1639 | REJECT_PRODUCT; inspect static evidence only |
| 02_resources | 1145 | REFERENCE_ONLY |
| 03_assets | 9 | REFERENCE_ONLY |
| 04_code | 111 | REFERENCE_ONLY |
| 07_extended_audit | 113 | REFERENCE_ONLY |
| 00_inventory | 4 | REFERENCE_ONLY |
| 05_agent_docs | 5 | REFERENCE_ONLY |
| 06_tools | 2 | private reference only |
| 08_priority_research | 10 | reference formulas and synthetic fixtures; independent implementation |
| 09_final_agent_handoff | 17 | private planning contracts |
| Root documents | 4 | REFERENCE_ONLY |
No target APK/DEX/SDK, artwork, fonts, names/logos, credentials, private endpoints, protected blobs or decompiled code imported. Do not execute unknown files or access private target services. 23 screenshots reference-only; original visual implementation later. Independently authored formulas and behavior may guide implementation, but no source copying without rights.
## Actual baseline audit
PR #2 parent 06fd7401ea110cff9c347e631260d378b1424d0c, complete GitHub recursive tree: 124 tracked blobs, mode 100644. Size prefilter against all 3059 archive entries and 23 screenshots: 35 tracked files have matching byte lengths; 81 evidence candidates share lengths. Exact Git blob SHA-1 comparison: zero matches. Other 89 files cannot be exact copies because lengths differ. This detects exact byte copies, not transformed assets or fragments. Reviewed existing gitignore, source audit, generated runtime licenses, legacy notices and asset provenance. Seven existing original SVGs recorded in ASSET_REGISTRY.json (owner final clearance pending). Existing ciefa elapsed helper MIT notice retained; no new upstream code. Existing pinned npm runtime dependencies continue previous license audit; R03 reviews new selection, R51 verifies final distribution. Prior R01 final commit CI four workflows passed.
## Enforcement
Railway-only branch adds a deny-by-default tracked-artifact scanner, asset content digest registry, self-tests and release audit workflow steps. Block quarantine directory names, known archive filenames, raw binaries/archives and secret-file paths; reject new or modified art without reviewed provenance. New dataset formats require separate audited policy in R04/R18; no arbitrary exceptions. Existing source audit covers high-signal secret patterns and literal external runtime calls. Scan findings are path/category only. No secrets or archive hashes of individual proprietary files published. Before each future task re-open private evidence, compare introduced files against private fingerprints where available, review source diff and record rights. Before release R51 inspect actual distribution and all notices; no claim of complete absence of transformed copying or secret leaks from heuristics.
## Status
R02 PASS — baseline quarantine acceptance verified; final release license clearance remains separate. No production resource adopted. 21 candidate rows in LICENSE_REGISTER.json retain supplied unverified license claims; R03/R04/R51 handle actual pins, obligations, data and package rights. Final brand/project license pending. No change to engine, UI, dependencies or legacy PR.

## First CI attempt
Tested 856696e run 45778511693 job 139767965875: 9/9 standalone tests; 129 tracked files, seven registered assets, zero quarantine findings; legacy secret heuristic zero findings, 12 runtime licenses collected, npm audit full/runtime zero reported vulnerabilities. Verify game 45778511702 job 139767965538 failed because Vitest discovered the standalone node:test .test.mjs (35 existing files and 134 tests passed; extra suite absent). Rename to .selftest.mjs and update CI path, rerun. No acceptance claimed before fix verification.

## Closure — 2026-11-26 IST
Corrected test-runner naming at 4a573b335766a055b11a41581a766d55770e5d65. Release audit 45778676512/job 139768506503: 9/9 tests, 129 tracked files, 7 registered assets, zero findings, 12 runtime license texts, full/runtime npm audit zero reported vulnerabilities. Verify game 45778676345/job 139768506260: typecheck, 35/35 files, 134/134 tests and production build PASS. Both checked synthetic PR merge bf453f4 of tested head into pinned legacy base. Android QA APK and unsigned AAB (45778676372): in_progress; Browser and offline smoke (45778676342): in_progress; Verify game (45778676345): completed / success; G08 save and worker acceptance (45778676384): in_progress; Release dependency and license audit (45778676512): completed / success. Pending checks are not declared passed. Acceptance: no exact-copy matches against private evidence at baseline, no new unapproved assets or opaque payloads, guards and current source audit successful. All 21 new resource candidates remain unapproved; R03 pin review and R51 actual final bundle/rights review remain mandatory. Heuristic scanning does not certify all secrets or transformed copies. Closure commit documentation only; cited CI applies to tested parent. Next START R03; no merge.
