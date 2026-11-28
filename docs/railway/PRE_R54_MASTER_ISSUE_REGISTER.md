# Railway CEO — PRE-R54 Master Issue Register (audit only)
**Snapshot:** e9c55d5aae93a39033893554aa8ee2a0021f1859 | PR #2 feat/railway-manager-v5, draft/open/unmerged, 138 commits, 237 changed files versus protected PR1. PR1 fefd995fd189506502ae59230b9ee9c408faa544; main 8268c8dcd6ef46fc35e300c14d8491bfbb3656e1. **R54 HOLD; no remediation authorized until owner says FIX IT.** This file is the central issue register and future execution authority for the remediation phase, subordinate to immutable plan and latest owner scope. Not owner release approval. No code fix, production signing, publishing, merge, new raw geography or proprietary material in this audit.

## Method and confidence
- Actual immutable archives reopened: V4 SHA256 ebd171202005b8a680540c7f9add297298feb69ea11acc1b36f5c86c46b9f4ea (3059 regular members), V5 ba177fb4ecbc7247696459e4794fec878adf2c0f0b6ebc07903339653376e41d (15 regular members); both CRC pass. V4 task CSV matches V5 aa768a3f7e6c5d57ca6334e5a59ec4850d15d136f27ab687e5a0b681a09422b3, GP 34481b87632ad0fb48efe0ec457e1078443d73be20072dd7962ef0dbcc98063b, E d634a4f5a3e3bb8d0787365d4ff2318cf624171eda9e957f79c1fe7de8c78a87. All 54 original R tasks mapped; R00 is preflight only, not added to original ledger; R54 not executed.
- Reviewed actual repository comparison inventory (237 changed paths), full working execution/deferred/resource registers, V5 plan and original 35 GP / 28 E / 23 UI / 21 candidate rows. Targeted current source reads in canonical schemas, graph/compatibility/routing/quotes/catalog, all ten economy modules, aggregate dispatch/scheduler/movement/offline/persistence/guest and UI/build/rights/security interfaces, previous report evidence and latest CI. This is a system/contract reconciliation and targeted static review, not exhaustive line-by-line proof of every changed file, independent full test rerun or proof no hidden bugs. Unreproduced hypotheses explicitly marked RISK_REQUIRES_REPRODUCTION. A missing approved input is not a bug; intentional deferral is not a defect. Do not infer a bug from absence of TODO markers.
- Status snapshot: 14 PASS, 22 IMPLEMENTED_UNVERIFIED, 9 BLOCKED (R13 plus eight partial R45 R46 R47 R49 R50 R51 R52 R53), 8 NOT_STARTED within R01–R53; plus R54 NOT_STARTED. 44/54 full/partial reached, only 14/54 fully accepted. Working DV 88 rows, 44 open and 44 historical closed at audited HEAD. This register does not silently rewrite or close those source rows. 60 remediation/verification/scope groups (not 60 distinct reproduced bugs): {"P0":26,"P1":31,"P2":3}. Existing DV rows overlap these groups; do not add counts as distinct bugs.
- P0 release/core correctness, P1 high integration/quality/approval, P2 process or scoped risk. Priority proposed by system audit, not owner-approved calibration; prerequisite graph takes precedence over numbering.

## Fresh observed CI and artifacts
- R52 hardened cfe9d0af8e129e9ef3889a2fa59e785fb338375a exact 19/19 success; actual browser 45887337233 and native retry 45887337159 job 140143267986 PASS merged manifest, notices, lifecycle, native Back. R52 prior HTTP429 remains historical. R53 executable 7946cc1ea2fa5bd1e372016529dd1cf93dd5d16a exact 19/20 success; R50 stress 45888075257 timed out 900000ms. Audited docs-only HEAD e9c55d5aae93a39033893554aa8ee2a0021f1859 exact 20/20 success, Verify 45888384442 job 140144686404 1566/1566 across 72 suites; stress 45888384265 passed 5/5 incl 10000 scheduler events 8351.078ms. Docs-only compare from executable shows five docs changed, not a performance fix. Multiple intermittent failures 45884553941/45887252664/45888075257 remain actionable; no false 10000-train claim.
- Actual R53 QA web 45888075642 job 140143659927: two byte-identical same-runner builds per shell, independently downloaded artifact 15149269572 verified 4/4 manifest and 32/32 inner file hashes. Development ZIP SHA256 1b2c8793af261648daa7db498280f296a32fc0b74958103dc11b20d794377c4f, guest QA ZIP 785ea045e0b209d5a25cf1957112467a3f7e997aadfe7bd2f581be7b1f717249. Latest repeat 45888384468 web hashes identical.
- Actual native R53 45888075642 job 140143660652 PASS debug signature, unsigned AAB, exact 19 public files each, QA manifest/permissions, R51 61 components/53 artifacts, R52 native boundaries and R47/R49 emulator. Downloaded artifact 15150218468 independently matched provider SHA256 03dff22383c75e5c8d1f146c94722e6e03b10034294677a4f503b7bd60edf527; outer CRC PASS, 13/13 manifest entries match, both inner CRCs PASS, all 38/38 public payload hashes independently match and 17/17 PWA files identical in each native archive (SW deliberately excluded; two Cordova bridge files). APK 4621973 bytes SHA256 97444c75cb0c1b4312ca14707591d058cb8e02b3068607b54271ee5eb75d0c08; AAB 3406098 bytes SHA256 1d2b5bd93baf7024d47bb7873c2b6309877df481bd076551898456cd2ca0ccd1. Source synthetic merge 617c3285e89a4c61f4102819190a8cb7be0a8234 zero changed files versus executable head. QA app ID app.railway.qa.r47, version 1/1.0, target SDK36, min24; APK CI apksigner v2 PASS Android Debug cert SHA256 95855f7042fef74fba65790fbdfdb2fca40fbeec6f9d4da848a74b658469df65. Latest 45888384468 job 140144686510 QA AAB same SHA, APK differs d2498d07fcc42a9c141f023726bc99cb3682a25d5532b953efdf48037198d102; do not claim APK bit reproducibility or signer continuity. Latest repeat artifact 15149704842 provider log only, not independently downloaded here. Empty error.json in downloaded native archive is shell redirection artifact, not a recorded runtime error.
- DV-084 and DV-087 executable-only evidence now eligible for reconciliation on remediation, full scope DV-085/088 still blocked. DV-086 remains open. All previous DV rows and original failures retained.
- Artifact links: https://github.com/S2zxx0zxx/Railway-Ceo-/actions/runs/45888384442 ; https://github.com/S2zxx0zxx/Railway-Ceo-/actions/runs/45888384265 ; https://github.com/S2zxx0zxx/Railway-Ceo-/actions/runs/45888075257 ; https://github.com/S2zxx0zxx/Railway-Ceo-/actions/runs/45888075642/artifacts/15150218468 ; https://github.com/S2zxx0zxx/Railway-Ceo-/actions/runs/45888384468 .

## Full R00–R53 crosswalk
| ID | Original task title (compact) | Working status at audit | Issue IDs |
|---|---|---|---|
| R00 | Preflight (not an immutable task) | AUDIT_PREFLIGHT | MR-054 MR-053 MR-001 |
| R01 | Baseline repo and approved scope | PASS | MR-053 MR-054 MR-001 |
| R02 | Quarantine APK and license register | PASS | MR-035 MR-047 |
| R03 | Pin references and dependencies | PASS | MR-049 MR-047 MR-048 |
| R04 | Data provenance and regional scope | PASS | MR-002 MR-007 MR-047 |
| R05 | Map existing product modules and QA | PASS | MR-001 MR-043 MR-056 |
| R06 | Canonical units and schemas | PASS | MR-039 MR-056 |
| R07 | Deterministic graph primitives | PASS | MR-004 MR-009 |
| R08 | Compatibility and turn rules | PASS | MR-004 MR-005 MR-006 |
| R09 | Routing worker algorithm | PASS | MR-006 MR-017 MR-044 |
| R10 | Route and trip quote contract | PASS | MR-014 MR-017 MR-030 MR-039 |
| R11 | Synthetic fixture suite | PASS | MR-004 MR-006 MR-056 |
| R12 | Rolling stock catalog schema | PASS | MR-029 MR-035 MR-057 |
| R13 | Acquire dated real regional PBF | BLOCKED | MR-002 |
| R14 | Extract rail data and references | NOT_STARTED | MR-003 |
| R15 | Normalize stations and track topology | NOT_STARTED | MR-004 |
| R16 | Build OpenRailRouting oracle | NOT_STARTED | MR-005 |
| R17 | Real route comparison suite | NOT_STARTED | MR-006 |
| R18 | Build map tiles | NOT_STARTED | MR-007 |
| R19 | Offline region loader and portals | NOT_STARTED | MR-008 |
| R20 | Real data and map benchmark gate | NOT_STARTED | MR-009 |
| R21 | Demand and market share E01–03 | IMPLEMENTED_UNVERIFIED | MR-019 MR-033 |
| R22 | Fare and ticket/cargo revenue E04–07 | IMPLEMENTED_UNVERIFIED | MR-018 MR-020 |
| R23 | Energy E08–10 | IMPLEMENTED_UNVERIFIED | MR-021 MR-031 |
| R24 | Spot market E11 | IMPLEMENTED_UNVERIFIED | MR-022 |
| R25 | Access payroll wear E12–14 | IMPLEMENTED_UNVERIFIED | MR-023 MR-026 |
| R26 | Maintenance depreciation E15–16 | IMPLEMENTED_UNVERIFIED | MR-023 MR-028 |
| R27 | Subsidy fares marketing E17–19 | IMPLEMENTED_UNVERIFIED | MR-024 MR-019 |
| R28 | Loans liquidity E20–21 | IMPLEMENTED_UNVERIFIED | MR-025 MR-017 |
| R29 | Double entry settlement E22–23 | IMPLEMENTED_UNVERIFIED | MR-026 MR-013 MR-028 |
| R30 | Inflation ROI equity E24–26 | IMPLEMENTED_UNVERIFIED | MR-027 |
| R31 | Progression insolvency E27–28 | IMPLEMENTED_UNVERIFIED | MR-028 MR-033 MR-034 |
| R32 | Deterministic event scheduler | PASS | MR-011 MR-015 MR-026 MR-044 |
| R33 | Train movement capacity | PASS | MR-011 MR-031 MR-032 MR-060 |
| R34 | Dispatch reservations | IMPLEMENTED_UNVERIFIED | MR-013 MR-014 MR-017 MR-019 |
| R35 | Settlement cancellation | IMPLEMENTED_UNVERIFIED | MR-020 MR-021 MR-026 MR-028 MR-060 |
| R36 | Service parking relocation | IMPLEMENTED_UNVERIFIED | MR-023 MR-029 MR-030 |
| R37 | ALTRIOS calibration | IMPLEMENTED_UNVERIFIED | MR-031 |
| R38 | OSRD timetable validation | IMPLEMENTED_UNVERIFIED | MR-032 |
| R39 | Persistence migration | IMPLEMENTED_UNVERIFIED | MR-013 MR-038 MR-039 MR-040 MR-041 |
| R40 | Offline catch-up replay | IMPLEMENTED_UNVERIFIED | MR-011 MR-015 MR-016 MR-044 |
| R41 | Economy balance lab | IMPLEMENTED_UNVERIFIED | MR-012 MR-019 MR-033 |
| R42 | Map UI region manager | NOT_STARTED | MR-010 MR-017 MR-060 |
| R43 | Fleet dispatch route UI | IMPLEMENTED_UNVERIFIED | MR-017 MR-018 MR-029 MR-030 MR-037 |
| R44 | Finance energy company UI | IMPLEMENTED_UNVERIFIED | MR-022 MR-023 MR-025 MR-026 MR-027 MR-028 MR-037 |
| R45 | Progression/events | BLOCKED | MR-034 MR-037 MR-046 MR-057 |
| R46 | Independent art/catalog | BLOCKED | MR-029 MR-035 MR-047 |
| R47 | Guest Android PWA | BLOCKED | MR-001 MR-015 MR-036 MR-038 MR-039 MR-042 MR-045 MR-059 |
| R48 | Optional ads/billing/social | IMPLEMENTED_UNVERIFIED | MR-046 MR-057 |
| R49 | Cross-platform QA | BLOCKED | MR-037 MR-042 MR-043 MR-044 MR-052 MR-055 |
| R50 | Regression/stress | BLOCKED | MR-011 MR-012 MR-013 MR-033 MR-043 MR-056 |
| R51 | Data/license review | BLOCKED | MR-047 MR-048 MR-049 |
| R52 | Security/privacy/save | BLOCKED | MR-038 MR-040 MR-041 MR-045 MR-046 MR-052 MR-059 |
| R53 | Reproducible builds/device install | BLOCKED | MR-050 MR-051 MR-058 MR-042 MR-052 |
R54 NOT_STARTED / HOLD until remediation acceptance and explicit owner command. The table tracks all original task IDs, not implied PASS for partial contracts.

## Gates G0–G6
| Gate | Current disposition | Acceptance remaining |
|---|---|---|
| G0 | R01–05 accepted planning/foundation only | Preserve protected refs; private evidence, source rights and local repeat (MR-002/047/049/053) |
| G1 | R06–12 accepted synthetic only | Keep strict validation; real topology/worker/quote/catalog integration and lifecycle limits (MR-004/014/017/029/044) |
| G2 | BLOCKED | R13 acquisition then R14–20; real comparison/map/device budgets (MR-002–009) |
| G3 | PROVISIONAL | All E01–28 production policy and cross-book acceptance (MR-018–028/033) |
| G4 | PROVISIONAL | Deterministic core available; lifecycle, durable archive, actual calibration and approved balance (MR-011–016/019–034/038–044/060) |
| G5 | BLOCKED | R42 plus production root/onboarding, all UI actions, original artwork and physical full loop (MR-001/010/017/029–046/055) |
| G6 | BLOCKED | Actual stress, full rights/security, final identity and signed release on physical device (MR-011/012/042/045/047–058); R54 owner approval not given |

## Consolidated issue groups (60)
### MR-001 — P0 — CONFIRMED_SCOPE_GAP
- Tasks: R01 R05 R47 R53
- Evidence: railway-app/main.tsx:5; GuestShell.tsx:24,50; R53 report
- Finding: Actual development entry renders RailwayGuestShell without a session; production create/resume unavailable. QA fixtures are not a production scenario.
- Acceptance: Approve real scenario and build production composition root from reviewed graph/catalog/policy; start/resume guest in production bundle, no QA globals/fixtures, full dispatch-to-settlement test.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-002 — P0 — OWNER_INPUT_BLOCK
- Tasks: R04 R13
- Evidence: DV-002/003/023/025; R13_RAW_DATASET_MANIFEST.json
- Finding: PBF reported 247546068 bytes and sidecar MD5 2bd5e0db4194c3aa127814f96975a50d but actual PBF byte hash, header and full parser not verified; private approved processing location not confirmed.
- Acceptance: In approved India workspace where required, compute matching MD5 + SHA256, verify dated source/header, pin Osmium v1.19.0 package/binary and full fileinfo; rights and precision/sensitive-attribute review.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-003 — P0 — NOT_STARTED
- Tasks: R14
- Evidence: V4 R14; ledger
- Finding: No actual extraction/member reference report.
- Acceptance: Extract railway ways/nodes/relations from verified PBF; all required refs resolve or explicit quarantine, record hashes/counts.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-004 — P0 — NOT_STARTED
- Tasks: R15
- Evidence: V4 R15; R07/R08 synthetic only
- Finding: No real topology, true station attachments, bridge/tunnel/parallel/gauge/electrification/turn normalization.
- Acceptance: Versioned directed multigraph, zero known false joins, unknown-tag coverage and manual validation; no nearest-node fabricated links.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-005 — P0 — NOT_STARTED
- Tasks: R16
- Evidence: V4 R16; B03 register
- Finding: Pinned OpenRailRouting candidate not actually built/configured for strict equivalent profile.
- Acceptance: Build pinned oracle and dependencies; verify unknown/DC distinction and no permissive bypass; report exact executable evidence.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-006 — P0 — NOT_STARTED
- Tasks: R17
- Evidence: V4 R17; DV-017/018
- Finding: No 100+ actual curated comparisons or discrepancy record.
- Acceptance: At least 100 real positive/negative route comparisons with exact profiles, discrepancy adjudication, no accepted incompatible paths.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-007 — P0 — NOT_STARTED
- Tasks: R18
- Evidence: V4 R18; B05/B06/B07; DV-082
- Finding: No graph-version-aligned tiles, glyphs/sprites, offline boundary layer or data rights.
- Acceptance: Pinned build tools, tile/graph parity, approved India political layer, ODbL notices and independently licensed assets; hash inventory.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-008 — P0 — NOT_STARTED
- Tasks: R19
- Evidence: V4 R19; DV-078
- Finding: No atomic region loader, disk preflight, portals, active graph version retention, corruption or interrupted install recovery.
- Acceptance: Hash/signature verification, atomic activation/rollback, boundary seam checks and active-trip graph pinning on actual data.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-009 — P0 — NOT_STARTED
- Tasks: R20
- Evidence: V5 §4; DV-080
- Finding: No real geographic/device benchmarks; target <=50MB graph, p95 route <=300ms, map >=30FPS, incremental memory <=150MB unmeasured.
- Acceptance: Measure actual approved pilot on recorded midrange Android; report refs, counts, memory, route p95, FPS, unknown tags and scope; optimize if misses.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-010 — P0 — NOT_STARTED
- Tasks: R42
- Evidence: V5 §4/6; R49_QA_MATRIX UI05/06/07/08/12; DV-018
- Finding: No real interactive India map, supported region manager, route preview, active train positions/locate, detail toggle or map HUD.
- Acceptance: Integrate one authoritative graph/movement state with MapLibre or reviewed renderer; offline pack, pan/pinch, focus, route colors, terrain/detail, unsupported region disclosure and physical QA.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-011 — P0 — CONFIRMED_PERFORMANCE_FAILURE
- Tasks: R32 R33 R34 R35 R39 R40 R50
- Evidence: 45888075257 job 140143658048 timeout 900000ms; DV-086; 45888384265 later PASS; dispatch/index.ts:728-744; persistence/index.ts:250
- Finding: Fleet stress intermittently times out. 32 trains previously 251.8–391.8s total; event scheduler 10000 took 7–123s on different runs. Repeated snapshot validation, accounting replay and boundary syncing are profiling candidates, not proven sole root cause.
- Acceptance: Instrument phases and CPU/heap profiles; optimize without changing canonical checksums, command idempotency or boundary ordering; repeated same-runner and actual-device p50/p95/backlog results, no increased timeout masking failure.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-012 — P0 — MISSING_ACCEPTANCE_COVERAGE
- Tasks: R41 R50 R53
- Evidence: V5 §5; tools/stress/railway-stress.ts; tests/railway-r50.test.ts; 45888075257
- Finding: Original plan specifies 100/1000/10000-train stress at 1x and offline; actual aggregate fleet only 8/16/32, 10000 scheduler events is not trains. Thermal/battery and production device capacity absent.
- Acceptance: Stage 100 then 1000 then 10000 actual trains or explicit owner-approved revised scope with measured capacity, exact replay and no backlog loss; realistic device and policy budgets; no claims from event count.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-013 — P0 — CONFIRMED_LIFETIME_LIMIT
- Tasks: R29 R34 R39 R40
- Evidence: DV-007/009; persistence/index.ts:203-250; offline/lifecycle.ts:36-49
- Finding: Every new request (including catchup) appends journal; at maxJournalEntries or size rejects. Export alone cannot clear cap. Domain histories and receipts also bounded; no reconciled archive/checkpoint pipeline.
- Acceptance: Design versioned lossless checkpoint/archives retaining replay IDs and claim/financial invariants. Prove >50000 entries, cap transition, old retries and payload conflict, migration, crash during checkpoint and restores; no silent truncation.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-014 — P0 — CONFIRMED_LIFETIME_LIMIT
- Tasks: R10 R34 R39 R43
- Evidence: dispatch/index.ts:598-599,757-773
- Finding: Issued quote registry rejects when issued.size>=maxQuotes; no expiry reclamation/checkpoint observed in current controller. Repeated previews can eventually exhaust registry; preserve consumed quote identity.
- Acceptance: Expire/prune only provably unconsumed stale offers or archive with durable receipt linkage, preserve old replay/conflict; test repeated previews beyond capacity and no mutation on rejection.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-015 — P0 — SOURCE_CONFIRMED_WIRING_GAP
- Tasks: R32 R33 R40 R42 R47
- Evidence: offline/lifecycle.ts:53-69; GuestShell.tsx:29-32,39-44
- Finding: Host binds visibility/pagehide/pageshow/native changes and manual wake; no foreground heartbeat wired in production/QA guest shell. Staying on screen may leave simulation clock unchanged until wake; dynamic trip display not integrated.
- Acceptance: Add bounded coalesced foreground heartbeat and independent render interpolation; same sampler, no background service, no concurrent duplicate wake, long active play and pause/resume replay parity; prove via fake-clock and real-device test.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-016 — P1 — RISK_REQUIRES_REPRODUCTION
- Tasks: R40 R47 R49
- Evidence: offline/lifecycle.ts:36-69; GuestShell.tsx:29-44
- Finding: Each wake queues a serialized job; multiple browser/native lifecycle signals may pile up. QA worker timeout 60s can be smaller than observed large fleet batches. UI sections only render while ready and remount on pending backlog.
- Acceptance: Reproduce burst wake and worker timeout/unknown commit, measure bounded queued work, coalesce without losing wall watermark; preserve stable screen, safe retry/reopen and cancel semantics.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-017 — P0 — MISSING_INTEGRATION
- Tasks: R09 R10 R28 R34 R42 R43
- Evidence: DV-017/018/048/066; FleetScreen.tsx:119-123
- Finding: Routing core and configured templates exist; arbitrary durable route creation/edit/name/color/stops/track alternatives/licence fee not wired, no map-worker production path.
- Acceptance: Real route draft and atomic create/edit/delete with immutable quoted costs, compatibility checks, stale cancellation, no negative cash; valid stops/direct and alternate rankings time/demand/cost/subsidy.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-018 — P1 — MISSING_INTEGRATION
- Tasks: R22 R27 R43
- Evidence: DV-066; UI-10; R43 report
- Finding: Fare classes, inspector/fine and auto-set policy domain exist in part; actual durable edit UI and authority missing.
- Acceptance: Validated fare/inspection settings with preview, atomic commit and new quote version; seeded inspection results, capped collected fines and no mutation of in-flight terms.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-019 — P0 — MISSING_BALANCE_AND_INTEGRATION
- Tasks: R21 R27 R34 R41
- Evidence: DV-026/038/048/064; R29_SOURCE_RECONCILIATION; V5 §5
- Finding: Finite initial OD stock, no approved recurring replenishment/competing services/dispatch-gap effects or calibrated elasticity and demand event rates.
- Acceptance: Approve profiles and replenishment/season/quality/late departure rules; authoritative periodic inventory updates and marketing, conserve across trains/segments, long horizons with no infinite demand.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-020 — P0 — PARTIAL_CONTRACT
- Tasks: R22 R35
- Evidence: DV-028/051; revenue.ts:91; R29_SOURCE_RECONCILIATION
- Finding: Whole-trip terminal revenue and cancellation only; partial delivered OD cancellation rejected; multi-leg cargo/transfer/refund/replan contract incomplete.
- Acceptance: Approve policy; conserve delivered/undelivered seats and consignments, partial delivery and refunds/fines with one payout, replay interruption and rollback; tests for each leg.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-021 — P0 — CALIBRATION_AND_LIFECYCLE_GAP
- Tasks: R23 R33 R35 R37 R41
- Evidence: DV-030/051/055; energy.ts; R37 report
- Finding: Nominal distance/idle/grade/load models and reserved lots exist; actual calibrated per-segment consumption and in-flight disruption/replan missing.
- Acceptance: Approved mixed traction/load/grade holdouts, segment cost and locked lot reconciliation, cancellations use actual prefix and partial deliveries; no negative stock or duplicate debits.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-022 — P1 — POLICY_GAP
- Tasks: R24 R44
- Evidence: DV-032/068; R29_SOURCE_RECONCILIATION
- Finding: Spot/locked contract quantities implemented; prepaid commitment vs stock draw policy needs approval, capacity upgrades and consultant absent.
- Acceptance: Choose precise prepaid/commitment semantics; immutable active prices, bounded seeded chart and expiry; approved tank/electric capacity purchase and consultant authority with ledger.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-023 — P1 — POLICY_GAP
- Tasks: R25 R26 R36 R44
- Evidence: DV-034/036/054/068
- Finding: Access/terminal/payroll/wear, maintenance/depreciation cores present; real crew assignments, schedule, staff hiring/firing, service/depot costs and disposal end-to-end absent or provisional.
- Acceptance: Approve actual track class/crew policy and authority, test no duplicate payroll, maintenance lock/completion and book value/resale with durable UI.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-024 — P1 — POLICY_GAP
- Tasks: R27 R35 R41
- Evidence: DV-038/064; incentives.ts
- Finding: Subsidy eligibility and caps, inspections, campaign functions exist; approval of rates, ongoing actual marketing/demand integration and eligibility windows incomplete.
- Acceptance: Scenario-specific route grant/budget, inspection and campaign costs/lift/expiry, no repeat claims/fines; prove authoritative settlement and multi-service competition.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-025 — P1 — PARTIAL_CONTRACT
- Tasks: R28 R29 R44
- Evidence: DV-040/068; liquidity.ts
- Finding: Explicit simple noncompounding debt model/credit reserves, repayment/rescue/refinance present; ordinary loan offers, lender policy and amortization approval missing.
- Acceptance: Approve repayment/rounding/credit policy; durable ordinary loan offer, maturity/default and cost-overrun behavior; balanced journal and insufficient-cash rejection.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-026 — P0 — ACCOUNTING_ACCEPTANCE_GAP
- Tasks: R29 R32 R35
- Evidence: DV-006/008; accounting.ts:362; R29 source review
- Finding: Half-open periods and scheduled boundary tests exist, but final tax policy, complete accounting/order reconciliation and legacy tax risk not resolved.
- Acceptance: Approve tax included/excluded scope; boundary-first same-time interest/payroll/arrival/liquidation and reversals; report earned vs operating vs accounting profit, cash flow/equity; no legacy mutation.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-027 — P1 — UNCONNECTED_DOMAIN
- Tasks: R30 R44 R45
- Evidence: company.ts exports; dispatch/index.ts:699; DV-068
- Finding: Regional inflation, expansion ROI and fictional stock functions exist but aggregate valuation calls shares:null,stock:null. No real authority for IPO, share issuance/trading, dilution or expansion acquisition.
- Acceptance: Wire policy-versioned company domain into authoritative durable transaction and scheduler; approve offline fictional NPC market, dilution, costs and ROI loss; no real securities or fake online rank.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-028 — P0 — PARTIAL_RECOVERY_AUTHORITY
- Tasks: R31 R35 R36 R44
- Evidence: DV-008/051/068; governance.ts:168+; dispatch finance action registry
- Finding: Domain has liquidation/restart authority; aggregate/UI only rescue/refinance subset, no complete controlled disposal/payables/new company archive flow.
- Acceptance: Atomic liquidation with active trips reconciled, sold assets/stock/proceeds, payable rules, explicit restart archive with no money creation; verify boundary and stale commands across crash/reload.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-029 — P1 — MISSING_ACQUISITION
- Tasks: R12 R36 R43 R46
- Evidence: DV-054/066/072; FleetScreen.tsx:136; CatalogPanel.tsx:24
- Finding: No approved starter roster or train/base purchase/sale/customization/freight upgrade and purchased-yard authority. Existing preowned fixture is not acquisition.
- Acceptance: Catalog with verified real or explicitly fictional stats and rights; initial budget/base/difficulty/starter, atomic order/sale/upgrade/yard expansion, valid relocation only to owned bases.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-030 — P1 — POLICY_GAP
- Tasks: R10 R36 R43
- Evidence: DV-054; GP-032/033
- Finding: Circle-line relocation and modifications applying to existing routes not final; active trip frozen terms vs future edits needs explicit authority.
- Acceptance: Approve circle-line and modification rules; prevent teleport, invalid route edit and active trip changes; test compatible/incompatible modifications.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-031 — P1 — EXTERNAL_CALIBRATION_BLOCK
- Tasks: R23 R33 R37
- Evidence: DV-055; 45869120505; R37 report
- Finding: ALTRIOS Rust 104 passed/1 ignored, wheel built; upstream Python 10 pass/1 missing Kokam_NMC_75Ah.xlsx; actual demo/holdout unavailable.
- Acceptance: Resolve exact pinned resource packaging/license, rerun official tests/demo, independently approved traction fixtures and holdouts; proposed median <=15%, p95 <=30% or approved deviation.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-032 — P1 — PARTIAL_EXTERNAL_CALIBRATION
- Tasks: R33 R38
- Evidence: DV-057; 45864116665; R38 report
- Finding: Native OSRD duration comparison median 3.163266%, 0 false negatives and 3 false positives on 18 probes; spatial/profile/routing and Indian independent calibration incomplete.
- Acceptance: Matched independent Indian RailJSON and conflict probes; analyze all discrepancies/false positives, no known incompatible accepted; review optional SUMO only if needed.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-033 — P0 — MISSING_PRODUCTION_BALANCE
- Tasks: R21-R31 R35 R40 R41
- Evidence: DV-064; V5 §5; R41 200 runs/1560 audits
- Finding: One unapproved synthetic profile, same-model fleet, finite demand/stock; no Easy/Realism approved parameters, tutorial profitability or actual recurring economy.
- Acceptance: Approve difficulty/scenario and thresholds; run 100 seeds for each 30d and 90d per approved difficulty, actual diverse models/region, bankroll/ROI/first-profit/bankruptcy distributions and invariant checks.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-034 — P1 — MISSING_PROGRESSION
- Tasks: R31 R32 R45
- Evidence: DV-070; ProgressionScreen.tsx:22-24
- Finding: One-time recognition and event expiry implemented, but rewards, event economic effects, simulated rival ranks and speed boosts not wired.
- Acceptance: Approved earned-only rewards, deterministic rivals with clear simulated label, scoped event demand/effects and expiry, bounded boost policy or explicit owner deferral; no double claim.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-035 — P1 — MISSING_VISUAL_RIGHTS_AND_UI
- Tasks: R12 R46 R47 R49 R51
- Evidence: DV-072; R46_ART_REVIEW.json; CatalogPanel.tsx:24; V5 §6
- Finding: Generic draft artwork, 7 legacy assets pending owner; final 15–20 proposed models, original branding, visual tokens and map overlay layout not accepted.
- Acceptance: Approved independent original/authorized asset manifest with hashes/license/dimensions and optimized formats; 23 screen comparison plus unseen tabs, proper touch sizes and no reference asset reuse.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-036 — P1 — MISSING_ONBOARDING
- Tasks: R12 R31 R43 R47
- Evidence: UI-01/02/03/04; DV-066/074
- Finding: No actual company name/base/difficulty and compatible electric/diesel starter selection, map tutorial or supported-region disclosure.
- Acceptance: End-to-end validated new guest flow, realistic initial budget/positive-margin tutorial route, no mandatory login, language/help and error states.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-037 — P1 — MISSING_UI_SURFACES
- Tasks: R42 R43 R44 R45 R47
- Evidence: V5 §6; R49_QA_MATRIX.json; DV-066/068/070/074
- Finding: All 23 screens partial/blocked; unseen shop, staff, marketing, service detail, post-IPO, notifications/help/settings not independently completed. Existing UI is card-oriented QA, no main map overlays.
- Acceptance: Track every original screen plus unseen tabs, actual action/disabled reason, responsive safe insets, back/scroll/keyboard/empty/error/offline; owner visual approval and actual screenshot QA.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-038 — P1 — POLICY_OR_OWNER_SCOPE
- Tasks: R39 R47 R49 R52
- Evidence: DV-060/074/078/085; V5 §5
- Finding: Recovery same installation/current head only; portable checksum/transfer policy and authenticated new-device recovery not accepted. Full DB rollback/same-origin compromise outside threat model.
- Acceptance: Explicit owner decision for device-bound vs portable. If portable required, authenticated key transfer/archive, no rollback or duplicate reward, migration and real two-device proof. Disclose limits; no false encryption/anti-cheat.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-039 — P0 — SOURCE_CONFIRMED_MIGRATION_GAP
- Tasks: R10 R39 R47 R53
- Evidence: persistence/index.ts:103-109,151-160; dispatch/index.ts:172; DV-060
- Finding: Save configuration hash binds graph/catalog/governance/lifecycle/limits; schema v1-to-v2 migration exists, but approved graph/catalog/policy/version upgrade path absent. Changed config can make existing legitimate save reject.
- Acceptance: Versioned compatible scenario migration retaining active-trip pinned graph/prices and receipts; rollback-safe upgrade, keep original backup, explicit incompatible error; no silent replacement.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-040 — P1 — RISK_REQUIRES_REPRODUCTION
- Tasks: R39 R52
- Evidence: persistence/index.ts:24,52-65; persistence/import.ts
- Finding: Outer recovery file cap 64MB equals maximum inner payload cap; JSON escaping/envelope overhead can make an otherwise accepted near-limit save impossible to import. Current QA small payloads do not exercise this.
- Acceptance: Test boundary payloads with multibyte/escaped content and full envelope byte size; consistent export/import limits or streamed bounded format; no size-limit weakening.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-041 — P1 — RISK_REQUIRES_REPRODUCTION
- Tasks: R39 R52
- Evidence: persistence/index.ts:125-133,254-264
- Finding: CAS checks head/slots and existence of key but not replacement identity across concurrent key corruption. Same-origin compromise explicitly out of scope; accidental key lifecycle/race still worth fail-closed verification.
- Acceptance: Test local key replacement/deletion during async commit/recover; no overwrite of trusted save; clarify threat model and add atomic key epoch if required. Do not claim remote anti-cheat.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-042 — P1 — MISSING_PHYSICAL_QA
- Tasks: R39 R40 R47 R49 R52 R53
- Evidence: DV-011/060/062/074/078/085/088; R49-Q06/Q08/Q09
- Finding: Actual API35 emulator PASS, physical Android low RAM/storage, denied permissions, app upgrade/region interrupted, PWA installation, iOS/WebKit and safe-area/pinch/keyboard not verified.
- Acceptance: Physical device matrix recorded OS/RAM/WebView, install/upgrade offline, app death, low storage, clock rollback, denied permission, graph corruption/rollback, transfer and full UI. iOS only if approved supported.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-043 — P1 — MISSING_TOOLCHAIN_REPRODUCIBILITY
- Tasks: R05 R49 R50 R53
- Evidence: DV-012; D03/D04; .github/workflows/railway-r47-web.yml
- Finding: Playwright ephemeral install (1.51.1) no lockfile/browser revision in release toolchain; fast-check candidate not adopted. CI apt HTTP403 and Maven 429 recurring.
- Acceptance: Lock QA deps/browser artifacts and checksums or approved alternate reproducible strategy; CI cache/pinned runner strategy and retry only infra failures; retain exact full regression and property coverage without duplicate engines.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-044 — P1 — HISTORICAL_REMEDIATION_RECHECK
- Tasks: R09 R32 R40 R49
- Evidence: DV-010/017; src/worker/rail-routing-bridge.ts; offline/lifecycle.ts
- Finding: Worker timeout/cancel and deterministic replay implemented for offline; real map/routing worker browser+Android wiring still absent; prior MR-05 not final.
- Acceptance: Actual production routing worker cancellation/out-of-order replies, unknown commit and stale generation, version mismatch, WebCrypto and transfer clone cost tests.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-045 — P1 — RELEASE_PRIVACY_SECURITY_GAP
- Tasks: R47 R48 R52 R53
- Evidence: DV-085; GuestShell privacy text; R52 report
- Finding: Local CSP/HMAC/native manifest QA passes. Final deployment origin, HTTPS response headers, publisher privacy contact/URL, Data Safety, secret review and final permissions are not approved. Native QA still has INTERNET needed for WebView context; no OS-wide network proof.
- Acceptance: Approved hosting origin separate from legacy, strict header audit and actual network/secret scan, privacy/deletion/contact declarations aligned to release, verify final APK permissions/bridge/exports and disabled services.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-046 — P1 — INTENTIONAL_DISABLED_SCOPE
- Tasks: R45 R47 R48 R52
- Evidence: DV-076; GP-018/028/029; R48_OPTIONAL_SCOPE.json
- Finding: Nine optional online/ads/billing/analytics services intentionally disabled and unauthorized commands rejected. Do not treat this as broken monetization or enable silently.
- Acceptance: Owner scope confirms N/A/deferred first release; preserve disabled flags and no SDK/consent/real money. Any later activation separate approved work with verified callbacks.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-047 — P0 — RELEASE_RIGHTS_BLOCK
- Tasks: R02 R03 R04 R18 R46 R51
- Evidence: DV-072/082; R51_DISTRIBUTION_REQUIREMENTS.json
- Finding: Seven legacy registered assets and QA draft pending owner; no approved final art/project brand/license or actual ODbL/Survey of India layer distribution offer.
- Acceptance: Review actual assets and source rights, explicit owner project/brand clearance; ODbL attribution + compliant derived database/alteration offer and actual boundary/data review; no proprietary evidence shipped.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-048 — P0 — NATIVE_LICENSE_BLOCK
- Tasks: R03 R51 R53
- Evidence: DV-082; R51 corrected artifact 15149333980; R53 native evidence
- Finding: QA debug runtime 61 components/53 artifacts/51 coordinates, 50 direct declarations; listenablefuture:1.0 inherited parent POM, final Maven transitive notice and release classpath rights not accepted.
- Acceptance: Resolve exact inherited/license texts incl filesystem reference, local module notices, final release classpath/SBOM and actual signed package notice audit; no blanket acceptance from metadata.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-049 — P1 — RESOURCE_REGISTER_RECONCILIATION
- Tasks: R03 R07 R37 R38 R47 R49 R51
- Evidence: RESOURCE_ADOPTION_LEDGER.csv; LICENSE_REGISTER.json; R03_SOURCE_LOCK.json
- Finding: All 21 resource rows reviewed; B01/B02 and B05–B07 not ready; C01/C02 build-only tests partial, D01/D02/D03 QA used but register still prior reviewed not accepted. Optional candidates explicitly not shipped.
- Acceptance: Reconcile actual chosen pins, QA vs build vs runtime and license evidence. Adopt only required data/render/build resources; no duplicate engine or blanket source acceptance.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-050 — P0 — PRODUCTION_BUILD_BLOCK
- Tasks: R47 R51 R52 R53
- Evidence: DV-088; tools/qa/r47/prepare-android.mjs; tools/qa/r53/native.py
- Finding: Actual APK and AAB use app.railway.qa.r47 versionCode 1, versionName 1.0, QA name/fixture; AAB unsigned and debug APK certificate. Default npm android scripts belong to legacy CEO. No final owner package/version/signing.
- Acceptance: Owner approved independent app ID, versioning, production root and art; dedicated release factory rejects QA markers and legacy identity; bundletool validation, private upload key outside git with expected cert, final signed AAB/APK and physical install. No publish/merge until R54 explicit.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-051 — P1 — REPRODUCIBILITY_SCOPE
- Tasks: R49 R53
- Evidence: R53 runs 45888075642 and 45888384468; DV-088
- Finding: Same-runner web builds/ZIPs byte-identical and AAB hashes equal across two CI runs. Debug APK hashes differ (97444c75... vs d2498d07...); native full reproducibility and upgrade signer continuity not proven.
- Acceptance: Record exact toolchain, compare unsigned content across clean environments and signed deterministic policy; stable owner signing cert and upgrade tests, validate exact AAB manifest with bundletool; no claim bit-reproducible debug APK.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-052 — P1 — EVIDENCE_DRIFT
- Tasks: R49 R50 R51 R52 R53
- Evidence: R49_QA_MATRIX.json Q03/Q04 and observedCI; EXECUTION_LEDGER.csv; DV-084/087; actual 45888384468
- Finding: R49 matrix still shows old guest failure/pending, R52/53 ledger pending despite successful later runs. Historical failures must remain but current evidence should be updated separately.
- Acceptance: After FIX IT, reconcile exact status and artifacts, preserve historical failed runs; close only executable DV-084/087 portion on actual logs, not full R tasks.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-053 — P2 — LOCAL_ENVIRONMENT_BLOCK
- Tasks: R01 R05 R53
- Evidence: DV-001; earlier git ls-remote DNS exit128
- Finding: No verified independent full local repository checkout/build/test at historical baseline; connector and CI evidence available.
- Acceptance: Get approved working local checkout and exact commit, reproduce dependency install, all tests and build; no assumption prior DNS issue persists until retry.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-054 — P1 — TRACEABILITY_GAP
- Tasks: R00-R53
- Evidence: V5 §7; V4 task GP/E CSVs; R49 QA matrix; working ledgers
- Finding: Task evidence exists but no fully synchronized live GP/E acceptance matrix; original immutable statuses all NOT_STARTED by design. 23 UI rows partial, source reviews provisional. Distinguish original contracts vs working statuses.
- Acceptance: Use this register as live crosswalk; attach actual code, exact checks and owner scope to every row, no silent skips; reconcile all open DV, all G gates and approval before R54.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-055 — P2 — PLATFORM_SCOPE_DECISION
- Tasks: R47 R49 R53
- Evidence: V5 §6/8; R49-Q08
- Finding: Physical PWA install/update and WebKit/iOS browser not confirmed; target Android and Web/PWA, not native iOS.
- Acceptance: Agree supported browser/device list; test actual installed PWA on supported hardware and separately scope optional iOS/WebKit. No unsupported platform claim.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-056 — P1 — TEST_SCOPE_GAP
- Tasks: R05 R49 R50
- Evidence: Verify 45888384442; V5 §2/7; R05 mapping
- Finding: 1566 tests include legacy manufacturing and railway tests; aggregate count is not proof of every GP/E/UI acceptance. No independent full repository mutation/fuzz audit or proof no unknown bugs.
- Acceptance: Report distinct rail test count and per-contract integration coverage, negative and long-run/property cases. Re-run exact branch after all fix batches; no acceptance by test count alone.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-057 — P2 — REFERENCE_ONLY_OR_DEFERRED
- Tasks: R12 R31 R42 R45 R48
- Evidence: GAMEPLAY_SCOPE_REGISTER; GP-023/024/027; V5 §0
- Finding: Historical model specs, tourism promotion and paid boosters are research; global expansion, online alliances and ads intentionally excluded. Do not copy promotional values or mark skipped core India scope N/A.
- Acceptance: Owner explicitly approves optional disposition; if boost selected implement earned local bounded behavior; reference-only models not required copied; preserve India-only first release.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-058 — P1 — MISSING_RELEASE_ARTIFACT_DURABILITY
- Tasks: R53
- Evidence: R53 workflow retention 14d; 45888075642 artifacts; no final distribution
- Finding: QA artifacts expire, and changing CI debug cert may prevent update install on same package. Need durable owner archive and signer policy, not commit binaries into Git.
- Acceptance: Keep verified QA archive privately with manifest, source SHA and cert. Test upgrade only same approved signer, no destructive uninstall of player saves; final signed production artifact retained.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-059 — P1 — RISK_REQUIRES_REPRODUCTION
- Tasks: R39 R40 R47 R52
- Evidence: GuestShell.tsx:22-44; src/rail/guest/pwa.ts:10-16; src/platform/native.ts
- Finding: UI recovery and lifecycle remount may leave stale status; PWA listeners no dispose API, native export cache uses fixed filename and share cancellation outcome not separately surfaced. No reproduced data loss; inspect long session, update, repeated export and cancellation.
- Acceptance: Test remount, repeated wake/update, export/cancel/share, native back busy states; prove no leaked handlers, no unintended overwrite/loss; add explicit feedback and safe temp cleanup if reproduced.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

### MR-060 — P1 — SOURCE_SCOPE_GAP
- Tasks: R32 R33 R35 R40 R42
- Evidence: V5 §5; runCatchupBatch; R33/R35/R40 reports
- Finding: Movement/reservation and deterministic arrivals implemented; active movement geometry UI, approved repeat schedules, stop-level passenger/freight accounting, seeded disruption/replan and independent foreground playback missing.
- Acceptance: One authority for continuous trip state; plan/stop dwell/boarding, realistic route position from geometry, recurring schedule and explicit disruption/cancellation policy; actual real map+settlement parity.
- State: OPEN_FOR_REMEDIATION_OR_SCOPE_DECISION; no code change authorized in this audit.

## GP-001–GP-035 gameplay traceability (all original IDs)
| ID | Contract | Original tasks | Audit disposition | Issue IDs |
|---|---|---|---|---|
| GP-001 | Route editor | R10 R43 | MISSING | MR-017 |
| GP-002 | Track graph alternatives | R10 R43 | CORE_ONLY | MR-010 MR-017 |
| GP-003 | Dispatch / delay / load | R33 R34 | PARTIAL | MR-019 MR-060 |
| GP-004 | Passenger-linked subsidy | R27 | PROVISIONAL | MR-024 |
| GP-005 | Track-specific subsidy | R27 | PROVISIONAL | MR-024 |
| GP-006 | Out-of-service exclusion | R36 | QA_ONLY | MR-029 MR-030 |
| GP-007 | Bulk departure | R34 | QA_ONLY | MR-012 MR-033 |
| GP-008 | Ticket inspection | R27 | PARTIAL | MR-018 MR-024 |
| GP-009 | Diesel economy | R23 R24 | PROVISIONAL | MR-021 MR-022 |
| GP-010 | Electric economy | R23 R24 | PROVISIONAL | MR-021 MR-022 |
| GP-011 | Parking/base ownership | R36 | PARTIAL | MR-029 MR-030 |
| GP-012 | IPO | R30 R45 | MISSING_LOCAL_EQUIVALENT | MR-027 |
| GP-013 | World map | R42 | INDIA_CORE_MISSING_WORLD_DEFERRED | MR-007 MR-010 |
| GP-014 | Difficulty | R31 | MISSING_APPROVAL | MR-033 MR-036 |
| GP-015 | Fleet types | R12 R23 | SCHEMA_ONLY | MR-021 MR-029 MR-035 |
| GP-016 | Fleet trading | R12 R43 | MISSING | MR-029 |
| GP-017 | Staff | R25 R44 | PARTIAL | MR-023 |
| GP-018 | Alliances | R45 | INTENTIONALLY_DEFERRED | MR-046 |
| GP-019 | Maintenance | R26 R36 | QA_ONLY | MR-023 MR-029 |
| GP-020 | Economy/specs/fare | R12 R22 | PARTIAL | MR-018 MR-029 |
| GP-021 | Fleet catalogue | R12 R46 | PARTIAL | MR-029 MR-035 |
| GP-022 | Achievements | R31 R45 | RECOGNITION_ONLY | MR-034 |
| GP-023 | Historical train spec | R12 | REFERENCE_ONLY | MR-057 |
| GP-024 | Tourism fleet | R12 R31 | OPTIONAL_REFERENCE | MR-057 |
| GP-025 | Map detail | R42 | MISSING | MR-010 |
| GP-026 | Seasonal demand | R21 R45 | EFFECT_MISSING | MR-019 MR-034 |
| GP-027 | Speed booster | R32 R45 | LOCAL_CANDIDATE_DEFERRED_POLICY | MR-034 MR-057 |
| GP-028 | Reward ads | R48 | INTENTIONALLY_DISABLED | MR-046 |
| GP-029 | Reward ads cap | R48 | INTENTIONALLY_DISABLED | MR-046 |
| GP-030 | Guest saves | R39 R47 | QA_LOCAL_ONLY | MR-038 MR-039 MR-042 |
| GP-031 | Route economy validation | R28 R34 | PARTIAL | MR-017 MR-025 |
| GP-032 | Circle lines | R10 R36 | PARTIAL | MR-030 |
| GP-033 | Train modification | R12 R10 R43 | PARTIAL | MR-029 MR-030 |
| GP-034 | Map locate | R42 | MISSING | MR-010 MR-060 |
| GP-035 | Supported coverage | R19 R42 | MISSING | MR-008 MR-010 MR-036 |
## E01–E28 economic traceability (all original IDs)
Exact formulas remain immutable in V4/V5; this is a reconciliation crosswalk, not a replacement formula or approved parameters.
| ID | Contract | Task | Audit disposition | Issue IDs |
|---|---|---|---|---|
| E01 | Demand elasticity | R21 | CORE IMPLEMENTED / APPROVAL REQUIRED | MR-019 MR-033 |
| E02 | Shared OD allocation | R21 | CORE IMPLEMENTED / APPROVAL REQUIRED | MR-019 MR-033 |
| E03 | Seat capacity and OD decrement | R21 | CORE IMPLEMENTED / APPROVAL REQUIRED | MR-019 MR-020 |
| E04 | Fare formula | R22 | CORE IMPLEMENTED / APPROVAL REQUIRED | MR-018 MR-020 |
| E05 | Paid class revenue/refunds | R22 | CORE IMPLEMENTED / APPROVAL REQUIRED | MR-018 MR-020 |
| E06 | Cargo delivered tonne-km | R22 | CORE IMPLEMENTED / APPROVAL REQUIRED | MR-020 |
| E07 | Delay penalty and transfer | R22 | CORE IMPLEMENTED / APPROVAL REQUIRED | MR-019 MR-020 |
| E08 | Diesel consumption | R23 | CORE IMPLEMENTED / APPROVAL REQUIRED | MR-021 MR-031 |
| E09 | Electric/regen | R23 | CORE IMPLEMENTED / APPROVAL REQUIRED | MR-021 MR-031 |
| E10 | Inventory/locked price | R23 | CORE IMPLEMENTED / APPROVAL REQUIRED | MR-021 MR-022 |
| E11 | Seeded spot/contract | R24 | CORE IMPLEMENTED / APPROVAL REQUIRED | MR-022 |
| E12 | Access and terminal cost | R25 | CORE IMPLEMENTED / APPROVAL REQUIRED | MR-023 |
| E13 | Crew wages and overhead | R25 | CORE IMPLEMENTED / APPROVAL REQUIRED | MR-023 MR-026 |
| E14 | Wear | R25 | CORE IMPLEMENTED / APPROVAL REQUIRED | MR-023 |
| E15 | Maintenance | R26 | CORE IMPLEMENTED / APPROVAL REQUIRED | MR-023 MR-029 |
| E16 | Depreciation/resale | R26 | CORE IMPLEMENTED / APPROVAL REQUIRED | MR-023 MR-028 |
| E17 | Subsidy cap | R27 | CORE IMPLEMENTED / APPROVAL REQUIRED | MR-024 |
| E18 | Evasion and fines | R27 | CORE IMPLEMENTED / APPROVAL REQUIRED | MR-018 MR-024 |
| E19 | Marketing | R27 | CORE IMPLEMENTED / APPROVAL REQUIRED | MR-019 MR-024 |
| E20 | Debt/interest | R28 | CORE IMPLEMENTED / APPROVAL REQUIRED | MR-025 |
| E21 | Liquidity reserve | R28 | CORE IMPLEMENTED / APPROVAL REQUIRED | MR-025 MR-017 |
| E22 | Double entry/atomic settlement | R29 | CORE IMPLEMENTED / APPROVAL REQUIRED | MR-013 MR-026 MR-028 |
| E23 | Profit/cash distinction | R29 | CORE IMPLEMENTED / APPROVAL REQUIRED | MR-026 |
| E24 | Regional inflation | R30 | PROVISIONAL / INTEGRATION REQUIRED | MR-027 |
| E25 | Expansion ROI | R30 | PROVISIONAL / INTEGRATION REQUIRED | MR-027 MR-029 |
| E26 | Fictional equity | R30 | PROVISIONAL / INTEGRATION REQUIRED | MR-027 |
| E27 | Reliability/unlocks | R31 | PROVISIONAL / INTEGRATION REQUIRED | MR-033 MR-034 |
| E28 | Bankruptcy/restart | R31 | PROVISIONAL / INTEGRATION REQUIRED | MR-028 |
## UI-01–UI-23 and additional required surfaces
| ID | Screen | Original task mapping | Last documented available scope | Blockers | Issue IDs |
|---|---|---|---|---|---|
| UI-01 | Guest/login | R45 R47 | Offline guest/recovery verified in R47; language/help incomplete | DV-074 | MR-036 MR-038 MR-037 |
| UI-02 | Create company | R12 R31 R43 R47 | No approved starter name/base/difficulty | DV-066 DV-072 DV-074 | MR-036 MR-029 |
| UI-03 | Electric starter | R12 R43 R46 | Synthetic catalogue only; acquisition blocked | DV-072 | MR-029 MR-035 |
| UI-04 | Diesel starter | R12 R43 R46 | Synthetic catalogue only; acquisition blocked | DV-072 | MR-029 MR-035 |
| UI-05 | Map home | R19 R42 R44 | Real map unavailable | R19 R42 | MR-010 |
| UI-06 | Destination selection | R09 R10 R42 R43 | Configured route only; map unavailable | R42 DV-066 | MR-010 MR-017 |
| UI-07 | Passenger route | R09 R10 R21 R27 R42 | Domain/configured routes only; map UI incomplete | R42 DV-066 | MR-010 MR-017 MR-019 |
| UI-08 | Alternate track preview | R09 R10 R42 | Map path preview blocked | R42 | MR-010 MR-017 |
| UI-09 | New route modal | R10 R28 R34 R43 | Durable arbitrary route creation absent | DV-066 | MR-017 |
| UI-10 | Ticketing continued | R22 R27 R43 | Editing/inspection controls incomplete | DV-066 | MR-018 |
| UI-11 | Departure summary | R29 R34 R35 R43 R44 | Synthetic itemized receipt tested R43 | DV-066 DV-068 | MR-020 MR-026 MR-037 |
| UI-12 | Active map | R33 R42 | Map position display blocked | R42 | MR-010 MR-060 |
| UI-13 | Train management | R36 R43 | Configured dispatch/service/park/settle tested | DV-066 | MR-029 MR-030 MR-060 |
| UI-14 | Company highscore | R30 R31 R45 | No approved rival dataset | DV-070 | MR-027 MR-034 |
| UI-15 | Checklist top | R31 R45 | Recognition claim tested; reward policy pending | DV-070 | MR-034 |
| UI-16 | Checklist continued | R31 R45 | Synthetic milestones tested | DV-070 | MR-034 |
| UI-17 | Yard | R12 R36 R43 | Yard/service fixture tested; acquisition incomplete | DV-066 DV-072 | MR-029 |
| UI-18 | Electricity capacity | R23 R24 R44 | Inventory domain only; approved electric scope pending | DV-068 | MR-022 |
| UI-19 | Fuel price history | R24 R44 | Simulated history/lock; consultant absent | DV-068 | MR-022 |
| UI-20 | Fuel capacity | R23 R24 R44 | Synthetic purchase tested; expansion absent | DV-068 | MR-022 |
| UI-21 | Spot price history | R24 R44 | Synthetic contract tested; approved scenario pending | DV-068 | MR-022 |
| UI-22 | IPO eligibility | R30 R31 R44 R45 | IPO disabled; policy absent | DV-068 DV-070 | MR-027 |
| UI-23 | Finance summary | R29 R30 R44 | Ledger and cash/profit projection; approved full history pending | DV-068 | MR-026 MR-027 |
All 23 require actual production visual/action approval. R49 matrix historical Q03/Q04 outdated; native and regression now passed on later revisions. Additional V5 required unseen surfaces shop/order, staff, marketing, service detail, post-IPO, help/settings/notifications tracked MR-037, not assumed covered by screenshots.

## All 21 resources — exact working register snapshot
Do not interpret candidate as adopted. D01/D02/D03 are used in actual QA; review register status drift in MR-049. B01–B07 need actual selected build/runtime evidence; reference-only and deferred alternatives do not need unnecessary installs.
```csv
id,resource,proposed_role,source,pinned_sha_or_version,verified_license,notice_path,decision,status,test_evidence,blocker
"A01","OpenTTD","REFERENCE_ONLY","https://github.com/OpenTTD/OpenTTD","871c4f4cb544af7b45fb22c72129ddea293172ae","GPL-2.0 (core)","https://github.com/OpenTTD/OpenTTD/blob/871c4f4cb544af7b45fb22c72129ddea293172ae/COPYING.md","REFERENCE_ONLY","REVIEWED_NOT_PRODUCTION_ACCEPTED","license blob 089f86e973d7e5e2b8ac901a7d44a6083fca4b1c","Concept reference only; no code/art incorporation; review specific third-party rights if scope changes."
"A02","Simutrans","REFERENCE_ONLY","https://github.com/simutrans/simutrans","0750443f72878e295445ef430575dde306d5f396","Artistic-1.0","https://github.com/simutrans/simutrans/blob/0750443f72878e295445ef430575dde306d5f396/LICENSE.txt","REFERENCE_ONLY","REVIEWED_NOT_PRODUCTION_ACCEPTED","license blob 80e549c7a1fd1f769141dcb3541b60782655693f","Mechanics reference only; pakset and font rights separate."
"A03","World Bank railway toolkit","REFERENCE_ONLY","https://ppp.worldbank.org/library/railway-reform-toolkit-improving-rail-sector-performance","2017-09-01 landing page; underlying toolkit June 2011","Publication reuse terms not established","","REFERENCE_ONLY","REVIEWED_NOT_PRODUCTION_ACCEPTED","publication/data rights record; see manifest","https://ppp.worldbank.org/library/railway-reform-toolkit-improving-rail-sector-performance ; cost taxonomy ideas only; no workbook/text/figures copied."
"A04","Rail demand research","REFERENCE_ONLY","https://doi.org/10.1007/s11116-024-10462-z","DOI 10.1007/s11116-024-10462-z; version of record 2024-02-12","CC-BY-4.0 article","","REFERENCE_ONLY","REVIEWED_NOT_PRODUCTION_ACCEPTED","publication/data rights record; see manifest","https://link.springer.com/article/10.1007/s11116-024-10462-z ; Wardman, Transportation 52 (2025), 1457–1483. Great Britain evidence only; calibrate original India game coefficients; third-party exceptions."
"B01","Geofabrik/OSM","DATA_CANDIDATE","https://download.geofabrik.de/asia/india/eastern-zone/","","ODbL-1.0 (OSM data)","","LISTED_ACQUISITION_BLOCKED","REVIEWED_NOT_PRODUCTION_ACCEPTED","R13_RAW_DATASET_MANIFEST.json; dated 261101 and sidecar listed","DNS exit6; zero bytes; actual checksum/header and approved workspace review absent"
"B02","Osmium","BUILD_TOOL_CANDIDATE","https://github.com/osmcode/osmium-tool","v1.19.0","GPL-3.0 license text","https://github.com/osmcode/osmium-tool/blob/v1.19.0/LICENSE.txt","PINNED_TOOL_UNAVAILABLE","REVIEWED_NOT_PRODUCTION_ACCEPTED","R13_ACQUISITION_REPORT.md; actual pinned fileinfo manual and source reviewed","Binary missing; trusted binary SHA and full parse required; no runtime adoption"
"B03","OpenRailRouting","ORACLE_CANDIDATE","https://github.com/geofabrik/OpenRailRouting","e5112194fde4cc8ec36e2b0093e250df89ef4845","Apache-2.0","https://github.com/geofabrik/OpenRailRouting/blob/e5112194fde4cc8ec36e2b0093e250df89ef4845/LICENSE.txt","BUILD_ONLY_ORACLE_CANDIDATE","REVIEWED_NOT_PRODUCTION_ACCEPTED","R08_COMPATIBILITY_REPORT.md; pinned README config pom and four parsers inspected","R16 fork and Maven pins and actual strict equivalent profile build; unknown-vs-DC encoding and permissive defaults must be resolved; R17 comparisons"
"B04","Graphology","RUNTIME_CANDIDATE","https://github.com/graphology/graphology","01bb37e39c66ff4eddaf3b0beda40903a663e627","MIT","https://github.com/graphology/graphology/blob/01bb37e39c66ff4eddaf3b0beda40903a663e627/LICENSE.txt","REFERENCE_ONLY","REVIEWED_NOT_PRODUCTION_ACCEPTED","R07_GRAPH_REPORT.md; pinned classes.js graph.js manifest and iteration tests inspected","No runtime install; if reconsidered require exact package/transitive pins and single graph parity/mobile benchmark"
"B05","MapLibre GL JS","RUNTIME_CANDIDATE","https://github.com/maplibre/maplibre-gl-js","v6.18.0","BSD-3-Clause + bundled third-party notices","https://github.com/maplibre/maplibre-gl-js/blob/v6.18.0/LICENSE.txt","CANDIDATE_PIN_REVIEW_ONLY","REVIEWED_NOT_PRODUCTION_ACCEPTED","license blob 1e8acbb54fa7baddc844377507cc5a79353174fb","Renderer only; ESM/WebGL support, offline glyphs/sprites, package integrity, Android WebView and device budget proof before adoption."
"B06","Planetiler","BUILD_TOOL_CANDIDATE","https://github.com/onthegomap/planetiler","v0.10.2","Apache-2.0","https://github.com/onthegomap/planetiler/blob/v0.10.2/LICENSE","CANDIDATE_PIN_REVIEW_ONLY","REVIEWED_NOT_PRODUCTION_ACCEPTED","license blob 261eeb9e9f8b2b4b0d119366dda99c6fd7d35c64","Build-time custom vector tiles; verify JAR digest and NOTICE/dependency licenses; tiles and graph data rights separate."
"B07","PMTiles","RUNTIME_CANDIDATE","https://github.com/protomaps/PMTiles","aec8fa1341222fdddb3318e9ffa8e18e19b312f7","BSD-3-Clause implementations; spec public domain/CC0","https://github.com/protomaps/PMTiles/blob/aec8fa1341222fdddb3318e9ffa8e18e19b312f7/LICENSE","CANDIDATE_PIN_REVIEW_ONLY","REVIEWED_NOT_PRODUCTION_ACCEPTED","license blob ec3d69a55220793cb4b2074ebe202df25f9cb417","JS manifest 4.5.0 (blob 1b6519d9ef11ead211f7988354e2052ba2fcc208); lock package and fflate at adoption; sample tiles separate rights; offline range adapter/rollback test."
"B08","Transitland Atlas","OPTIONAL","https://github.com/transitland/transitland-atlas","db0fe0bd5382f85e35740be5832589e7fe619ad7","CC-BY-4.0 catalog","https://github.com/transitland/transitland-atlas/blob/db0fe0bd5382f85e35740be5832589e7fe619ad7/LICENSE.txt","DEFERRED_NO_INSTALL","REVIEWED_NOT_PRODUCTION_ACCEPTED","license blob da6ab6cc8f333d7e89a99812866df8f24374d47c","Defer for pilot; catalog not track geometry; individual GTFS feeds separately licensed; no feed acquisition."
"C01","ALTRIOS","ORACLE_CANDIDATE","https://github.com/NatLabRockies/altrios","aecad5e702403c3a39947e7668af54ebfaefddd5","BSD-3-Clause style","https://github.com/NatLabRockies/altrios/blob/aecad5e702403c3a39947e7668af54ebfaefddd5/LICENSE.md","CANDIDATE_PIN_REVIEW_ONLY","REVIEWED_NOT_PRODUCTION_ACCEPTED","license blob 0421455a13bf647697101d20757f61d24e00edaf","R37 separate build/test calibration; freight focus, validate Indian traction assumptions and holdout; no Python/Rust runtime on phone."
"C02","OSRD","ORACLE_CANDIDATE","https://github.com/OpenRailAssociation/osrd","6d6f1d84b6a132fd10c6556460eec2576eeeb916","LGPL-3.0-only default (REUSE); README dual license","https://github.com/OpenRailAssociation/osrd/blob/6d6f1d84b6a132fd10c6556460eec2576eeeb916/LICENSES/LGPL-3.0-only.txt","CANDIDATE_PIN_REVIEW_ONLY","REVIEWED_NOT_PRODUCTION_ACCEPTED","license blob 0a041280bd00a9d068f503b8ee7ce35214bd24a1","REUSE.toml blob 4b669c6192b6b05ab81026b97b1ff34e641e0147; R38 external timetable oracle, pin schema/containers; no UI, server or mobile bundling."
"C03","Eclipse SUMO","OPTIONAL","https://github.com/eclipse-sumo/sumo","89430dbd39e93b34b91c647314612f59e7d310fd","EPL-2.0; secondary/module terms require review","https://github.com/eclipse-sumo/sumo/blob/89430dbd39e93b34b91c647314612f59e7d310fd/LICENSE","DEFERRED_NO_INSTALL","REVIEWED_NOT_PRODUCTION_ACCEPTED","license blob e48e0963459bf4c4e175956b657a8f4a91967880","Optional independent validator only if OSRD insufficient; no install."
"C04","Salabim","OPTIONAL","https://github.com/salabim/salabim","99bc8b2213d66a7287f04952cabc1fb9aa6c369d","MIT declared in README; full package license not reviewed","https://github.com/salabim/salabim/blob/99bc8b2213d66a7287f04952cabc1fb9aa6c369d/readme.md","DEFERRED_NO_INSTALL","REVIEWED_NOT_PRODUCTION_ACCEPTED","license blob cbde39a0c3ad3a8023f8d749221649fddfa19bf1","Defer optional DES oracle; verify packaged license before use; no install."
"C05","MATSim","DEFER","https://github.com/matsim-org/matsim-libs","a178593e8e2d93fcd69c9c0f493d72187c038b68","GPL-2.0-or-later core","https://github.com/matsim-org/matsim-libs/blob/a178593e8e2d93fcd69c9c0f493d72187c038b68/matsim/LICENSE","DEFERRED_NO_INSTALL","REVIEWED_NOT_PRODUCTION_ACCEPTED","license blob c3676097f9234a0330a400af6cdd8a899162a2ae","Not needed for pilot; heavy independent simulation; no install."
"D01","Capacitor","REUSE_EXISTING_CANDIDATE","https://github.com/ionic-team/capacitor","8.6.2","MIT","https://github.com/ionic-team/capacitor/blob/8.6.2/LICENSE","REUSE_EXISTING_TOOLING_PENDING_RAIL_QA","REVIEWED_NOT_PRODUCTION_ACCEPTED","license blob c3e903bdded1959466a54a74dd3e9361481f8144","Existing exact core/android/cli 8.6.2 npm lock and integrity; app/filesystem/share 8.0.0 already declared; legacy CI passed; R47 railway identity and physical device QA."
"D02","Vitest","REUSE_EXISTING_CANDIDATE","https://github.com/vitest-dev/vitest","v5.1.2","MIT","https://github.com/vitest-dev/vitest/blob/v5.1.2/LICENSE","REUSE_EXISTING_TOOLING_PENDING_RAIL_QA","REVIEWED_NOT_PRODUCTION_ACCEPTED","license blob 0e5771dddf4e96ebc77c349f53fc763b910e63c0","Existing package-lock 5.1.2 and integrity; legacy 134 tests; reuse test runner, not claim railway functionality."
"D03","Playwright","REUSE_EXISTING_CANDIDATE","https://github.com/microsoft/playwright","0ad26b38902449d9347536c97a34cc5dedbec729","Apache-2.0","https://github.com/microsoft/playwright/blob/0ad26b38902449d9347536c97a34cc5dedbec729/LICENSE","REUSE_EXISTING_TOOLING_PENDING_RAIL_QA","REVIEWED_NOT_PRODUCTION_ACCEPTED","license blob df112373eb2e23e459bf93ec412be1764dc5a38b","Existing CI playwright@1.51.1 (browser-smoke.yml blob a789f7d890f736d52de89f69ba3fe64cae1e265c), ephemeral install not lockfile; R05/R49 harden toolchain/lock, advisory and browser revision review."
"D04","fast-check","TEST_TOOL_CANDIDATE","https://github.com/dubzzz/fast-check","6f2cc934c49dddae8a71b0ced407072cd60cd251","MIT","https://github.com/dubzzz/fast-check/blob/6f2cc934c49dddae8a71b0ced407072cd60cd251/LICENSE","CANDIDATE_PIN_REVIEW_ONLY","REVIEWED_NOT_PRODUCTION_ACCEPTED","license blob 879582464487c55389c243110ca18e014db7319e","Manifest 4.11.0 (blob 844ccbe17f325a93152d60d81c0992ebfae6741e); dev-only candidate; no install; lock tarball and pure-rand at acceptance."
```

## All 44 open deferred-verification records — preserved verbatim
Snapshot before remediation (including DV-084/087 whose executable evidence has since passed); distinguish history from active release blocker. No closure mutation at audit stage.
```csv
id,task,status,observed_at_commit,check_or_command,last_result,dependency_impact,retry_action
DV-001,R01,OPEN,b95c47935865a7310548b0d604ac2b83e8afc539,git ls-remote or local clone,Prior DNS failure exit 128,Local build evidence not available; connector and CI used,Retry local checkout and record exit and exact revision at next suitable environment or final reconciliation
DV-002,R13,OPEN,872d60f4331b14f60f8f129be13c127f0f115566,Uploaded PBF and matching named sidecar; metadata and file service read,247546068 PBF bytes reported; 62-byte sidecar claim 2bd5e0db4194c3aa127814f96975a50d; rematerialized; actual full-byte hash not computed,Actual source integrity remains unverified,Compute PBF MD5 compare uploaded sidecar and SHA256 in working approved workspace; retain independent provider evidence; owner defers PC work to final reconciliation unless sandbox recovers earlier
DV-003,R13,OPEN,872d60f4331b14f60f8f129be13c127f0f115566,Pinned Osmium v1.19.0; candidate conda-forge win-64 h60971b7_3,Windows package listed; current execution environment unavailable; no installed parser verification,Actual PBF full scan not run,Install exact reviewed package in working local environment; record version binary SHA256 package lock and full fileinfo result; owner defers PC work to final reconciliation unless sandbox recovers earlier
DV-006,R29,OPEN,66501728e6c1873ac7cc3ab379ca05e6301bb9f7,MR-01 railway half-open accounting periods and R32 boundary adapter,R29 baseline passed; R32 actual accounting scheduler integration regression authored,Legacy tax not reused; approved tax policy and aggregate boundary integration unresolved,Verify R32 CI and R35 aggregate ordering; do not claim legacy tax fix; R35 exact scheduled interest/payroll and half-open reporting regression authored; legacy tax policy still unresolved
DV-007,R39,OPEN,cac9b84a34602ecef977ded0a6ad7579982a870a,MR-02 journal growth regression,Static source limits,Requires reconciled archive and save growth proof,Test >50000 entries and envelope limits without data loss
DV-008,R32,OPEN,66501728e6c1873ac7cc3ab379ca05e6301bb9f7,MR-03 terminal ordering; scheduler boundary guard and R31 actual governance integration,R32 tests authored for same-time exclusive grace deadline and rescue rejection; full aggregate settlement still pending,R35 must schedule due boundaries before ordinary commands and validate active trip settlement,Verify R32 CI and simultaneous liquidation and actual settlement at R35; R35 boundary-first review/grace/maturity and same-time arrival regression authored; controlled liquidation recovery command integration still pending
DV-009,R39,OPEN,cac9b84a34602ecef977ded0a6ad7579982a870a,MR-04 receipt retention,512-entry window and latest snapshot return,Requires durable replay and payload conflict behavior,Test retries after eviction and checkpoint R29/R34/R35/R39
DV-010,R40,OPEN,cac9b84a34602ecef977ded0a6ad7579982a870a,MR-05 worker cancellation and version,No correlated cancellation in old protocol,Requires bounded stale rejection,Test timeout cancel and replay parity R09/R32/R40
DV-011,R47,OPEN,cac9b84a34602ecef977ded0a6ad7579982a870a,MR-06 platform identity,CEO namespace and landscape retained,Requires separate rail identity and physical QA,Owner approved app ID DB cache and portrait tests R47/R49/R53
DV-012,R49,OPEN,cac9b84a34602ecef977ded0a6ad7579982a870a,MR-07 browser reproducibility,Ephemeral Playwright 1.51.1 install,Toolchain lock pending,Verify exact browser revision and lock at R49/R53
DV-017,R49,OPEN,f97aa926ff79bb94ca2552cd4a1be12d8804a313,Actual browser module worker and Android route integration,Local strict compile and Node thread adapter only,UI integration and platform acceptance not proven,Test Vite worker bundle and WebCrypto on browser and Android R42/R49; measure cloning and search R20
DV-018,R42,OPEN,a93ef65f287af1c0264e61d5106fba137f8c574f,Alternate-route UI preview and worker integration; separate economy rank,Core distinct feasible alternative search and rank by distance/time implemented with R10 64/64 local cases; implementation CI 5/5 success,GP-002 and UI-08 integration incomplete; no economy ranking yet,Wire existing engine to cancellable worker and preview R42/R43; use R21/R27/R34 estimates for cost/demand/subsidy rankings; device budget R20/R49
DV-023,R13,OPEN,f2f91e30e062c92d551746f2eebe00e83de903bf,Approved workspace and actual data review; helper live execution,No confirmed runtime jurisdiction or actual source accuracy/attributes; 6/6 synthetic helper tests only,Actual data processing blocked under R04 policy; no foreign CI transfer,Record approved private India workspace and applicable review; acquire bytes and run pinned tool; resume R13 before R14 or R16; owner defers PC work to final reconciliation unless sandbox recovers earlier
DV-025,R13,OPEN,872d60f4331b14f60f8f129be13c127f0f115566,Container and Python direct reads plus intentional file rematerialization,File service read sidecar and copied PBF; shell hash probe still ClientError before output,R13 computed hash and parser blocked; strict sequence retained,Use working local Windows environment for minimal validation or retry functioning sandbox; never skip R13; owner defers PC work to final reconciliation unless sandbox recovers earlier
DV-026,R21,OPEN,83cfe410845fb17712a2bae14f5e9bda8f179f3a,Original archive SHA CRC and formula source comparison,Original V4/V5 bytes recovered and exact CSV parity verified; preliminary code comparison in R29_SOURCE_RECONCILIATION.md,Detailed source-policy and dependent final acceptance remain pending,Review documented implementation decisions and integration/calibration evidence in final reconciliation
DV-028,R22,OPEN,53883b84530711e59c942aea32358a2bbcf9e517,Original archive SHA CRC and formula source comparison,Original V4/V5 bytes recovered and exact CSV parity verified; preliminary code comparison in R29_SOURCE_RECONCILIATION.md,Detailed source-policy and dependent final acceptance remain pending,Review documented implementation decisions and integration/calibration evidence in final reconciliation
DV-030,R23,OPEN,886db5b4aa90a4bae1c5214c83a9f23e1fb5a980,Original archive SHA CRC and formula source comparison,Original V4/V5 bytes recovered and exact CSV parity verified; preliminary code comparison in R29_SOURCE_RECONCILIATION.md,Detailed source-policy and dependent final acceptance remain pending,Review documented implementation decisions and integration/calibration evidence in final reconciliation
DV-032,R24,OPEN,0b22792d79145ddec436649e5c561cf5605f9358,Original archive SHA CRC and formula source comparison,Original V4/V5 bytes recovered and exact CSV parity verified; preliminary code comparison in R29_SOURCE_RECONCILIATION.md,Detailed source-policy and dependent final acceptance remain pending,Review documented implementation decisions and integration/calibration evidence in final reconciliation
DV-034,R25,OPEN,26950e5e80a063c770e412b515a91fa3d973546a,Original archive SHA CRC and formula source comparison,Original V4/V5 bytes recovered and exact CSV parity verified; preliminary code comparison in R29_SOURCE_RECONCILIATION.md,Detailed source-policy and dependent final acceptance remain pending,Review documented implementation decisions and integration/calibration evidence in final reconciliation
DV-036,R26,OPEN,3a7e35205dc33a27ccd250d59f28f3e12b34eba7,Original archive SHA CRC and formula source comparison,Original V4/V5 bytes recovered and exact CSV parity verified; preliminary code comparison in R29_SOURCE_RECONCILIATION.md,Detailed source-policy and dependent final acceptance remain pending,Review documented implementation decisions and integration/calibration evidence in final reconciliation
DV-038,R27,OPEN,2fd859ea7d17e7f2c0756f35b35d85c0eab7b1bb,Original archive SHA CRC and formula source comparison,Original V4/V5 bytes recovered and exact CSV parity verified; preliminary code comparison in R29_SOURCE_RECONCILIATION.md,Detailed source-policy and dependent final acceptance remain pending,Review documented implementation decisions and integration/calibration evidence in final reconciliation
DV-040,R28,OPEN,74fa6c44a393eb52a66fc5013f1eba0d9e867cb0,Original archive SHA CRC and formula source comparison,Original V4/V5 bytes recovered and exact CSV parity verified; preliminary code comparison in R29_SOURCE_RECONCILIATION.md,Detailed source-policy and dependent final acceptance remain pending,Review documented implementation decisions and integration/calibration evidence in final reconciliation
DV-048,R34,OPEN,c1735856994893a40e07522415c7cbc280e91dd7,GP-003 and GP-031 V4/V5 traceability; R29 action registry review,No approved dispatch-gap coefficient or source-backed route-license debit and accounting classification; no invented formula or fee,GP acceptance incomplete; route creation and calibrated demand/marketing integration distinct from dispatch reservation core,Resolve explicit license policy and authoritative charge through R29/R43; approve late-gap balance and integrate R41; do not mark GP PASS
DV-051,R35,OPEN,24f1957cbd0a3ea2884ebae4f267417e5e5cf70b,V4 trip lifecycle and E03/E08/E09 plus R31 recovery source,Safe-station cancellation with no already-delivered OD and actual prefix costs supported; partial-delivered OD rejected; no continuous segment debit or disruption/replan policy; durable recovery authority pending,Full gameplay and liquidation integration incomplete,Add approved partial delivery and in-flight disruption/consumption policy; integrate controlled rescue/liquidation and payable handling without invented money; reconcile before G4 acceptance
DV-054,R36,OPEN,be846a277acf388dc5b8bc207f6cb22d9616c983,R36 trusted fleet scenario and V5 base/yard ownership; R13-R20 data deferral,Explicit preowned bases and abstract yard slots; purchase/acquisition UI and actual licensed topology not integrated; no invented cost,Final base purchase and real data acceptance pending,Integrate actual purchased base authority and approved infrastructure before final G4/G5 acceptance; GP-032 explicit circle-line product policy and actual purchased base authority still provisional
DV-055,R37,OPEN,03e0af1272c5f9ba80262bf3339931fafee378a9,Retry 45869120505 job 140079600359 failed official Python tests 10 PASS 1 missing XLSX resource; Rust and wheel PASS,Missing packaged Kokam_NMC_75Ah.xlsx; artifact provider 15143302100 r37-altrios-evidence sha256:41cd5b3a52850468a7f030bd6e5f00514d25f753666d1c4909178e1c7086e204; no actual numeric output,External calibration acceptance blocked,Inspect pinned resource packaging and rerun official tests/demo in final reconciliation
DV-057,R38,OPEN,efd35c6e7a4daaf9b71d1c88460e68f6aff372da,Native OSRD 45864116665 job 140062398379 SUCCESS; artifact 15140770425 verified 17/17; 10 JUnit PASS,601.093 vs 634s and 668.306 vs 674s; median 3.163266%; 18 probes 0 FN 3 FP; zero known incompatible accepted,Exact routing/spatial mapping and Indian approved scenarios pending,Retain evidence and complete approved external scope before R53
DV-060,R39,OPEN,0727a4cc0d7d575b955210dae07e835518b1ad56,Local HMAC and atomic same-head mirror/export recovery; synthetic authenticated v1 migration,No cross-device key transfer or untrusted portable import; no full DB rollback or same-origin compromise protection; actual Android WebView and storage pressure pending; no deployed railway legacy save format evidenced,Final GP-030 portable transfer and R47/R49/R52 acceptance pending,Approve transfer/key policy and device tests; reconcile bounded history checkpoint before cap; retain legacy CEO saves
DV-062,R40,OPEN,f15622d4ee6f7fa68e898a0bdcac8a540215ec65,Explicit policy inputs and tested web worker; isolated Android emulator harness authored,Actual emulator parity and native lifecycle PASS 45870806091; physical device acceptance pending; physical device unavailable; no approved production caps/rate/budget; prior acceptance gaps,Final platform and policy acceptance pending; owner permits provisional R41,Inspect native evidence; obtain approved policy; retain R49 physical device scope and prior gaps
DV-064,R41,OPEN,03e0af1272c5f9ba80262bf3339931fafee378a9,One explicitly unapproved synthetic profile; 10 scenario classes; 30/90-day horizons; actual R31/R35/R40 functions,No approved difficulty or balance targets; finite initial OD/stock no ongoing replenishment; same-model fleet; expansion eligibility not acquisition; isolated rescue not durable; no calibrated economic or Indian data,Full R41 balance acceptance blocked and R50 dependent; no inferred profit target,Approve profiles and ranges; integrate missing upstream mechanisms and rerun 100 seeds per approved horizon/profile
DV-066,R43,OPEN,d318312b2f04368e81da5fe52a6a02458ae92a24,Configured-route selection and actual quote dispatch bulk settle cancel park unpark service relocation screens; explicit blocked controls,No durable arbitrary route creation/edit/name/color/licence/fare/inspection modifications or acquisition/sale/starter company setup; R42 graph/map and R46 approved art R47 app root pending; no production scenario,Full UI-02/03/04/06/09/10/17 and GP-001/002/016/033 acceptance blocked; no fake actions,Implement missing authority under owner-approved dependency scope; integrate approved scenario and app root; full device and screenshot QA R49
DV-068,R44,OPEN,4345cb7f509518f82d67e16dac0c0a60d356f02e,Actual finance valuation and market projections; atomic governed purchase contract repayment rescue refinance,No approved ordinary lender offers IPO issuance/share trading regional inflation ROI scenario consultant capacity upgrade or aggregate liquidation/restart; production root and device pending,Full UI-19/20/22/23 and E24-E28 acceptance provisional,Approve missing policy and transactions and verify final device scope
DV-070,R45,OPEN,b950d0d2c40246352a8f0afab0bc076b69ce0e8d,GP-022 GP-026 GP-027 UI-01 UI-14 UI-15 UI-16 UI-22,Recognition only; no approved reward currency event coefficients rival dataset or IPO policy; isolated UI,Full implementation and production acceptance blocked,Approve scenario and integrate actual demand clock root and device scope
DV-072,R46,OPEN,e5ed2432eb54a613972b53a68b2c8be69d628570,GP-021 UI-03 UI-04; R12 R05; R46_ART_REVIEW.json,Generic original QA concept only; no approved final roster model art trademark or starter acquisition; legacy rights PENDING_OWNER,Full R46 R49 R51 acceptance blocked,Obtain approved original or licensed asset and calibrated catalog evidence and root integration; physical QA and final clearance
DV-074,R47,OPEN,8899fcafac5655c73f38c77cd5552668c99a2fb1,GP-030 UI-01 UI-02 R39 R40 R05,No approved starter scenario owner package origin brand icons transfer key policy or multilingual UI; QA identity only,Production guest and final platform acceptance blocked,Approve missing contracts and verify physical device and transfer recovery low storage and upgrade
DV-076,R48,OPEN,0a7dcf1e4b3837ac0231207822ed3d0a91c0aae8,R45 R47 dependencies; GP-028 GP-029 GP-018,Disabled scope only; no owner activation authorization and upstream functional scope incomplete,Final R48 and R52 acceptance pending,Reconcile R45 R47 and final release audit; activation only with separate owner approval
DV-078,R49,OPEN,7eed40b4d88b19b61485adb939ad21564f768ee4,Original R49 D03 and G5 dependencies R42 R43 R44 R45 R46 R47 R40,Real Indian map and region corruption/interruption tests missing; physical device low storage permission denial actual installation migration transfer and approved launch art and scenario unavailable,Full cross-platform acceptance blocked,Preserve R13–20/R42 and DV-060/062/066/068/070/072/074; complete final real device and data acceptance
DV-080,R50,OPEN,129a0c0780934dd83e7a8d8aa2c5f37e9e33a125,R20 R41 R49 D02 D03 D04,No actual regional graph and calibrated long-term scenario; physical device performance budgets and final full scope unavailable,Full R50 gate blocked,Preserve DV-064 DV-078 and real-data/physical device dependencies; measure approved production workloads
DV-082,R51,OPEN,534adccb643ef317f27896e4abb8fa33fdb79a0a,R02 R03 R18 R46; R51_DISTRIBUTION_REQUIREMENTS.json,No actual licensed geographic pack or approved project/brand/asset rights; native Maven inventory and final package review unavailable,Full redistribution gate blocked,Complete real data ODbL attribution and derivative offer boundary rights owner clearance and final native SBOM; preserve DV-072
DV-084,R52,OPEN,cfe9d0af8e129e9ef3889a2fa59e785fb338375a,Actual Verify 45887337309 1566/1566 and PWA 45887337233 PASS; prior 13/13 dedicated R52; native 45887337159 pending,Five invalid or stale imports and cross-install and missing-key rejection unchanged saves; CSP and disabled services PASS; exact CI 13/19,Native merged manifest and remaining CI not yet accepted,Reconcile exact native logs and preserve DV-085
DV-085,R52,OPEN,4acc8709371922de02bf3c08a2c14f0910b0d1d5,R39 R47 R48 and R52,Final deployment origin HTTPS hosting response headers publisher privacy URL contact physical device and cross-device policy missing; same-origin compromise and full DB rollback out of local HMAC threat model,Full security release gate blocked,Preserve DV-060/062/074/076/078 and final production security review
DV-086,R50,OPEN,e59c529b4e61929c1c72de1e579ea64397ad9441,Stress rerun 45884553941 job 140131903587 actual scaled test timed out 900000ms; 1000/10000 scheduler PASS,Prior exact correctness CI 18/18 retained; new runtime variability not production performance acceptance,Fresh stress runs and bottleneck measurement pending,Preserve DV-080; no weakened assertions; reconcile next exact run and optimize separately before release
DV-087,R53,OPEN,7946cc1ea2fa5bd1e372016529dd1cf93dd5d16a,Actual web 45888075642 job 140143659927 PASS and downloaded artifact 15149269572 SHA CRC and 4/4 manifest 32/32 inner hashes,Same runner repeated builds and deterministic ZIP verified; native job 140143660652 pending; exact CI 15/20,QA native and remaining exact CI not yet accepted,Reconcile actual APK AAB hashes signature manifest offline device install and preserve DV-088
DV-088,R53,OPEN,54c84ea91136dcffe9fb6de7ed318fa7c75b2b8f,R50 R51 R52 R37 R38 and R53,Approved production scenario and data rights identity version signing physical device native reproducibility and calibration missing,Full signed production release acceptance blocked,Preserve DV-055/057/080/082/085/086; no merge or production signing without explicit approval
```
## Historical closure register (44 rows retained verbatim)
```csv
id,task,status,observed_at_commit,check_or_command,last_result,dependency_impact,retry_action
DV-004,R04,CLOSED,3cb55955bf9c0d25cf624299b5625b10ce51b68e,45794396408 and equivalent 45794465233,Original Maven HTTP 429 failed; equivalent docs-only checkpoint Android success,Planning acceptance recovered; no actual device claim,Retain both run records
DV-005,R05,CLOSED,dbf82a42ac06e059568ba1d7e6f2a38e5dceb750,CI 45795215066 45795215087 45795215351 45795215086 45795215029,5/5 completed success; checkpoint eefc7f5 also 5/5,Foundation acceptance,Retain evidence
DV-013,R06,CLOSED,b2c13be0f24f86c1bb29741fbcebccfe2bc9a528,CI 45798509142 45798509185 45798509347 45798509182 45798509155,5/5 completed success; checkpoint d67fbe5 also 5/5,R06 accepted,Retain evidence
DV-014,R07,CLOSED,980e708fdc6375e37f0f69e1d92e7e12117f8df6,CI 45802848165 45802848155 45802848255 45802848179 45802848222,5/5 completed success; checkpoint e0e5776 also 5/5,R07 accepted,Retain evidence
DV-015,R08,CLOSED,fc637c57f47badddc7e3c07f53e55e6288e74328,CI 45804409871 45804409310 45804409417 45804409595 45804409345,5/5 completed success; checkpoint 4ef5106 also 5/5,R08 accepted,Retain evidence
DV-016,R09,CLOSED,f97aa926ff79bb94ca2552cd4a1be12d8804a313,CI 45806967040 45806966964 45806966938 45806966930 45806966966; checkpoint 5767008 CI 45807654944 45807654941 45807654988 45807654928 45807655037,Original and latest starting checkpoint 5/5 completed success,R09 accepted,Retain evidence
DV-019,R10,CLOSED,a93ef65f287af1c0264e61d5106fba137f8c574f,CI 45809806621 45809806558 45809806573 45809806675 45809806705,5/5 completed success; 560/560 repo tests; 54c5411 Android failure separately DV-020,R10 accepted,Retain evidence
DV-020,R10,CLOSED,54c54117d174bd3fc8ec155755bcc550154e79c5,Android CI 45809886182 job 139874665059; recovery 45810989053 and 45811059163,Original Maven HTTP429 exit1; subsequent equivalent production source Android success,Infrastructure recovered; final device verification still R53,Retain original failed and recovered runs
DV-021,R11,CLOSED,768a4dbfa0711b460d972b20bc72c260151b3807,CI 45810989053 45810988195 45810988231 45810988281 45810988211; checkpoint 4b90f53 also 5/5,5/5 both revisions; 671/671 repository tests,R11 accepted,Retain evidence
DV-022,R12,CLOSED,d3e1348ad360888b2a4482a11f321d91b00452a4,CI 45814601236 45814601347 45814601294 45814601254 45814601245; checkpoint 5790505 also 5/5,5/5 both revisions; 750/750 repo tests,R12 accepted and G1 accepted,Retain evidence
DV-024,R13,CLOSED,f2f91e30e062c92d551746f2eebe00e83de903bf,Generic CI 45815486698 45815486735 45815486695 45815486792 45815486693; checkpoint 2fea497 also 5/5,5/5 both revisions; no actual acquisition proof,Generic CI recovered only,Retain evidence
DV-027,R21,CLOSED,83cfe410845fb17712a2bae14f5e9bda8f179f3a,CI 45823142320 45823142394 45823142298 45823142377 45823142388; 885658c also 5/5,61/61 R21; 811/811 full repo tests; typecheck/build; both revisions 5/5,Executable CI accepted only; DV-026 original source remains open,Retain evidence
DV-029,R22,CLOSED,53883b84530711e59c942aea32358a2bbcf9e517,CI 45829922037 45829922035 45829921849 45829921758 45829922433,5/5 implementation CI success; 81/81 R22 and 892/892 full tests; typecheck/build,Executable verification accepted; source DV-028 separate,Retain evidence
DV-031,R23,CLOSED,886db5b4aa90a4bae1c5214c83a9f23e1fb5a980,CI 45831111480 45831111575 45831111461 45831111438 45831111415; 215b864 also 5/5,55/55 R23; 947/947 full tests; both revisions 5/5; typecheck/build,Executable verification accepted; DV-030 separate,Retain evidence
DV-033,R24,CLOSED,0b22792d79145ddec436649e5c561cf5605f9358,Original CI 45833044536 45833044781 45833044498 45833044512 45833044513; equivalent 3a06d4c CI 5/5,1004/1004 tests; Android original job 139954524345 Maven HTTP429 exit1; equivalent Android 45833262757 success,Executable recovery verified; source DV-032 separate,Retain failed and successful evidence
DV-035,R25,CLOSED,f0a196de074b0ff36d8cef80ae2a7635223a9c47,Corrected CI 45834381898 45834381881 45834381997 45834381880 45834381873; c70cceb also 5/5; original failed Verify 45834166623 and worker 45834166512,62/62 R25; 1066/1066 tests; strict compile/build; both corrected revisions 5/5,Executable recovery verified; DV-034 separate,Retain failure and recovery evidence
DV-037,R26,CLOSED,3a7e35205dc33a27ccd250d59f28f3e12b34eba7,CI 45836323406 45836322966 45836322740 45836322713 45836322758,5/5 exact implementation success; 40/40 R26; 1106/1106 tests; strict compile/build,Executable evidence accepted; DV-036 separate,Retain evidence
DV-039,R27,CLOSED,2fd859ea7d17e7f2c0756f35b35d85c0eab7b1bb,Original 45837672178 45837672374 45837672222 45837672151 success; 45837672240 failed; equivalent de547a0 5/5,1139/1139 tests; Android HTTP429 job 139970740643; equivalent Android 45837903153 success,Executable recovery verified; DV-038 separate,Retain failure and recovery evidence
DV-041,R28,CLOSED,74fa6c44a393eb52a66fc5013f1eba0d9e867cb0,CI 45842662966 45842662992 45842662913 45842663143 45842663072,5/5 exact CI success; Verify job 139988120291 45/45 R28 and 1184/1184 tests; typecheck/build,Executable verification accepted; DV-040 separate,Retain evidence
DV-042,R29,CLOSED,cc9cdea2093b60a0e1cfc8189da77f7764c1d249,Corrected CI 45844667899 45844667279 45844667109 45844667320 45844667507; d6987ad also 5/5; original Verify 45844460733 failed,33/33 R29; 45/45 R28; 1217/1217 tests; strict typecheck/build and both corrected revisions 5/5,Executable recovery verified; prior policy and DV-006 separate,Retain failure and recovery evidence
DV-043,R30,CLOSED,60a2e5f94840a6f02af4e8cf4471546cac7c889b,CI 45847796495 45847796460 45847796417 45847796752 45847796429; 9db0070 equivalent all 5 success,50/50 R30 and 1267/1267 tests; strict compile/build; both revisions 5/5,Executable verification complete; prior policy acceptance separate,Retain evidence
DV-044,R31,CLOSED,66501728e6c1873ac7cc3ab379ca05e6301bb9f7,Verify 45850828751 job 140016421716; Android 45850828621 job 140016420739 and rerun,43/43 R31; 1310/1310 full tests; typecheck/build; four original workflows passed; Android retry job 140025853032 completed success,Executable verification complete only,Retain original failed evidence and reconcile retry
DV-045,R32,CLOSED,15683d5ca555a2b0f5e5b0733c8d089b1d67af8b,Corrected revision and equivalent docs-only checkpoint CI all 5 success each,1353/1353 tests and 54 suites; 40 R32 plus 3 integration; initial TS2345 retained; Android success,Executable R32 verification complete,Retain original failure and exact corrected CI evidence
DV-046,R33,CLOSED,0c6993e8f295fb9f7b384f5c63392c5c2838e6a3,Hardened and equivalent docs-only checkpoint 5/5 each,40/40 R33; 1393/1393 full tests; 55 suites; typecheck/build success,R33 executable verification accepted,Retain both revisions and initial evidence
DV-047,R34,CLOSED,83f17a3ce26f5b7a55df0d33add2bb183d9a2cf5,Corrected exact CI all 5 success,30/30 R34; 1423/1423 tests; 56 suites; initial failure and correction retained,Executable CI verified only,Reconcile provisional predecessors and DV-048 at final acceptance
DV-049,R35,CLOSED,20c07fed7747f4e3901d40800c03f30b7d0e8ac0,Exact corrected implementation CI 5/5,25/25 R35; 1448/1448 repository tests; 57 suites; typecheck/build; prior failures retained,Executable verification only,Preserve DV-051 and dependencies
DV-050,R34,CLOSED,24f1957cbd0a3ea2884ebae4f267417e5e5cf70b,Android 45857103136 initial 140038232835 and retry 140041482798,Initial HTTP429 then retry completed success,Recovered docs-only Android verification,Retain original failed evidence
DV-052,R36,CLOSED,fb8f0e4950017f8978811ddcc4a7025b5302ac58,Corrected and equivalent docs-only CI all 5 success each,21/21 R36; 1469/1469 repository tests; 58 suites; prior failures retained,Executable verification only,Retain DV-054 and provisional predecessors
DV-053,R35,CLOSED,be846a277acf388dc5b8bc207f6cb22d9616c983,Release dependency and license audit 45858591302 completed/success; Verify game 45858591497 completed/success; Browser and offline smoke 45858591434 completed/success; G08 save and worker acceptance 45858591522 completed/success; Android QA APK and unsigned AAB 45858591520 completed/success,Docs-only checkpoint CI; identical corrected source already 5/5,Verified,Recheck docs-only platform evidence
DV-056,R37,CLOSED,3112bcf217386b454ec074b7017967ec196b3d5c,Ordinary CI all 5 success on initial and workflow correction and equivalent documentation checkpoint,12/12 synthetic and 1481/1481 full tests; 59 suites; typecheck/build,Ordinary verification only,Retain DV-055 independent oracle and approval
DV-058,R38,CLOSED,0727a4cc0d7d575b955210dae07e835518b1ad56,Both exact implementation and docs-only CI 5/5,12/12 R38 and 1493/1493 tests; 60 suites; typecheck/build success,Ordinary executable verification,Preserve DV-057
DV-059,R39,CLOSED,889f8a4070b2add5098f4d3b2b0330219c4cf62b,Hardened and docs-only ordinary and browser CI 6/6 each,8/8 codec; 1501/1501 full; 61 suites; 8 real Chromium acceptance groups; typecheck/build,Executable verification only,Retain DV-060 and provisional predecessors
DV-061,R40,CLOSED,03e0af1272c5f9ba80262bf3339931fafee378a9,Hardened ordinary CI 7/7 and QA revision CI 8/8; actual emulator 45870806091 job 140085410973 success,12/12 R40; 1513/1513; six Chromium groups; native parity actual; artifact 15143121873,Executable verification only,Physical device and approved clock policy remain DV-062
DV-063,R41,CLOSED,d318312b2f04368e81da5fe52a6a02458ae92a24,Corrected CI 9/9; actual 200 scenario run 45872165489 job 140090086615 success,1560 audits and zero invariant failures; report hash and provider artifact metadata recorded,Executable synthetic verification only,Keep DV-064 approved scope and long-term contracts
DV-065,R43,CLOSED,0b7daa13c5592361af0aeeda69be1f626f18c5fe,Actual corrected browser 45875915204 job 140102819837 SUCCESS seven groups; full regression PASS,Prior selector failures retained; actual flow and responsive QA complete,Executable R43 scope only,Retain DV-066 for missing contracts and R49 physical device
DV-067,R44,CLOSED,0b7daa13c5592361af0aeeda69be1f626f18c5fe,Exact executable CI 11/11 including 45875915242 45875915439 45875915377,All completed success; previous 8/11 checkpoint preserved,Executable CI accepted only,Preserve DV-068
DV-069,R45,CLOSED,e5ed2432eb54a613972b53a68b2c8be69d628570,Corrected Chromium 45878238362 and Verify 45878238422 success; exact CI 12/12 including Android WebView 45878238677,1541/1541 tests; original failure preserved,Executable scope accepted only,Preserve DV-070
DV-071,R46,CLOSED,0c9d85ef3843de84552d12fcc888a1affd58f18a,Styled Verify 45878667084 and Chromium 45878666921 success; exact CI 13/13 including Android WebView 45878666983,1544/1544 tests; actual art exclusion offline interaction and responsive browser PASS,Executable acceptance only,Preserve DV-072
DV-073,R47,CLOSED,a1ae52577789d810784d1bb6a906e26157891ebb,Exact CI 15/15; actual hardened PWA 45879602642 and separate Android 45879602529,Actual both-copy recovery and native airplane-mode guest creation process-death resume persisted quote lifecycle PASS,Executable acceptance only,Preserve DV-074
DV-075,R48,CLOSED,581b243f27a2d224be60dc97f34514beb70eac1e,Verify 45880137247 browser 45880137222 native 45880137293 success; exact CI 15/15,1548/1548; actual native APK permissions and emulator PASS; source and CSP checks PASS,Executable acceptance only,Preserve DV-076; final dependency scope separate
DV-077,R49,CLOSED,68a911bcbfd86f6bb4e07a75926385d612551b3f,Actual Chromium Firefox 45881400844 and native 45883407295; exact later CI 18/18 after R45 retry,Executable cross-platform test scope only; original startup cause unconfirmed,Full map and physical QA remain DV-078,Preserve original failures and full scope blockers
DV-079,R50,CLOSED,68a911bcbfd86f6bb4e07a75926385d612551b3f,Stress 45883407204 durable 45883407076 native 45883407295 Verify 45883407033 PASS; exact CI 18/18,6 fleet cases 10000 scheduler events three replay pairs 8 writers 7 stale rejections mirror recovery PASS,Executable correctness only; latency risk 32 train 355–392s and real data physical budget remain DV-080,Preserve full scope and optimize measured bottleneck before production
DV-081,R51,CLOSED,b99d06fc997618d6dce3bda6dd58f9d5d6197c92,Exact CI 19/19; later actual bundle 45884553936 native 45884553888 PWA 45884553921 PASS,238 lock 12 runtime 21 resources 8 asset records and 4 exact QA APK notices; offline UI PASS,Executable npm notice and bundle scope only,Preserve DV-082 and new DV-083
DV-083,R51,CLOSED,d0c2d5a775adbc28a3bedf4b3799f03c77508f5c,Actual native 45887252821 job 140140917604 PASS 61 components 53 artifacts 51 coordinates,50 declarations 1 unresolved; QA inventory evidence only,Final Maven obligations remain DV-082,Preserve actual unresolved declaration and final signed package review
```
## FIX IT execution order (proposed; owner command required)
1. **F00 evidence freeze** MR-052/053/054/056: exact HEAD, preserve old failed evidence, reconcile actual QA and DV; pin verification toolchain MR-043. Do not merge or alter PR1/main. Before each phase, re-open master and append test results/issue states.
2. **F01 real data critical path** MR-002 → R13 full actual validation → MR-003 R14 → MR-004 R15 and MR-005 R16 → MR-006 R17, MR-007 R18 → MR-008 R19 → MR-009 R20 → MR-010 R42. Follow original DAG; wait for private approved workspace and source rights. No synthetic geography or fabricated topology.
3. **F02 durable engine, performance, clock** MR-011–016/039–041/044/060: profile and fix measured bottlenecks first, archive/checkpoint without losing idempotency or money; worker and foreground clock; actual deterministic replay and failure tests. MR-012 stage real train workload tiers separately. Keep actual calibration gates.
4. **F03 economy/authority** MR-017–034: approve scenario/difficulty, rates, payment/settlement, train/base acquisition, event/repeat/partial delivery, insolvency and IPO policy; authoritative UI and ledger, actual real graph and mixed fleet. R37/R38 external holdouts and R41 30/90-day profiles; no invented parameters.
5. **F04 integrated game and original assets** MR-001/029/035–038/042/046/055/057/059: approved starter and production session, real map + all 23 screens and unseen tabs, physical offline/device QA, help/settings, explicitly disabled online; preserve existing saves and protected legacy. Approve visual/rights before incorporation.
6. **F05 license/security/release verification** MR-045/047–051/058: actual data redistribution, asset/brand/project rights, native SBOM/notices, final hosting/identity/signature, repeat exact tests, full physical install/upgrade and signed release evidence; private owner inputs cannot be fabricated.
7. **F06 final reconciliation** all MR and DV rows closed with actual checks or explicit owner-approved N/A, all GP/E/UI mapped, G0–G6 required gates met. Owner reviews result before START R54. No merge/publish or production signing unless separately authorized. This sequence is a plan, not a promise of all items fixable in one execution; owner inputs, actual datasets, calibration, physical device and external CI may block. Do not bypass dependencies to meet a deadline.

