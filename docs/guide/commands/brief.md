# slicekit brief

The steps of `/slicekit brief` that the CLI takes: open the brief, record each question and its answer in the order of the topics, then commit the brief.

## Usage

```text
slicekit brief start <slug>
slicekit brief ask --topic <problem|today|use-cases|out-of-scope|success-measures|constraints|unknowns> --question <q>
slicekit brief answer (--answer <a> | --unknown)
slicekit brief done
```

| Subcommand | What it does |
|---|---|
| `brief start <slug>` | Writes `<docsRoot>/brief/<slug>.md` with its seven headings and prints its path. It refuses on the default branch or a protected branch, while another brief is under way, and when the file exists. |
| `brief ask` | Records the question the agent is about to ask and prints `question <n>`. The topic is the one last asked or the next in the order of the usage line. It refuses a topic out of that order, and a new question while the last one has no answer. |
| `brief answer` | Writes the answer just given under its topic's heading and prints the brief's path. `--unknown` lists the topic under `## Open questions` instead, once, and writes nothing under its heading; a later answer on the topic takes it off `## Open questions`. It refuses `--unknown` on a topic that already has an answer, naming `brief answer --answer` for the follow-up answer. An answer to `unknowns` goes under `## Open questions`. |
| `brief done` | Commits the brief alone on the current branch, then prints its path and, as the last line, `/slicekit intake <docsRoot>/brief/<slug>.md`. It refuses when no brief is under way, while a question has no answer, on the default branch or a protected branch, while a topic was never asked and answered (an answer given with `--unknown` counts as answered), naming the first such topic, when the brief file is missing, while a heading is missing from the brief, and when a file under `<docsRoot>/spec/` appeared, changed or was removed since `brief start`. |

`slicekit stage require brief` refuses a brief in which a topic's section is empty and the topic is not listed under `## Open questions`, naming the file and the section, so a brief edited by hand is held to the same rule. It also refuses a brief in which a section's only line is the line the blank brief `templates/brief/blank.md` holds under that heading, naming the file and the section, and one whose title still holds `<name>`; `brief done` refuses a section's only line that is that guidance line the same way.

To write a brief by hand, copy the blank brief `templates/brief/blank.md` from the installed package to `<docsRoot>/brief/<slug>.md` and replace the line under each heading. It holds the seven headings in the order `stage require brief` checks them.

## What it reads and writes

Reads the brief session file in the worktree's git directory and the files under `<docsRoot>/spec/`, to compare them with the start. Writes `<docsRoot>/brief/<slug>.md` and the session file, and one commit: the brief's.

## Exit codes

| Exit | Meaning |
|---|---|
| 0 | done; `ask` prints `question <n>`, `done` ends with the intake command |
| 1 | refused: a protected branch, a topic out of order, a question with no answer, `--unknown` on an answered topic, a topic never asked, a missing heading, a changed spec file |
| 2 | bad usage or bad input: an unknown topic, a bad slug, both or neither of `--answer` and `--unknown` |

## Example

```console
$ slicekit brief start payments-retry
docs/brief/payments-retry.md
$ slicekit brief ask --topic=problem --question="What goes wrong, and for whom?"
question 1
$ slicekit brief answer --answer="Card payments that time out are lost; the support team handles them."
docs/brief/payments-retry.md
$ # one brief ask and one brief answer for each of the six other topics, in order
$ slicekit brief done
docs/brief/payments-retry.md
/slicekit intake docs/brief/payments-retry.md
```

[Back to the guide](../README.md#pages)
