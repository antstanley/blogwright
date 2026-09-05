/** Path filters are literal prefixes at a slash boundary, not URL or SQL patterns. */
import { expect, it } from 'vitest';
import { normalizePathFilter, pathProblem } from './path-filter.js';
it.each([
  [undefined, undefined],
  ['', undefined],
  ['  ', undefined],
  ['/', '/'],
  [' /docs/// ', '/docs'],
  ['/docs%_', '/docs%_'],
])('normalizes %j', (input, expected) => {
  expect(normalizePathFilter(input)).toBe(expected);
});
it.each([
  null,
  17,
  'docs',
  'https://example.com/docs',
  '//example.com',
  '/docs?x=1',
  '/docs#intro',
  '/two words',
  '/docs\\page',
  '/docs\u0000page',
  '/docs\u001fpage',
  '/docs\u007fpage',
])('rejects malformed path %j', (input) => {
  expect(() => normalizePathFilter(input)).toThrow();
});
it('shares validation with the form', () => {
  expect(pathProblem('/docs')).toBeUndefined();
  expect(pathProblem('docs')).toContain('starting with /');
});
