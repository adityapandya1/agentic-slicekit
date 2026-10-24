#!/usr/bin/env node
import { main } from '../src/cli/index.js';

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

const io = {
  cwd: process.cwd(),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  stdin: readStdin,
  env: process.env,
};

process.exitCode = await main(process.argv.slice(2), io);
process.exit(process.exitCode);
