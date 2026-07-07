import { describe, expect, it } from 'vitest';

import type { OpsContext } from './context.js';
import { microvmLogGroup } from './deploy.js';

function ctxWith(resources: Record<string, Record<string, unknown>>): OpsContext {
  return {
    names: { microvmLogGroup: '/aws/lambda/microvms/preview-iamstan-builder' },
    state: { version: 1, env: 'preview', resources },
  } as unknown as OpsContext;
}

describe('microvmLogGroup', () => {
  it('prefers the log group recorded on the image at bootstrap', () => {
    const ctx = ctxWith({
      'microvm-image': { logGroup: '/iamstan/preview/microvm-build' },
      'microvm-log-group': { arn: 'arn:aws:logs:us-east-1:1:log-group:/other:*' },
    });
    expect(microvmLogGroup(ctx)).toBe('/iamstan/preview/microvm-build');
  });

  it('parses the name from the log-group ARN when the image has none', () => {
    const ctx = ctxWith({
      'microvm-log-group': { arn: 'arn:aws:logs:us-east-1:1:log-group:/iamstan/preview/microvm-build:*' },
    });
    expect(microvmLogGroup(ctx)).toBe('/iamstan/preview/microvm-build');
  });

  it('falls back to the derived name when state has nothing recorded', () => {
    // A stack that predates state recording — the derived name is the only source.
    expect(microvmLogGroup(ctxWith({}))).toBe('/aws/lambda/microvms/preview-iamstan-builder');
  });
});
