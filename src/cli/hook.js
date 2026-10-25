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
      r = await runHook(name, { stdin, env: io.env ?? process.env, ...load });
    } catch (err) {
      r = { stdout: failureOutput(name, err?.message ?? String(err)), code: 0, stderr: '' };
    }
    if (r.stderr) await io.stderr(r.stderr);
    if (r.stdout) await io.stdout(`${r.stdout}\n`);
    return r.code;
  },
};
