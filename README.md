# Agentic SliceKit

Spec-driven, slice-by-slice delivery for AI coding agents, with a traceable line from every
requirement to every test, commit, pull request and release. The spec stays true because a machine
checks it on every stop and in CI, not because anyone remembers to update it.

**Status:** specification stage. Nothing is installable yet. Read `docs/spec/00-overview.md` for what
it is and why, `docs/decisions.md` for every choice made so far, and `BUILD.md` for the order it is
being built in. The kit is being built with itself.

What it is not: a code graph. It does not parse your language. graphify and similar tools sit
alongside it.

## How the hooks find slicekit

`slicekit init` writes the hook command as `node node_modules/slicekit/bin/slicekit.js` when the
repository has a local install, and `slicekit` otherwise, which needs slicekit on PATH. When neither
is found, init still writes `slicekit` and warns that the hooks will fail until it is installed; it
never fetches slicekit from the registry. `cli` in `.slicekit/config.json` (or `init --cli <command>`)
overrides that choice, and init and update warn when the command does not answer `--version`. The hooks run from the session's working directory, so
a worktree outside the repository tree needs an absolute path in `cli` or a global install (D-30).

License: MIT.
