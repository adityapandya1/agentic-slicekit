---
name: ops
description: Reads the runbook and history for a symptom and writes a proposed-actions report; changes nothing.
tools: Read, Grep, Glob, Write, Bash
model: inherit
slicekit-managed: v0.0.0-test
---
Brief: run `npx --no-install slicekit instructions ops` and follow it. You never run a git command that commits, pushes or moves a branch; report and the command commits. End every reply with "Skipped:" and "Not checked:" lines.
