// Every failure a git host raises is a GitHostError, so a caller can tell "the host said no"
// from a bug in the kit. GitHostNotFound is the one a sync may skip past: the host answered,
// and the thing asked for is not there.
export class GitHostError extends Error {
  constructor(message, { stderr } = {}) {
    super(message);
    this.name = 'GitHostError';
    if (stderr !== undefined) this.stderr = stderr;
  }
}

export class GitHostNotFound extends GitHostError {
  constructor(message, opts) {
    super(message, opts);
    this.name = 'GitHostNotFound';
  }
}
