---
slice: P6/S-55
name: Front page
repo: .
group: C
runbook: no
requirements: [REQ-5.7, REQ-5.8]
decisions: [D-98, D-97]
---

## Done when

1. `README.md` opens with the banner image `docs/assets/slicekit-banner.png`, then the line "A closed-loop framework for spec-driven development with coding agents.", then three badges (the npm version, the CI workflow and the MIT license), then a section "Why" of at most five lines: most agent workflows add control through prompts and rule files the agent can skip, and slicekit checks each step outside the agent, by its CLI, its hooks and CI. The opening holds no version number, no count of slices, tests or phases, and no list of what each phase added (D-98, REQ-5.7). <!-- slicekit:pending P6/S-55 -->
2. The next section, "See it in action", is a transcript of a Claude Code session in one `text` block of at most forty lines: `/slicekit intake`, `/slicekit specify`, `/slicekit plan`, `/slicekit build P1/S-01`, `/slicekit review`, `/slicekit release`, each followed by the files or pull request it produced. Every output line of the build step is a line the walkthrough of `examples/backend` prints, with only its IDs, numbers and paths kept as the walkthrough has them. After it come, in this order: "What it covers" (a table of stage, command and what you get, naming every command template under `templates/claude-code/commands/` and the graph queries `trace`, `impact`, `history`, `uncovered` and `shipped`), "Quick start" (`npm install --save-dev slicekit`, `npx slicekit init`, the first slash command), "How it differs" (prompt and rule-file workflows, spec-only tools, no workflow), and "Docs" (the guide index, the walkthrough, the runbook, the adapters, the changelog). The status, the versions and provenance, the scope line of REQ-4.8 and how the kit is built with itself follow in `<details>` blocks (D-98, REQ-5.7).
3. The ten-minute walkthrough leaves the README; `docs/walkthrough.md`, which the plan adds with the same commands and `text` blocks of the lines they print, is where the walkthrough runner in `test/helpers/walkthrough.js` reads it. The test that runs its commands on `examples/backend` passes and fails naming any line of a `text` block the run does not print. The README links it from "Quick start" and "Docs" (D-98, REQ-5.7).
4. `docs/guide/README.md` opens with the heading "slicekit guide" and the same line as the README and one paragraph of at most four sentences saying what the guide holds; the web page's title and footer say "slicekit" in place of "SliceKit" (`scripts/guide-html.js`), the web page is regenerated with `node scripts/guide-html.js`, and `node scripts/guide-html.js --check` exits 0 (D-97, REQ-5.8).
5. The README tests that pinned the old order are replaced by tests of the order above; `slicekit check` gives `0 findings`, with the style rule applied to the new README text, and no pending marker naming this slice is left in `docs/`.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `readme.test.js » the README opens with the banner, the one line, the badges and Why, and the banner file exists` | happy | REQ-5.7 |
| `readme.test.js » the README's opening holds no version number, no count and no list of phases` | negative | REQ-5.7 |
| `readme.test.js » See it in action comes before Quick start, and each build output line is one the walkthrough prints` | happy | REQ-5.7 |
| `readme.test.js » What it covers names every command template and the graph queries` | negative | REQ-5.7 |
| `walkthrough.test.js » the walkthrough's commands are read from docs/walkthrough.md` | happy | REQ-5.7 |
| `user-guide.test.js » the guide index opens with the README's line` | happy | REQ-5.8 |

## Expected changes

`README.md`, `docs/walkthrough.md`, `docs/assets/slicekit-banner.png`, `docs/guide/README.md`, `docs/guide/slicekit-guide.html`, `scripts/guide-html.js`, `test/helpers/walkthrough.js`, tests.

## Tasks

### Task 1: The README's opening and the transcript

- [ ] **Step 1: Failing tests** — the four `readme.test.js` tests above. The transcript test reads the build step's output lines from the README's `text` block and runs the walkthrough helper's output, or reads the walkthrough's recorded output, and fails naming a line the walkthrough does not print.
- [ ] **Step 2: Code** — copy the banner from the author's showcase render into `docs/assets/slicekit-banner.png` (1280 by 400 at twice the density, no version on it). Write the README in the order of Done when 1 and 2. Replace the README tests that pinned two sentences, then Status, then the walkthrough, then the scope line; keep the tests of the scope line's content (it names graphify, the graph is built from IDs and git) and point them at its `<details>` block. <!-- slicekit:pending P6/S-55 -->

### Task 2: The walkthrough file

- [ ] **Step 1: Failing test** — `walkthrough.test.js » the walkthrough's commands are read from docs/walkthrough.md`.
- [ ] **Step 2: Code** — move the `## Walkthrough` section and its commands to `docs/walkthrough.md`; `test/helpers/walkthrough.js` reads that file; the tests that name a README line in a refusal name the file and line of `docs/walkthrough.md`.

### Task 3: The guide index

- [ ] **Step 1: Failing test** — `user-guide.test.js » the guide index opens with the README's line`.
- [ ] **Step 2: Code** — the index's first lines; regenerate the web page.

## Notes

`docs/walkthrough.md` is added by a plan pull request, not by the slice: the pre-edit guard refuses a new document while a slice is building, and the slice only changes it.

The line, the banner and the order come from the author (2026-11-16). The comparison names no other tool. The showcase pieces outside the repository (carousel, starter pack, PDFs) take the same opening and are not part of this slice.
