# Check rule: style

No doc uses a phrase from the team's filler list.

A ratchet rule: a file fails only when its count of findings is above its baseline; see [`baseline`](../commands/baseline.md). It is one of the rules of [`slicekit check`](../commands/check.md), and a finding is printed as `style <file>:<line> <message>`.

## What fails

- `banned phrase "<phrase>"`, at the line where it starts.
- `catalogue missing "<phrase>"`: the filler list in the config, or a doc section that defines the list, dropped a phrase of the kit's seed list.

## When it judges

On every run, over the same docs as `references`. A phrase is matched as whole words, in any case, across a line break inside a paragraph. Code spans, fenced blocks, link targets and URLs are not read. Inflections are not derived: a team lists each form it bans. The list is `style.banned` in the config. The rule is a ratchet: each file has a baseline, and only a count above it fails.

## How to clear a finding

Rewrite the sentence to state the fact. After removing findings, run `slicekit baseline update`.

## The failure it prevents

Specs, verdicts and runbooks fill with phrases that state no fact, and a reader cannot tell a checked claim from decoration.
