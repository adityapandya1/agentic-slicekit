import { main } from './index.js';
import { failureOutput } from '../hooks/io.js';

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

const write = (stream, s) => new Promise((resolve) => stream.write(s, () => resolve()));

// The process entry behind bin/slicekit.js. `stdin` and `loadHook` are seams for tests only.
export async function runProcess(argv, { stdin = readStdin, loadHook } = {}) {
  if (argv[0] !== 'hook') {
    const io = {
      cwd: process.cwd(),
      stdout: (s) => process.stdout.write(s),
      stderr: (s) => process.stderr.write(s),
      stdin,
      env: process.env,
    };
    process.exitCode = await main(argv, io);
    return;
  }
  // For a hook, a write resolves once flushed, so process.exit below cannot cut the answer short.
  const io = {
    cwd: process.cwd(),
    stdout: (s) => write(process.stdout, s),
    stderr: (s) => write(process.stderr, s),
    stdin,
    env: process.env,
    loadHook,
  };

  // A hook answers exactly once and then ends the process itself, so nothing the handler left behind
  // (a late rejection, a stray throw, a promise that never settles) can change the exit code or the answer.
  const name = argv[1];
  let answered = false;
  const finish = async (code) => {
    answered = true;
    await write(process.stdout, '');
    process.exit(code);
  };
  const late = (err) => {
    process.stderr.write(`slicekit hook ${name}: ignored after the answer: ${err?.message ?? err}\n`);
  };
  process.on('unhandledRejection', late);
  process.on('uncaughtException', late);
  // The loop emptied with the handler still pending (nothing holds it open): answer as a failure.
  process.on('beforeExit', () => {
    if (answered) return;
    answered = true;
    process.stdout.write(`${failureOutput(name, 'handler never settled')}\n`, () => process.exit(0));
  });
  const code = await main(argv, io);
  if (!answered) await finish(code);
}
