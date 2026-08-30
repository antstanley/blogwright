import { PLUGIN_NAME_PATTERN } from 'blogwright-core';
import { describe, expect, it } from 'vitest';

import { ANALYTICS_NAMESPACE } from './index.js';

describe('ANALYTICS_NAMESPACE', () => {
  it('is the CLI namespace the analytics plugin will claim', () => {
    expect(ANALYTICS_NAMESPACE).toBe('analytics');
  });

  it('matches the pattern core enforces for Plugin.name', () => {
    expect(PLUGIN_NAME_PATTERN.test(ANALYTICS_NAMESPACE)).toBe(true);
  });
});
