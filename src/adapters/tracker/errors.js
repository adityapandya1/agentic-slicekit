// Every failure a tracker raises is a TrackerError, so a caller can tell "the tracker said no" from
// a bug in the kit.
import { parseSliceAddr } from '../../ids.js';

export class TrackerError extends Error {
  constructor(message, { stderr } = {}) {
    super(message);
    this.name = 'TrackerError';
    if (stderr !== undefined) this.stderr = stderr;
  }
}

// The checks both trackers make before they spend a call.
export function assertSlice(id) {
  if (typeof id !== 'string' || !parseSliceAddr(id)) throw new Error(`slice must be P<n>/S-<nn>, got ${JSON.stringify(id)}`);
  return id;
}

export function assertFinding(id) {
  if (typeof id !== 'string' || !/^[BH]-[1-9]\d*$/.test(id)) throw new Error(`finding must be B-<n> or H-<n>, got ${JSON.stringify(id)}`);
  return id;
}

export function assertIssueTitle(title) {
  if (typeof title !== 'string' || title.trim() === '' || /[\r\n]/.test(title)) {
    throw new Error(`issue title must be a non-empty single line, got ${JSON.stringify(title)}`);
  }
  return title;
}

export function assertIssueId(id) {
  if (!Number.isInteger(id) || id < 1) throw new Error(`issue id must be a positive integer, got ${id}`);
  return id;
}

export function assertLabels(labels) {
  if (!Array.isArray(labels) || !labels.every((l) => typeof l === 'string' && l.trim() !== '' && !/[\r\n]/.test(l))) {
    throw new Error(`labels must be a list of non-empty single-line strings, got ${JSON.stringify(labels)}`);
  }
  return labels;
}

// The title every kit-opened issue for a finding starts with; `find` matches on it.
export const findingTitlePrefix = (slice, finding) => `[${slice}] ${finding}:`;

// The first issue among `list` ({number, url, title, state}) whose title starts with the finding's
// prefix, as {id, url, state}; state is `open` or `closed`, and an issue with none reads as open.
export function pickFinding(list, slice, finding) {
  const prefix = findingTitlePrefix(slice, finding);
  const hit = (Array.isArray(list) ? list : []).find((i) => i && typeof i.title === 'string' && i.title.startsWith(prefix) && Number.isInteger(i.number));
  if (!hit) return null;
  return { id: hit.number, url: hit.url, state: String(hit.state ?? 'open').toLowerCase() === 'closed' ? 'closed' : 'open' };
}
