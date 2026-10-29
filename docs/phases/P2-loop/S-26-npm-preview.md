---
slice: P2/S-26
name: Preview on npm: 0.1.1
repo: .
group: G
runbook: yes
requirements: [REQ-5.7, REQ-5.8]
decisions: [D-30, D-40, D-41]
---

## Done when

1. `package.json` carries version `0.1.1` (D-40) and `repository`, `homepage` and `bugs` fields naming `github.com/adityapandya1/agentic-slicekit`, so the npm page links to the repository; it still has no `dependencies`. The kit's own rendered adapter files are re-rendered by `slicekit update --yes`, so they carry `v0.1.1` and `slicekit check` stays at `0 findings`.
2. The package test (Task 1) packs the kit with `npm pack` and checks what ships: every packed file is `package.json`, `README.md`, `LICENSE` or under `bin/`, `src/` or `templates/`, and `bin/slicekit.js` is among them. It then installs the packed file into an empty temporary git repository with no network and no other file of the kit, and there `npx slicekit --version` prints `0.1.1`, `npx slicekit init --shape backend --name demo` prints `hooks run: node node_modules/slicekit/bin/slicekit.js`, and `npx slicekit check` prints `0 findings` (REQ-5.7).
3. The not-installed warning `init` prints goes back to the install advice of D-30: `slicekit is not installed locally or on PATH; hooks will fail until it is (npm i -D slicekit, or set cli in .slicekit/config.json)`, with nothing about a clone or a missing release.
4. `README.md`'s `## Status: preview` says the kit is on npm as a preview from 0.1.1 and gives the install in a ` ```sh ` block outside the walkthrough: `npm i -D slicekit` and `npx slicekit init --shape backend --name <your-project>`. It says the walkthrough still runs from a clone, because it copies files only the repository holds (`examples/backend`, `examples/walkthrough`). Its `## How the hooks find slicekit` section names the local install first and the clone with `--cli` second. The walkthrough itself does not change.
5. `docs/runbook.md` gains `## Releasing a preview` and `## Rolling back a bad version on npm` (REQ-5.8): the release is the author's, by hand, from an up-to-date `main` that is green on all three systems; `npm publish --dry-run`, then `npm publish` with the one-time code; then a `v<version>` tag on that commit; after 0.1.1, `npm deprecate slicekit@0.0.1` pointing at the new version. A bad version is unpublished only within npm's 72 hours; after that it is deprecated with a message naming the fixed version, and the fix ships as the next patch. A version number is never reused. `## Going public as a preview` no longer says npm keeps the placeholder until S-24.
6. Nothing in the slice publishes to npm, pushes a tag or changes a repository setting; the publish is the author's after the slice merges.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `package.test.js » the packed kit installs into an empty project and runs version, init and check` | e2e | REQ-5.7 |
| `package.test.js » npm pack ships bin, src, templates and the files npm adds, and nothing else` | happy | REQ-5.7 |
| `package.test.js » a packed file outside bin, src and templates is refused, naming it` | negative | REQ-5.7 |
| `package.test.js » package.json is 0.1.1, links the repository and has no dependencies` | happy | REQ-5.7 |
| `hook-cli.test.js » probe order: a local install, then slicekit on PATH, else the PATH form with a warning, never the registry` | happy | REQ-5.7 |
| `readme.test.js » the status section gives the npm install and says the walkthrough runs from a clone` | happy | REQ-5.7 |
| `readme.test.js » the status section names no placeholder and no release still to come` | negative | REQ-5.7 |
| `runbook.test.js » the runbook says how to release a preview and how to roll back a bad version` | happy | REQ-5.8 |

## Expected changes

`package.json`, `.claude/`, `.slicekit/rendered/`, `src/hook-cli.js`, `README.md`, `docs/runbook.md`, `test/package.test.js`, `test/hook-cli.test.js`, `test/readme.test.js`, `test/runbook.test.js`, tests.

## Tasks

### Task 1: Version 0.1.1 and what npm ships

**Files:** Modify `package.json`, `test/hook-cli.test.js` and any test that names `0.0.1` as the kit's version (read it from `package.json` instead). Re-render `.claude/` with `node bin/slicekit.js update --yes`. Create `test/package.test.js`.

**Interfaces:**
- `packProblems(files) → string[]`: one `<file> is outside bin, src and templates` per packed path that is not `package.json`, `README.md`, `LICENSE` or under `bin/`, `src/` or `templates/`, and `bin/slicekit.js is missing` when it is absent. The test reads the list from `npm pack --dry-run --json` (the `files[].path` of its one entry).
- The install test packs into a temporary directory, runs `npm install --offline --no-audit --no-fund -D <tarball>` in a fresh `makeRepo` repository, and runs the kit through `npx --no-install slicekit` there. npm is `npm.cmd` through the shell on Windows.

- [ ] **Step 1: Failing tests** — the four `package.test.js` tests above; `packProblems(['package.json', 'bin/slicekit.js', 'docs/runbook.md'])` → `['docs/runbook.md is outside bin, src and templates']`, and `packProblems(['package.json'])` names the missing bin.
- [ ] **Step 2: Run** `node --test test/package.test.js` → FAIL (version is 0.0.1).
- [ ] **Step 3: Implement** the version, the fields and the helper; run `update --yes`.
- [ ] **Step 4: Run** `node --test test/package.test.js test/hook-cli.test.js` and `node bin/slicekit.js check` → PASS, `0 findings`.
- [ ] **Step 5: Commit** `feat(package): 0.1.1, and a test of what npm ships`.

### Task 2: The install advice and the README

**Files:** Modify `src/hook-cli.js`, `test/hook-cli.test.js`, `README.md`, `test/readme.test.js`.

**Interfaces:**
- The warning text of Done when 3, word for word.
- `readme.test.js` keeps its heading-order test and its `git clone` check (the walkthrough's reader still clones), and replaces the placeholder and first-release assertions with the two tests above: the status section matches `npm i -D slicekit` and `npx slicekit init`, and matches neither `placeholder` nor `first real release`.

- [ ] **Step 1: Failing tests** — the warning and the two README tests.
- [ ] **Step 2: Run** `node --test test/hook-cli.test.js test/readme.test.js` → FAIL.
- [ ] **Step 3: Write** the warning and the README sections.
- [ ] **Step 4: Run** the same, `node --test test/walkthrough.test.js` and `node bin/slicekit.js check` → PASS, `0 findings`.
- [ ] **Step 5: Commit** `docs(readme): install from npm; the walkthrough still runs from a clone`.

### Task 3: The release in the runbook, and the whole suite

**Files:** Modify `docs/runbook.md`. Create `test/runbook.test.js`.

**Interfaces:**
- The two sections of Done when 5. `runbook.test.js` checks that both headings exist, that the release section names `npm publish --dry-run`, `npm publish` and `npm deprecate`, and that the rollback section names the 72 hours and says a version number is never reused.

- [ ] **Step 1: Failing test** — `the runbook says how to release a preview and how to roll back a bad version`.
- [ ] **Step 2: Run** `node --test test/runbook.test.js` → FAIL.
- [ ] **Step 3: Write** the sections.
- [ ] **Step 4: Run** `npm test` and `node bin/slicekit.js check` → PASS, `0 findings`.
- [ ] **Step 5: Commit** `docs(runbook): releasing a preview, and rolling back a bad version`.
