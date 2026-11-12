---
slice: P5/S-48
name: Versions follow the plan, published from CI
repo: .
group: R
runbook: yes
requirements: [REQ-5.5]
decisions: [D-62, D-63, D-90, D-91]
---

## Done when

1. With `release.auto` true in config (default false; the kit's own config sets it), the sync pull request after a slice pull request merges also sets `package.json`'s version: the patch number up by one, or, when a merge it records leaves every slice of that slice's phase `merged` or `released`, the minor number up by one and the patch at 0; and it adds the newest `CHANGELOG.md` section for that version, naming each slice the sync records as newly merged (its ID, name and pull request), and for a minor version the phase and each of its slices. A sync that supersedes an earlier unmerged one, and so records several slice merges, sets one version whose section names every one of them, so no merged slice drops out of the changelog; and it carries the files `update --yes` writes at that version (the rendered `.claude/` files name the kit's version), as `build render` would commit them (REQ-5.5, D-43, D-90).
2. A merge that changes `package.json`'s version itself, a `[plan]`, `[sync]` or `[release]` merge, and a config without `release.auto` set no version and add no section; the next merge counts from the version on the default branch, never from a version an open sync pull request proposes (REQ-5.5, D-90).
3. `check --ci` on a sync pull request accepts a change to `package.json` only in its `version` field, to `CHANGELOG.md` only as one new section on top, and to rendered files only where they equal a fresh render at that version, each equal to what CI computes for the merge the sync branch names; any other change to those files in a sync pull request is one finding naming the file (REQ-5.5, D-43, D-89, D-90).
4. `.github/workflows/publish.yml` runs on a push to the default branch and on `workflow_dispatch`; when `package.json`'s version is not on npm and no tag `v<version>` exists, one job on `ubuntu-latest` in the environment `npm`, with `id-token: write` and `contents: write`, runs `npm ci` and `npm test`, installs npm 11.5.1 or later, runs `npm publish --provenance --access public` with no token, then pushes the tag `v<version>`; otherwise it publishes nothing; every action is pinned by SHA from `templates/workflow/pins.json` (REQ-5.5, D-62, D-91). <!-- slicekit:pending P5/S-48 -->
5. `package.json` is 0.3.0, `CHANGELOG.md`'s newest section is 0.3.0, Phase 4, and the kit's `.claude/` is rendered at 0.3.0, so this slice's own merge publishes 0.3.0 and its sync sets no version (D-63); the kit's runbook says how a version is published (the merge, the environment's approval, `npm view slicekit@<version> dist.attestations`), lists the author's one-time npm and GitHub settings, and how to roll back a bad version (REQ-5.5, D-62, D-91).

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `release-version.test.js » a slice merge sets the next patch version and a changelog section` | happy | REQ-5.5 |
| `release-version.test.js » the merge that completes a phase sets the next minor version` | happy | REQ-5.5 |
| `release-version.test.js » a sync that records two slice merges sets one version naming both` | happy | REQ-5.5 |
| `release-version.test.js » a merge that sets the version itself, a plan merge, or a config without release.auto sets no version` | negative | REQ-5.5 |
| `release-version.test.js » a sync pull request whose version or changelog differs from what CI computes fails` | negative | REQ-5.5 |
| `publish.test.js » the publish workflow pins every action by SHA and publishes with provenance when the version is new` | happy | REQ-5.5 |
| `publish.test.js » the publish workflow publishes nothing when the version is already on npm or tagged` | negative | REQ-5.5 |
| `runbook.test.js » the release steps name the environment's approval, the attestation check and the rollback` | happy | REQ-5.5 |

## Expected changes

`src/release-version.js`, `src/state/sync.js`, `src/cli/sync.js`, `src/cli/status.js`, `src/check/rules/journal.js`, `src/check/rules/sync-release.js`, `src/check/index.js`, `src/config.js`, `.slicekit/config.json`, `templates/workflow/slicekit.yml`, `.github/workflows/slicekit.yml`, `.github/workflows/publish.yml`, `templates/workflow/pins.json`, `package.json`, `CHANGELOG.md`, `.claude/`, `docs/runbook.md`, `docs/platform.md`, `test/fixtures/golden/workflow/`, tests.

## Tasks

### Task 1: The version a sync pull request sets

**Files:** Create `src/release-version.js`, `test/release-version.test.js`. Modify `src/state/sync.js` (or `src/cli/status.js`, wherever `status --sync --write` computes the sync change), `src/config.js`, `.slicekit/config.json`, `src/check/` (the sync pull request's rule).

- [ ] **Step 1: Failing tests** — the five `release-version.test.js` tests above, on a fixture repository with a fixture host (`SLICEKIT_GITHOST_FIXTURE`); no test reaches the network.
- [ ] **Step 2: Run** `node --test test/release-version.test.js` → FAIL.
- [ ] **Step 3: Implement** `nextVersion({ current, merges, phaseComplete })` and `changelogSection(...)` as pure functions; the sync step writes `package.json` (only the `version` field, the file's other bytes unchanged), prepends the section under the file's intro and runs `update --yes` so the rendered files follow; `release.auto` is validated as a boolean; CI recomputes both for the merge the sync branch names, as D-89 does for the heads log.
- [ ] **Step 4: Run** the same → PASS.
- [ ] **Step 5: Commit** `feat(release): the sync pull request sets the next version`.

### Task 2: Publishing from CI

**Files:** Create `.github/workflows/publish.yml`, `test/publish.test.js`. Modify `templates/workflow/pins.json` only if an action is not pinned yet, `docs/runbook.md`, `docs/platform.md` (its deployment line says a pushed `v*` tag publishes; it becomes a merge to the default branch, approved in the `npm` environment), `test/runbook.test.js`.

- [ ] **Step 1: Failing tests** — the two `publish.test.js` tests (they read the workflow as text, and run its "is this version new" script with a stubbed `npm view` and `git ls-remote`), and the `runbook.test.js` test.
- [ ] **Step 2: Run** `node --test test/publish.test.js test/runbook.test.js` → FAIL.
- [ ] **Step 3: Implement** the workflow as Done-when 4 says; the runbook's `## Releasing a preview` becomes `## Releasing a version`, with the author's one-time settings of D-62 and D-91 under `## Dependencies and their owners`.
- [ ] **Step 4: Run** the same → PASS.
- [ ] **Step 5: Commit** `feat(release): publish from CI when the version is new, with provenance`.

### Task 3: 0.3.0

**Files:** Modify `package.json`, `CHANGELOG.md`, `.claude/` (through `build render`), `test/package.test.js` and `test/runbook.test.js` where they pin the version.

- [ ] **Step 1:** `package.json` 0.3.0; `CHANGELOG.md` gains `## 0.3.0`, Phase 4: what S-37 to S-47 added, fixed and changed, in the file's existing voice.
- [ ] **Step 2:** `node bin/slicekit.js build render P5/S-48`; run the slice's tests and `node bin/slicekit.js check` → PASS.
- [ ] **Step 3: Commit** `chore(release): 0.3.0, Phase 4`.
