# /slicekit specify

Write the spec from the intake snapshots and the decisions, one capability per file, with a contract
for each interface named at intake, then open the spec pull request (REQ-2.3, D-07). Arguments:
{{args}}.

`<docsRoot>` below is the `docsRoot` in `.slicekit/config.json`. Every step that touches the
repository's history goes through `{{cli}}`; run no git or gh command yourself.

## Steps

1. Run `{{cli}} branch spec <slug>`. The slug is the program name (`name` in
   `.slicekit/config.json`) lower-cased, with each run of characters other than `a-z0-9` turned
   into one `-`, dashes trimmed from both ends, cut to 60 characters. That is the slug intake used,
   so the spec lands on the branch that holds the intake snapshot.
2. Run `{{cli}} stage require clarify`. On exit 1, print what it says and stop: the spec waits for
   intake and clarify.
3. Read every snapshot under `<docsRoot>/intake/` and every row of `<docsRoot>/decisions.md`. These
   are the only sources a requirement may stand on.
4. Write `<docsRoot>/spec/<capability>.md`, one capability per file. Each requirement has the shape
   of REQ-1.3:
   - a `## REQ-<n>.<m> <title>` heading;
   - one or more sentences with SHALL;
   - a `Scenario:` line in GIVEN / WHEN / THEN form;
   - a `Cites:` line naming the snapshot (`../intake/<file>`) or the D rows that support it;
   - an `Enforced by:` line naming the test or check that proves it.

   Where no intake sentence and no decision supports a claim, write
   `[NEEDS CLARIFICATION: <question>]` in its place. Never guess, and never add a requirement the
   sources do not ask for.
5. Run `{{cli}} spec verify`. For each interface it lists without a contract, write
   `<docsRoot>/spec/contracts/C-<n>-<name>.md`: the producer, the consumers, a table of the
   operations with their inputs and outputs, and a `Cites:` line naming the interface's D row.
6. Run `{{cli}} spec verify` again until it exits 0, fixing each finding it prints. A REQ that cites
   nothing that exists gets a clarification marker, not an invented source. The markers it lists may
   stay: the gaps step and the plan deal with them. Then run `{{cli}} check` and fix each finding
   until it reports 0 blocking.
7. Write the pull request body to a file outside the repository, with these three sections:

   ```
   **Done when:** one spec file per capability, each REQ citing its source, a contract per interface named at intake
   **Proof:** <the first line spec verify printed> · <the summary line check printed>
   **Decisions:** <the D rows the spec cites, one per line, or "none">
   ```

   Then run `{{cli}} pr open --title "[spec] <program name>" --body-file <file> --commit "docs(spec): <program name>" --paths <docsRoot>/spec,<docsRoot>/decisions.md`,
   with the program name from `.slicekit/config.json`.
8. Print the pull request line `pr open` printed, and tell the human that merging the pull request
   approves the spec (D-07). Each clarification marker still in the spec is listed under the line.
