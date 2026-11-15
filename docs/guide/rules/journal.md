# Check rule: journal

The session journal is an unbroken, append-only record, and under `--ci` its commits are signed.

A blocking rule: any finding fails `check`. It is one of the rules of [`slicekit check`](../commands/check.md), and a finding is printed as `journal <file>:<line> <message>`.

## What fails

- A journal file whose hash chain is broken, at its first broken line.
- An entry in the journal directory that is not a `*.log` file or its `*.lock`.
- A journal file committed at the merge base that was shortened or removed.
- Under `--ci`: `commit <sha7> changes a journal file and its signature is not verified by the host`.
- Under `--ci`: a change to `.slicekit/journal-heads.log` on a branch that is not a sync branch, a file that is not the old file plus new lines, or a new line that differs from the line CI computes for its merge commit.
- Under `--ci`, on a sync branch: a missing heads line for a journal file the merge changed.

## When it judges

On every run when a journal exists. The git part is silent outside a repository. Signatures and CI runs are read only under `--ci`. The rule never repairs a journal.

## How to clear a finding

Restore the journal file from git; never edit one by hand. Sign the commits that change a journal file. The heads file is written only by `journal heads` in the sync job.

## The failure it prevents

Someone edits or deletes the record of what a session did, such as a declined finding or an amended test, and nothing shows the record was changed after the fact.
