import { describe, expect, it } from 'vitest';

import { invalidationPaths } from './invalidation-paths.js';

describe('invalidationPaths', () => {
  it('maps a plain asset to its URL path', () => {
    expect(invalidationPaths('site/_astro/app.css', 'site/')).toEqual(['/_astro/app.css']);
  });

  it('maps the root index to both /index.html and /', () => {
    expect(invalidationPaths('site/index.html', 'site/')).toEqual(['/index.html', '/']);
  });

  it('maps a nested index to the file and its directory URL', () => {
    expect(invalidationPaths('site/posts/index.html', 'site/')).toEqual([
      '/posts/index.html',
      '/posts/',
    ]);
  });

  it('leaves a key outside the prefix as a path of its own', () => {
    expect(invalidationPaths('other/a.css', 'site/')).toEqual(['/other/a.css']);
  });
});
