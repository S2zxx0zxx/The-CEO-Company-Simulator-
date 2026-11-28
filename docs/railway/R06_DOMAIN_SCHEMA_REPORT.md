# R06 — Canonical units and railway domain schemas
Date 2026-11-26 IST. R06/G1 depends R05; deliverable domain models; acceptance: invalid units, unknown values and overflow rejected. Actual isolated TypeScript source, not a second runtime engine. No legacy code, package, UI, save namespace or platform change.

## Source authority
Original V4 SHA-256 ebd171202005b8a680540c7f9add297298feb69ea11acc1b36f5c86c46b9f4ea and V5 ba177fb4ecbc7247696459e4794fec878adf2c0f0b6ebc07903339653376e41d both CRC pass. Embedded master equals uploaded MD. V4 contracts/domain_contracts.ts equals V5 traceability/V4_DOMAIN_CONTRACTS.ts (SHA-256 d83b242e8d90248fcc7a79f68d7780e9253e648afa471eaad045645a8fa6551f); task ledger byte match aa768a3f7e6c5d57ca6334e5a59ec4850d15d136f27ab687e5a0b681a09422b3. V5 sections 2,3,5,7 and gameplay/economy registers reviewed, R05 mapping reopened. SHA-256 comparison of five new source/test blobs against all 3059 original archive files: zero exact byte matches (not complete derivative rights clearance). No original asset or private archive committed; screenshot bytes not reopened for this non-UI task.

## Implementation
- units.ts: branded m, s, kg, seats, km/h, mm, V, Hz, bps; decimal INR paise and signed reporting type, separate energy decimal amounts; safe integer and nonnegative bounds, BigInt exact addition/subtraction, rational floor/ceil/toward-zero, explicit speed/time conversion and overflow rejection. Number.MAX_SAFE_INTEGER numeric bound; 30-digit decimal bound consistent with legacy amount validation. Wh/mL/g separate; steam representation does not enable gameplay.
- validation.ts: required/unknown fields, plain object/dense array checks, ordinary getter rejection, duplicates, enums, coordinate ranges, SHA-256 syntax, UTC and provenance URL. Null and explicit unknown data remain unknown, not compatible defaults.
- models.ts: 37 direct decode exports and 3 registry decoder factories, inferred types; original V4 interfaces plus V5 supplemental entity shapes. Station/node/edge/turn/graph, train model/profile/fleet, route/draft/quote/trip, conserved demand, energy lot/contract, balanced journal, company/base/yard, passenger/cargo/slot, staff/service/loan/subsidy/campaign/mission/receipt/share ledger. Command/event/save require registered payload/state/RNG decoders. Hash/checksum syntax only; integrity and migrations R39.
- Engineering choices: schema v1, stable ASCII IDs <=128 chars, bounded strings/arrays (default <=100k, graph arrays <=1M), integer quantities and geographic floating coordinates, INR-only journal, Easy/Realism difficulty, condition basis points. Supplemental shapes provisional, not final balance or transition policy. No fabricated real train facts. R07 topology/references, R08 compatibility, R09 routing, R10 continuity and quote immutability, R12 provenance/catalog, R21–R41 authoritative economy/events/persistence still required. No graph engine or gameplay claim.

## Local verification
Node v22.16.0 and TS 5.8.3 local CLI (repo lock TS 5.9.3). Initial compile failed generic path narrowing, fixed explicit string annotation and recompiled exit 0:
    tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution Bundler src/domain/*.ts tests/railway-r06.cases.ts
    tsc --strict --target ES2022 --module commonjs --moduleResolution node --outDir out src/domain/*.ts tests/railway-r06.cases.ts
Node executed every compiled shared case function from out/tests/railway-r06.cases.js: 206/206 pass, unique names 206, exit 0. Tests cover positive JSON roundtrip, extra/unknown fields, invalid/overflow units, exact decimal, rational rounding, mixed energy, dates/coordinates, demand/journal/share conservation, payload registry, pending event order/duplicates and input non-aliasing. Vitest wrapper invokes identical shared cases; actual full repository Vitest/build not run locally (Git DNS exit 128). 254 production LOC and 90 test LOC. Local Git blob hashes match all five GitHub create_blob responses. Initial tree request rejected 422 because truncated base tree SHA supplied; no ref changed. Full tree fetched and validated before retry.

| Path | Git blob | SHA-256 |
|---|---|---|
| src/domain/units.ts | 8d78150ccc7c453f154d4943048e30ef07de5570 | 402867cd1653599a5ef0b3971b00989936abedbd644ab85a2bd2a9c210e24a6d |
| src/domain/validation.ts | 262bd8b63d93848b8f6f98f8dd8bffcbf0c5090c | 196cb890d5655de0cce1b0eb346ffd16bc903fb5067483575b8c3182f533ef72 |
| src/domain/models.ts | 01cd4ebbb9dd7594d18eafc3940d046a23cbbd97 | aebd533b643f07c59ec05559ff82dc5a4015d94f9bfa70a55aaa76979212e15c |
| tests/railway-r06.cases.ts | 263a150e639dfc112d7122d1fbc0cd865184711c | 1f8883955a5946c8ce8b15d4666549a30cbd9958ccaff6e4182ead10f465e175 |
| tests/railway-r06.test.ts | ac12370ea0e64b19e1a37f58f069e84ed8ab73af | fafde913f2171a3658ed111f12d6f4e7be4b847c3c6e6fddb5c95170dd22ce6e |

## Status
R05 dbf82a42ac06e059568ba1d7e6f2a38e5dceb750 and checkpoint eefc7f5d075bd8cd4f3dd134a887c261825fb73c both 5/5 CI completed success. R05 PASS, G0 accepted for foundation scope; DV-005 closed. R06 local acceptance passed, full repository CI/readback pending: IMPLEMENTED_UNVERIFIED. Next R07 provisional under owner protocol. No merge or release.

## Repository readback checkpoint
Implementation b2c13be0f24f86c1bb29741fbcebccfe2bc9a528; all five source/test file hashes matched local-tested Git blobs. Compare: five added source/test files, five docs-only changes; protected refs unchanged. CI: Android QA APK and unsigned AAB 45798509182: in_progress/pending; Verify game 45798509142: in_progress/pending; Browser and offline smoke 45798509185: in_progress/pending; G08 save and worker acceptance 45798509155: in_progress/pending; Release dependency and license audit 45798509347: in_progress/pending. DV-013 open for fresh repository CI; no false PASS. Next R07 under owner protocol. No merge.

## R06 closure at R07
Both implementation b2c13be0f24f86c1bb29741fbcebccfe2bc9a528 and checkpoint d67fbe56ce1e2f3387ff6d9df3dd537a48b0bee6 five CI runs completed success (implementation 45798509142 45798509185 45798509347 45798509182 45798509155; checkpoint 45798576681 45798576696 45798576613 45798576615 45798576715). R06 PASS; DV-013 closed.
