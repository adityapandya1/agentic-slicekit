# /slicekit plan

Write the stack, the phases and the slice files from the spec, regenerate `BUILD.md`, then open the
plan pull request (REQ-2.5). Arguments: {{args}}.

`<docsRoot>` below is the `docsRoot` in `.slicekit/config.json`. Every step that touches the
repository's history goes through `{{cli}}`; run no git or gh command yourself.

## Steps

1. Run `{{cli}} branch plan <slug>`. The slug is the program name (`name` in
   `.slicekit/config.json`) lower-cased, with each run of characters other than `a-z0-9` turned
   into one `-`, dashes trimmed from both ends, cut to 60 characters, then dashes trimmed again; it
   is `source` if nothing is left. That is the slug intake and the spec used, so the plan lands on
   the program's branch.
2. Run `{{cli}} plan check`. When it exits 1 it prints one blocker per line: a clarification marker
   as `<file>:<line> clarification marker: …`, or the gap scan not being done. Print them and stop;
   the plan waits for clarify and `/slicekit gaps`. Go on only when it prints `ready to plan`.
3. When `<docsRoot>/spec/stack.md` is absent or says nothing yet, take the stack (language, runtime,
   storage, test runner, hosting) from the intake snapshots or `<docsRoot>/decisions.md` when they
   give it. For each choice they leave open, ask the human one question, and record the answer with
   `{{cli}} decide add --type Decision --question "<the question>" --answer "<the answer>"`. Then
   write `stack.md` from those sources only.
4. Write one phase per milestone in the intake or the decisions:
   `<docsRoot>/phases/P<n>-<name>/P<n>.md`, with a `# Phase <n> — <name>` heading, the phase's goal
   in a few sentences, and one `**Order:** <step>; <step>; …` line, each step a comma list of the
   parallel groups that run at the same time (D-38). The line names every group of the phase
   exactly once, and no group that no slice has.
5. Write the slice files, `<docsRoot>/phases/P<n>-<name>/S-<nn>-<descr>.md`, in the shape of REQ-1.5:
   - front matter with `slice` (`P<n>/S-<nn>`), `name`, `repo`, `group`, `runbook`,
     `requirements` and `decisions`;
   - a `## Done when` list of at most five observable checks;
   - a `## Evaluation set` table with the columns `Test | Kind | Covers`, at least one `happy` and
     one `negative` row, each row naming the REQ it covers;
   - a `## Expected changes` list of the files or packages the slice changes, each in backticks;
   - the runbook flag set to `yes` when the slice touches configuration, infrastructure,
     migrations, alerts, queues or integrations (D-21), else `no`.

   Every REQ in the spec is named by at least one slice. No two slices of one Order step expect the
   same path, apart from the shared roots: `.`, anything under `test/`, `src/cli/index.js` and
   `<docsRoot>/runbook.md`. When two slices must change one file, put them in groups of different
   steps.
6. Run `{{cli}} status --write` to regenerate `BUILD.md`, then run `{{cli}} check` and fix each
   finding it prints, in the plan files only, until it reports `0 findings`. A `coverage` finding is
   a plan defect: a REQ no slice names, a slice with no happy or no negative test, an Order line
   that misses or repeats a group, or two slices of one step expecting one path. Run
   `{{cli}} status --write` again after each change to a slice file.
7. Write the pull request body to a file outside the repository, with these three sections:

   ```
   **Done when:** every REQ named by a slice, each slice with a happy and a negative test, no shared path within an Order step
   **Proof:** <the summary line check printed>
   **Decisions:** <the D rows recorded in step 3, one per line, or "none">
   ```

   Then run `{{cli}} pr open --title "[plan] <program name>" --body-file <file> --commit "docs(plan): <program name>" --paths <docsRoot>/spec/stack.md,<docsRoot>/phases,<docsRoot>/decisions.md,BUILD.md`,
   with the program name from `.slicekit/config.json`.
8. Print the pull request line `pr open` printed, and tell the human that merging the pull request
   approves the plan; `/slicekit build` then takes the first slice.
