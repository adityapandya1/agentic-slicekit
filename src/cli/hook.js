import { failureOutput, runHook } from '../hooks/io.js';

// `slicekit hook <name>`: read all of stdin, print the hook's JSON decision, exit with its code.
// Any throw here answers like a failed hook: the refusal for a fail-closed name, {} for a fail-open one.
export const hookCommand = {
  usage: 'hook <name>   run a hook handler (called by the agent tool)',
  async run(args, io) {
    const [name] = args;
    if (!name) {
      await io.stderr('usage: slicekit hook <name>\n');
      return 2;
    }
    let r;
    try {
      const stdin = await io.stdin();
      const load = io.loadHook ? { load: io.loadHook } : {};
      const dispatch = io.runHook ?? runHook; // io.runHook: a seam for tests only
      r = await dispatch(name, { stdin, env: io.env ?? process.env, ...load });
    } catch (err) {
      r = { stdout: failureOutput(name, err?.message ?? String(err)), code: 0, stderr: '' };
    }
    if (r.stderr) await io.stderr(r.stderr);
    // Never print nothing for a known name: zero bytes at exit 0 reads as an allow.
    const answer = r.stdout || (r.code === 2 ? '' : failureOutput(name, 'hook produced no answer'));
    if (answer) await io.stdout(`${answer}\n`);
    return r.code;
  },
};
