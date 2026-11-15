# /slicekit audit

Compare what the spec and the runbook claim with what the code, the tests and the CI history show,
and list each claim as `holds`, `drifted` or `unverifiable` (REQ-2.14). The area: {{args}}.

The area is a spec file's name without `.md`, a REQ prefix such as `REQ-2`, the word `runbook`, or
a path; `(none)` means every claim. This command changes no tracked file. Its report goes under
`.slicekit/reports/`, which the project's ignore rules cover, and is never committed. Every step
that reads the repository's history goes through `{{cli}}`; run no git or gh command yourself.

## Steps

1. Run `{{cli}} graph`, so the files the claims name are read from the latest history.
2. Run `{{cli}} audit context {{args}}`; when the area is `(none)`, leave it out and run the command
   with no area. Its first line is the report path. Then, for each claim in the area (each REQ block
   of the spec, each `##` section of the runbook), it prints the claim's ID, its `<file>:<line>` and
   its title, the files the claim names, and one `candidate` line for each commit that touched one of
   those files after the claim's heading was last changed. It prints at most ten `candidate` lines
   for a claim, the newest, then one line that counts the older ones and names the command that
   prints them: `{{cli}} audit context <area> --all --no-report`. That form prints the context
   alone, with every candidate and no report path, and reserves no report file, so the report of
   this step stays the one the auditor writes. On exit 2 the area names no claim: print what it says and ask the human
   for another area.
3. Spawn the auditor in audit mode. Its brief is the output of `{{cli}} instructions auditor`. Give
   it the whole output of step 2 and the report path, and tell it this is an audit, not a gap scan:
   the claims are the ones listed, and the evidence is the code, the tests and the CI history. The
   auditor writes the report at that path. Step 2 created that path as an empty file, so tell the
   auditor to read it with the Read tool before the first write, or the Write tool refuses to
   overwrite it.
4. Run `{{cli}} audit check <report> {{args}} --every-claim`, with the same area as step 2 or none.
   The check reads the area's claims from the spec and the runbook, as step 2 did. It prints
   `ok <report>`, or one `<report>:<line> <message>` line per problem: a missing `## Claims` table,
   a row for a claim that is not in the area, a claim of the area with no row, a claim with two
   rows, a status that is not one of the three words, a
   `drifted` row whose commit is not one of its claim's candidates. On findings, send them to the
   auditor once and run the check again. When the check still finds a problem, print the findings
   with the report path and go on to step 5.
5. Print the report path and the count of rows for each status. Tell the human that the audit
   changed nothing: each `drifted` row becomes a slice or a decision, by their hand, and each
   `unverifiable` row is a claim with no test or check behind it.
