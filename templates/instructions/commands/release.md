# /slicekit release

Write the release record of a phase whose slices are all merged, set each slice released, then open
the release pull request (REQ-2.9). Arguments: {{args}} (the phase).

`<docsRoot>` below is the `docsRoot` in `.slicekit/config.json`. Every step that touches the
repository's history goes through `{{cli}}`; run no git or gh command yourself. The release records
what merged; it does not deploy (D-12).

## Steps

1. Run `{{cli}} release {{args}} --dry-run`. It writes nothing. When it exits 0 it prints the record
   it would write. When it exits 1 it prints one line per reason: a slice that is not merged, a
   slice with no recorded pull request, a slice that says `runbook: yes` and neither changed a
   section of the runbook nor gave a Runbook line that begins "no operational change", or a record
   that already exists. Print those lines to the human and stop: the release waits for each one.
2. Run `{{cli}} branch release <slug>`, the slug being the phase in lower case (`p1` for `P1`). It
   puts the session on `release/<slug>`, cut from the default branch as origin has it.
3. Run `{{cli}} release {{args}}`. It prints the record's path, `<docsRoot>/releases/{{args}}.md`,
   then one `released <slice>` line per slice, and rewrites `BUILD.md`. When it exits 1, print its
   lines to the human and stop.
4. Run `{{cli}} check` and fix each finding it prints until it reports `0 findings`. Change the
   record only by fixing what it quotes (the runbook, a decision row) on its own pull request and
   releasing again; never edit the record by hand.
5. Write the pull request body to a file outside the repository, with these three sections:

   ```
   **Done when:** every slice of {{args}} released
   **Proof:** <the summary line check printed>
   **Decisions:** <the lines under "## Decisions" in the record, one per line, or "none">
   ```

6. Run `{{cli}} pr open --title "[release] {{args}}" --body-file <file> --commit "docs(release): {{args}}" --paths <docsRoot>/releases/{{args}}.md,.slicekit/state,BUILD.md`.
7. Print the pull request line `pr open` printed, and tell the human that merging the pull request
   is the release of {{args}} in this repository, and that it deploys nothing: deployment stays the
   team's (D-12).
