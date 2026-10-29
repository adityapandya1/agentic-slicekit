// What npm may ship (S-26): the files npm always adds, and the three folders package.json names.
const ALWAYS = new Set(['package.json', 'README.md', 'LICENSE']);
const FOLDERS = ['bin/', 'src/', 'templates/'];

export function packProblems(files) {
  const problems = files
    .filter((f) => !ALWAYS.has(f) && !FOLDERS.some((d) => f.startsWith(d)))
    .map((f) => `${f} is outside bin, src and templates`);
  if (!files.includes('bin/slicekit.js')) problems.push('bin/slicekit.js is missing');
  return problems;
}
