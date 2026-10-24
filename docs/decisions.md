# Decisions

Every clarification the kit's own build rests on, with an ID the spec cites. One row per decision.
Settled rows stay; a reversal is a new row that names the one it replaces.

**Type.** *Decision* = the author chose, the code could go either way. *Action* = only the author can
do it. *Information* = a fact we did not have. *Open* = not yet answered.

## Settled

| # | Type | Question | Answer | Who, when |
|---|---|---|---|---|
| D-01 | Decision | Is this part of Redelio or its own project? | Its own public project, authored by Aditya Pandya. Redelio is the experience it was distilled from, not the owner. | author, 2026-10-24 |
| D-02 | Decision | Name? | The tool, package, folder and command prefix are `slicekit`. The repository is `agentic-slicekit`. `ratchet` was rejected for colliding with twbs/ratchet, sethvargo/ratchet and an npm package. | author, 2026-10-24 |
| D-03 | Decision | License? | MIT. | author, 2026-10-24 |
| D-04 | Decision | What does the kit itself run on? | Node, with zero runtime dependencies. Every supported agent tool already requires Node, and plain scripts are readable by a security team. | author, 2026-10-24 |
| D-05 | Decision | Which agent tools in version one? | Claude Code only. Commands, agents and skills are plain markdown and the engine is plain Node, so another tool is a renderer later, not a redesign. | author, 2026-10-24 |
| D-06 | Decision | Who runs slices in parallel? | Both. A large team: each developer runs the build command on their own slice. A small team or one person: one session fans out developer agents in separate worktrees. | author, 2026-10-24 |
| D-07 | Decision | How is a spec approved? | As a pull request. Merge is the approval. | author, 2026-10-24 |
| D-08 | Decision | Which copy of the requirement is authoritative after intake? | The repository. Intake copies the original into `docs/intake/` as a dated, hashed snapshot that the spec cites. A change to the original is a new intake. | author, 2026-10-24 |
| D-09 | Decision | Which git host and tracker in version one? | GitHub and GitHub Issues. Both sit behind an adapter interface so Jira, GitLab and others can follow. | author, 2026-10-24 |
| D-10 | Decision | Who writes a slice's tests, and when? | `BUILD.md` lists slices; each slice has its own file with spec references and an evaluation set (happy path, negative, end to end). The developer agent invoked by the build command writes the tests from that set, runs them, sees them all fail, then builds. Freezing those files for the rest of the slice is on by default and can be turned off in config. | author, 2026-10-24 |
| D-11 | Decision | Does the kit ship stack profiles (Java, Node, Python)? | No. The team declares its test, lint, build and end-to-end commands once in config. The kit never knows the language. | author, 2026-10-24 |
| D-12 | Decision | Is deployment in the kit? | Partly. The kit generates the GitHub Actions pipeline and a pull request needs green CI. Continuous deployment (Argo CD and the like) stays the team's; the kit records a release, it does not run one. | author, 2026-10-24 |
| D-13 | Decision | What is the graph in version one? | A traceability graph built by the kit from its own IDs and git: requirement, decision, slice, test, commit, pull request, file, release, repo. Deterministic, no model calls. Not a code graph; graphify can sit alongside. | author, 2026-10-24 |
| D-14 | Decision | How does the kit adapt to full-stack versus backend teams? | A shape chosen at init turns capabilities on or off. A capability that is off is absent from the install, never disabled. | author, 2026-10-24 |
| D-15 | Decision | Where does the spec live when one requirement spans several repositories? | One program repository holds intake, spec, phases and `BUILD.md`; a slice names the repository it is built in; a workspace file lists the repositories; contracts between services (events, topics, queues, APIs) are spec sections of their own. A single-repo team is the case where the program repo and the service repo are the same. The author was unsure; this is the recommendation taken. | author (by recommendation), 2026-10-24 |
| D-16 | Decision | Is Redelio the first installation? | No. Publish first; Redelio later. The kit builds itself from its first commit, which is the proof instead. | author, 2026-10-24 |
| D-17 | Decision | Where do clarification answers live? | In `docs/decisions.md` with IDs, cited by the spec. This file is the first instance. | author, 2026-10-24 |
| D-18 | Decision | How many review rounds? | Two in the build session. A blocker that survives both stops the loop with a draft pull request open. An independent review from a second session is required before merge by default and can be set to optional. | author (by recommendation, unopposed), 2026-10-24 |
| D-19 | Decision | Who runs git? | The command in the human's session. Agents write files and report; they never commit, push or open pull requests. | author (by recommendation, unopposed), 2026-10-24 |
| D-20 | Decision | Infrastructure and observability? | Captured at intake in a second interview and written to `docs/platform.md` and `docs/observability.md`. The kit adapts to the team's platform and monitoring stack and carries their CI steps as dependencies; it builds neither. | author, 2026-10-24 |
| D-21 | Decision | Runbook? | One per repository at `docs/runbook.md`, kept true by a check: a slice that touches configuration, infrastructure, migrations, alerts, queues or integrations must touch the runbook or say why not. An ops agent is its reader. | author, 2026-10-24 |
| D-22 | Decision | One state file or many? | One small file per slice under `.slicekit/state/`, so parallel branches never conflict on state. | author (by recommendation, unopposed), 2026-10-24 |
| D-23 | Decision | Is the graph committed? | No. Rebuilt in seconds, published as a CI artefact. | author (by recommendation, unopposed), 2026-10-24 |
| D-24 | Decision | Where do documents go? | A docs root, default `docs/`, configurable at init, because teams document differently. | author, 2026-10-24 |
| D-25 | Decision | How is filler language kept out? | A banned-phrase list in config, seeded by the kit, extended by the team, enforced as a ratchet in `slicekit check`. Seed examples from the author: "minting at the gate", "at the boundary of". | author, 2026-10-24 <!-- slicekit:example --> |
| D-29 | Decision | Which Node versions, and which files are tests? | Node 22 or later: Node 20 reached end of life on 2026-04-30. The test script is `node --test "test/**/*.test.js"`, so helpers and fixtures under `test/` never run as tests. | author (by review ruling), 2026-10-24 |
| D-30 | Decision | Which command do the hooks run, and how does init know it works? | `init` probes in order: `node_modules/slicekit/bin/slicekit.js` exists → `node node_modules/slicekit/bin/slicekit.js`; `slicekit` on PATH → `slicekit`; else `slicekit` (the PATH form) with the warning `slicekit is not installed locally or on PATH; hooks will fail until it is (npm i -D slicekit, or set cli in .slicekit/config.json)`, and the `--version` check is skipped so the two messages do not repeat each other. There is no registry fallback: an unclaimed npm name (D-26) must never be auto-installed by a hook, since anyone could publish under it and every hook call would run their code. `--cli <command>` or a `cli` already in config wins. After rendering, `init` and `update` run `<cli> --version` once (10 s timeout) and warn when it fails or prints another version; `init` prints `hooks run: <cli>`. Reason: `npx --no-install slicekit` fails for a global-only install and costs about 1.7 s per hook call on Windows (measured by the S-02 final review). README "How the hooks find slicekit". | author (by review ruling), 2026-10-24 |
| D-31 | Decision | May a first adoption raise a baseline? | Yes, once: `slicekit baseline update --adopt` records higher counts, prints each one with its previous value, is refused in CI, and a reviewer treats an adopted raise like any other finding. | the build, 2026-10-24 |
| D-32 | Decision | Is a hash-chained session journal wanted, or is the git log enough? | A per-session append-only journal of agent actions, each line carrying the hash of the previous one, so a tampered or truncated record is visible; the git log records commits, not what the agents did between them. | brainstorm with the author, 2026-10-24 |
| D-33 | Decision | Does the kit version itself and migrate a team's config? | Semver on the package; `.slicekit/config.json` carries `configVersion`; a newer kit migrates an older config forward on first run and prints each change; a downgrade refuses. | brainstorm with the author, 2026-10-24 |

## Open

| # | Type | Question | Why it matters | Recommendation |
|---|---|---|---|---|
| D-26 | Action | Reserve the npm name `slicekit` now? It is free today and this space moves fast. | Losing it forces a rename after the README is public. | Publish a 0.0.1 placeholder from this repository once the CLI skeleton exists (Phase 1, S-01). `npm view slicekit` returns 404 "Unpublished on 2026-07-29": a previous holder withdrew the name. The author tries `npm publish`; if npm refuses a withdrawn name, the fallback is `@adityapandya1/slicekit`. Until the author publishes the name, nothing in the kit fetches `slicekit` from the registry (D-30). |
| D-27 | Information | More seed phrases for the filler list, from the author's reading of agent output. | The ratchet is only as good as its seed. | Author adds phrases to `templates/style.json` as they meet them; the kit ships with those given so far. |
| D-28 | Decision | Public from the first commit, or private until 0.1 is installable? | Public early invites eyes and stars; private avoids a half-built first impression. | Private until Phase 1 passes its own `check` and the README's ten-minute walkthrough works; then public. |
