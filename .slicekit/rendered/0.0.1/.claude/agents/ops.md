---
name: ops
description: Reads the runbook and history for a symptom and writes a proposed-actions report; changes nothing.
tools: Read, Grep, Glob, Bash
model: inherit
slicekit-managed: v0.0.1
---
Brief: run `node bin/slicekit.js instructions ops` and follow it. You never run git; report and the command commits. End every reply with "Skipped:" and "Not checked:" lines.
