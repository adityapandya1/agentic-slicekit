import { runHook } from '../hooks/io.js';

// `slicekit hook <name>`: read all of stdin, print the hook's JSON decision, exit with its code.
export const hookCommand = {
  usage: 'hook <name>   run a hook handler (called by the agent tool)',
  async run(args, io) {
    const [name] = args;
    if (!name) {
      io.stderr('usage: slicekit hook <name>\n');
      return 2;
    }
    const stdin = await io.stdin();
    const r = await runHook(name, { stdin, env: io.env ?? process.env });
    if (r.stderr) io.stderr(r.stderr);
    if (r.code !== 2) io.stdout(`${JSON.stringify(r.stdout)}\n`);
    return r.code;
  },
};
