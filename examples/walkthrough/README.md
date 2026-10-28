# examples/walkthrough

This folder is not an example project. It holds what a developer agent, a reviewer and GitHub
would produce during the walkthrough in the kit's `README.md`, so a reader can run the whole
walkthrough without an agent or a GitHub account. The walkthrough copies each file in at the step
where the agent, the reviewer or GitHub would have made it.

| File | Stands in for | Used at |
|---|---|---|
| `test/greet.test.js`, `test/greet-empty.test.js` | the developer agent's tests for P1/S-01, the two rows of its evaluation set | `build red` |
| `src/greet.js` | the developer agent's code | `build commit --require-green` |
| `notes.json` | what the developer agent knows that the diff does not: the `--notes` input of `build pr` | `build pr` |
| `P1-S-01-r1.md` | the in-loop reviewer's verdict, `APPROVE` | `build verdict` |
| `P1-S-01i-r2.md` | the independent reviewer's verdict, `APPROVE` | `build verdict --independent` |
| `host.js` | GitHub reporting CI and merging the pull request | after `build pr` and at the merge |

The tests and the code are the ones the kit's own end-to-end test writes for P1/S-01 on a copy of
`examples/backend`, so the red step fails and the green step passes the same way there and here.

## host.js

The walkthrough sets `SLICEKIT_GITHOST_FIXTURE` to a directory, and the kit then reads and writes
pull requests there as files instead of calling `gh`. Two things happen on GitHub without anyone
running a command: CI reports on the pull request's head, and someone presses merge. `host.js`
does those two:

```sh
node examples/walkthrough/host.js ci <n> <success|failure>
node examples/walkthrough/host.js merge <n>
```

- `ci` sets the pull request's head to the tip of its branch in `origin` and records one finished
  CI run on that commit with the status given.
- `merge` merges the pull request's branch into its base in `origin` with a merge commit, then
  marks the pull request merged, so `slicekit status --sync` moves the slice to `merged`.

It writes only in the `SLICEKIT_GITHOST_FIXTURE` directory and in the bare `origin`; the merge is
made in a temporary clone inside the fixture directory. Your checkout is never changed: pull to
see the merge. Without `SLICEKIT_GITHOST_FIXTURE` it refuses to run.
