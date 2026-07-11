import type { ResourceOutputs } from 'blogwright-core';
import { describe, expect, it } from 'vitest';

import type { OpsContext } from './context.js';
import { microvmLogGroup } from './deploy.js';
import { createTestContext } from './test-support.js';

function ctxWith(resources: Record<string, ResourceOutputs>): OpsContext {
  // env "preview" + site "example" derive /aws/lambda/microvms/preview-example-builder
  return createTestContext({ env: 'preview', state: { resources } });
}

describe('microvmLogGroup', () => {
  it('prefers the log group recorded on the image at bootstrap', () => {
    const ctx = ctxWith({
      'microvm-image': { logGroup: '/example/preview/microvm-build' },
      'microvm-log-group': { arn: 'arn:aws:logs:us-east-1:1:log-group:/other:*' },
    });
    expect(microvmLogGroup(ctx)).toBe('/example/preview/microvm-build');
  });

  it('parses the name from the log-group ARN when the image has none', () => {
    const ctx = ctxWith({
      'microvm-log-group': {
        arn: 'arn:aws:logs:us-east-1:1:log-group:/example/preview/microvm-build:*',
      },
    });
    expect(microvmLogGroup(ctx)).toBe('/example/preview/microvm-build');
  });

  it('falls back to the derived name when state has nothing recorded', () => {
    // A stack that predates state recording — the derived name is the only source.
    expect(microvmLogGroup(ctxWith({}))).toBe('/aws/lambda/microvms/preview-example-builder');
  });
});
