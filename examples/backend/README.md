# examples/backend

The smallest project a slice can be built in: one requirement (REQ-1.1), one slice (P1/S-01) and an empty `src/`.

`<kit>` below is the path of your slicekit checkout. `.slicekit/config.json` names no `cli`: init writes the one you pass.

1. Copy this directory into a new git repository on `main`.
2. Add an `origin` remote; it is required, because `build start` pushes the slice branch.
3. Run `node <kit>/bin/slicekit.js init --shape backend --cli "node <kit>/bin/slicekit.js"`. Init adds the kit's hooks, templates and the rest of the docs layout and keeps the files here as they are.
4. Run `node <kit>/bin/slicekit.js status --write`, so `BUILD.md` gets its generated region.
5. Commit everything on `main` with `ALLOW_PROTECTED_COMMIT=1` set, because the kit's git hook refuses a commit on `main` without it, and push `main` to `origin`. `node <kit>/bin/slicekit.js check` on `main` now reports 0 findings.
6. Run `/slicekit build` to build P1/S-01 from `todo` to a draft pull request.
