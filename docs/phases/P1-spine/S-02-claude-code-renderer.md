---
slice: P1/S-02
name: Claude Code renderer and update
repo: .
group: A2
runbook: no
requirements: [REQ-1.10, REQ-3.12, REQ-5.6]
decisions: [D-05, D-14]
---

## Done when

1. `init --shape backend` renders `.claude/commands/slicekit-*.md`, `.claude/agents/{developer,reviewer,fixer,auditor,ops}.md`, `.claude/skills/slicekit-*/SKILL.md` and merges the hook entries into `.claude/settings.json`; `designer.md` is absent. `--shape fullstack` adds `designer.md`.
2. Every rendered file carries the kit version: a file with front matter has `slicekit-managed: v<version>` in it and is managed whole; a file without front matter sits inside comment markers and `slicekit update` changes only what is between them. `slicekit update` prints a unified diff per changed file and asks before writing unless `--yes`.
3. A rendered file edited inside its markers is reported by `slicekit update --check` with exit 1 and the file name (this becomes the `managed` rule in S-05).
4. Golden files per shape match byte for byte.

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `render-all.test.js » backend renders no designer` | happy | REQ-1.10 |
| `render-all.test.js » fullstack renders designer` | happy | REQ-1.10 |
| `render-all.test.js » every rendered file has markers with the version` | happy | REQ-3.12 |
| `render-all.test.js » golden files per shape` | happy | REQ-3.12 |
| `render-all.test.js » settings merge keeps the team's own hooks and permissions` | negative | REQ-3.12 |
| `update.test.js » update rewrites only inside markers` | happy | REQ-3.12, REQ-5.6 |
| `update.test.js » text outside markers survives update` | negative | REQ-3.12 |
| `update.test.js » --check reports a drifted managed block` | negative | REQ-3.12 |

## Expected changes

`templates/claude-code/`, `src/render/`, `src/cli/update.js`, `src/cli/init.js`, `src/cli/hook.js`, `test/render-all.test.js`, `test/render/`, `test/update.test.js`, `test/fixtures/golden/`.

## Tasks

### Task 1: Managed blocks

**Files:** Create `src/render/managed.js`, `test/render/managed.test.js`.

**Interfaces:**
- `markerStyle(path, text) → 'frontmatter' | 'html' | 'hash' | 'json'`: a `.md` file whose text starts with front matter → `frontmatter` (`slicekit-managed: v<version>` added to the front matter, file managed whole, because Claude Code reads front matter only when `---` is on line 1); other `.md` and `.html` → html comment markers, managed block-wise; `.json` → an html-comment wrapper is invalid JSON, so JSON files use a top-level `"_slicekit": {"managed": true, "version": "…"}` key instead; `.yml`, `.sh`, no-extension → hash comment markers, managed block-wise.
- `wrapManaged(content, {version, style}) → string`; `extractManaged(text, style) → {before, block, after, version} | null`; `replaceManaged(text, newBlock, {version, style}) → string` (keeps `before` and `after` byte for byte).

- [ ] **Step 1: Failing tests** — `wraps with html markers`, `wraps with hash markers`, `extract returns null when absent`, `replace keeps text outside markers` (prefix and suffix identical, including a trailing newline), `json style uses _slicekit key`.
- [ ] **Step 2: Run — FAIL.**  **Step 3: Implement.**  **Step 4: PASS.**  **Step 5: Commit** `feat(render): managed blocks`.

### Task 2: Manifest and templates

**Files:** Create `templates/claude-code/manifest.json`, `templates/claude-code/commands/slicekit-{intake,specify,gaps,plan,build,review,release,ops,audit}.md`, `templates/claude-code/agents/{developer,reviewer,fixer,auditor,ops,designer}.md`, `templates/claude-code/skills/slicekit-{writing,ids,loop}/SKILL.md`, `templates/claude-code/hooks.json`, `src/render/manifest.js`, `test/render/manifest.test.js`.

**Interfaces:**
- `manifest.json`: `[{ "src": "commands/slicekit-build.md", "dest": ".claude/commands/slicekit-build.md", "shapes": ["backend","fullstack","data"] }, …]`; `designer.md` has `"shapes": ["fullstack"]`.
- `loadManifest() → entries[]`; `entriesForShape(shape) → entries[]`.
- `hooks.json` is the `hooks` object for `.claude/settings.json`, one entry per event in C-3's table, each command `slicekit hook <name>`, `timeout` 20, Stop timeout 120.
- Template content in P1 is the frame only: front matter (`description`, `argument-hint` for commands; `name`, `description`, `tools`, `model` for agents) and a body that says `Brief: run slicekit instructions <role> and follow it.` plus the writing rules. S-09 fills the briefs.

- [ ] **Step 1: Failing tests** — `every manifest src exists`, `entriesForShape backend excludes designer`, `entriesForShape fullstack includes designer`, `hooks.json names every event in the contract table` (SessionStart, PreToolUse, SubagentStart, SubagentStop, PreCompact, Stop, SessionEnd).
- [ ] **Step 2–5:** FAIL → write templates and manifest → PASS → commit `feat(render): manifest and template frames`.

### Task 3: renderAll and settings merge

**Files:** Create `src/render/index.js`, `src/render/settings.js`, `test/render-all.test.js`, `test/fixtures/golden/{backend,fullstack,data}/`. Modify `src/init.js` to call `renderAll`.

**Interfaces:**
- `renderAll(root, cfg, {version}) → [{dest, action:'created'|'updated'|'unchanged'}]`; writes each manifest entry wrapped by `wrapManaged`, substituting `{{version}}`, `{{name}}`, `{{docsRoot}}`.
- `mergeSettings(existing: object|undefined, hooks: object) → object`: keeps every key of `existing`; for each event, removes entries whose any `hooks[].command` starts with `slicekit hook` and appends ours; preserves foreign entries and order; result written with 2-space JSON and a `_slicekit` key.
- `kitVersion() → string` from `package.json`.

- [ ] **Step 1: Failing tests** — the four `render-all.test.js` cases in the evaluation set, plus `golden files per shape`: render into a temp dir and compare each file to `test/fixtures/golden/<shape>/`; a `SLICEKIT_UPDATE_GOLDEN=1` env regenerates them.
- [ ] **Step 2–5:** FAIL → implement, generate goldens once, review them by eye → PASS → commit `feat(render): renderAll and settings merge`.

### Task 4: `slicekit update`

**Files:** Create `src/render/update.js`, `src/cli/update.js`, `test/update.test.js`.

**Interfaces:**
- `planUpdate(root, cfg, {version}) → [{dest, status:'same'|'changed'|'drifted'|'missing', diff}]` where `drifted` means the installed block differs from the installed version's template (compare against a copy kept at `.slicekit/rendered/<version>/<dest>` written by `renderAll`).
- `applyUpdate(root, plan) → written[]` replaces blocks only.
- `diffLines(a, b) → string` minimal unified-style diff (line LCS; no dependency).
- CLI: `slicekit update [--yes] [--check]`; `--check` prints drifted and missing files and exits 1 if any.

- [ ] **Step 1: Failing tests** — the three `update.test.js` cases; `diffLines shows added and removed lines with +/-`.
- [ ] **Step 2–5:** FAIL → implement → PASS → commit `feat(update): managed re-render with diff`.
