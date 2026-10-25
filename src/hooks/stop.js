// stop (REQ-3.7): when the main session tries to stop, run the gate (`slicekit check`) and block the
// stop with the first ten failing finding lines when it is red. Fails closed through io.js.
//
// Claude Code's Stop carries session_id, transcript_path, cwd and stop_hook_active. A block makes
// Claude continue with the reason as its next instruction. stop_hook_active is true when Claude is
// already continuing because of a stop hook: the hook then allows, so the main session gets one push
// to fix the gate and, if it stops again still red, the human sees it. It never loops.
//
// The finding lines are check()'s own (`<rule> <file>:<line> <message>`, what `slicekit check`
// prints), less the summary line and the findings held at their baseline, which do not fail the gate.
// The reason keeps "\n" between lines: io.js passes a handler's reason through untouched and collapses
// newlines only in its own failure messages.
import { allow, block } from './io.js';
import { check } from '../check/index.js';

export const MAX_LINES = 10;

export async function handle(input, { root, env = process.env, runCheck = check }) {
  if (input?.stop_hook_active === true) return allow();
  let result;
  try {
    result = runCheck(root, { ci: false, env });
  } catch (e) {
    return block(`slicekit check could not run: ${e?.message ?? e}`);
  }
  if (result.exitCode === 0) return allow();
  // check() pushes one line per finding, in order, then its summary line.
  const lines = result.findings.map((f, i) => (f.baseline ? null : result.lines[i])).filter((l) => l !== null);
  const shown = lines.slice(0, MAX_LINES);
  const more = lines.length - shown.length;
  return block([
    'slicekit check failed:',
    ...shown,
    ...(more > 0 ? [`…and ${more} more`] : []),
    'Fix them; do not raise a baseline.',
  ].join('\n'));
}
