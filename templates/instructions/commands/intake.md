# /slicekit intake

You bring a requirement document into the project and interview the human about it. You end with the snapshot, one decision row per answer, and a list of the questions still open. The source is: {{args}}

`<docsRoot>` below is the `docsRoot` in `.slicekit/config.json`.

This command writes no file under `<docsRoot>/spec/`. Writing the spec is `/slicekit specify`, later. Every git step is in the CLI: the branch, the snapshot commit and the answers commit are all `{{cli}}` subcommands. You run no git command yourself.

When a `{{cli}}` step exits with a code other than 0, stop and show the human its message. Do not work around it.

## 1. The work branch

The slug is the program name (`name` in `.slicekit/config.json`) lower-cased, with each run of characters other than `a-z0-9` turned into one `-`, dashes trimmed from both ends, cut to 60 characters, then dashes trimmed again; it is `source` if nothing is left. The snapshot in step 2 names its file by the same rule, applied to the source's base name without its extension. Then run:

`{{cli}} branch spec <slug>`

## 2. The snapshot

`{{cli}} intake snapshot {{args}}`

The first line it prints is the snapshot's path, for example `docs/intake/2026-10-26-orders.md`. Call it `<snapshot>` below. A snapshot is frozen: you never edit it. When the source changes, run this step again for a new snapshot.

## 3. Read the snapshot

Read `<snapshot>` in full before the first question. Note the line numbers where it names a component, a system or an interface between components or repositories. You cite these line numbers in step 4.

## 4. The product pass

Ask one question at a time, one topic per question, in this order:

1. purpose
2. users
3. components
4. existing systems
5. constraints
6. out of scope
7. interfaces between components or repositories, one question per interface

A topic may take more than one question. Do not mix two topics in one question. Where a question has likely answers, offer them as numbered choices: the one the snapshot suggests goes first, and the last choice lets the human say something else. Skip a question the snapshot already answers beyond doubt, and record that answer the same way, citing the line.

For each question:

1. Before you ask it, run `{{cli}} intake ask --pass product --topic=<topic> --question=<the question>`. It prints `question <n>`.
2. Ask the human, and wait for the answer.
3. Record the answer with `{{cli}} intake answer --answer=<the answer>`. It prints the D-ID of the row it wrote.
   - Add `--type=<Type>` when the answer is not a decision the team made. Use `Information` for a fact, `Action` for work only a person can do, and `Counsel` when an expert view is needed.
   - For an interface, add `--interface=<name>`, and `--source=<snapshot>:<line>` when the snapshot names it.
   - When the human cannot answer, record the question as open: `{{cli}} intake answer --open --why=<why it matters> --recommendation=<what you would do>`.
4. Ask the next question only after the answer step has printed a D-ID. The CLI refuses a new question while the last one has no row.

Always write a value as `--option=<text>`, with the `=`, so a value that starts with `-` is read as text and not as an option.

## 5. The platform pass

When the product pass is done, ask about the platform and the monitoring, one section per question, in the same way with `{{cli}} intake ask --pass platform`. The CLI refuses a product question once the first platform question is asked, so finish the product pass first.

The sections of `<docsRoot>/platform.md`:

- Providers and services
- Environments
- How a change reaches each environment
- Access and ownership
- Secrets
- Network boundaries

The sections of `<docsRoot>/observability.md`:

- Dashboards
- Alert routes
- Log shape and required fields
- Trace and correlation IDs
- CI steps the monitoring setup requires
- On-call contact

After each answer step, write the answer into its section of the file, followed by the D-ID in brackets, for example `One Postgres on Fly (D-07).`. Leave the single line "Not yet known" in each section the human cannot answer, and record that question with `--open`. Change nothing else in these two files.

## 6. Finish

`{{cli}} intake done`

It commits `<docsRoot>/decisions.md`, `<docsRoot>/platform.md` and `<docsRoot>/observability.md`. It prints one `open: <D-ID> <question>` line per question still open, or `open: none`. Show the human that list as it is: these are the questions the interview could not answer.

`{{cli}} intake done` refuses while a question has no answer, while a pass asked nothing, or when a file under `<docsRoot>/spec/` appeared or changed during the interview. Show the human the message. Never delete or edit a spec file to get past it.

## You never

- Write or edit a file under `<docsRoot>/spec/`.
- Edit the snapshot, its sidecar, or `<docsRoot>/decisions.md` by hand. Rows are written only by `{{cli}} intake answer`.
- Edit the interview session file.
- Run a git or gh command. The CLI does every git step.
