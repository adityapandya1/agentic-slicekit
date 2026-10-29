---
slice: P4/S-24
name: Examples, walkthrough, publish from CI
repo: .
group: C
runbook: no
requirements: [REQ-4.8, REQ-5.5, REQ-5.6, REQ-5.7, REQ-5.8]
decisions: [D-28, D-41]
---

## Done when

1. `examples/fullstack` and `examples/data`; the ten-minute walkthrough runs verbatim in CI on three operating systems; REQ-5.5 to REQ-5.8; the repository went public as a preview at the end of Phase 2 (P2/S-25, D-28) and preview versions reached npm from 0.1.1 (P2/S-26, D-41); this slice moves publishing into CI, with provenance attestations (REQ-5.5).
2. An older `configVersion` is migrated forward on first run, printing what changed.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `walkthrough.test.js » the README walkthrough's commands exit 0 on examples/backend` | e2e | REQ-5.7 |
| `examples.test.js » every example checks green` | happy | REQ-5.5 |
| `examples.test.js » a rendered adapter file that differs from its template fails, naming the file` | negative | REQ-5.5 |
| `user-guide.test.js » a command or check rule with no guide page fails, naming it` | negative | REQ-5.8 |
| `config.test.js » an older configVersion is migrated and each change printed` | happy | REQ-5.6 |

## Expected changes

`examples/fullstack/`, `examples/data/`, `README.md`, `docs/guide/`, `docs/adapters.md`, `src/config.js`, tests.
