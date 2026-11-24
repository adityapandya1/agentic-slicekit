#!/usr/bin/env node
// The user guide as one web page (P6/S-54, REQ-5.8, D-97): docs/guide/slicekit-guide.html, written
// from docs/guide/README.md and the pages that index links under commands/, slash/ and rules/.
//
// Usage: node scripts/guide-html.js [--check] [--guide <dir>]
//   no option     writes <guide>/slicekit-guide.html
//   --check       writes nothing; exit 1 with one line when the page on disk differs (CRLF read as LF)
//   --guide <dir> another guide folder than the repository's docs/guide
//
// What the page holds: the index's title and introduction, each `##` section of the index except
// Contents and Pages, then one section per group of `## Pages`, each holding one section per page
// in the order of the group's table. The section of `<folder>/<name>.md` has the id
// `<folder>-<name>`. A link to a page, or to a heading of a page, becomes a link inside the page.
// Left out of the index, and nothing else of it: the list of its Contents section (any other block
// there is refused); the paragraphs of its Pages section and the cells of a Pages row after the
// first (a list or a code block there is refused; the group headings and the link in the first cell
// of each row are kept, and the contents list of the web page replaces the rest); a paragraph that
// links the web page itself, `slicekit-guide.html` beside the index, in the introduction (before the
// first `##` heading), whose other links are judged as every link is. Elsewhere a link to the web
// page, with no `#`, is kept and leads to the top of the page. Any other link to a file that is no
// page of the guide, a folder included, is refused with the file and line, in a paragraph, a list
// item, a table cell or a heading.
//
// The bytes depend only on the files read and on this script: no version, date, user name or path of
// this machine, and every line ends in LF. `node:fs` and `node:path` only.
//
// One reader, one writer. `tokens` reads every text of a source file that reaches the page: the
// first heading of a page, the title of the index, every other heading, paragraph, list item and
// table cell, and the link text of a Pages row. `parse` keeps the tokens and drops the text, and
// `render` writes tokens only. Where words without marks are needed (an id, the names Contents,
// Pages, Usage and Exit) `plain` takes them from the tokens, and they are compared, not written.
// The text of a code block is literal and is written escaped.
//
// What the script converts, and nothing else (the set is closed; see `tokens`, `shape` and `parse`):
//   - a heading: one to six #, a space or tab, the text, starting in the first column;
//   - a paragraph: lines that start in the first column, joined by a space;
//   - a code block between two fence lines of ``` or ~~~ that start in the first column, the first
//     with nothing or one language name after the marks, the second of the same mark and at least
//     as many of them; its text is literal, a fence-mark line four or more spaces in included;
//   - a list of - * or + items, or of numbered items that start at 1 (a marker of one to nine
//     digits; a longer number with a dot or bracket is text), each item's text on one or
//     more lines, the later ones indented or not, with or without blank lines between items, however
//     many (the list is written without them), and a list inside an item at any depth, its items
//     starting where the text of that item starts or up to three spaces further in;
//   - a table: a header row and rows that start with a bar, a delimiter line of dashes without
//     colons, the same number of cells in each, and \| for a bar inside a cell;
//   - inside a text: a code span that opens and closes on one line, whose text is literal, less one
//     space at each end when both ends have one; a link [text](target) whose target is taken as
//     written and holds no space, title, bracket of any kind, backtick, backslash or HTML entity;
//     **strong** and *emphasis*, one inside the other; a backslash before a punctuation character,
//     for that character;
//   - an HTML comment that begins and ends on one line, which is left out, in two places only: as
//     the whole of a line in the first column (it ends the paragraph, list or table before it), and
//     after other text of a heading, a paragraph line or a list item, where it holds no two dashes
//     together, begins with no > or -> and ends with no dash, and stands in no link target (there
//     it is kept and the link is refused);
//   - as the character itself: an underscore inside a word or between two spaces, a star between two
//     spaces, a < that no letter, /, ! or ? follows, an & that begins no entity, an @ that does not
//     stand between two words.
//
// Exit 1, naming the file and line, and nothing written, with or without --check, for everything
// else. One function, `shape`, judges what a text starts, and it is asked for a line in the first
// column, for a later line of a list item and for the text straight after a list marker at every
// depth. It refuses: a block quote, a rule line of - * or _, a line of = or - alone (a heading
// underlined with it, or a rule), a line that starts with # and is no heading (no space after the
// #, more than six, no text), a heading closed by # marks, a link definition, a footnote, a task
// item, an empty list item, a fence line with more than a language name, a table delimiter line
// under no header row that starts with a bar (a table whose header row has no leading bar), a line
// that begins with an HTML comment and holds text after it, or whose comment does not end on it.
// Text straight after a list marker is the start of a paragraph or it is refused: a heading, a code
// block, a table, a second list marker, an HTML comment and each shape above are refused there, as
// are a tab or more than four spaces after the marker.
//
// Refused by where a line stands: an indented line outside a list (an indented code block, an
// indented comment line, or a second paragraph or other block inside a list item), a tab in the
// indentation, an indented fence line, a closing fence line one to three spaces in, a code block
// that is not closed, a list item indented to no level, a second list inside one item, a list whose
// marker changes, a numbered list that does not start at 1. Straight after a line of a list item,
// with no blank line between, only the next item, an item of a list inside the item and more text
// of the item are read; a table, a heading, a code block and a comment line are refused there,
// indented or not (Markdown reads such a table as text of the item). The delimiter line of a table
// is judged by where it stands as its header row is: indented, it is refused. Also refused: a table straight
// after a line of a paragraph, a table row with no leading bar or text straight after a table, a
// table row or delimiter line with the wrong number of cells, a column alignment, an HTML comment
// in a line that starts with a bar, a line break made by two trailing spaces or a trailing
// backslash, and white space that is no space, tab or line feed (a no-break space, any other
// Unicode space, a form feed) anywhere outside a code span or a code block.
//
// Refused inside a text: an image, emphasis or strong written with underscores, three or more
// stars, a star that pairs with none, strikethrough or any other tilde, a reference-style link or
// any square bracket that is not part of a link, a link with a title or with a space, a round,
// square or angle bracket, a backtick, a backslash or an HTML entity in its target, an HTML tag of
// any name, an HTML comment that is not left out by the rule above, a link in angle brackets, an
// HTML entity, a web address written bare (http, https, ftp, www., mailto: or xmpp:), an e-mail
// address written bare, judged broadly: an @ with a letter, a digit, a dot, a plus or a dash before
// it and a letter, a digit, a dash or an underscore after it; an emoji short code (a colon, one or
// more letters, digits, _ + or -, a colon), judged by that shape alone once the backslash escapes
// are read, as the git host reads it, so a time such as 10:30:00 and `\:tada:` are refused too
// (write it as a code span); a code span that is not closed on the line it opens on (one that runs
// over two lines included), a link that leads nowhere in the guide.
//
// Refused in the files as a whole: a page file the index does not list, or a listed page that is
// missing; a page file whose name holds a character that is no letter, digit, dot, dash or
// underscore; a file that does not begin with a # heading or holds a second one; a heading more
// than one level below the heading before it (in the index, a ### before the first ##); a heading
// under `## Contents`, or one of four or more # under `## Pages`; a first cell of a Pages row that
// is not one link to a page file and nothing else; a heading with no letter or digit, which gives
// no id; an id that would stand twice in the page. Every id is claimed once: top, toc and theme of
// the page's frame, the section of each page file, `<section id>--<anchor>` for a heading of a
// page, the anchor for a heading of the index and for a group of pages; a second heading of the
// same words in one file gets -1, as on the git host, and any id still claimed twice is refused
// with the file and line of the second claim. Last, `sound` refuses to return a page that holds
// `undefined` as an element, an id or a link target, an id of another shape, or one id twice.
// Exit 2: bad usage.
import fs from 'node:fs';
import path from 'node:path';

const PAGE = 'slicekit-guide.html';
const FOLDERS = ['commands', 'slash', 'rules'];
const REGENERATE = 'node scripts/guide-html.js';

const readText = (file) => fs.readFileSync(file, 'utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fail = (message) => { throw new Error(message); };

// ---------------------------------------------------------------- Markdown: inline
// The text of a heading, a paragraph, a list item or a table cell, as tokens: {t:'text',s}
// {t:'code',s} {t:'link',raw,body,url,at} {t:'b',body} {t:'em',body}. The set is closed: a character
// that Markdown gives a meaning and that is none of these throws a Refusal, with its place in the text.
class Refusal extends Error {
  constructor(what, at) { super(what); this.at = at; }
}
const refuse = (what, at) => { throw new Refusal(what, at); };

const ASCII_PUNCT = /[!-/:-@[-`{-~]/;
const ENTITY = /&(?:#\d+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/;
const isSpace = (c) => c === undefined || /\s/.test(c);
// White space that is no space, tab or line feed: a no-break space, every other Unicode space, a
// form feed. Markdown reads none of them as the space after a # or a list marker.
const ODD_SPACE = /[^\S \t\n]/;
// What Markdown and the git host turn into a link with no brackets round it.
const BARE_ADDRESS = /^(?:https?:\/\/|ftp:\/\/|www\.|mailto:|xmpp:)\S/i;
// The shape of an emoji short code on the git host: a colon, letters, digits, _ + or -, a colon.
const EMOJI = /^:[A-Za-z0-9_+-]+:/;
// Whether the text from text[i] on is an emoji short code once its backslash escapes are gone: the
// git host turns a short code into an emoji in the text it renders, after the escapes are read, so
// `\:tada:`, `:tada\:` and `:smile\_cat:` are emoji as `:tada:` is (issue #188). The text is read
// up to the first space or backtick, so a code span after it is no part of it.
function emojiAt(text, i) {
  let s = '';
  for (let k = i; k < text.length && !isSpace(text[k]) && text[k] !== '`';) {
    if (text[k] === '\\' && ASCII_PUNCT.test(text[k + 1] ?? '')) { s += text[k + 1]; k += 2; } else { s += text[k]; k++; }
  }
  return EMOJI.test(s);
}
const EMOJI_REFUSAL = 'an emoji short code, a word between two colons, with or without a backslash before a colon or an underscore in it (write it as a code span)';
const isPunct = (c) => c !== undefined && /[\p{P}\p{S}]/u.test(c);
const isWord = (c) => c !== undefined && /[\p{L}\p{N}]/u.test(c);

// The code span that opens at text[i]: a run of backticks, closed by the next run of the same
// length. null when no run closes it.
function codeSpan(text, i) {
  let n = 0;
  while (text[i + n] === '`') n++;
  let k = i + n;
  while (k < text.length) {
    if (text[k] !== '`') { k++; continue; }
    let m = 0;
    while (text[k + m] === '`') m++;
    if (m === n) return { end: k + m, body: text.slice(i + n, k) };
    k += m;
  }
  return null;
}

// A run of stars opens emphasis when text follows it, and closes emphasis when text precedes it;
// beside punctuation the other side has to be a space or punctuation, as Markdown judges it.
const starRun = (text, i) => { let n = 0; while (text[i + n] === '*') n++; return n; };
const opens = (text, i, n) => !isSpace(text[i + n]) && (!isPunct(text[i + n]) || isSpace(text[i - 1]) || isPunct(text[i - 1]));
const closes = (text, i, n) => !isSpace(text[i - 1]) && (!isPunct(text[i - 1]) || isSpace(text[i + n]) || isPunct(text[i + n]));

// Where the run of n stars at text[i] is closed. Between the two, a run of the other length may open
// and close; any other star that touches text is refused.
function starClose(text, i, n, base) {
  let k = i + n;
  while (k < text.length) {
    const c = text[k];
    if (c === '\\') { k += 2; continue; }
    if (c === '`') {
      const span = codeSpan(text, k);
      if (!span) refuse('a code span that is not closed', base + k);
      k = span.end;
      continue;
    }
    if (c !== '*') { k++; continue; }
    const m = starRun(text, k);
    if (isSpace(text[k - 1]) && isSpace(text[k + m])) { k += m; continue; }
    if (m === n && closes(text, k, m)) return k;
    if (m !== n && m <= 2 && opens(text, k, m)) { k = starClose(text, k, m, base) + m; continue; }
    refuse('stars that do not pair as emphasis or strong', base + k);
  }
  return refuse('emphasis or strong that is not closed', base + i);
}

function tokens(text, base = 0, inLink = false) {
  const out = [];
  let buf = '';
  const flush = () => { if (buf) out.push({ t: 'text', s: buf }); buf = ''; };
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const at = base + i;
    if (c === '\\') {
      const next = text[i + 1];
      if (next === undefined) refuse('a backslash at the end of the text (a line break)', at);
      if (next === ':' && emojiAt(text, i)) refuse(EMOJI_REFUSAL, at);
      if (ASCII_PUNCT.test(next)) { buf += next; i += 2; } else { buf += c; i++; }
    } else if (c === '`') {
      const span = codeSpan(text, i);
      if (!span) refuse('a code span that is not closed', at);
      flush();
      out.push({ t: 'code', s: span.body });
      i = span.end;
    } else if (c === '!' && text[i + 1] === '[') {
      refuse('an image', at);
    } else if (c === '[') {
      if (inLink) refuse('a square bracket inside the text of a link', at);
      if (text[i + 1] === '^') refuse('a footnote', at);
      let k = i + 1;
      while (k < text.length && text[k] !== ']') {
        if (text[k] === '\\') { k += 2; continue; }
        if (text[k] === '[') refuse('a square bracket inside square brackets', base + k);
        if (text[k] === '`') {
          const span = codeSpan(text, k);
          if (!span) refuse('a code span that is not closed', base + k);
          k = span.end;
          continue;
        }
        k++;
      }
      if (k >= text.length) refuse('a square bracket that opens no link (write \\[ for the character)', at);
      if (text[k + 1] !== '(') refuse('square brackets with no (target) after them: a reference-style link, or text to write with \\[ and \\]', at);
      // The target is taken as written, so it holds nothing Markdown would decode or read as more
      // than an address: no escape, no entity, no bracket, no backtick.
      const target = /^\(([^()\s]+)\)/.exec(text.slice(k + 1));
      if (!target) refuse('a link whose target holds a title, a space, a round bracket or nothing', at);
      if (/[[\]<>`\\]/.test(target[1])) refuse('a link whose target holds a square or angle bracket, a backtick or a backslash', at);
      if (ENTITY.test(target[1])) refuse('a link whose target holds an HTML entity', at);
      flush();
      const raw = text.slice(i + 1, k);
      out.push({ t: 'link', raw, body: tokens(raw, at + 1, true), url: target[1], at });
      i = k + 1 + target[0].length;
    } else if (c === ']') {
      refuse('a square bracket that closes no link (write \\] for the character)', at);
    } else if (c === '*') {
      const n = starRun(text, i);
      if (isSpace(text[i - 1]) && isSpace(text[i + n])) { buf += text.slice(i, i + n); i += n; continue; }
      if (n > 2) refuse('emphasis written with three or more stars', at);
      if (!opens(text, i, n)) refuse('a star that opens no emphasis (write \\* for the character)', at);
      const end = starClose(text, i, n, base);
      flush();
      out.push({ t: n === 2 ? 'b' : 'em', body: tokens(text.slice(i + n, end), at + n, inLink) });
      i = end + n;
    } else if (c === '_') {
      let n = 0;
      while (text[i + n] === '_') n++;
      const inWord = isWord(text[i - 1]) && isWord(text[i + n]);
      const alone = isSpace(text[i - 1]) && isSpace(text[i + n]);
      if (!inWord && !alone) refuse('emphasis or strong written with underscores (write * or **, or \\_ for the character)', at);
      buf += text.slice(i, i + n);
      i += n;
    } else if (c === '~') {
      refuse('strikethrough (write \\~ for the character)', at);
    } else if (c === '<' && /[A-Za-z/!?]/.test(text[i + 1] ?? '')) {
      refuse('an HTML tag, a link in angle brackets, or an HTML comment that does not end on its line, that holds two dashes together or that stands straight after a list marker (write \\< for the character)', at);
    } else if (c === '&' && text.slice(i, i + 40).search(ENTITY) === 0) {
      refuse('an HTML entity (write \\& for the character)', at);
    } else if (!inLink && /[hfwmx]/i.test(c) && !isWord(text[i - 1]) && BARE_ADDRESS.test(text.slice(i, i + 12))) {
      refuse('a web address written bare (write it as a link or as a code span)', at);
    } else if (!inLink && c === '@' && /[\p{L}\p{N}._+-]/u.test(text[i - 1] ?? '') && /[\p{L}\p{N}_-]/u.test(text[i + 1] ?? '')) {
      // Judged broadly: an @ with a letter, a digit, a dot, a plus or a dash before it and a letter,
      // a digit, a dash or an underscore after it, whatever follows.
      refuse('an e-mail address written bare, or an @ between two words (write it as a code span)', at);
    } else if (c === ':' && emojiAt(text, i)) {
      refuse(EMOJI_REFUSAL, at);
    } else if (ODD_SPACE.test(c)) {
      refuse('white space that is no space or tab, such as a no-break space,', at);
    } else {
      buf += c;
      i++;
    }
  }
  flush();
  return out;
}

// The line a place in a text is on. `where` is one line number, or the marks of a text joined from
// several lines: [[offset of the line's first character, line number], ...].
function lineAt(where, at) {
  if (typeof where === 'number') return where;
  let line = where[0][1];
  for (const [offset, n] of where) if (offset <= at) line = n;
  return line;
}

// The text of a code span as Markdown reads it: one space off each end when both ends have one and
// the span holds more than spaces.
const codeText = (s) => (s.length > 1 && s.startsWith(' ') && s.endsWith(' ') && /[^ ]/.test(s) ? s.slice(1, -1) : s);

// The one writer of a text: every heading, paragraph, list item, table cell, title and contents
// entry of the page is written here from tokens, and from nothing else. `link` turns a link target
// into an href, or null for none; with no `link` at all a link is written as its text (a contents
// entry, which stands inside a link of its own). `inCode` is for a text the caller writes inside a
// code element: a code span is written as its text, with no second code element.
function render(toks, link, where, inCode = false) {
  return toks.map((k) => {
    if (k.t === 'text') return esc(k.s);
    if (k.t === 'code') return inCode ? esc(codeText(k.s)) : `<code>${esc(codeText(k.s))}</code>`;
    if (k.t === 'link') {
      const href = link ? link(k.url, lineAt(where, k.at)) : null;
      const body = render(k.body, link, where, inCode);
      return href === null ? body : `<a href="${esc(href)}">${body}</a>`;
    }
    return `<${k.t}>${render(k.body, link, where, inCode)}</${k.t}>`;
  }).join('');
}

const linkTokens = (toks) => toks.flatMap((k) => (k.t === 'link' ? [k] : k.body ? linkTokens(k.body) : []));
// The words of a text with no marks, for a comparison or an id. Never written to the page.
const plain = (toks) => toks.map((k) => (k.t === 'text' ? k.s : k.t === 'code' ? codeText(k.s) : plain(k.body))).join('').trim();

// ---------------------------------------------------------------- Markdown: blocks
// Blocks, each with the line it starts on: {t:'h',level,toks} {t:'p',toks,marks} {t:'code',lang,text}
// {t:'list',ordered,items:[{toks,marks,lists}]} {t:'table',head:[toks],rows:[[toks]]}. A block holds
// the tokens of its text and not the text: the source text of a heading, a paragraph, an item or a
// cell does not leave `parse`, so nothing after it can write a text that `tokens` has not read. The
// text of a code block is literal and is kept.
// All four are matched against the text of a line without its indentation. The white space they
// name is a space or a tab; any other is refused by `look` before they are asked.
const FENCE = /^(`{3,}|~{3,})[ \t]*([\w-]*)$/;
const HEADING = /^(#{1,6})[ \t]+(.+)$/;
// A numbered marker has one to nine digits, as in Markdown; a longer number with a dot is text.
const ITEM = /^([-*+]|\d{1,9}[.)])([ \t]+)(.*)$/;
const DELIM = /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

// Where a line outside a code block holds white space that is no space or tab, outside a code span;
// -1 for none. `whole` is for a fence line, which opens no code span.
function oddSpace(line, whole) {
  if (!ODD_SPACE.test(line)) return -1;
  let i = 0;
  while (i < line.length) {
    if (!whole && line[i] === '\\' && line[i + 1] === '`') { i += 2; continue; }
    if (!whole && line[i] === '`') {
      const span = codeSpan(line, i);
      if (span) { i = span.end; continue; }
    }
    if (ODD_SPACE.test(line[i])) return i;
    i++;
  }
  return -1;
}

// The line without the HTML comments that stand after other text of it. A code span is text and
// stays whole. A comment is taken out only where Markdown reads a comment inside a text: it ends on
// the line, and what it holds has no two dashes together, begins with no > or -> and ends with no
// dash. A comment straight after a list marker starts an HTML block in Markdown and stays, so
// `look` refuses it, and `tokens` refuses every other comment that is not taken out. A line that
// begins with a comment never comes here: `shape` judges it. `cut` says that a comment was taken
// out; `open` says that the line opens a code span it does not close; the caller refuses such a
// line, so no comment is ever taken out of a code span that runs on.
function clean(line) {
  if (!line.includes('<!--') && !line.includes('`')) return { line, open: false, cut: false };
  let out = '';
  let cut = false;
  let i = 0;
  while (i < line.length) {
    if (line[i] === '\\') { out += line.slice(i, i + 2); i += 2; continue; }
    if (line[i] === '`') {
      const span = codeSpan(line, i);
      if (!span) return { line: out + line.slice(i), open: true, cut };
      out += line.slice(i, span.end);
      i = span.end;
      continue;
    }
    // Not straight after a list marker, and not inside a link target: Markdown reads no comment
    // there, so the comment stays and `tokens` refuses the link.
    if (line.startsWith('<!--', i) && !/^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+$/.test(out) && !/\]\([^)]*$/.test(out)) {
      const close = line.indexOf('-->', i + 4);
      if (close >= 0 && !/^>|^->|--|-$/.test(line.slice(i + 4, close))) { cut = true; i = close + 3; continue; }
    }
    out += line[i++];
  }
  return { line: out, open: false, cut };
}

// The one judgement of what a text starts. `text` begins where the content of a line begins: the
// whole of a line without its indentation, or what follows a list marker; `next` is the line after
// it. Gives {t} for what the script converts: 'blank', 'comment' (an HTML comment that is the whole
// of its line), 'fence', 'heading', 'item', 'table', or 'text' for the start or a later line of a
// paragraph. Gives {no} for a shape the script refuses. Every
// path of `parse` asks here, so a line in the first column, a later line of a list item and the
// text straight after a list marker cannot be judged differently. What stands inside the text is
// judged by `tokens`.
function shape(text, next) {
  if (!text) return { t: 'blank' };
  if (text.startsWith('<!--')) {
    // Markdown reads a line that begins with a comment as raw HTML to its end, marks and all.
    const end = text.indexOf('-->');
    if (end < 0) return { no: 'an HTML comment that does not end on its line' };
    if (text.slice(end + 3).trim()) return { no: 'an HTML comment at the start of a line with text after it on the same line' };
    return { t: 'comment' };
  }
  if (text.startsWith('>')) return { no: 'a block quote' };
  if (/^(?:`{3,}|~{3,})/.test(text)) {
    const m = FENCE.exec(text);
    return m ? { t: 'fence', m } : { no: 'a code fence line that holds more than a language name' };
  }
  if (/^(?:=+|-+)$/.test(text)) return { no: 'an underlined heading or a rule line' };
  if (/^([-*_])(?:[ \t]*\1){2,}$/.test(text)) return { no: 'a rule line' };
  if (text.startsWith('#')) {
    const m = HEADING.exec(text);
    if (!m) return { no: 'a line that starts with # and is no heading of one to six #, a space and a text' };
    if (/(?:^|[ \t])#+$/.test(m[2])) return { no: 'a heading closed by # marks' };
    return { t: 'heading', m };
  }
  if (/^(?:[-*+]|\d{1,9}[.)])$/.test(text)) return { no: 'an empty list item' };
  if (/^(?:[-*+]|\d{1,9}[.)])[ \t]+\[[ xX]\](?:[ \t]|$)/.test(text)) return { no: 'a task item' };
  const item = ITEM.exec(text);
  if (item) return { t: 'item', m: item };
  if (/^\[\^[^\]]*\]:/.test(text)) return { no: 'a footnote' };
  if (/^\[[^\]]*\]:/.test(text)) return { no: 'a link definition' };
  if (text.includes('|') && DELIM.test(text)) return { no: 'a table delimiter line under no header row that starts with a bar' };
  if (text.startsWith('|') && next !== undefined && next.includes('|') && DELIM.test(next)) return { t: 'table' };
  return { t: 'text' };
}
// What `shape` gives, named for a message.
const BLOCK = { blank: 'an empty text', comment: 'an HTML comment', fence: 'a code block', heading: 'a heading', item: 'a list', table: 'a table' };

function cells(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

function parse(md, file) {
  const lines = md.split('\n');
  const out = [];
  let i = 0;
  const no = (line, what) => fail(`${file}:${line}: ${what} is a Markdown construct this script does not convert`);
  // Line k outside a code block, as the blocks read it: {t, m, line, text, indent}, with its
  // comments taken out. Refused here, for every such line at every depth: white space that is no
  // space or tab outside a code span, a shape `shape` refuses, anything but a plain text straight
  // after a list marker, a comment in a line that starts with a bar (a table row), a code span the
  // line does not close, a line break.
  const look = (k) => {
    const raw = lines[k];
    if (/^ *\t/.test(raw)) no(k + 1, 'a tab in the indentation');
    // A fence line is judged as written: the marks of a fence open no code span.
    const fenced = /^ *(?:`{3,}|~{3,})/.test(raw);
    if (oddSpace(raw, fenced) >= 0) no(k + 1, 'white space that is no space or tab, such as a no-break space, outside a code span');
    // So is a line that begins with a comment: nothing is taken out of it.
    const whole = fenced || raw.trimStart().startsWith('<!--');
    const { line, open, cut } = whole ? { line: raw, open: false, cut: false } : clean(raw);
    const text = line.trim();
    const next = lines[k + 1];
    const sh = shape(text, next);
    if (sh.no) no(k + 1, sh.no);
    if (cut && text.startsWith('|')) no(k + 1, 'an HTML comment in a table row');
    if (sh.t === 'item') {
      if (sh.m[2].includes('\t')) no(k + 1, 'a tab after a list marker');
      if (sh.m[2].length > 4) no(k + 1, 'an indented code block inside a list item');
      const inner = shape(sh.m[3], next);
      if (inner.no) no(k + 1, `${inner.no} straight after a list marker`);
      if (inner.t !== 'text') no(k + 1, `${BLOCK[inner.t]} straight after a list marker`);
    }
    if (open) no(k + 1, 'a code span that is not closed on its line');
    if (sh.t !== 'fence' && next !== undefined && next.trim() && (/ {2,}$/.test(line) || /(?:^|[^\\])(?:\\\\)*\\$/.test(line))) no(k + 1, 'a line break made by two trailing spaces or a trailing backslash');
    return { t: sh.t, m: sh.m, line, text, indent: line.length - line.trimStart().length };
  };
  // A text is converted whole or refused, naming the line of the character that is refused. The
  // tokens it gives are all a block keeps of the text.
  const converts = (text, where) => {
    try {
      return tokens(text);
    } catch (err) {
      if (!(err instanceof Refusal)) throw err;
      return no(lineAt(where, err.at), err.message);
    }
  };
  const INDENTED = 'an indented line outside a list (an indented code block, or a paragraph or other block inside a list item)';

  // A list whose items start `indent` spaces in. An item inside another starts where the text of
  // that item starts, or up to three spaces further in.
  function list(indent) {
    const first = look(i);
    const ordered = /\d/.test(first.m[1]);
    const marker = first.m[1].at(-1);
    if (ordered && Number.parseInt(first.m[1], 10) !== 1) no(i + 1, 'a numbered list that does not start at 1');
    const node = { t: 'list', line: i + 1, ordered, items: [] };
    while (i < lines.length) {
      const L = look(i);
      if (L.t === 'blank') {
        // Blank lines, however many, end the list only when no item of it follows them.
        let j = i + 1;
        while (j < lines.length && look(j).t === 'blank') j++;
        const after = j < lines.length ? look(j) : null;
        if (after && after.t === 'item' && after.indent >= indent) { i = j; continue; }
        break;
      }
      // Straight after a line of a list, with no blank line between, stands the next item, an item
      // of a list inside the item, or more text of the item, indented or not, as Markdown reads it.
      // Every other block is refused there: Markdown reads a table as text of the item, and the
      // others end the list or stand inside the item by their indentation.
      const STRAIGHT = 'straight after a line of a list item, with no blank line between,';
      if (L.t === 'fence') no(i + 1, L.indent ? 'a code block inside a list item' : `a code block ${STRAIGHT}`);
      const last = node.items.at(-1);
      if (L.t === 'item') {
        if (L.indent < indent) break;
        if (L.indent > indent) {
          if (L.indent < last.offset || L.indent > last.offset + 3) no(i + 1, `a list item ${L.indent} spaces in (an item inside the one above starts ${last.offset} to ${last.offset + 3} spaces in)`);
          if (last.lists.length) no(i + 1, 'a second list inside one list item');
          last.lists.push(list(L.indent));
          continue;
        }
        if (L.m[1].at(-1) !== marker) no(i + 1, 'a list whose marker changes from one item to the next');
        const offset = L.indent + L.m[1].length + L.m[2].length;
        node.items.push({ text: L.line.slice(offset).trimEnd(), marks: [[0, i + 1]], offset, lists: [], line: i + 1 });
      } else if (L.t !== 'text') no(i + 1, L.indent ? `${BLOCK[L.t]} inside a list item` : `${BLOCK[L.t]} ${STRAIGHT}`);
      else {
        last.marks.push([last.text.length + 1, i + 1]);
        last.text += ` ${L.text}`;
      }
      i++;
    }
    return node;
  }
  const convertsList = (node) => {
    for (const it of node.items) {
      it.toks = converts(it.text, it.marks);
      delete it.text;
      it.lists.forEach(convertsList);
    }
  };

  while (i < lines.length) {
    const L = look(i);
    if (L.t === 'blank') { i++; continue; }
    if (L.indent) no(i + 1, L.t === 'fence' ? 'an indented code fence' : INDENTED);
    // A comment that is the whole of a line in the first column is left out. It ends the block
    // before it, as it does in Markdown, so it is not read as a blank line: a list goes on over a
    // blank line and not over a comment.
    if (L.t === 'comment') { i++; continue; }
    if (L.t === 'fence') {
      const start = i + 1;
      const body = [];
      // The block ends at a line in the first column of the same mark, at least as many of them, and
      // nothing else. Such a line four or more spaces in is text of the block; one to three spaces
      // in, Markdown ends the block there and this script does not, so the line is refused.
      const marks = `\\${L.m[1][0]}{${L.m[1].length},}[ \\t]*$`;
      const closing = new RegExp(`^${marks}`);
      const near = new RegExp(`^ {1,3}${marks}`);
      i++;
      while (i < lines.length && !closing.test(lines[i])) {
        if (near.test(lines[i])) no(i + 1, 'a closing code fence that is indented one to three spaces');
        body.push(lines[i++]);
      }
      if (i >= lines.length) fail(`${file}:${start}: a code block is not closed`);
      i++;
      out.push({ t: 'code', line: start, lang: L.m[2], text: body.join('\n') });
      continue;
    }
    if (L.t === 'heading') {
      out.push({ t: 'h', line: i + 1, level: L.m[1].length, toks: converts(L.m[2], i + 1) });
      i++;
      continue;
    }
    if (L.t === 'table') {
      const start = i + 1;
      const rows = [];
      // The delimiter line is judged where it stands, as every line outside a list is: indented, it
      // is refused (four or more spaces in, Markdown reads it as text of a paragraph).
      if (/^[ \t]/.test(lines[i + 1])) no(i + 2, INDENTED);
      const delim = cells(lines[i + 1]);
      const width = cells(L.line).length;
      if (delim.length !== width) fail(`${file}:${i + 2}: a table's delimiter line has ${delim.length} cells, its header has ${width}`);
      if (lines[i + 1].includes(':')) no(i + 2, 'a column alignment (a colon in the delimiter line of a table)');
      const head = cells(L.line).map((c) => converts(c, start));
      i += 2;
      while (i < lines.length && lines[i].startsWith('|')) {
        const at = i + 1;
        const row = cells(look(i).line);
        if (row.length !== width) fail(`${file}:${at}: a table row has ${row.length} cells, its header has ${width}`);
        rows.push(row.map((c) => converts(c, at)));
        i++;
      }
      if (i < lines.length && look(i).t === 'text') no(i + 1, 'a table row with no leading bar, or text with no blank line after a table,');
      out.push({ t: 'table', line: start, head, rows });
      continue;
    }
    if (L.t === 'item') {
      const node = list(0);
      convertsList(node);
      out.push(node);
      continue;
    }
    const start = i + 1;
    const marks = [[0, start]];
    let text = L.text;
    i++;
    while (i < lines.length) {
      const more = look(i);
      // A heading, a code block, a list or a comment line ends the paragraph, as in Markdown. A
      // table straight after a line of a paragraph is refused: the script does not read it.
      if (more.t === 'table') no(i + 1, 'a table straight after a line of a paragraph, with no blank line between,');
      if (more.t !== 'text') break;
      if (more.indent) no(i + 1, INDENTED);
      marks.push([text.length + 1, i + 1]);
      text += ` ${more.text}`;
      i++;
    }
    out.push({ t: 'p', line: start, marks, toks: converts(text, marks) });
  }
  return out;
}

// GitHub's anchor for a heading, from the words of its tokens: lower case, punctuation dropped,
// spaces to dashes. A second heading of the same words in one file gets -1, a third -2.
const slug = (toks) => plain(toks).toLowerCase().replace(/[^\p{L}\p{N} _-]/gu, '').replace(/ /g, '-');
function slugger() {
  const seen = new Map();
  return (toks) => {
    const s = slug(toks);
    const n = seen.get(s) ?? 0;
    seen.set(s, n + 1);
    return n ? `${s}-${n}` : s;
  };
}

// ---------------------------------------------------------------- HTML of blocks
// Alternatives of one long usage line, split at each " | " outside brackets, so each reads on its own line.
function alternatives(line) {
  if (line.length <= 100) return [line];
  const out = [];
  let cur = '';
  let depth = 0;
  for (let k = 0; k < line.length; k++) {
    const ch = line[k];
    if ('[(<'.includes(ch)) depth++;
    if (')]>'.includes(ch)) depth--;
    if (depth === 0 && line.startsWith(' | ', k)) { out.push(cur); cur = '  | '; k += 2; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function codeBlock(b, usage) {
  if (b.lang === 'console') {
    const lines = b.text.split('\n').map((l) => (l.startsWith('$ ')
      ? `<span class="p">$ </span>${esc(l.slice(2))}` : l ? `<span class="o">${esc(l)}</span>` : ''));
    return `<pre class="ex">${lines.join('\n')}</pre>`;
  }
  if (b.lang === 'text') {
    const lines = b.text.split('\n').flatMap((l) => (usage ? alternatives(l) : [l]));
    return `<pre class="syn">${lines.map((l) => `<span class="l">${esc(l) || ' '}</span>`).join('')}</pre>`;
  }
  return `<pre class="ex">${esc(b.text)}</pre>`;
}

function listHtml(b, link, ind) {
  const tag = b.ordered ? 'ol' : 'ul';
  const items = b.items.map((it) => `${ind}  <li>${render(it.toks, link, it.marks)}${it.lists.map((l) => `\n${listHtml(l, link, `${ind}    `)}\n${ind}  `).join('')}</li>`);
  return `${ind}<${tag}>\n${items.join('\n')}\n${ind}</${tag}>`;
}

function tableHtml(b, link, ind) {
  if (b.head.length === 2 && plain(b.head[0]) === 'Exit') {
    return `${ind}<ul class="exits">\n${b.rows.map((r, k) => `${ind}  <li><b>${render(r[0], link, b.line + 2 + k)}</b><span>${render(r[1], link, b.line + 2 + k)}</span></li>`).join('\n')}\n${ind}</ul>`;
  }
  const row = (r, c, line) => `<tr>${r.map((x) => `<${c}>${render(x, link, line)}</${c}>`).join('')}</tr>`;
  return [`${ind}<div class="tw"><table class="cols-${b.head.length}">`, `${ind}  <thead>${row(b.head, 'th', b.line)}</thead>`, `${ind}  <tbody>`,
    ...b.rows.map((r, k) => `${ind}    ${row(r, 'td', b.line + 2 + k)}`), `${ind}  </tbody>`, `${ind}</table></div>`].join('\n');
}

// headings: maps a Markdown heading level to the HTML element name. A level it does not hold, or a
// heading that was given no id, is refused, naming `file` and the line.
function blocksHtml(blocks, { file, link, ind, headings, firstClass }) {
  const out = [];
  let usage = false;
  let first = firstClass;
  for (const b of blocks) {
    if (b.t === 'h') {
      const el = Object.hasOwn(headings, b.level) ? headings[b.level] : null;
      if (!el || !b.id) fail(`${file}:${b.line}: a heading of ${b.level} # has no place here in the web page`);
      usage = plain(b.toks) === 'Usage';
      out.push(`${ind}<${el} id="${b.id}">${render(b.toks, link, b.line)}</${el}>`);
    } else if (b.t === 'p') {
      const back = b.toks.length === 1 && b.toks[0].t === 'link' && link(b.toks[0].url, b.line) === '#toc';
      out.push(`${ind}<p${back ? ' class="back"' : first ? ` class="${first}"` : ''}>${render(b.toks, link, b.marks)}</p>`);
      first = null;
    } else if (b.t === 'code') out.push(`${ind}${codeBlock(b, usage)}`);
    else if (b.t === 'list') out.push(listHtml(b, link, ind));
    else out.push(tableHtml(b, link, ind));
  }
  return out;
}

// ---------------------------------------------------------------- the look
// The styles and the theme script the web page had before it was generated here, then the rules the
// Markdown pages need.
const STYLE = String.raw`/* One palette and type, with a dark theme. */
:root{
  --paper:#F1F3EF; --sheet:#FFFFFF; --ink:#16201B; --muted:#56635C; --rule:#D5DBD4;
  --accent:#2B59C3; --accent-soft:#E3EAFA; --term:#101814; --term-fg:#DCE6DF; --term-dim:#7F9188; --term-p:#7FD3A2;
  --ok:#2E8B57; --warn:#B7791F; --err:#C2513B;
  --ok-soft:#E2F1E8; --warn-soft:#F7EDDC; --err-soft:#F7E4DF;
  --display:"Bricolage Grotesque", "Segoe UI", system-ui, sans-serif;
  --body:"IBM Plex Sans", "Segoe UI", system-ui, sans-serif;
  --mono:"JetBrains Mono", Consolas, monospace;
  color-scheme:light;
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    --paper:#0F1512; --sheet:#172019; --ink:#E3EBE5; --muted:#A3B1A9; --rule:#2B3832;
    --accent:#8DAAF2; --accent-soft:#1D2944; --term:#0A0F0C; --term-fg:#DCE6DF; --term-dim:#7F9188;
    --ok:#62C48F; --warn:#E2AC52; --err:#E8836D;
    --ok-soft:#173022; --warn-soft:#332713; --err-soft:#371C16;
    color-scheme:dark;
  }
}
:root[data-theme="dark"]{
  --paper:#0F1512; --sheet:#172019; --ink:#E3EBE5; --muted:#A3B1A9; --rule:#2B3832;
  --accent:#8DAAF2; --accent-soft:#1D2944; --term:#0A0F0C; --term-fg:#DCE6DF; --term-dim:#7F9188;
  --ok:#62C48F; --warn:#E2AC52; --err:#E8836D;
  --ok-soft:#173022; --warn-soft:#332713; --err-soft:#371C16;
  color-scheme:dark;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth;scroll-padding-top:16px}
body{margin:0;background:var(--paper);color:var(--ink);font:400 15px/1.6 var(--body);-webkit-text-size-adjust:100%}
a{color:var(--accent)}
a:focus-visible,button:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}

/* page frame */
.top{max-width:1240px;margin:0 auto;padding:28px 24px 0;display:flex;justify-content:space-between;align-items:center;gap:12px}
.brand{font:800 20px var(--display);color:var(--ink);text-decoration:none}
.brand i{font-style:normal;color:var(--accent)}
.eyebrow{font:600 12px var(--body);letter-spacing:.08em;text-transform:uppercase;color:var(--accent);background:var(--accent-soft);padding:6px 11px;border-radius:7px}
.theme{font:600 13px var(--body);color:var(--ink);background:var(--sheet);border:1.5px solid var(--rule);border-radius:9px;padding:7px 12px;cursor:pointer}
.theme:hover{border-color:var(--accent)}
.right{display:flex;gap:10px;align-items:center}
.layout{max-width:1240px;margin:0 auto;padding:0 24px 80px;display:grid;grid-template-columns:250px minmax(0,1fr);gap:48px}
main{min-width:0;max-width:880px}

/* table of contents */
.toc{position:sticky;top:0;align-self:start;max-height:100vh;overflow-y:auto;padding:28px 4px 28px 0;font-size:13.5px}
.toc summary{display:none}
.toc h2{font:700 12px var(--body);letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:0 0 10px}
.toc ol{list-style:none;margin:0;padding:0}
.toc li{margin:0}
.toc a{display:block;padding:3px 8px;border-radius:6px;color:var(--muted);text-decoration:none}
.toc a:hover{background:var(--accent-soft);color:var(--accent)}
.toc > nav > ol > li > a{color:var(--ink);font-weight:600;margin-top:8px}
.toc ol ol a{padding-left:18px}
.toc ol ol a code{font-size:12px;background:none;padding:0;color:inherit}

/* type */
.kicker{font:600 12.5px var(--body);letter-spacing:.12em;text-transform:uppercase;color:var(--accent)}
h1{font:800 48px/1.04 var(--display);letter-spacing:-.02em;margin:14px 0 0}
h2{font:800 32px/1.1 var(--display);letter-spacing:-.015em;margin:8px 0 0}
h3{font:700 19px/1.3 var(--display);margin:0}
h4{font:700 15px/1.3 var(--display);margin:22px 0 0}
p{margin:12px 0 0;color:var(--muted)}
p b, li b, td b, dd b{color:var(--ink);font-weight:600}
.lead{font-size:17px;line-height:1.55;margin-top:16px;max-width:720px}
section.part{padding-top:56px}
section.part > .intro{max-width:760px}
code{font:600 .86em var(--mono);color:var(--accent);background:var(--accent-soft);padding:1px 5px;border-radius:5px;overflow-wrap:anywhere}
ul,ol{color:var(--muted)}
li{margin:4px 0}

/* tags */
.tag{display:inline-block;font:600 11.5px/1.2 var(--body);letter-spacing:.02em;padding:4px 9px;border-radius:7px;vertical-align:middle;white-space:nowrap}
.t-rare{background:var(--paper);color:var(--muted);border:1px solid var(--rule)}

/* command entries */
.group{margin-top:34px}
.group > h3{font:800 23px/1.2 var(--display);letter-spacing:-.01em}
.group > p{max-width:760px}
section.cmd{background:var(--sheet);border:1.5px solid var(--rule);border-radius:12px;padding:18px 20px;margin-top:14px;min-width:0}
section.cmd > header{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px}
section.cmd > header h4{margin:0;font:700 18px var(--display)}
section.cmd > header h4 code{font-size:16px;background:none;padding:0;color:var(--ink)}
pre{margin:12px 0 0;padding:12px 14px;border-radius:10px;overflow-x:auto;font:400 13px/1.65 var(--mono);white-space:pre}
pre.syn{background:var(--accent-soft);color:var(--ink);border:1px solid var(--rule)}
pre.ex{background:var(--term);color:var(--term-fg)}
pre.ex .p{color:var(--term-p);user-select:none}
pre.ex .o{color:var(--term-dim)}
.exits{list-style:none;margin:0;padding:0}
.exits li{margin:2px 0;color:var(--ink)}
.exits b{display:inline-block;min-width:18px;font:700 14px var(--display);color:var(--accent)}
table{width:100%;border-collapse:collapse;font-size:14px;margin-top:12px}
th{text-align:left;font:600 11.5px var(--body);letter-spacing:.08em;text-transform:uppercase;color:var(--muted);padding:7px 10px;border-bottom:1.5px solid var(--rule)}
td{padding:8px 10px;border-bottom:1px solid var(--rule);vertical-align:top;color:var(--ink)}
td:first-child{width:34%}
td code{white-space:normal}
.foot{margin-top:64px;padding-top:14px;border-top:1px solid var(--rule);display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:13px;color:var(--muted)}

/* the pages written in Markdown: section labels, wrapped usage lines, exit lists, wide tables */
section.part > h2 + section.cmd, section.part > .group + section.cmd{margin-top:26px}
section.cmd h5{font:600 12px/1.5 var(--body);letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:20px 0 0}
section.cmd h6{font:700 14.5px/1.3 var(--display);color:var(--ink);margin:16px 0 0}
section.cmd p, section.cmd li{color:var(--ink);font-size:14.5px}
section.cmd h5 + p, section.cmd h5 + pre, section.cmd h5 + ul, section.cmd h5 + ol, section.cmd h5 + .tw > table{margin-top:6px}
section.cmd ul:not(.exits), section.cmd ol{margin:10px 0 0;padding-left:22px}
section.cmd p.back{font-size:13px;margin-top:16px}
pre.syn{white-space:pre-wrap;overflow-wrap:anywhere}
pre.syn .l{display:block;padding-left:4ch;text-indent:-4ch}
.exits li{display:grid;grid-template-columns:minmax(18px,max-content) minmax(0,1fr);gap:0 10px}
.tw{overflow-x:auto}
table.cols-3 td:first-child, table.cols-4 td:first-child, table.cols-5 td:first-child{width:auto}
section.part > ul, section.part > ol, .group > ul, .group > ol{margin:12px 0 0;padding-left:22px}

/* phone */
@media (max-width: 900px){
  .top{padding:18px 16px 0}
  .layout{display:block;padding:0 16px 60px}
  .toc{position:sticky;top:0;z-index:5;max-height:none;overflow:visible;padding:10px 0;background:var(--paper);border-bottom:1px solid var(--rule)}
  .toc summary{display:flex;justify-content:space-between;align-items:center;cursor:pointer;font:600 14px var(--body);color:var(--ink);list-style:none;padding:8px 12px;background:var(--sheet);border:1.5px solid var(--rule);border-radius:9px}
  .toc summary::-webkit-details-marker{display:none}
  .toc summary::after{content:"+";font:700 18px var(--display);color:var(--accent)}
  .toc[open] summary::after{content:"\2212"}
  .toc > nav{display:block;max-height:65vh;overflow-y:auto;margin-top:8px;background:var(--sheet);border:1.5px solid var(--rule);border-radius:9px;padding:10px}
  .toc h2{display:none}
  h1{font-size:36px}
  h2{font-size:27px}
  .lead{font-size:16px}
  section.cmd{padding:16px}
  td:first-child{width:auto}
  table{min-width:520px}
  table.cols-2{min-width:0}
  .eyebrow{display:none}
  section.part{padding-top:40px}
}
@media (prefers-reduced-motion: reduce){html{scroll-behavior:auto}}`;

const SCRIPT = String.raw`(function(){
  var root = document.documentElement;
  var btn = document.getElementById('theme');
  var toc = document.getElementById('toc');
  var narrow = window.matchMedia('(max-width: 900px)');
  function current(){
    var t = root.getAttribute('data-theme');
    if (t) return t;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function label(){ btn.textContent = current() === 'dark' ? 'Light theme' : 'Dark theme'; }
  try { var saved = localStorage.getItem('slicekit-theme'); if (saved === 'dark' || saved === 'light') root.setAttribute('data-theme', saved); } catch (e) {}
  label();
  btn.addEventListener('click', function(){
    var next = current() === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('slicekit-theme', next); } catch (e) {}
    label();
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', label);
  function fitToc(){ toc.open = !narrow.matches; }
  fitToc();
  narrow.addEventListener('change', fitToc);
  toc.addEventListener('click', function(e){ if (narrow.matches && e.target.closest('a')) toc.open = false; });
})();`;

// ---------------------------------------------------------------- the page
// The text of the web page for a guide folder. Throws an Error whose message names the file, and the
// line where there is one, when a file holds what the script does not convert.
export function guidePage(guideDir) {
  const GUIDE = path.resolve(guideDir);

  // Every id of the page is claimed here, with the place that claims it: the three ids of the page's
  // frame, the section of each page file, each heading of a page and of the index, each group of
  // pages. An id that is claimed twice is refused, naming the file and line of the second claim.
  const claimed = new Map([['top', 'the top bar of the web page'], ['toc', 'the contents list of the web page'], ['theme', 'the theme button of the web page']]);
  const claim = (id, file, line) => {
    if (claimed.has(id)) fail(`${file}:${line}: the id "${id}" is already the id of ${claimed.get(id)}; an id stands once in the web page`);
    claimed.set(id, `${file}:${line}`);
    return id;
  };
  // The anchor of a heading, by `next` (a slugger). A heading with no letter or digit has none.
  const anchorOf = (next, b, file) => {
    if (!slug(b.toks)) fail(`${file}:${b.line}: a heading whose text holds no letter or digit gives no id`);
    return next(b.toks);
  };
  // A heading is at most one level below the heading before it, so each has its place in the page.
  const inOrder = (blocks, file) => {
    let level = 1;
    for (const b of blocks.slice(1)) {
      if (b.t !== 'h') continue;
      if (b.level === 1) fail(`${file}:${b.line}: a second # heading; a file has one`);
      if (b.level > level + 1) fail(`${file}:${b.line}: a heading of ${b.level} # under a heading of ${level}; a heading is at most one level below the heading before it`);
      level = b.level;
    }
  };

  // The pages: 'commands/check.md' -> {rel, dir, id, blocks, anchors}.
  const pages = new Map();
  for (const dir of FOLDERS) {
    const folder = path.join(GUIDE, dir);
    const names = fs.existsSync(folder) ? fs.readdirSync(folder).filter((f) => f.endsWith('.md')).sort() : [];
    for (const f of names) {
      const rel = `${dir}/${f}`;
      // The name becomes an id and an attribute of the page as written.
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(f)) fail(`${rel}: the name of a page file holds a character that is no letter, digit, dot, dash or underscore`);
      const blocks = parse(readText(path.join(folder, f)), rel);
      if (!blocks.length || blocks[0].t !== 'h' || blocks[0].level !== 1) fail(`${rel}:1: the page does not begin with a # heading`);
      inOrder(blocks, rel);
      const id = claim(`${dir}-${f.slice(0, -3)}`, rel, 1);
      const next = slugger();
      const anchors = new Map();
      for (const b of blocks.slice(1)) {
        if (b.t !== 'h') continue;
        const anchor = anchorOf(next, b, rel);
        b.id = claim(`${id}--${anchor}`, rel, b.line);
        anchors.set(anchor, b.id);
      }
      pages.set(rel, { rel, dir, id, blocks, anchors });
    }
  }

  // The index.
  const INDEX = 'README.md';
  const readme = parse(readText(path.join(GUIDE, INDEX)), INDEX);
  if (readme[0]?.t !== 'h' || readme[0].level !== 1) fail(`${INDEX}:1: the index does not begin with a # heading`);
  inOrder(readme, INDEX);

  // Walk the index once: decide what stays, give each heading its id, and note where each of
  // GitHub's anchors now leads.
  const readmeAnchor = new Map(); // GitHub anchor -> id in this page
  const groups = []; // from "## Pages": {title, id, pages:[{page,label}]}
  const intro = []; // blocks before the first ## heading
  const parts = []; // {title, id, blocks, group}
  const dropped = []; // paragraphs that link the web page itself
  {
    const github = slugger();
    const mine = slugger();
    let skip = false; // inside "## Contents"
    let inPages = false;
    let part = null;
    for (const b of readme.slice(1)) {
      if (b.t === 'h') {
        // `inOrder` has refused a second # heading and a ### or deeper one before the first ##.
        const anchor = anchorOf(github, b, INDEX);
        if (b.level > 2 && skip) fail(`${INDEX}:${b.line}: a heading under "## Contents"; the section holds the list of contents and nothing else`);
        if (b.level > 2 && inPages) {
          if (b.level !== 3) fail(`${INDEX}:${b.line}: a heading of ${b.level} # under "## Pages"; a group of pages has a ### heading`);
          groups.push({ toks: b.toks, anchor, line: b.line, pages: [] });
          continue;
        }
        skip = false;
        inPages = false;
        const title = plain(b.toks);
        if (b.level === 2 && title === 'Contents') { skip = true; readmeAnchor.set(anchor, 'toc'); continue; }
        if (b.level === 2 && title === 'Pages') { inPages = true; readmeAnchor.set(anchor, 'toc'); continue; }
        b.id = claim(mine(b.toks), INDEX, b.line);
        readmeAnchor.set(anchor, b.id);
        if (b.level === 2) { part = { toks: b.toks, id: b.id, line: b.line, blocks: [] }; parts.push(part); continue; }
      } else if (skip) {
        // The contents list of the web page replaces the index's; any other text there is refused.
        if (b.t !== 'list') fail(`${INDEX}:${b.line}: ${b.t === 'p' ? 'a paragraph' : b.t === 'code' ? 'a code block' : 'a table'} under "## Contents"; the section holds the list of contents and nothing else`);
        continue;
      }
      if (inPages) {
        // Kept from the section: the group headings and the first cell of each row. Its paragraphs
        // and the later cells of a row are left out; a list or a code block there is refused.
        if (b.t === 'list' || b.t === 'code') fail(`${INDEX}:${b.line}: ${b.t === 'list' ? 'a list' : 'a code block'} under "## Pages"; the section holds paragraphs, ### headings and tables of pages`);
        if (b.t === 'table') {
          if (!groups.length) fail(`${INDEX}:${b.line}: a table of pages comes before the first ### heading of "## Pages"`);
          b.rows.forEach((row, k) => {
            const at = b.line + 2 + k;
            // The first cell is one link to a page file and nothing else; its text is the entry of
            // the contents list.
            const m = row[0].length === 1 && row[0][0].t === 'link' ? row[0][0] : null;
            if (!m) fail(`${INDEX}:${at}: the first cell of a Pages row is not one link to a page file and nothing else`);
            const page = pages.get(path.posix.normalize(m.url));
            if (!page) fail(`${INDEX}:${at}: the Pages row links "${m.url}", which is no page file of the guide`);
            if (page.listed) fail(`${INDEX}:${at}: ${page.rel} is listed twice under "## Pages"`);
            page.listed = true;
            groups.at(-1).pages.push({ page, toks: m.body, line: at });
          });
        }
        continue;
      }
      // A paragraph of the introduction that links the web page itself, the file beside the index,
      // says where this page comes from; the page does not repeat it. Its other links are judged as
      // every link is. A paragraph elsewhere that links it is kept, the link leading to the top of
      // the page (issue #189).
      if (!part && b.t === 'p' && linkTokens(b.toks).some((k) => k.url === PAGE)) { dropped.push(b); continue; }
      (part ? part.blocks : intro).push(b);
    }
  }
  if (!groups.length) fail(`${INDEX}: no "## Pages" section with a ### heading and a table of pages`);
  for (const page of pages.values()) if (!page.listed) fail(`${page.rel}: the page is not listed under "## Pages" of ${INDEX}, so the web page would have no section for it`);

  // Each group of pages is a section of its own, after the index's sections, in the index's order.
  // Its id is the anchor of its words; an id that is taken is refused by `claim`.
  for (const g of groups) {
    const id = claim(slug(g.toks), INDEX, g.line);
    readmeAnchor.set(g.anchor, id);
    parts.push({ toks: g.toks, id, line: g.line, blocks: [], group: g });
  }

  // A link target as an href of this page; null for a link to the section it stands in.
  function linker(fromRel, own) {
    return (url, line) => {
      if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
      const [file, hash = ''] = url.split('#');
      const rel = file ? path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), file)) : fromRel;
      let to;
      if (rel === INDEX || (rel === PAGE && !hash)) to = hash ? readmeAnchor.get(hash) : 'top';
      else if (pages.has(rel)) to = hash ? pages.get(rel).anchors.get(hash) : pages.get(rel).id;
      if (!to) fail(`${fromRel}:${line}: the link "${url}" leads to nothing in the guide`);
      return to === own ? null : `#${to}`;
    };
  }

  function pageSection(page) {
    const link = linker(page.rel, page.id);
    // The page's first heading, from its tokens. The words "Check rule: " at its start become a tag.
    const first = page.blocks[0];
    const RULE = 'Check rule: ';
    const rule = first.toks[0]?.t === 'text' && first.toks[0].s.startsWith(RULE) && plain(first.toks).length > RULE.trim().length;
    const toks = rule ? [{ t: 'text', s: first.toks[0].s.slice(RULE.length) }, ...first.toks.slice(1)] : first.toks;
    const head = `<h4><code>${render(toks, link, first.line, true)}</code></h4>${rule ? '<span class="tag t-rare">Check rule</span>' : ''}`;
    return [`  <section id="${page.id}" class="cmd" data-page="${page.rel}">`, `    <header>${head}</header>`,
      ...blocksHtml(page.blocks.slice(1), { file: page.rel, link, ind: '    ', headings: { 2: 'h5', 3: 'h6', 4: 'h6', 5: 'h6', 6: 'h6' }, firstClass: 'sum' }),
      '  </section>', ''];
  }

  const readmeLink = linker(INDEX, null);
  for (const b of dropped) for (const k of linkTokens(b.toks)) if (k.url !== PAGE) readmeLink(k.url, lineAt(b.marks, k.at));
  const H = [];
  const p = (...x) => H.push(...x);

  p('<!doctype html>', '<html lang="en">', '<head>', '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>slicekit guide</title>',
    '<meta name="description" content="The slicekit user guide: the stages, the conventions, and a section for every command, slash command and check rule.">',
    '<!-- Generated by scripts/guide-html.js from docs/guide/README.md and the pages under commands/, slash/ and rules/. Edit those, then run the script; do not edit this file. -->',
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=IBM+Plex+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;600&display=swap">',
    '<style>', STYLE, '</style>', '</head>', '<body>', '',
    '<div class="top">', '  <a class="brand" href="#top" id="top">Slice<i>Kit</i></a>', '  <div class="right">',
    '    <span class="eyebrow">User guide</span>',
    '    <button class="theme" id="theme" type="button" aria-label="Switch colour theme">Dark theme</button>',
    '  </div>', '</div>', '', '<div class="layout">', '');

  // contents
  p('<details class="toc" id="toc" open>', '  <summary>Contents</summary>', '  <nav aria-label="Contents">', '  <h2>Contents</h2>', '  <ol>');
  // An entry stands inside a link of its own, so a link in its text is written as its text; the
  // heading the entry leads to writes the link.
  for (const part of parts) {
    const head = `    <li><a href="#${part.id}">${render(part.toks)}</a>`;
    if (!part.group) { p(`${head}</li>`); continue; }
    p(head, '      <ol>', ...part.group.pages.map((e) => `        <li><a href="#${e.page.id}">${render(e.toks)}</a></li>`), '      </ol></li>');
  }
  p('  </ol>', '  </nav>', '</details>', '', '<main>', '');

  // header: the index's title and what stands before its first section. No heading stands there:
  // `inOrder` refuses a ### before the first ##, and the empty table of headings refuses any other.
  p('<header style="padding-top:36px">', '  <div class="kicker">User guide</div>', `  <h1>${render(readme[0].toks, readmeLink, readme[0].line)}</h1>`,
    ...blocksHtml(intro, { file: INDEX, link: readmeLink, ind: '  ', headings: {}, firstClass: 'lead' }), '</header>', '');

  // sections: the index's text, then the pages of the group the section holds
  const INDEX_HEADINGS = { 4: 'h4', 5: 'h5', 6: 'h6' };
  for (const part of parts) {
    p(`<section class="part" id="${part.id}">`, `  <h2>${render(part.toks, readmeLink, part.line)}</h2>`);
    let open = false;
    let run = [];
    const flush = () => { p(...blocksHtml(run, { file: INDEX, link: readmeLink, ind: open ? '    ' : '  ', headings: INDEX_HEADINGS })); run = []; };
    for (const b of part.blocks) {
      if (b.t === 'h' && b.level === 3) {
        flush();
        if (open) p('  </div>');
        p(`  <div class="group" id="${b.id}">`, `    <h3>${render(b.toks, readmeLink, b.line)}</h3>`);
        open = true;
      } else run.push(b);
    }
    flush();
    if (open) p('  </div>');
    p('');
    if (part.group) for (const e of part.group.pages) p(...pageSection(e.page));
    if (part === parts.at(-1)) p('  <div class="foot"><span>slicekit · user guide</span><span><a href="#top">Back to top</a></span></div>');
    p('</section>', '');
  }

  p('</main>', '</div>', '', '<script>', SCRIPT, '</script>', '</body>', '</html>', '');
  return sound(H.join('\n').replace(/\r\n?/g, '\n'));
}

// The last guard, after every rule above: a page that holds an element, an id or a link target
// named `undefined`, an id of another shape than letters, digits, dots, dashes and underscores, or
// one id twice is not returned, so it is not written. Each of these is a fault of this script; the
// rules above refuse the Markdown that could lead to one with its file and line.
export function sound(html) {
  if (/<\/?undefined\b|\s(?:id|class|href)="#?undefined"/.test(html)) fail(`${PAGE}: the page would hold "undefined" as an element, an id or a link target; nothing is written`);
  const ids = new Set();
  for (const [, id] of html.matchAll(/\sid="([^"]*)"/g)) {
    if (!/^[\p{L}\p{N}._-]+$/u.test(id)) fail(`${PAGE}: the page would hold the id "${id}", which is empty or holds a character no id of the page has; nothing is written`);
    if (ids.has(id)) fail(`${PAGE}: the page would hold the id "${id}" twice; nothing is written`);
    ids.add(id);
  }
  return html;
}

// ---------------------------------------------------------------- the command line
function main(argv) {
  const USAGE = 'usage: node scripts/guide-html.js [--check] [--guide <dir>]';
  let check = false;
  let guideArg = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--check') check = true;
    else if (argv[i] === '--guide' && argv[i + 1] !== undefined) guideArg = argv[++i];
    else if (argv[i].startsWith('--guide=') && argv[i].length > 8) guideArg = argv[i].slice(8);
    else if (argv[i] === '--help' || argv[i] === '-h') { process.stdout.write(`${USAGE}\n`); return 0; }
    else { process.stderr.write(`${USAGE}\n`); return 2; }
  }
  const guide = guideArg === null ? path.join(import.meta.dirname, '..', 'docs', 'guide') : path.resolve(guideArg);
  const file = path.join(guide, PAGE);
  // The page and the command as a person at the repository root reads them.
  const shown = guideArg === null ? `docs/guide/${PAGE}` : file.split(path.sep).join('/');
  const command = guideArg === null ? REGENERATE : `${REGENERATE} --guide ${guideArg.split(path.sep).join('/')}`;

  let html;
  try {
    html = guidePage(guide);
  } catch (err) {
    process.stderr.write(`guide-html: ${err.message}\n`);
    return 1;
  }
  if (check) {
    const onDisk = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : null;
    if (onDisk === html) return 0;
    const what = onDisk === null ? 'is missing' : 'differs from what the pages under the guide give';
    process.stderr.write(`guide-html: ${shown} ${what}; run \`${command}\` to regenerate it\n`);
    return 1;
  }
  fs.writeFileSync(file, html);
  process.stdout.write(`wrote ${shown}\n`);
  return 0;
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : '';
const same = process.platform === 'win32' ? invoked.toLowerCase() === import.meta.filename.toLowerCase() : invoked === import.meta.filename;
if (same) process.exitCode = main(process.argv.slice(2));
