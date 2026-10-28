# Runbook: slicekit

## How to run it

Not yet known

## Dependencies and their owners

`gh` (GitHub CLI), authenticated (`gh auth status`), is needed by `slicekit pr open` and the build commands; tests use `SLICEKIT_GITHOST_FIXTURE` instead.

Declined should-haves become GitHub issues through `gh` (`slicekit build decline`), so its login needs permission to open issues in the repository; tests use `SLICEKIT_TRACKER_FIXTURE` instead.

In a fork, run `gh repo set-default` so issues (and pull requests) go to the right repository.

## Known failure modes and the first thing to check

Not yet known

## Actions and who may take them

Not yet known

## Rollback

Not yet known

## Going public as a preview

The repository goes public as a preview once this slice has merged and CI is green on `main` on Linux, macOS and Windows (D-28). The author changes the visibility by hand: Settings, General, Danger Zone, "Change repository visibility", Public. No command in the kit does this.

Nothing is published to npm at this point. The `slicekit` package keeps its 0.0.1 placeholder until S-24 publishes 0.1, so the README tells readers to run the kit from a clone.

After the switch, the README walkthrough is the first thing a visitor tries. A failure of `test/walkthrough.test.js` on `main` is a broken first impression: fix it before any other work.
