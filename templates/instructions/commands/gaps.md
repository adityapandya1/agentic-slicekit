# /slicekit gaps

After the spec pull request is merged, find each place where the spec is silent, vague or in
conflict with the intake, ask the human about each one, close every row, then open the gaps pull
request (REQ-2.4). Arguments: {{args}}.

`<docsRoot>` below is the `docsRoot` in `.slicekit/config.json`. Every step that touches the
repository's history goes through `{{cli}}`; run no git or gh command yourself.

## Steps

1. Run `{{cli}} branch gaps <slug>`. The slug is the program name (`name` in
   `.slicekit/config.json`) lower-cased, with each run of characters other than `a-z0-9` turned
   into one `-`, dashes trimmed from both ends, cut to 60 characters, then dashes trimmed again; it
   is `source` if nothing is left. The branch is cut from the default branch, which holds the
   merged spec.
2. Run `{{cli}} stage require spec-review`. On exit 1, print what it says and stop: the gaps step
   waits for the spec pull request to be merged.
3. Run `{{cli}} gaps scan`. It writes a row to `<docsRoot>/spec/gaps.md` for each gap a script can
   find: each "Not yet known" section, each Open decision, each REQ that cites one, and each
   interface named at intake with no contract. It prints the rows it added, or `no new gaps`.
4. Spawn the auditor. Its brief is the output of `{{cli}} instructions auditor`. Give it the claims,
   every file under `<docsRoot>/spec/`, and the evidence, the snapshots under `<docsRoot>/intake/`
   and `<docsRoot>/decisions.md`. The auditor records each gap it finds with `{{cli}} gaps add` and
   lists the G-IDs it added. Read `<docsRoot>/spec/gaps.md` when it returns.
5. For each row whose `Closed by` cell is empty, ask the human one question about it, offering
   choices where they exist. Close the row in one of two ways:
   - Record the answer. For a row about an Open decision, settle that row with
     `{{cli}} decide settle <D-ID> --answer <answer>` (adding `--type <T>` when its Type is
     `Open`); otherwise run `{{cli}} decide add` with the
     answer. Then run `{{cli}} gaps close <G-ID> --decision <D-ID>`. An Open row cannot close a gap,
     so settle it first.
   - Or change the REQ the gap is about, then run `{{cli}} gaps close <G-ID> --req <REQ>`. The REQ
     must differ from the merged spec.

   A REQ that rests on an Open decision closes with the same D-ID once that row is settled. When an
   Open question was reworded after an earlier scan, the row for the old wording stays open: close
   it with the decision that settles the question, or tell the human it is the same gap and close it
   the same way. When the human cannot answer yet, the row stays open; tell them which rows are
   open and stop here.
6. Run `{{cli}} stage require gap-scan`. It must print `ready: gap-scan`; on exit 1, close each row
   it names. Then run `{{cli}} check` and fix each finding until it reports 0 blocking.
7. Write the pull request body to a file outside the repository, with these three sections:

   ```
   **Done when:** every gap between the spec and the intake is a G row, and every G row is closed by a decision or a REQ change
   **Proof:** <the rows gaps scan and the auditor added> · <the summary line check printed>
   **Decisions:** <the D rows that closed a gap, one per line, or "none">
   ```

   Then run `{{cli}} pr open --title "[spec] <program name>: gaps" --body-file <file> --commit "docs(spec): gaps" --paths <docsRoot>/spec,<docsRoot>/decisions.md`,
   with the program name from `.slicekit/config.json`.
8. Print the pull request line `pr open` printed, and tell the human that merging the pull request
   approves the answers.
