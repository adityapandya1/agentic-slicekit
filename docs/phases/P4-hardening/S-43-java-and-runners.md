---
slice: P4/S-43
name: Java builds and the team's runners in the workflow
repo: .
group: J
runbook: yes
requirements: [REQ-3.11]
decisions: [D-67, D-69, D-85, D-86]
---

## Done when

1. Config accepts `ci.runsOn` (a string or a list of runner labels, default `ubuntu-latest`) and `ci.java` (a JDK version, default 25, D-85); `validateConfig` refuses other types naming the key (REQ-3.11).
2. Every generated job runs on `ci.runsOn`; the kit's own three-system test matrix is unchanged (REQ-3.11, D-67).
3. A repository with `pom.xml`, `build.gradle` or `build.gradle.kts` at the root, or a declared command calling `mvn`, `gradle` or `./gradlew`, is a Java repository: each job that runs a team command sets up a JDK of `ci.java` with the cache of the one build file present, or, with both or neither, of the tool the commands call; the cache is set only when the checkout holds a file that tool's cache keys on (`pom.xml`, or a Gradle build or wrapper file, at any depth), since setup-java fails a job whose cache matches no file, and otherwise the JDK is set up with no cache (REQ-3.11, D-69).
4. A repository with no Java build file and no such command gets the same workflow as today, byte for byte (REQ-3.11).
5. `workflow --check` passes on each generated workflow; the actions are pinned by SHA from `templates/workflow/pins.json`; `docs/runbook.md` says a runner needs Docker for Testcontainers and a GitHub Enterprise Server host needs GitHub Connect or mirrored actions at the pinned SHAs (REQ-3.11, D-86).

## Evaluation set

| Test | Kind | Covers |
|---|---|---|
| `workflow.test.js » a Maven repository's command jobs set up a JDK with the Maven cache` | happy | REQ-3.11 |
| `workflow.test.js » a Gradle repository's command jobs set up a JDK with the Gradle cache` | happy | REQ-3.11 |
| `workflow.test.js » ci.runsOn names the runner of every job` | happy | REQ-3.11 |
| `workflow.test.js » a repository with no Java build renders as before` | negative | REQ-3.11 |
| `config.test.js » ci.runsOn or ci.java of the wrong type is refused` | negative | REQ-3.11 |

Amended 2026-11-08: `workflow.test.js` — the two command-only cases (an empty folder with an `mvn` or `./gradlew` command) expected a cache, which setup-java refuses when no file matches (Codex on #135); they now expect a JDK step with no cache.

## Expected changes

`src/workflow.js`, `src/config.js`, `templates/workflow/pins.json`, `test/fixtures/golden/workflow/`, `docs/runbook.md`, tests.

## Tasks

### Task 1: Runners and the JDK

**Files:** Modify `src/workflow.js`, `src/config.js`, `templates/workflow/pins.json`, `test/workflow.test.js`, `test/config.test.js`, `test/fixtures/golden/workflow/`.

- [ ] **Step 1: Failing tests** — the five tests above.
- [ ] **Step 2: Run** `node --test test/workflow.test.js test/config.test.js` → FAIL.
- [ ] **Step 3: Implement**; pin `actions/setup-java` by SHA in `pins.json`; `cache: maven` or `cache: gradle` on that step.
- [ ] **Step 4: Run** the same → PASS; `node bin/slicekit.js workflow --check` → no drift on the kit's own workflow.
- [ ] **Step 5: Commit** `feat(workflow): Java builds and ci.runsOn`.
