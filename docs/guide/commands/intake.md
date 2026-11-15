# slicekit intake

The steps of `/slicekit intake` that the CLI takes: freeze the source document, then record each interview question and its answer.

## Usage

```text
slicekit intake snapshot <file|url> [--slug <s>] [--who <w>]
slicekit intake ask --pass <product|platform> --topic <t> --question <q>
slicekit intake answer (--answer <a> [--type <T>] | --open --why <w> --recommendation <r>) [--who <w>] [--interface <name> [--source <file>:<line>]]
slicekit intake done
```

| Subcommand | What it does |
|---|---|
| `intake snapshot <file\|url>` | Copies the source, a file or a URL of at most 50 MB, to `<docsRoot>/intake/YYYY-MM-DD-<slug>.<ext>` beside a sidecar that pins its SHA-256, and commits both. The snapshot is frozen from then on. `--slug` names the file; `--who` says who supplied it. |
| `intake ask` | Records the question the agent is about to ask and prints `question <n>`. `--pass` is `product` or `platform`; `--topic` and `--question` are required. It refuses a new question while the last has no answer row, and a product question once the platform pass has started. |
| `intake answer` | Writes one row to `<docsRoot>/decisions.md` for the question just asked and prints its ID. `--answer <a>` with an optional `--type` (`Decision`, `Information`, `Action`, `Counsel`), or `--open --why <w> --recommendation <r>` when the person could not answer. `--interface <name>` marks an interface. |
| `intake done` | Commits `decisions.md`, `platform.md` and `observability.md`, then prints one `open: <D-ID> <question>` line per open row, or `open: none`. It refuses while a question has no answer, while a pass asked nothing, or when a spec file appeared or changed during the interview. |

## What it reads and writes

Reads the source document and the interview session file. Writes the snapshot and its sidecar under `<docsRoot>/intake/`, rows in `<docsRoot>/decisions.md`, and two commits: the snapshot's and the answers'.

## Exit codes

| Exit | Meaning |
|---|---|
| 0 | done; `snapshot` prints the path, `answer` the D-ID |
| 1 | refused: a protected branch, a failed fetch, a question with no answer, a file problem |
| 2 | bad usage or bad input: no such file, a bad slug, a URL with a password, a source over the size cap |

## Example

```console
$ slicekit intake snapshot ./brief/orders.md
docs/intake/2026-10-31-orders.md
$ slicekit intake ask --pass product --topic=users --question="Who places an order?"
question 2
$ slicekit intake answer --answer="Shop staff, and customers on the web store"
D-02
$ slicekit intake done
open: D-09 Which payment provider do refunds go through?
```

[Back to the guide](../README.md#pages)
