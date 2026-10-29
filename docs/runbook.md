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

The repository goes public as a preview once P2/S-25 has merged and CI is green on `main` on Linux, macOS and Windows (D-28). The author changes the visibility by hand: Settings, General, Danger Zone, "Change repository visibility", Public. No command in the kit does this.

Preview versions reach npm from 0.1.1 (D-41); see "Releasing a preview".

After the switch, the README walkthrough is the first thing a visitor tries. A failure of `test/walkthrough.test.js` on `main` is a broken first impression: fix it before any other work.

## Releasing a preview

The author publishes, by hand, from their own npm account; no command in the kit and no CI job publishes. Until S-24 moves publishing into CI, a preview carries no provenance attestation (D-41).

1. The version in `package.json` is set in a merged slice, and CI on that `main` commit is green on Linux, macOS and Windows.
2. On an up-to-date `main` with a clean working tree, `npm test` passes, and `npm publish --dry-run` lists only `package.json`, `README.md`, `LICENSE` and files under `bin/`, `src/` and `templates/` (the package test checks the same list).
3. `npm login` once per machine, then `npm publish`. npm asks for the one-time code of the account's two-factor login.
4. Tag the commit and push the tag: `git tag v<version>` and `git push origin v<version>`.
5. `npm view slicekit version` prints the new version.
6. After the first preview only: `npm deprecate slicekit@0.0.1 "placeholder with no code; install slicekit@latest"`, so nobody installs the placeholder by pinning it.

## Rolling back a bad version on npm

A version number is never reused on npm, even after the version is removed, so a fix always ships as a new version.

- Within 72 hours of publishing, and when no other package depends on it, `npm unpublish slicekit@<version>` removes the version. Its number stays used.
- After that, `npm deprecate slicekit@<version> "<what is wrong>; use <fixed version>"` marks it: npm shows the message to anyone who installs it. Then publish the fix as the next patch version through "Releasing a preview".
- If the bad version carries the `latest` tag, point the tag back at the last good version until the fix is out: `npm dist-tag add slicekit@<good version> latest`.
