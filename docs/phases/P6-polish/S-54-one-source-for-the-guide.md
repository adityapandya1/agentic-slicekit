---
slice: P6/S-54
name: One source for the guide
repo: .
group: B
runbook: yes
requirements: [REQ-5.8]
decisions: [D-97, D-61]
---

## Done when

1. A script under `scripts/`, `guide-html.js`, with no dependency, writes `docs/guide/slicekit-guide.html` from `docs/guide/README.md` and every page that index links under `docs/guide/commands/`, `docs/guide/slash/` and `docs/guide/rules/`: one section per page, in the order of the index, with a contents list, and each link from one page to another turned into a link inside the page. The page's bytes depend only on those files and the script: it holds no version, date, user name or absolute path, and its lines end in LF. Run with `--check` the script writes nothing and exits 1 with one line naming the page and the command that regenerates it when the page on disk differs. A Markdown construct the script does not convert makes it exit 1 naming the file and line, and it writes nothing (D-97, REQ-5.8).
2. A test fails when `docs/guide/slicekit-guide.html` differs from what the script writes, reading CRLF as LF, and its message names the command that regenerates the page. A page file under those folders that the web page has no section for fails the same test, naming the file (D-97, REQ-5.8).
3. The PDF copies leave docs/guide, and no file of the repository links one. `docs/guide/README.md` is the index of pages: the sections Slash commands and Command reference written for version 0.2.1 go, since every command, slash command and rule has its page (D-61); the introduction says that the web page is generated from the pages and names the command, and that the PDF copies are rendered from the web page outside the repository. The web page's `init` usage line carries `--default-branch`, because it is generated from the `init` page (issue #99). The text the index keeps (Overview, Stages, the group introductions and Conventions) agrees with the pages; Task 2 lists the places where it does not today.
4. The commands row of `docs/adapters.md` names every command file under `templates/claude-code/commands/`, `audit` and the bare `/slicekit` command included, and a test fails naming a template the row leaves out (issue #113, REQ-5.8).
5. The runbook says when the web page is regenerated (after a change to a page under `docs/guide/`), the command, and what the failing test's line means. `node scripts/guide-html.js --check` exits 0 and `slicekit check` gives `0 findings`.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `guide-page.test.js » the web page equals what the script writes from the pages` | happy | REQ-5.8 |
| `guide-page.test.js » a changed page makes the check fail, naming the command that regenerates the web page` | negative | REQ-5.8 |
| `guide-page.test.js » the page has a section for every command, slash command and rule page, and no version or date` | happy | REQ-5.8 |
| `guide-page.test.js » a Markdown construct the script does not convert fails, naming the file and line` | negative | REQ-5.8 |
| `user-guide.test.js » the guide index holds no command reference and links no PDF` | negative | REQ-5.8 |
| `readme.test.js » docs/adapters.md names every slash command template in its commands row` | happy | REQ-5.8 |

Amended (author's standing instruction, 2026-11-15): `test/guide-page.test.js`, where one comparison sorts the pages the index links and compares them with the page files in folder order, so the two lists hold the same pages in different orders and no index can pass. Both sides are sorted the same way; what the test asserts stays the same.

## Expected changes

`scripts/guide-html.js`, `docs/guide/slicekit-guide.html`, `docs/guide/README.md`, `docs/guide/`, `docs/adapters.md`, `docs/runbook.md`, tests.

## Tasks

### Task 1: The script and the generated page

**Files:** Create `scripts/guide-html.js`, `test/guide-page.test.js`. Modify `docs/guide/slicekit-guide.html`.

- [ ] **Step 1: Failing tests** — the `guide-page.test.js` tests above. The test imports the script's function that returns the page's text for a guide folder and compares it with the file; the negative tests run the script on a copy of the guide in a temporary directory, with one page changed and with one page holding a construct the script refuses.
- [ ] **Step 2: Run** `node --test test/guide-page.test.js` → FAIL.
- [ ] **Step 3: Implement** the script with `node:fs` and `node:path` only: the Markdown the pages use (headings, paragraphs, lists, tables, fenced code, code spans, links, emphasis), escaped for HTML; the page's style and script inline, as the page has them today. Then write the page with it. The test job's runner (`scripts/test-shard.js`) picks the new test file up by its name.
- [ ] **Step 4: Run** the same and `node scripts/guide-html.js --check` → PASS, exit 0.
- [ ] **Step 5: Commit** `feat(guide): the web page is generated from the pages under docs/guide`.

### Task 2: The index, the PDF copies, the adapters row

**Files:** Modify `docs/guide/README.md`, `docs/guide/`, `docs/guide/slicekit-guide.html`, `docs/adapters.md`, `docs/runbook.md`, `test/user-guide.test.js`, `test/readme.test.js`.

- [ ] **Step 1: Failing tests** — the `user-guide.test.js` test and the `readme.test.js` test above.
- [ ] **Step 2: Run** `node --test test/user-guide.test.js test/readme.test.js` → FAIL.
- [ ] **Step 3: Implement**: cut the index down to the introduction, the tables of pages and what the pages do not hold (the stages and the conventions, each checked against the CLI as it is); remove the PDF copies and their links; name the missing commands in the adapters row; add the runbook's section. Regenerate the web page, since the index changed.
- [ ] **Step 4: Run** the same, `node --test test/guide-page.test.js` and `node bin/slicekit.js check` → PASS, `0 findings`.
- [ ] **Step 5: Commit** `docs(guide): the index of pages is the guide's front page; the PDF copies leave the repository`.

The index text that disagrees with the pages today (found when the pages were laid out as one document; the page wins in each case):

| Where in the index | What it says | What the pages say |
|---|---|---|
| Stages, the sentence on gating | every stage command is gated by `stage require` | `stage require` gates specify, gaps and build; plan uses `plan check` and release uses `release --dry-run` |
| Stages table, CLI steps column | lacks steps | gaps runs `check` and `decide add`; intake runs `workflow --write`; build runs `build config`; review runs `instructions fixer`, `build decline`, `build commit --require-green`, `build pr` and `build sync`; release has `release --undo`; ops and audit run `instructions ops`, `instructions auditor` and `audit check --every-claim` |
| The sentence on the sync job | names no heads step | the sync job also runs `journal heads` |
| Build loop introduction | names `/slicekit build` alone, and its shared exit list is short | build and review share the loop; exit 1 also covers a failing command or check and a frozen test, exit 2 a missing required option |
| Conventions, exit codes | four commands outside the convention | `status` is a fifth: it has no exit 1 and gives 2 for a git host error; a held lock is exit 2 for `state` and `status` and exit 1 for `build` |
| Conventions, agents | agents write files and report | the ops agent holds read tools only and its reply is the report |
| Overview and Maintenance | the `--version` example of an older version, a list of command tags, and sentences about entries added after an older version | the pages carry no tags and no version |
