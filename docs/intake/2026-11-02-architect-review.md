# slicekit: assessment for an architecture review board

Written on 2026-11-02 by an independent reviewing agent acting as a technical architect choosing one agentic development tool as the standard for many teams. The context it was given: a 4-developer team building ISO 20022 payment-ordering middleware (SAGA orchestrator, Java with Spring Boot, Kafka, Apache Camel, ArgoCD), one repository per component, payment files up to 150 MB, moving to spec-driven development; and the wider question of one standard across many teams.

## 1. Verdict

**Do not adopt slicekit as a standard across teams. Do not run a payments pilot on it in its current state either.**

Its design ideas are worth taking into any team's own standard: spec-to-test-to-PR traceability, frozen tests, a CI gate that reads machine evidence, and a decision log.

The tool itself has these problems:
- It is 10 days old and has one author.
- It works only with Claude Code and GitHub.
- Phase 4 (release, ops, audit) is not built.
- The build loop runs inside one repository only.
- Its agent controls are client-side and can be bypassed.
- Its audit journal is a hash chain with no key or signature, and the identity in it is self-asserted.

The board could reconsider when four conditions hold:
- a 1.x release;
- a second team has used it in production;
- support for the git host and CI teams use;
- server-side enforcement replaces the client-side controls.

A sandbox trial on one non-production repository, with synthetic data only, is acceptable for evaluating the method.

## 2. What slicekit is

slicekit is a Node 22 command-line tool with no dependencies, plus a set of templates. It installs into a repository:
- Claude Code slash commands, agent briefs and hooks;
- git hooks;
- a GitHub Actions workflow;
- a `docs/` layout: intake, spec with REQ IDs, decisions with D-IDs, phases and slice files.

The flow is:
1. A requirement document is snapshotted and hashed.
2. Agents write the spec and the plan, and each is approved by merging a pull request.
3. Each slice is built in its own git worktree. A developer agent writes the tests first, and they must fail ("red"); those tests are then frozen while it writes the code.
4. Up to two in-loop review rounds run, then an "independent" review by a second Claude session.
5. A human merges on GitHub.

Hooks and `slicekit check` (the Stop hook and CI) enforce IDs, references, the PR title and body format, a list of banned phrases, and a hash-chained session journal. `slicekit graph` builds a traceability graph from IDs and git history. It does not parse code.

## 3. Scored criteria

Scores run from 1 (poor) to 5 (strong).

| # | Criterion | Score | Justification | Evidence |
|---|---|---|---|---|
| 1 | Traceability (requirement to test to commit to PR) | 4 | IDs, `Slice:` trailers, a fixed PR body and a graph. The weakness: a test "covers" a requirement only if its text mentions the REQ ID. | `docs/spec/03-hooks-gates-ci.md` REQ-3.7 table; `CHANGELOG.md` 0.2.0; PR #86 body |
| 2 | Auditability and tamper evidence | 2 | The journal is plain SHA-256 with no key or signature, so anyone can recompute the chain. Lines not yet committed are unprotected. The actor is read from environment variables. The kit's own repo has never committed a journal file. | `src/journal.js:1-13`; `src/hooks/session-end.js:110`; `git log --all -- .slicekit/journal` returns nothing; D-36 |
| 3 | Segregation of duties and human approval | 2 | The only human gate is the GitHub merge. The "independent review" is a second agent session, and the kit says it cannot check that the session is independent. Nothing requires a second human. It configures no branch protection or CODEOWNERS. | `templates/instructions/commands/review.md:15-19`; `docs/spec/02-commands-agents-loop.md:113` |
| 4 | Security of agent actions | 2 | The pre-bash guard is a lexical parser and its own header lists the gaps. Bypasses were confirmed (listed after this table). There is no pre-push git hook. | `src/hooks/pre-bash.js:13-25`; REQ-3.9 |
| 5 | Secrets handling | 2 | `redact.js` masks about 10 known token shapes and says it "is not a guarantee". The kit does nothing for secret scanning or vault integration, and `platform.md` "Secrets" says "Not yet known". | `src/redact.js:1-4`; `docs/platform.md` |
| 6 | Data handling (payment data, egress to the model) | 1 | Nothing in the kit covers data classification, PII, or which model endpoint is used. The agents have Bash, Read and Write over the whole repository. | `templates/claude-code/agents/developer.md:4` |
| 7 | Change management | 3 | Spec, plan and slice each go through a PR, and the state machine requires evidence. The kit's own author bypassed it: slices were committed by hand and their state set with `state set`. | D-43; PR #86 body (issue #72) |
| 8 | Reproducibility | 3 | Actions are pinned by SHA and the graph is deterministic (D-44). The agent model is `model: inherit`, so the model is not pinned. The PR "Proof" lines cite a local runner that is not in the repo. | `.github/workflows/slicekit.yml`; `templates/claude-code/agents/*.md:5` |
| 9 | Vendor and model dependency | 1 | Claude Code only. GitHub and GitHub Issues only (through `gh`). GitHub Actions only, on hosted runners. Adapter interfaces exist, but each has one implementation. | D-05, D-09; `docs/adapters.md`; `src/workflow.js:21,131,153` (`ubuntu-latest` hardcoded) |
| 10 | Multi-repo scale | 2 | The workspace file covers the graph and impact queries only. `build` creates worktrees in the current repo and has no notion of a slice's `repo:`. | `src/build/worktree.js:1-3`; REQ-4.6 |
| 11 | Language and stack neutrality | 3 | It runs the team's declared test, lint, build and e2e commands and never parses code (D-11). Test-file detection is regex-based and configurable (D-46). The generated CI sets up Node only, and CI fails if the workflow is edited away from the generator. | `docs/spec/stack.md`; `src/workflow.js:90` |
| 12 | Maturity and support | 1 | Version 0.2.1, a "preview". The repo was created 2026-10-24; 644 of 654 commits are by one author. 0 stars, 0 forks. 5 of 31 issues are open. No commercial support. D-63 says no team other than the kit itself has used it yet. | `package.json`; `gh repo view`; `git shortlog -sn`; D-63 |
| 13 | Supply chain | 2 | Zero runtime dependencies is a plus. Against that: npm releases are published by hand from the author's machine with no provenance (D-62 open), and the npm name previously had another owner who published 0.1.0. | `package.json`; D-40, D-41, D-62 |
| 14 | Quality of the kit's own engineering | 4 | 115 test files: 26,887 test lines against 17,654 source lines. The specs are precise and documented limits are stated honestly. `slicekit check` is clean. | `slicekit check` → `check: 0 findings, 0 over baseline, 0 blocking, 14 rules` |
| 15 | CI health | 2 | The last 200 runs: 67 success, 11 failure, 121 cancelled. On `main`, last 30: 16 success, 5 failure, 8 cancelled. A full run takes about 10 minutes. The full suite runs out of memory on a developer machine. | `gh run list --limit 200`; D-43 |
| 16 | Onboarding and operating cost | 2 | 63 decisions, a 59 KB `BUILD.md`, a strict writing style and many procedure refusals. One release slice took five independent review rounds. Cost per slice in model tokens is not measured anywhere. | `.slicekit/reviews/P3-S-36i-r5.md` |
| 17 | Spec-driven development fit | 4 | The strongest part of the kit: intake snapshots, REQ/SHALL/scenario specs, a gap scan, slices with evaluation sets, and frozen red tests. | `docs/spec/02-commands-agents-loop.md` |

**Results of probing the pre-bash guard.** JSON was fed into `node bin/slicekit.js hook pre-bash`; this only returns the decision and executes nothing.
- `git push origin HEAD:main` → deny.
- `B=main; git push origin HEAD:$B` → `{}` (allowed).
- A force push hidden behind a variable (`X=push; git $X --force …`) → `{}` (allowed).
- As a subagent, `git commit -m x` → deny.
- As a subagent, `eval "git commit -m x"`, `node -e "...execSync('git commit')"` and `python -c "os.system('git push ...')"` → all `{}` (allowed).

## 4. Fit for the payments engine

**What works**
- Spec-driven flow from ISO 20022 requirement documents into REQ/SHALL specs and slices with happy and negative test sets. Frozen red tests fit a regulated change process.
- The kit is stack-neutral: Maven or Gradle commands go in `commands.test` and `commands.build`. The default test-file pattern includes names ending in `Test` (D-46).
- Contracts between services can be spec sections (`C-<n>`). `impact` follows `produces` and `consumes` edges across repos (REQ-4.6).
- The runbook rule makes a slice that touches config, queues or integrations update `docs/runbook.md` or say why not (D-21).

**What does not work**
- Many repos: the build loop is single-repo (`src/build/worktree.js:1-3`). A SAGA change that spans the orchestrator and several Camel route repos would need the kit installed in every repo, plus a separate program repo for the graph only. Cross-repo slices are not supported.
- GitOps with ArgoCD is out of scope: "the kit records a release, it does not run one" (D-12). The release command is not built.
- Java CI: the generated workflow uses `setup-node` only, and `workflow --check` fails on drift. Adding a JDK, a Maven cache, or Kafka and Camel integration containers (Testcontainers) means fighting the generator (inferred from `src/workflow.js`; not tested).
- 150 MB payment files: intake rejects files over 50 MB (`src/intake.js:22`); the kit has no guidance on LFS or test fixtures; nothing stops an agent from reading real payment files into the model context.
- ISO 20022 domain support: none. The kit is generic by design.

**What is missing**
- Support for non-GitHub hosts.
- Jira as a tracker.
- Self-hosted runners.
- A data-egress control.
- A way to pin the model.
- Server-side merge rules.

## 5. Fit as a standard across teams

Poor today.
- One agent tool and one git host: Claude Code only and GitHub only (D-05, D-09). The adapter interfaces (`docs/spec/contracts/C-1..C-3`) have no second implementation.
- Not proven beyond its author: one maintainer and no external users (D-63). Version 0.x.
- Controls are not ready for a regulated organisation: approval rests on a GitHub merge the kit does not require server-side; the audit journal has no signature and a self-asserted actor; the "independent" review is not verifiably independent.
- The CI `sync` job commits directly to the protected `main` with `ALLOW_PROTECTED_COMMIT=1` and `contents: write`. Under "PR-only to main" rules, that bot would need a bypass.
- Positive: zero dependencies, a readable codebase, actions pinned by SHA, and an honest statement of its limits in code comments.

## 6. Risks, ranked

| # | Risk | Mitigation |
|---|---|---|
| 1 | An agent with Bash bypasses the git, push and destructive-command guards (eval, variables, other interpreters). | Treat the hooks as convenience only. Enforce on the server: branch protection or rulesets, required status checks, required human reviewers through CODEOWNERS, no force push. Run agents with no push credentials. |
| 2 | Payment data or secrets reach the model provider through agent reads and Bash. | Synthetic data only. An enterprise model endpoint. Deny-list paths in the agent tool's permissions. Pre-commit secret scanning. |
| 3 | The audit trail does not hold up to an auditor: an unkeyed hash chain, an actor taken from environment variables, no committed journal. | Git commit signing, host audit logs and SIEM export as the record of truth. |
| 4 | Single-maintainer abandonment, or breaking 0.x changes. | Fork and pin a commit, or wait for 1.x and a second maintainer. |
| 5 | Lock-in to one vendor and one host. | Require a second agent-tool and tracker adapter, or a documented exit path. |
| 6 | The multi-repo SAGA work does not fit the single-repo build loop. | Limit a trial to one component repo; plan cross-repo contract slices by hand. |
| 7 | Supply chain: npm publishes from a personal machine with no provenance. | Install from a reviewed, pinned fork in the internal registry. |
| 8 | Process cost and friction: cancelled CI runs, five review rounds on one slice, hand workarounds when tooling fails (issues #69, #72, #75). | Measure in the trial. Budget model spend per slice. |
| 9 | Traceability is shallow: a test "covers" a REQ through a text mention. | Treat coverage as declared, not proven. Pair it with real coverage tooling such as JaCoCo. |

## 7. Claims checked

**True**
- Zero runtime dependencies, enforced in CI.
- One gate, two callers: the Stop hook and `check --ci`.
- Actions pinned by SHA.
- Fail-closed pre-bash and pre-edit hooks.
- Protected-branch commit and push denied for literal commands, as is a subagent's literal `git commit`.
- Frozen tests enforced at `build commit` (`src/build/commit.js:48-64`).
- The independent-review requirement is read from the base branch on origin (`src/ready-label.js:23-47`).
- Phase 4 is not built, as the README says.

**False, unenforced, or weaker than stated**
- "Agents never run git" (D-19, REQ-3.2) holds only for literal commands; `eval`, `node -e` and `python -c` pass.
- "A tamper-evident record of what agents did": the chain has no key, so a rewritten chain verifies; the actor is self-asserted; uncommitted lines are unprotected (D-36); no journal file has been committed in the kit's own repo.
- Frozen-test protection has gaps: writes through Bash are not covered (pre-edit leaves them to pre-bash, which has no frozen-test rule); no CI rule checks frozen tests; a state file forged on disk and hidden with `assume-unchanged` passes (issue #71).
- "Independent review": the kit cannot check that the review session is independent; it is a second agent session, not a second person.
- "The spec stays true because a machine checks it": the machine checks IDs, references and format, not behaviour.
- The process is not always followed by its author (D-43; PR #86 hand commit because of issue #72).
- Multi-repo "workspaces" cover the graph only, not building.

## 8. Gaps to close before adoption

1. Server-side enforcement generated or verified by the kit: branch rulesets, required checks, CODEOWNERS and a two-person rule; `check` fails when they are absent.
2. An audit journal signed or keyed, with the actor bound to a verified identity, exported to a store the team controls.
3. A frozen-test rule in CI, not only in local `build commit`; issue #71 fixed.
4. Adapters for the team's git host, CI (self-hosted runners) and tracker (Jira), and a second agent tool, or a documented exit path.
5. A data-handling layer: path deny-lists for agents, a synthetic-data policy, secret scanning, pinning of the model and endpoint.
6. Building across repos, or a documented cross-repo slice procedure; ArgoCD release integration; the Phase 4 commands (release, ops, audit).
7. Java CI templates (JDK, Maven or Gradle, Testcontainers for Kafka) that pass `workflow --check`.
8. Maturity: 1.x, more than one maintainer, npm provenance (D-62).

**What a sandbox pilot should measure:** lead time per slice and model cost per slice; review rounds per slice and the share of real blockers; CI minutes per PR and the share of cancelled or failed runs; how often humans worked around the kit; guard bypasses observed; escaped defects after merge; onboarding time to the first merged slice; whether an auditor accepts the trace from REQ to PR to release as change evidence.

## 9. Skipped and not checked

Skipped: the full test suite (it runs out of memory on the reviewer's machine; CI history was used instead); every command that writes files; running an agent loop; reading every spec file.

Not checked: a Maven build with Kafka containers in the generated workflow; performance on a large Java repo or with 150 MB files in git; whether `slicekit update` keeps team edits; Windows and macOS behaviour beyond CI; the npm tarball against the repo; token cost per slice; whether closed issues were fixed.
