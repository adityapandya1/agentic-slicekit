---
slice: P3/S-31
name: Every test names its requirement
repo: .
group: B
runbook: no
requirements: [REQ-4.3, REQ-5.5]
decisions: []
---

## Done when

1. A test in the kit's own suite fails, naming each file, when a test file under `test/` that `isTestFile` matches names no requirement the spec defines. A REQ ID that the spec does not define, such as the made-up IDs the check fixtures use, does not count.
2. A file may be left untagged only through an allowlist inside that test, one entry per file with a one-line reason. The test also fails when an allowlisted file is missing, or when it names a requirement and so no longer needs its entry.
3. Every test file under `test/` that names no requirement today gains a comment at its top naming the requirements its tests check, read from what the tests assert, not from the file name. A file whose tests check no requirement goes on the allowlist instead.
4. After the change, `uncovered` as computed from `graph.json` lists no requirement that a merged slice built and a test file checks. Requirements not built yet (REQ-2.9, REQ-2.13, REQ-2.14, REQ-4.6, REQ-4.7) may still appear.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `req-tags.test.js » every test file under test/ names a requirement the spec defines, or is allowlisted` | happy | REQ-4.3, REQ-5.5 |
| `req-tags.test.js » an allowlisted file that is missing, or that names a requirement, fails the test` | negative | REQ-5.5 |
| `req-tags.test.js » a REQ ID the spec does not define does not count as a tag` | negative | REQ-4.3 |

## Expected changes

`test/req-tags.test.js`, and a comment line at the top of each untagged test file under the test directory. No source file changes.

## Tasks

### Task 1: The guard test

**Files:** Create `test/req-tags.test.js`.

- [ ] **Step 1: Failing tests** — the three tests above. The file list is `testFiles(root, cfg)` from `src/graph/tests.js`, kept to paths under `test/`; the mentions are `reqMentions`; the defined IDs come from the spec the same way `slicekit check` reads them. The allowlist starts empty, so the first test fails, naming the files that are untagged today.
- [ ] **Step 2: Run** `node --test test/req-tags.test.js` → FAIL, naming each untagged file.

### Task 2: Tag the files

**Files:** Modify each untagged test file under `test/` (one comment line at the top), and the allowlist in `test/req-tags.test.js`.

- [ ] **Step 1: Tag** — for each file, read its tests and name the requirements they check, as `// REQ-x.y, REQ-x.y: <what the file checks>`. A file of helpers or plumbing that checks no requirement goes on the allowlist with its reason.
- [ ] **Step 2: Run** `node --test test/req-tags.test.js` and `node bin/slicekit.js check` → PASS, `0 findings`; rebuild the graph and confirm done-when 4.
- [ ] **Step 3: Commit** `test(P3/S-31): every test names its requirement`.
