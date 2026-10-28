export function greet(name) {
  if (!name) throw new Error('a name is required');
  return `Hello, ${name}!`;
}
