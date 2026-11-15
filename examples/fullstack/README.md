# examples/fullstack

"Counter": a project of the fullstack shape as a finished install leaves it. It has two requirements (REQ-1.1 and REQ-1.2), one slice (P1/S-01) and an empty `src/`.

Unlike `examples/backend`, which is kept before `slicekit init` so the kit's walkthrough can run it, this directory holds every file init renders. Read it to see what an install of this shape adds to a repository.

## What init and status left

- `.claude/`: the `/slicekit` commands, the skills, the hook settings and the agents. `.claude/agents/designer.md` is there because the shape is fullstack; the other shapes do not get it.
- `.githooks/`: the three git hooks. Git runs them once `core.hooksPath` names `.githooks`; init sets that in a real repository, and the setting does not travel with a copy.
- `.github/workflows/slicekit.yml`: the CI workflow.
- `.slicekit/config.json` with `cli` filled in, `.slicekit/rendered/` (the base of each rendered file, which `slicekit update` compares against), `.slicekit/baselines/` and `.slicekit/state/`.
- `.gitattributes`, `.gitignore`, `docs/spec/00-overview.md` and the empty folders of the docs layout.
- `BUILD.md`: the queue, whose table `slicekit status --write` generated from the slice file.

## What was written by hand

The docs are at the end of the plan stage, so `/slicekit build` can start:

- `docs/intake/2026-11-15-counter.md`: the team's note. Its sidecar holds the four fields `slicekit intake snapshot` records; `origin` is the note's file name, so it names no one's machine.
- `docs/decisions.md`: D-01, settled.
- `docs/spec/01-counter.md`: REQ-1.1 (`GET /count` answers `{"count": <n>}`) and REQ-1.2 (the page shows the count).
- `docs/spec/stack.md`: the stack, and the design rules the designer agent judges the page against.
- `docs/spec/gaps.md`: the `Scanned:` line `slicekit gaps scan` wrote, with no gap found. The scan ran before the first commit, so the line names no commit.
- `docs/platform.md`, `docs/observability.md`, `docs/runbook.md`: filled in, so the gap scan finds nothing unknown.
- `docs/phases/P1-counter/`: the phase and its one slice, whose evaluation tests are `count.test.js` and `page.test.js`.
- `.slicekit/config.json` before init: the defaults with `commands.test` set to `node --test` and no `cli`.
- `package.json`: no dependencies.

## How it was made

1. The files above were written into an empty git repository on `main`.
2. `slicekit init --shape fullstack --name counter --cli slicekit` rendered the kit's files and wrote `cli` into the config.
3. `slicekit status --write` generated the table in `BUILD.md`.

When the kit's version or a template changes, `slicekit update --yes` run in a copy of this directory re-renders it, and the result is committed here. The kit's examples test fails, naming the file, when a rendered file here differs from what the kit renders.

## Try it

1. Copy this directory into a new git repository on `main` and run `git config core.hooksPath .githooks`.
2. Install the kit (`npm install --save-dev slicekit`), or set `cli` in `.slicekit/config.json` to the command that runs it.
3. Commit everything on `main` with `ALLOW_PROTECTED_COMMIT=1` set, because the kit's git hook refuses a commit on `main` without it. `slicekit check` then reports 0 findings.
4. Add an `origin` remote, push `main`, and run `/slicekit build` to build P1/S-01.
