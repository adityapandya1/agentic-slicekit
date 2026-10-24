---
slice: P1/S-04
name: Check: references and style ratchets
repo: .
group: B
runbook: no
requirements: [REQ-3.7, REQ-3.10]
decisions: [D-25]
---

## Done when

1. `slicekit check` runs the `references` and `style` rules over every markdown file under the docs root, `BUILD.md`, `README.md`, `.slicekit/reviews/` and `.claude/`, prints findings as `<rule> <file>:<line> <message>`, and exits 1 when any bucket's count exceeds its baseline.
2. `slicekit baseline update` writes the current counts and refuses, with exit 1 and the bucket name, to raise any count.
3. The files that define the filler list are exempt from `style` and are checked to still contain it.
4. Run on the kit's own repo, both rules are green with a baseline of zero.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `check/references.test.js » dead relative link is a finding with line` | negative | REQ-3.7 |
| `check/references.test.js » missing heading anchor is a finding` | negative | REQ-3.7 |
| `check/references.test.js » unknown REQ or D id is a finding` | negative | REQ-3.7 |
| `check/references.test.js » live references are not findings` | happy | REQ-3.7 |
| `check/style.test.js » banned phrase is a finding, case-insensitive` | negative | REQ-3.10 |
| `check/style.test.js » the catalogue files are exempt and must contain the list` | negative | REQ-3.10 |
| `baseline.test.js » update refuses to raise a count` | negative | REQ-3.7 |
| `baseline.test.js » count under baseline passes, over fails` | happy | REQ-3.7 |
| `check/self.test.js » the kit's own repo is green` | e2e | REQ-5.4 |

## Expected changes

`src/check/index.js`, `src/check/context.js`, `src/check/rules/{references,style}.js`, `src/baseline.js`, `src/cli/{check,baseline}.js`, tests.

## Tasks

### Task 1: Check runner and context

**Files:** Create `src/check/index.js`, `src/check/context.js`, `src/cli/check.js`, `test/check/runner.test.js`.

**Interfaces:**
- A rule module exports `{ id: string, blocking: boolean, ratchet: boolean, run(ctx) → Finding[] }` where `Finding = {rule, file, line, message, bucket?}`.
- `buildContext(root, cfg, {ci, env}) → ctx` with `{root, cfg, paths, docs: [{path, rel, text, lines}], ids: {req:Set, decision:Set, gap:Set, contract:Set, slice:Set}, git: {isRepo, hasCommits, branch}, baselines, ci, env}`; `ids` collected from headings (`### REQ-`), decisions table rows, gaps rows, contract file names, slice files.
- `check(root, {ci=false, env=process.env, rules=ALL}) → {findings, counts: {rule: {bucket: n}}, exitCode}`; a ratchet rule fails only where a bucket's count exceeds `baselines[rule][bucket] ?? 0`; a non-ratchet blocking rule fails on any finding; output one line per finding, then `check: <n> findings, <m> over baseline` and exit 1 if `m > 0` or any blocking non-ratchet finding.
- `ALL` is built by importing every file in `src/check/rules/` at load time; later slices add files only.

- [ ] **Step 1: Failing tests** — `runs every rule file and aggregates counts` (with a stub rule injected via `rules` option); `exit 1 on over-baseline, 0 at baseline`; `prints findings in the fixed format`.
- [ ] **Step 2–5:** FAIL → implement → PASS → commit `feat(check): runner and context`.

### Task 2: Baselines

**Files:** Create `src/baseline.js`, `src/cli/baseline.js`, `test/baseline.test.js`.

**Interfaces:**
- Baseline file per rule: `.slicekit/baselines/<rule>.json` = `{ "<bucket>": n }`; bucket for both P1 rules is the file's relative path.
- `readBaselines(root) → {rule: {bucket: n}}`; `updateBaselines(root, counts) → {written, refused: [{rule, bucket, from, to}]}` writes only buckets whose new count ≤ old (or new); CLI `slicekit baseline update` exits 1 listing refusals.

- [ ] **Step 1: Failing tests** — the two `baseline.test.js` cases.  **Steps 2–5:** FAIL → implement → PASS → commit `feat(check): baselines that only go down`.

### Task 3: `references` rule

**Files:** Create `src/check/rules/references.js`, `test/check/references.test.js`, fixtures under `test/fixtures/check/references/`.

**Interfaces:** `run(ctx)` for every doc: each relative link or backticked path that looks like a repo path (contains `/` and an extension, or ends with `/`) must exist relative to the doc's dir or to root; each `#anchor` on a `.md` link must match a heading slug in the target; every `REQ-`, `D-`, `G-`, `C-` ID and `P<n>/S-<nn>` address must be in `ctx.ids`. Skips fenced code blocks and lines containing `<!-- slicekit:example -->`. Message forms: `missing file <target>`, `missing anchor #<a> in <target>`, `unknown id <id>`.

- [ ] **Step 1: Failing tests** — the four cases in the evaluation set plus `code fences are skipped`.  **Steps 2–5:** FAIL → implement → PASS → commit `feat(check): references rule`.

### Task 4: `style` rule

**Files:** Create `src/check/rules/style.js`, `test/check/style.test.js`.

**Interfaces:** `run(ctx)`: for every doc not in the exempt set, each occurrence of a `cfg.style.banned` phrase (case-insensitive, whole words, outside code fences) is a finding `banned phrase "<p>"`. Exempt set: `.slicekit/config.json`, `templates/style.json`, and any doc whose text contains `<!-- slicekit:style-catalogue -->` (the spec's REQ-3.10 carries this marker); for each exempt doc that is present the rule asserts every seed phrase is still there, else finding `catalogue missing "<p>"`.

- [ ] **Step 1: Failing tests** — the two `style.test.js` cases.  **Steps 2–5:** FAIL → implement, add the marker line to `docs/spec/03-hooks-gates-ci.md` under REQ-3.10 → PASS → commit `feat(check): style rule`.

### Task 5: Green on the kit itself

**Files:** Create `test/check/self.test.js`; modify docs as needed; create `.slicekit/` for the kit via `init`.

- [ ] **Step 1: Failing test** — `the kit's own repo is green`: `runCli(['check'], {cwd: repoRoot}).code === 0`.
- [ ] **Step 2:** Run `node bin/slicekit.js init --shape backend --name slicekit` on the kit's own root (the spec and BUILD already exist and are skipped). Run `check`; fix every finding in the docs rather than raising a baseline; commit baselines as `{}`.
- [ ] **Step 3–4:** PASS → commit `chore: the kit checks itself`.
