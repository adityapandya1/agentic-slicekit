import fs from 'node:fs';
import { initCommand } from './init.js';

// Later tasks add entries: { [name]: { run(args, io) -> Promise<number>, usage: string } }
export const COMMANDS = { init: initCommand };

function readVersion() {
  const url = new URL('../../package.json', import.meta.url);
  return JSON.parse(fs.readFileSync(url, 'utf8')).version;
}

function usageText() {
  const lines = ['usage: slicekit <command> [options]', ''];
  const names = Object.keys(COMMANDS).sort();
  if (names.length > 0) {
    lines.push('commands:');
    for (const name of names) lines.push(`  ${COMMANDS[name].usage}`);
    lines.push('');
  }
  lines.push('options:', '  --help       show this text', '  --version    print the version', '');
  return lines.join('\n');
}

export async function main(argv, io) {
  const [first, ...rest] = argv;
  if (first === '--version') {
    io.stdout(`${readVersion()}\n`);
    return 0;
  }
  if (first === '--help') {
    io.stderr(usageText());
    return 0;
  }
  const command = Object.hasOwn(COMMANDS, first ?? '') ? COMMANDS[first] : undefined;
  if (!command) {
    io.stderr(usageText());
    if (first !== undefined) io.stderr(`slicekit: unknown command '${first}'\n`);
    return 2;
  }
  return command.run(rest, io);
}
