---
slice: P2/S-10
name: `/slicekit intake`
repo: .
group: B
runbook: no
requirements: [REQ-1.2, REQ-2.2]
decisions: [D-08, D-17, D-20]
---

## Done when

1. `slicekit intake snapshot <file|url>` copies the source to `<docsRoot>/intake/YYYY-MM-DD-<slug>.<ext>` with a sidecar carrying origin, SHA-256, who and when, commits both on a work branch, and never overwrites a snapshot (REQ-1.2).
2. `slicekit intake ask`, `answer` and `done` hold the interview: one question waits at a time, the product pass comes before the platform pass, every answer is a D row before the next question is accepted, and `done` prints the open questions and refuses when a spec file appeared during the interview (REQ-2.2).
3. The `/slicekit intake` procedure drives those subcommands, writes no spec text, and passes the brief lint.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `commands/intake.test.js » the snapshot and its sidecar are written and no spec file is created` | happy | REQ-1.2, REQ-2.2 |
| `commands/intake.test.js » the next question is refused while the last answer has no D row` | negative | REQ-2.2 |
| `commands/intake.test.js » a URL source is fetched and its origin recorded` | happy | REQ-1.2 |
| `commands/intake.test.js » a second snapshot of changed bytes is a new file` | negative | REQ-1.2 |
| `commands/intake.test.js » a platform question closes the product pass` | negative | REQ-2.2 |
| `commands/intake.test.js » done refuses when a spec file appeared during the interview` | negative | REQ-2.2 |
| `commands/intake.test.js » the procedure passes the brief lint` | happy | REQ-2.2 |

## Expected changes

`src/intake.js`, `src/cli/intake.js`, `src/hooks/pre-edit.js` (the interview session is kit-owned), `src/cli/branch.js` (untracked files are carried), `templates/instructions/commands/intake.md`, tests.

## Tasks

### Task 1: `intake snapshot`

**Files:** Create `src/intake.js`, `src/cli/intake.js`, `test/commands/intake.test.js`. Modify `src/cli/index.js`.

**Interfaces:**
- Consumes (S-09): `commitPaths`, `gitUser`, `currentBranch` from `src/git.js`.
- `class IntakeError extends Error` with `code` 1 or 2.
- `snapshot(root, cfg, source, {slug, who, now = new Date(), fetchImpl = fetch} = {}) → Promise<{file, sidecar, created}>`. A source starting `http://` or `https://` is fetched with a 30 s timeout (a non-2xx answer → code 1 `could not fetch <url>: <status>`); its extension is the URL path's, else from the content type (`text/markdown` → `md`, `text/plain` → `txt`, `text/html` → `html`, `application/pdf` → `pdf`, the Word document type → `docx`, anything else → `bin`). Any other source is a file path (missing → code 2 `no such file <path>`). The slug is `--slug`, else `slugify(<the source's base name without its extension>)`; `slugify(text) → string` (exported) lower-cases, turns each run of characters other than `a-z0-9` into one `-`, trims dashes, cuts to 60 characters, and gives `source` when empty. The name is `<UTC date>-<slug>.<ext>`; when it exists with the same SHA-256 nothing is written (`created: false`), otherwise `-2`, `-3`, … goes before the extension. The sidecar `<name>.meta.json` is `{origin, sha256, by, at}`: the URL or the absolute POSIX path, the hex digest, `who` or `gitUser` or `unknown`, and the ISO time. On the default or a protected branch → code 1 `snapshot on a work branch; run slicekit branch spec <slug>`. Both files are committed as `docs(intake): snapshot <name>`.
- CLI `intake snapshot <file|url> [--slug <s>] [--who <w>]` prints the snapshot's path relative to root. `subcommands = ['snapshot','ask','answer','done']` (the rest land in Task 2).

- [ ] **Step 1: Failing tests** — `a URL source is fetched and its origin recorded`: a `node:http` server on `127.0.0.1` serving `text/markdown`; the snapshot ends `.md`, the sidecar's `origin` is the URL and its `sha256` matches the bytes, and `intakePin` (`src/stage.js`) reports `frozen`. `a second snapshot of changed bytes is a new file`: snapshotting `req.md`, changing it, and snapshotting again gives `<date>-req.md` and `<date>-req-2.md`, the first unchanged; snapshotting unchanged bytes again prints the first path and writes nothing. On `main` the command exits 1 with the work-branch message.
- [ ] **Step 2: Run** `node --test test/commands/intake.test.js` → FAIL.
- [ ] **Step 3: Implement** `snapshot` and the CLI.
- [ ] **Step 4: Run** the same → PASS.
- [ ] **Step 5: Commit** `feat(intake): frozen snapshots with a sidecar`.

### Task 2: The interview: `ask`, `answer`, `done`

**Files:** Modify `src/intake.js`, `src/cli/intake.js`, `test/commands/intake.test.js`.

**Interfaces:**
- Consumes (S-09): `addDecision`, `readDecisions` from `src/decisions.js`.
- The session lives in `interview.json` under `.slicekit`: `{startedAt, specFiles, pending, asked}`, where `specFiles` lists the files under `<docsRoot>/spec/` when the first question was asked, `pending` is `{pass, topic, question}` or null, and `asked` holds `{pass, topic, question, decision}` per answered question.
- `ask(root, cfg, {pass, topic, question}) → {n}`: `pass` is `product` or `platform` (else code 2); a pending question → code 1 `answer the last question first: "<question>" has no decision row`; a product question after any platform question → code 1 `the product pass is closed; ask platform questions now`.
- `answer(root, cfg, {answer, type = 'Decision', who, open, why, recommendation, iface}) → {id}`: no pending question → code 1 `no question is waiting for an answer`; writes the row through `addDecision` with the pending question (an `open` answer writes an Open row with `why` and `recommendation`), then clears `pending`.
- `done(root, cfg) → {open, commit}`: a pending question → the same code 1 as `ask`; a pass that asked nothing → code 1 `the <pass> pass asked nothing`; a file under `<docsRoot>/spec/` that is not in `specFiles` → code 1 `intake writes no spec text; remove <file>`. Otherwise it deletes the session, commits `<docsRoot>/decisions.md`, `<docsRoot>/platform.md` and `<docsRoot>/observability.md` as `docs(intake): interview answers`, and returns the Open-table rows written in the session.
- CLI `intake ask --pass <p> --topic <t> --question <q>` prints `question <n>`; `intake answer (--answer <a> [--type <T>] | --open --why <w> --recommendation <r>) [--who <w>] [--interface <name> [--source <file>:<line>]]` prints the D-ID; `intake done` prints `open: <D-ID> <question>` per open row, or `open: none`.

- [ ] **Step 1: Failing tests** — `the snapshot and its sidecar are written and no spec file is created`: snapshot, one product question and one platform question, each answered, then `done` → the snapshot and its sidecar exist, `decisions.md` has two new Settled rows, the file list under `docs/spec/` equals the one before, and `done` prints `open: none`. `the next question is refused while the last answer has no D row`: two `ask` calls in a row → the second exits 1 with `answer the last question first`, and `decisions.md` is unchanged. `a platform question closes the product pass`: product, platform, product → the third exits 1 with `the product pass is closed`. `done refuses when a spec file appeared during the interview`: write `docs/spec/x.md` after the first `ask` → `done` exits 1 naming it, and the session file still exists. <!-- slicekit:example -->
- [ ] **Step 2: Run** `node --test test/commands/intake.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same → PASS.
- [ ] **Step 5: Commit** `feat(intake): the two-pass interview, one decision row per answer`.

### Task 3: The `/slicekit intake` procedure

**Files:** Create `templates/instructions/commands/intake.md`. Modify `test/commands/intake.test.js`.

**Interfaces:**
- Consumes (S-09): `briefProblems` from `test/helpers/brief-lint.js`; `{{cli}} branch spec <slug>`.
- The procedure's steps, in order: (1) `{{cli}} branch spec <slug>` with the slug of `cfg.name` (lower-cased, each run of characters other than `a-z0-9` a `-`, trimmed to 60), the rule `snapshot` uses; (2) `{{cli}} intake snapshot {{args}}`; (3) read the snapshot; (4) the product pass, one topic per question in this order: purpose, users, components, existing systems, constraints, out of scope, interfaces between components or repositories, offering choices where choices exist; each question is preceded by `{{cli}} intake ask --pass product …` and followed by `{{cli}} intake answer …`; each interface is answered with `--interface <name> --source <snapshot>:<line>` when the snapshot names it; a question the human cannot answer is recorded with `--open`; (5) the platform pass over the sections REQ-1.11 lists for `platform.md` and `observability.md`, writing each answer into its section with the D-ID and leaving "Not yet known" where there is none; (6) `{{cli}} intake done` and print the open questions it lists. It states that the command writes no file under `<docsRoot>/spec/`, and that every git step is in the CLI.

- [ ] **Step 1: Failing test** — `the procedure passes the brief lint`: `briefProblems(text, {kind: 'command'})` is `[]`, and the text holds `intake ask`, `intake answer`, `intake done`, `--interface` and the sentence naming `<docsRoot>/spec/`.
- [ ] **Step 2: Run** `node --test test/commands/intake.test.js` → FAIL (no procedure).
- [ ] **Step 3: Write** the procedure.
- [ ] **Step 4: Run** the same, `node bin/slicekit.js instructions --command intake req.md` (prints it) and `node bin/slicekit.js check` → PASS, `0 findings`.
- [ ] **Step 5: Commit** `feat(intake): the /slicekit intake procedure`.
