# /slicekit brief

You interview a person who has an idea but no requirement document, and write their brief from their answers alone. You end with `<docsRoot>/brief/<slug>.md` committed on the spec branch, and the intake command that takes it as its source. The slug is: {{args}}

`<docsRoot>` below is the `docsRoot` in `.slicekit/config.json`.

This command writes no spec text and no file under `<docsRoot>/spec/`. Writing the spec is `/slicekit specify`, after `/slicekit intake`. Every git step is in the CLI: the branch and the brief commit are `{{cli}}` subcommands. You run no git command yourself.

When a `{{cli}}` step exits with a code other than 0, stop and show the person its message. Do not work around it.

## 1. The slug and the work branch

When the slug above is `(none)`, ask the person for a short name for the idea, and make the slug from it: lower-cased, each run of characters other than `a-z0-9` turned into one `-`, dashes trimmed from both ends, at most 60 characters. Then run:

`{{cli}} branch spec <slug>`

## 2. Start the brief

`{{cli}} brief start <slug>`

It prints the brief's path, for example `docs/brief/payments-retry.md`. Call it `<brief>` below. It holds the seven headings and nothing else yet.

## 3. The interview

Ask one question at a time, one topic per question, in this order:

1. `problem`: the problem and who has it
2. `today`: what they do today
3. `use-cases`: the use cases
4. `out-of-scope`: what is out of scope
5. `success-measures`: the success measures
6. `constraints`: the constraints
7. `unknowns`: what they know they do not know

A topic may take more than one question; do not mix two topics in one question, and do not go back to an earlier topic. Ask in the person's terms. Offer no answer of your own: the brief holds only what the person says.

For each question:

1. Before you ask it, run `{{cli}} brief ask --topic=<topic> --question=<the question>`. It prints `question <n>`.
2. Ask the person, and wait for the answer.
3. Record the answer in the person's own words with `{{cli}} brief answer --answer=<the answer>`. It writes the answer under the topic's heading in `<brief>`.
   - When the person says they do not know, or cannot answer, run `{{cli}} brief answer --unknown`. It lists the topic under `## Open questions` and writes nothing under the topic's heading. Never write a guess in its place.
4. Ask the next question only after the answer step exits 0. The CLI refuses a new question while the last one has no answer, and a topic out of the order above.

Always write a value as `--option=<text>`, with the `=`, so a value that starts with `-` is read as text and not as an option.

## 4. Finish

`{{cli}} brief done`

It commits `<brief>` alone on the spec branch. Its last line is the next command, for example `/slicekit intake docs/brief/payments-retry.md`. Show the person that line as it is: `/slicekit intake` takes the brief as its source like any other document.

`{{cli}} brief done` refuses while a question has no answer, on the default branch or a protected branch, while a heading is missing from `<brief>`, or when a file under `<docsRoot>/spec/` appeared or changed during the interview. Show the person the message. Never delete or edit a spec file to get past it.

## You never

- Write or edit a file under `<docsRoot>/spec/`.
- Edit `<brief>` by hand, or add text the person did not give. Answers are written only by `{{cli}} brief answer`.
- Edit the brief session file.
- Run a git or gh command. The CLI does every git step.
