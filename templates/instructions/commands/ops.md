# /slicekit ops

Triage one symptom: find the slices and pull requests that touched the files it names, the
runbook's first checks for it, and the actions someone could take, each marked by who may take it
(REQ-2.13). The symptom: {{args}}.

This command takes no action and changes no tracked file. Its report goes under
`.slicekit/reports/`, which the project's ignore rules cover, and is never committed. Every step
that reads the repository's history goes through `{{cli}}`; run no git or gh command yourself.

When the symptom is `(none)`, ask the human for it and stop until they answer.

## Steps

1. Run `{{cli}} graph`, so the history the next step reads holds the latest merged pull requests.
2. Run `{{cli}} ops context "{{args}}"`, with the symptom in one pair of double quotes and any
   double quote, backquote or dollar sign inside it removed. Its first line is the report path.
   The rest names the files the symptom's words match, the history of those files, the runbook,
   `observability.md` and the last release record.
   - On exit 1 the symptom names no file in the graph. Ask the human which file, directory or
     service is meant, then run the command again with `--path <path>` for each one they name.
   - A `too broad:` line names a word that matches more than fifty files and was not expanded. Tell
     the human; when that word is the one they meant, ask for a narrower path and add it with
     `--path`.
3. Spawn the ops agent. Its brief is the output of `{{cli}} instructions ops`. Give it the symptom
   and the whole output of step 2, and tell it to read the runbook, `observability.md` and the
   release record that output names. The agent holds no tool that writes a file or runs a command:
   its reply is the report.
4. Write the agent's reply, as it is, to the report path from step 2 with the Write tool. Change no
   word of it. Step 2 created that path as an empty file, so read it with the Read tool before the
   first write, or the Write tool refuses to overwrite it.
5. Run `{{cli}} ops check <report>`. It prints `ok <report>`, or one `<report>:<line> <message>`
   line per problem: a missing section, a slice or pull request the graph does not hold, a cited
   `<file>:<line>` that does not exist, an action marked by no one. On findings, send them to the
   agent once, write its new reply to the same path and run the check again. When the check still
   finds a problem, print the findings with the report path and go on to step 6.
6. Print the report path and the report's `## Proposed actions` section. Tell the human that no
   action was taken: each proposed action is theirs, or the named owner's, to take.
