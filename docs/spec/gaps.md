# Gaps

Each row is a place where the spec is silent, vague or in conflict with the intake. A gap stays here until a decision or a spec change closes it.

Scanned: 2026-11-02 at 7b31c0a

| # | Class | Where | What | Closed by |
|---|-------|-------|------|-----------|
| G-1 | unknown | docs/platform.md:3 | Providers and services not yet known | D-79 |
| G-2 | unknown | docs/platform.md:7 | Environments not yet known | D-79 |
| G-3 | unknown | docs/platform.md:11 | How a change reaches each environment not yet known | D-79 |
| G-4 | unknown | docs/platform.md:15 | Access and ownership not yet known | D-79 |
| G-5 | unknown | docs/platform.md:19 | Secrets not yet known | D-79 |
| G-6 | unknown | docs/platform.md:23 | Network boundaries not yet known | D-79 |
| G-7 | unknown | docs/observability.md:3 | Dashboards not yet known | D-79 |
| G-8 | unknown | docs/observability.md:7 | Alert routes not yet known | D-79 |
| G-9 | unknown | docs/observability.md:11 | Log shape and required fields not yet known | D-79 |
| G-10 | unknown | docs/observability.md:15 | Trace and correlation IDs not yet known | D-79 |
| G-11 | unknown | docs/observability.md:19 | CI steps the monitoring setup requires not yet known | D-79 |
| G-12 | unknown | docs/observability.md:23 | On-call contact not yet known | D-79 |
| G-13 | unknown | docs/runbook.md:3 | How to run it not yet known | D-82 |
| G-14 | unknown | docs/runbook.md:15 | Known failure modes and the first thing to check not yet known | D-82 |
| G-15 | unknown | docs/runbook.md:19 | Actions and who may take them not yet known | D-82 |
| G-16 | unknown | docs/runbook.md:23 | Rollback not yet known | D-82 |
| G-17 | unknown | docs/decisions.md:95 | D-27 is open: More seed phrases for the filler list, from the author's reading of agent output. | D-27 |
| G-18 | unknown | docs/decisions.md:96 | D-62 is open: How does the publish workflow of P5/S-24 authenticate to npm, so that a version published from CI carries a provenance attestation (REQ-5.5)? | D-62 |
| G-19 | unknown | docs/decisions.md:97 | D-63 is open: Which version is the first one published from CI by P5/S-24: 0.3.0, still a preview, or 1.0.0? | D-63 |
| G-20 | unknown | docs/decisions.md:98 | D-79 is open: Do you want the platform and monitoring pass now (12 short questions about where the kit's own repository runs, deploys, keeps secrets and is watched), or leave those sections Not yet known as they are today? | D-79 |
| G-21 | missing | docs/spec/03-hooks-gates-ci.md:28 | REQ-3.2 denies a command it cannot judge only from a subagent or on a protected branch, so the main session on a slice branch still passes the review's probes: a push to main with the ref in a variable, and a force push with the subcommand in a variable; docs/intake/2026-11-02-architect-review.md:70 | D-83 |
| G-22 | contradiction | docs/spec/03-hooks-gates-ci.md:107 | The REQ-3.7 rule table, which lists every rule check exits non-zero on, has no host-rules row (REQ-3.14), no frozen row (REQ-3.15) and no signed-commit condition on the journal row (REQ-3.8); docs/spec/03-hooks-gates-ci.md:298 | REQ-3.7 |
| G-23 | contradiction | docs/spec/03-hooks-gates-ci.md:275 | REQ-3.13 scenario says a read of a denied path is refused and the hook names the pattern, but no hook handles a Read: pre-edit covers Edit and Write only and C-3 maps no read event; docs/spec/contracts/C-3-agent-tool.md:81 | REQ-3.13 |
| G-24 | contradiction | docs/spec/03-hooks-gates-ci.md:219 | The sync job opens its pull request only when the state or BUILD.md changed, yet REQ-3.8 requires the sync pull request to add a journal-heads line for every changed journal file, which a merge can change without changing state; docs/spec/03-hooks-gates-ci.md:156 | REQ-3.11 |
| G-25 | contradiction | docs/spec/03-hooks-gates-ci.md:220 | The sync pull request has no slice title or body and its opener (the workflow's bot) is not in the ci.botActors default of dependabot and renovate, so ci-title and ci-body fail it under the required checks of REQ-3.14; docs/decisions.md:46 | REQ-3.7 |
| G-26 | missing | docs/spec/03-hooks-gates-ci.md:223 | Under workflow_dispatch there is no pull request event, and the spec does not say how check --ci finds the sync pull request's title, body, actor and slice for ci-title, ci-body and the frozen rule (D-80 says the checks run as on any pull request); docs/decisions.md:88 | REQ-3.11 |
| G-27 | contradiction | docs/spec/contracts/C-1-git-host.md:9 | C-1 says the kit calls a git host only through this interface, but it has no operation to start a workflow_dispatch run, which REQ-3.11 requires of the sync job (D-80); docs/spec/03-hooks-gates-ci.md:223 | D-80 |
| G-28 | contradiction | docs/spec/contracts/C-1-git-host.md:3 | C-1's consumer list omits slicekit check and slicekit init, which call getCommit, readBranchRules, readCodeowners and applyBranchRules; docs/spec/03-hooks-gates-ci.md:283 | D-77 |
| G-29 | missing | docs/spec/03-hooks-gates-ci.md:289 | REQ-3.14 does not say which credential CI reads the branch rules with; D-78 and D-80 rule out a token secret, and D-81 fails CI when the token may not read them, so the source of a token that can read them is unstated; docs/decisions.md:89 | D-84 |
| G-30 | unrequested | docs/spec/03-hooks-gates-ci.md:286 | REQ-3.14 also fails check when branch deletion is allowed; D-77 lists four rules (pull request required, kit checks required, no force push, one human approval) and no deletion rule; docs/decisions.md:86 | REQ-3.14 |
| G-31 | contradiction | docs/spec/03-hooks-gates-ci.md:287 | No agent, hook or CI job SHALL change a host rule names no enforcing script and is not marked advisory, and REQ-3.2 does not deny gh api calls to branch protection or rulesets from the main session; docs/spec/00-overview.md:26 | REQ-3.14 |
| G-32 | contradiction | docs/spec/03-hooks-gates-ci.md:147 | REQ-3.8 says the journal protection is exactly the chain and the default-branch prefix, then the next paragraph adds the signed-commit rule and journal-heads record of D-71, which amends D-36; docs/spec/03-hooks-gates-ci.md:154 | REQ-3.8 |
| G-33 | unsupported | docs/spec/03-hooks-gates-ci.md:231 | The JDK default of 21 in ci.java has no decision or intake sentence behind it; D-69 decides the build tool only; no evidence | D-85 |
| G-34 | contradiction | docs/spec/03-hooks-gates-ci.md:230 | The Java setup applies when the repository holds pom.xml or a build.gradle file, then says what happens with neither present, which that condition excludes; D-69 has the declared commands decide when both or neither are present; docs/decisions.md:78 | REQ-3.11 |
| G-35 | missing | docs/spec/03-hooks-gates-ci.md:233 | The Java CI template says nothing of integration containers (Testcontainers for Kafka) that the review asks the template to support and pass workflow --check with; docs/intake/2026-11-02-architect-review.md:150 | D-86 |
| G-36 | missing | docs/spec/03-hooks-gates-ci.md:226 | Actions pinned by SHA are fetched from github.com; the spec does not say how the workflow gets them on a GitHub Enterprise Server host, which D-70 leaves possible and D-67 requires the kit to work on; docs/decisions.md:79 | D-86 |
| G-37 | missing | docs/spec/03-hooks-gates-ci.md:306 | D-66 puts open issues 69, 71, 72, 75 and 87 in scope; the spec addresses only #71 and states no requirement for 69 (build stages deletions), 72 (amend after unfreeze), 75 (version bump breaks old verdicts) or 87 (defaultBranch from a feature branch); docs/decisions.md:75 | D-87 |
| G-38 | contradiction | docs/spec/01-layout-and-state.md:13 | The layout lists repos as a config key, which configVersion 2 removes (D-60), and omits the keys this branch adds: agents.denyPaths, ci.runsOn, ci.java, tracker.kind, tracker.baseUrl, tracker.project, tracker.issueType; docs/decisions.md:71 | REQ-1.1 |
| G-39 | missing | docs/spec/01-layout-and-state.md:16 | The install layout does not list .slicekit/journal-heads.log, which the sync pull request writes, nor does REQ-3.3 protect it from edits as it does the journal; docs/spec/03-hooks-gates-ci.md:157 | REQ-1.1 |
| G-40 | contradiction | docs/spec/05-kit-quality-and-release.md:17 | The kit's source tree lists only the githost adapter under src/adapters/, while C-2 places the tracker adapter, now GitHub Issues and Jira, in src/adapters/tracker/; docs/spec/contracts/C-2-tracker.md:3 | REQ-5.1 |
| G-41 | missing | docs/spec/04-traceability-graph.md:94 | D-76 decides a slice is built in one repository and a change spanning repositories is planned as one slice per repository by hand; no REQ states the build loop's single-repo limit or that rule; docs/decisions.md:85 | REQ-4.6 |
