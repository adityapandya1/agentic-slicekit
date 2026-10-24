// Stub until S-06: every hook name answers `{}` so a registered hook never blocks a team.
export const hookCommand = {
  usage: 'hook <name>   run a hook handler (called by the agent tool)',
  async run(args, io) {
    const [name] = args;
    if (!name) {
      io.stderr('usage: slicekit hook <name>\n');
      return 2;
    }
    await io.stdin();
    io.stdout('{}\n');
    return 0;
  },
};
