# Implementation contract

Read docs/MASTER_BUILD_SPEC.md and docs/EXECUTION_LEDGER.md. One feature PR; preserve the 25 systems, 34 experiences, 15 panels and 60 task IDs. Never mark a gate passed without evidence. Keep independent work moving and log blockers. Use original or license-verified assets only. No source copying without provenance. One deterministic engine and ledger for web and Android. Do not merge until all release gates pass.

## Owner gate sequencing
Read docs/GATE_EXECUTION.md. Owner superseded strict pass-before-next sequencing: implement the requested gate, record unresolved scope and deferred verification, and continue the next gate only on owner instruction. G12 is the active final remediation gate. G01–G11 must be reopened and individually verified; none is accepted by default. Do not claim a pass or merge until every gate is actually verified. License/provenance blockers prohibit incorporating uncleared third-party code or assets; use independent alternatives and log the exclusion.

## Railway V5 branch only
For feat/railway-manager-v5, docs/railway/STATE.md and EXECUTION_LEDGER.csv are the active railway task authority, alongside private V4/V5 evidence. Legacy rules apply to the untouched CEO baseline, not railway scope. Never place evidence or unapproved assets in the product. Read R02_QUARANTINE.md and registries; run quarantine audit before accepting changes. No merge into legacy feature branch.
