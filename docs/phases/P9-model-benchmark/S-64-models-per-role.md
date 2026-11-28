---
slice: P9/S-64
name: Models per role
repo: .
group: A
runbook: yes
requirements: [REQ-6.7, REQ-5.8]
decisions: [D-109, D-113, D-115, D-130, D-97]
---

## Done when

1. `validateConfig` accepts `models`, a map from a role to a model ID, whose roles are auditor, designer, developer, fixer, ops, reviewer, brief, intake, specify, plan and next; an unknown role or a value that is not a non-empty string is refused, naming the key (REQ-6.7, D-115).
2. The renderer writes each agent's `model:` from the map, and `inherit` for a role with no entry; `slicekit update` keeps the value, because it renders from the map (REQ-6.7, D-115).
3. For brief, intake, specify, plan and next, the renderer writes `model:` into the front matter of `.claude/commands/slicekit-<command>.md` when the map names one, and no `model:` line when it names none. `docs/adapters.md` says that `/slicekit-<command>` runs on that model and that `/slicekit <command>` runs on the session's model, and cites the Claude Code page that documents `model` in a command's front matter (REQ-6.7, D-130).
4. `slicekit models apply` renders the agent and command files from the map and prints one line per file whose `model:` changed, as `<file> <old> -> <new>`, or `no change`; it changes no other file (REQ-6.7, D-109).
5. `docs/guide/commands/models.md` exists, the guide index names it, the runbook says where the map lives and that a change to it reaches the default branch in a pull request, and `node scripts/guide-html.js --check` exits 0 (REQ-5.8, D-97). <!-- slicekit:pending P9/S-64 -->

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `models-apply.test.js » apply writes each mapped agent's model and leaves the rest inherit` | happy | REQ-6.7 |
| `models-apply.test.js » update keeps the model the map names` | happy | REQ-6.7 |
| `models-apply.test.js » a main-session role's model lands in its command file` | happy | REQ-6.7 |
| `models-apply.test.js » a model for an unknown role is refused naming the role` | negative | REQ-6.7 |
| `models-apply.test.js » apply with an unchanged map prints no change and changes no file` | negative | REQ-6.7 |
| `user-guide.test.js » the models command has a page` | happy | REQ-5.8 |

## Expected changes

`src/config.js`, `src/render/entry.js`, `src/render/update.js`, `src/cli/models.js`, `src/cli/index.js`, `templates/claude-code/agents/auditor.md`, `templates/claude-code/agents/designer.md`, `templates/claude-code/agents/developer.md`, `templates/claude-code/agents/fixer.md`, `templates/claude-code/agents/ops.md`, `templates/claude-code/agents/reviewer.md`, `templates/claude-code/commands/slicekit-brief.md`, `templates/claude-code/commands/slicekit-intake.md`, `templates/claude-code/commands/slicekit-specify.md`, `templates/claude-code/commands/slicekit-plan.md`, `templates/claude-code/commands/slicekit-next.md`, `docs/adapters.md`, `docs/runbook.md`, `docs/guide/commands/models.md`, `docs/guide/README.md`, `docs/guide/slicekit-guide.html`, the rendered agent and command files under `.claude/` and `.slicekit/rendered/` of the kit and of `examples/`, tests.

## Tasks

### Task 1: The map and the renderer

**Files:** Modify `src/config.js`, `src/render/entry.js`, `src/render/update.js`, the agent and command templates. Create `test/models-apply.test.js`.

- [ ] **Step 1: Failing tests** — the first four `models-apply.test.js` tests above, on a fixture project.
- [ ] **Step 2: Run** `node --test test/models-apply.test.js` → FAIL.
- [ ] **Step 3: Implement** the `models` key in `validateConfig`; a `model` template value per file, `inherit` by default for an agent; no `model:` line for a command file with no entry.
- [ ] **Step 4: Run** the same and `node --test test/render.test.js test/update.test.js test/config.test.js` → PASS.
- [ ] **Step 5: Commit** `feat(models): a model per role from the models map`.

### Task 2: `slicekit models apply`, the page and the runbook

**Files:** Create `src/cli/models.js`, `docs/guide/commands/models.md`. Modify `src/cli/index.js`, `docs/guide/README.md`, `docs/adapters.md`, `docs/runbook.md`, `test/user-guide.test.js`.

- [ ] **Step 1: Failing tests** — the fifth `models-apply.test.js` test and the `user-guide.test.js` test above.
- [ ] **Step 2: Run** `node --test test/models-apply.test.js test/user-guide.test.js` → FAIL.
- [ ] **Step 3: Implement** the command, the page, the index row, the adapters and runbook lines. Run `node bin/slicekit.js update` and `node scripts/guide-html.js`.
- [ ] **Step 4: Run** the same, `node --test test/guide-page.test.js` and `node bin/slicekit.js check` → PASS, `0 findings`.
- [ ] **Step 5: Commit** `feat(models): slicekit models apply and its page`.

## Notes

`/slicekit <command>` goes through the one `slicekit.md` file, which holds no per-command model, so a configured model applies only through `/slicekit-<command>`; Done when 3 says so in the adapters page. Before relying on it, the developer confirms in Claude Code's documentation that a command file's `model` front matter is honoured (D-130); if it is not, the slice stops and the question goes to the person.
