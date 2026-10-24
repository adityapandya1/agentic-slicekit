---
slice: P1/S-08
name: CI workflow generator
repo: .
group: C
runbook: no
requirements: [REQ-3.11, REQ-2.10, REQ-5.2, REQ-5.3, REQ-5.5]
decisions: [D-12, D-09]
---

## Done when

1. `init` writes `.github/workflows/slicekit.yml` with SHA-pinned actions, a `gate` job running `slicekit check --ci`, one job per non-empty team command, a `title-body` job, a `ready-label` job, and a `sync` job on push to the default branch that commits state and `BUILD.md` as a bot. <!-- slicekit:example -->
2. `slicekit check --ci` adds the `ci-title` and `ci-body` rules reading the pull request title and body from `GITHUB_EVENT_PATH`.
3. The kit's own repository runs this workflow on Windows, macOS and Linux and is green; `package.json` has no dependencies and CI fails if one appears.
4. Observability steps from `cfg.ci.observabilitySteps` render as additional jobs (the full wiring from `observability.md` is S-22; the shape is fixed here).

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `workflow.test.js » renders pinned actions and a job per non-empty command` | happy | REQ-3.11 |
| `workflow.test.js » empty e2e command renders no job` | negative | REQ-3.11 |
| `workflow.test.js » observability steps render as jobs` | happy | REQ-3.11 |
| `workflow.test.js » golden workflow for the example config` | happy | REQ-3.11 |
| `check/ci-title.test.js » title without slice id is a finding` | negative | REQ-3.11 |
| `check/ci-title.test.js » slice before draft-pr is a finding` | negative | REQ-3.11 |
| `check/ci-body.test.js » missing section is a finding naming it` | negative | REQ-2.10 |
| `check/ci-body.test.js » complete body passes` | happy | REQ-2.10 |
| `ready-label.test.js » label needs zero blockers and, when required, an independent verdict` | negative | REQ-3.11 |
| `workflow.test.js » the kit's own workflow matches the generator` | e2e | REQ-5.5 |

## Expected changes

`src/workflow.js`, `src/cli/init.js` (call), `src/check/rules/{ci-title,ci-body}.js`, `src/check/ci-event.js`, `src/ready-label.js`, `src/cli/ready-label.js`, `templates/workflow/slicekit.yml`, `.github/workflows/slicekit.yml`, tests.

## Tasks

### Task 1: Pin resolution and the template

**Files:** Create `templates/workflow/slicekit.yml`, `templates/workflow/pins.json`, `src/workflow.js`, `test/workflow.test.js`, golden `test/fixtures/golden/workflow/backend.yml`.

**Interfaces:**
- `pins.json`: `{ "actions/checkout": {"tag": "v4.2.2", "sha": "<40 hex>"}, "actions/setup-node": {"tag": "v4.1.0", "sha": "<40 hex>"}, "actions/upload-artifact": {"tag":"v4.4.3","sha":"<40 hex>"} }` — resolve each SHA at implementation time with `gh api repos/<owner>/<repo>/git/ref/tags/<tag> --jq .object.sha` (dereference annotated tags with `git/tags/<sha>` when `object.type` is `tag`), paste the values, and note the date in a comment key `"resolved": "YYYY-MM-DD"`.
- `renderWorkflow(cfg, pins) → string` from the template with placeholders `{{checkoutSha}}`, `{{setupNodeSha}}`, `{{defaultBranch}}`, and generated job blocks: `gate` (checkout, setup-node 22, `npm ci` when a lockfile exists, then `{{cli}} check --ci` where `{{cli}}` is the team's configured hook command (D-30: never a registry fetch; a team without a local install sets `cli` to its own path), upload `.slicekit/graph/graph.json` if present); `cmd-<name>` for each non-empty command (`run: <command>`); `obs-<n>` per `cfg.ci.observabilitySteps[]` (`{name, run, env?}`); `ready-label` (needs gate and every cmd job; `{{cli}} ready-label` with `GH_TOKEN`); `sync` on `push` to `defaultBranch` (`{{cli}} status --sync --write`, commit `chore(slicekit): sync state [skip ci]` as `github-actions[bot]` when there is a diff). Triggers: `pull_request` and `push` to the default branch. `permissions: contents: write, pull-requests: write`. <!-- slicekit:example -->
- The kit's own workflow is the same template with `cmd-test` as a matrix over `ubuntu-latest, windows-latest, macos-latest` and an extra step `node -e "if (require('./package.json').dependencies) process.exit(1)"` (REQ-5.3); generated with `cfg.ci.matrix = true`.

- [ ] **Step 1: Failing tests** — the four `workflow.test.js` render cases; `pins.json has 40-hex shas`.
- [ ] **Step 2–5:** FAIL → resolve pins, write template and renderer → PASS → commit `feat(ci): workflow generator with pinned actions`.

### Task 2: `ci-title` and `ci-body` rules

**Files:** Create `src/check/ci-event.js`, `src/check/rules/ci-title.js`, `src/check/rules/ci-body.js`, tests with fixture event JSON.

**Interfaces:**
- `readCiEvent(env) → {title, body, number, headSha, labels} | null` from `env.GITHUB_EVENT_PATH` (pull_request payload) or `env.SLICEKIT_PR_TITLE` / `SLICEKIT_PR_BODY` for local use; both rules return `[]` when `ctx.ci` is false or no event.
- `ci-title`: title must match `^\[(P\d+\/S-\d{2})\]` → else `title must begin with [P<n>/S-<nn>]`; the slice must exist and its state index ≥ `draft-pr` → else `slice <id> is <state>; open the pull request through /slicekit build`. A title `[spec]` or `[plan]` is exempt from the slice rule.
- `ci-body`: `REQUIRED_SECTIONS = ['Done when','Proof','Decisions','Runbook','Infra / migration','Try it','Reviewer blocked','Should-haves declined','Skipped / not checked']`; each must appear as `**<name>:**` with non-empty text after it on the same line or the next → `pull request body is missing "<name>"`. `[spec]`/`[plan]` titles require only `Done when`, `Proof`, `Decisions`.

- [ ] Steps: failing tests (four cases) → FAIL → implement → PASS → commit `feat(check): ci title and body rules`.

### Task 3: `ready-label`

**Files:** Create `src/ready-label.js`, `src/cli/ready-label.js`, `test/ready-label.test.js`.

**Interfaces:** `decideReady(state, cfg) → {ready: boolean, reason}`: latest verdict `blockers === 0`; `cfg.review.independent === 'required'` → some verdict `independent && blockers === 0` else reason `independent review missing`; CLI reads the slice from the event title, prints the decision, and when `GH_TOKEN` is set calls `gh pr edit <n> --add-label ready` or `--remove-label ready`; exits 0 either way (the label is information, the merge button is the human's).

- [ ] Steps: failing test → FAIL → implement → PASS → commit `feat(ci): ready label decision`.

### Task 4: The kit's own workflow, green on three platforms

**Files:** Create `.github/workflows/slicekit.yml` by running the generator with `ci.matrix = true`; `test/workflow.test.js » the kit's own workflow matches the generator`.

- [ ] **Step 1:** Add the failing golden test comparing `.github/workflows/slicekit.yml` with `renderWorkflow(kitCfg, pins)`. <!-- slicekit:example -->
- [ ] **Step 2:** Generate the file; create the GitHub repository `adityapandya1/agentic-slicekit` as private (D-28) with `gh repo create --private --source . --push` from the author's account, or ask the author to run it; push the slice branch; open the pull request with the REQ-2.10 body.
- [ ] **Step 3:** Watch the run: `gh run watch`; fix Windows path failures in the test suite until all three legs pass. Quote the final `gh run view` summary in the pull request's Proof line.
- [ ] **Step 4:** Commit `ci: the kit runs its own workflow`.
