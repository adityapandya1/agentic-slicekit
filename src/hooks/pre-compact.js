// pre-compact (REQ-3.6): before Claude Code compacts the conversation, writes a handoff into the active
// slice's state file so session-start can re-inject it on `compact` (REQ-3.1). Fails open through io.js:
// it never blocks compaction, and a failure (state unreadable, lock busy) is a stderr note.
//
// The handoff is plain keys with one-line values, so session-start prints it as `handoff: key: value`:
//   at            when it was written (ISO 8601)
//   state         the slice's stage
//   openFindings  the B-<n> ids of the latest verdict when that verdict is BLOCK, comma-joined; `none`
//   lastCommand   the last `ran: <command> → exit <n>` line in the tail of the main session's transcript,
//                 assistant text before tool output, secrets masked, cut to 200 characters; `none`
//   nextStep      by stage (nextStep below)
// Only the handoff changes: setHandoff re-reads the state under the slice lock and leaves state and
// history alone, and skips a slice with no state file yet. The lock is waited on for at most
// LOCK_BUDGET_MS.
import fs from 'node:fs';
import path from 'node:path';
import { redact } from '../redact.js';
import { setHandoff } from '../state/index.js';
import { parseVerdict } from '../verdict.js';
import { allow } from './io.js';
import { activeSlice, fromGitBash, transcriptTail } from './paths.js';
import { RAN } from './shapes.js';

export const TRANSCRIPT_TAIL = 256 * 1024;
export const LOCK_BUDGET_MS = 2_000;
const COMMAND_MAX = 200;

// The texts of one transcript entry: {assistant, tool}. Text the user typed is in neither.
function texts(content, role) {
  const out = { assistant: [], tool: [] };
  if (typeof content === 'string') {
    if (role === 'assistant') out.assistant.push(content);
    return out;
  }
  if (!Array.isArray(content)) return out;
  for (const part of content) {
    if (role === 'assistant' && part?.type === 'text' && typeof part.text === 'string') out.assistant.push(part.text);
    if (part?.type === 'tool_result') {
      if (typeof part.content === 'string') out.tool.push(part.content);
      else if (Array.isArray(part.content)) {
        for (const p of part.content) if (p?.type === 'text' && typeof p.text === 'string') out.tool.push(p.text);
      }
    }
  }
  return out;
}

const lastRan = (list) => list.flatMap((t) => t.split(/\r?\n/)).filter((l) => RAN.test(l)).at(-1);

// The last `ran: <command> → exit <n>` line (shapes.js RAN) in the transcript's last TRANSCRIPT_TAIL
// bytes: from assistant text when any has one (the agent's own report), else from tool output (which
// may only echo an old line). Secrets are masked (redact) before the line is trimmed and cut to
// COMMAND_MAX characters. null when there is none or the file cannot be read.
export function lastRanLine(file) {
  const lines = transcriptTail(file, TRANSCRIPT_TAIL);
  if (lines === null) return null;
  let fromTool;
  for (let i = lines.length - 1; i >= 0; i--) {
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    const role = entry?.message?.role;
    if (role !== 'assistant' && role !== 'user') continue;
    const t = texts(entry.message.content, role);
    const said = lastRan(t.assistant);
    if (said !== undefined) return clip(said);
    fromTool ??= lastRan(t.tool);
  }
  return fromTool === undefined ? null : clip(fromTool);
}

const clip = (line) => redact(line).trim().slice(0, COMMAND_MAX);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The highest-round verdict file of the slice: {shown, ids} where ids are its blockers when its verdict
// is BLOCK; null when the slice has no readable verdict file.
function latestVerdict(root, id) {
  const dir = path.join(root, '.slicekit', 'reviews');
  const name = new RegExp(`^${escapeRe(id.replace('/', '-'))}-r(\\d+)\\.md$`);
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null;
  }
  const rounds = names.map((n) => [n, name.exec(n)]).filter(([, m]) => m).map(([n, m]) => [n, Number(m[1])])
    .sort((a, b) => b[1] - a[1]);
  for (const [n] of rounds) {
    const file = path.join(dir, n);
    let text;
    try {
      if (!fs.lstatSync(file).isFile()) continue;
      text = fs.readFileSync(file);
    } catch {
      continue;
    }
    const shown = `.slicekit/reviews/${n}`;
    const v = parseVerdict(text, shown);
    const ids = v.verdict === 'BLOCK'
      ? [...new Set(v.findings.filter((f) => f.kind === 'blocker').map((f) => f.id))] : [];
    return { shown, ids };
  }
  return null;
}

export function nextStep(state, verdict) {
  if (state === 'tests-red') return 'build until the frozen tests pass';
  if (state === 'building') return 'run the test command; when green run slicekit check and push';
  if (state === 'changes-requested' && verdict?.ids.length) return `fix blockers ${verdict.ids.join(', ')}`;
  if (['draft-pr', 'in-review', 'changes-requested'].includes(state) && verdict) return `address verdict ${verdict.shown}`;
  return 'run slicekit status';
}

function transcriptOf(input) {
  const p = input?.transcript_path;
  if (typeof p !== 'string' || p === '') return null;
  return lastRanLine(path.resolve(fromGitBash(p.replace(/\\/g, '/'))));
}

export async function handle(input, { root, cfg }) {
  const active = activeSlice(root, cfg);
  if (!active) return allow();
  if (active.error) throw new Error(`state of ${active.id} unreadable: ${active.error}`);
  const state = String(active.state.state);
  const verdict = latestVerdict(root, active.id);
  const handoff = {
    at: new Date().toISOString(),
    state,
    openFindings: verdict?.ids.length ? verdict.ids.join(', ') : 'none',
    lastCommand: transcriptOf(input) ?? 'none',
    nextStep: nextStep(state, verdict),
  };
  setHandoff(root, cfg, active.id, handoff, { budgetMs: LOCK_BUDGET_MS });
  return allow();
}
