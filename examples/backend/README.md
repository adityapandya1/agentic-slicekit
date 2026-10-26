# examples/backend

The smallest project a slice can be built in: one requirement (REQ-1.1), one slice (P1/S-01) and an empty `src/`.

The docs are at the end of the plan stage, so `/slicekit build` can start. Each file is what an earlier stage left behind:

- `docs/intake/2026-10-26-greeting.md` and its sidecar: the team's note, pinned with `slicekit intake snapshot` (the sidecar's `origin` was then set to the note's file name, so it names no one's machine).
- `docs/decisions.md`: D-01, settled.
- `docs/spec/01-greeting.md`: REQ-1.1. `docs/spec/stack.md`: the stack.
- `docs/spec/gaps.md`: the `Scanned:` line `slicekit gaps scan` wrote, with no gap found.
- `docs/platform.md`, `docs/observability.md`, `docs/runbook.md`: filled in, so the gap scan finds nothing unknown.
- `docs/phases/P1-greeting/`: the phase and its one slice.

`<kit>` below is the path of your slicekit checkout. `.slicekit/config.json` names no `cli`: init writes the one you pass, and rewrites the file with two-space indentation.

1. Copy this directory into a new git repository on `main`.
2. Add an `origin` remote; it is required, because `build start` pushes the slice branch.
3. Run `node <kit>/bin/slicekit.js init --shape backend --cli "node <kit>/bin/slicekit.js"`. Init adds the kit's hooks, templates and the rest of the docs layout and keeps the files here as they are.
4. Run `node <kit>/bin/slicekit.js status --write`, so `BUILD.md` gets its generated region.
5. Commit everything on `main` with `ALLOW_PROTECTED_COMMIT=1` set, because the kit's git hook refuses a commit on `main` without it, and push `main` to `origin`. On `main`, `node <kit>/bin/slicekit.js check` now reports 0 findings and `node <kit>/bin/slicekit.js stage require plan` prints `ready: plan`.
6. Run `/slicekit build` to build P1/S-01 from `todo` to a draft pull request.
