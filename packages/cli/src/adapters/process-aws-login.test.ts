import { EventEmitter } from 'node:events';

import { describe, expect, it } from 'vitest';

import { createProcessAwsLogin, type LaunchAws } from './process-aws-login.js';

/** A launcher that records its call and lets the test end the "process". */
function fakeLauncher(): { launch: LaunchAws; child: EventEmitter; calls: unknown[][] } {
  const child = new EventEmitter();
  const calls: unknown[][] = [];
  return {
    child,
    calls,
    launch: (command, args, options) => {
      calls.push([command, args, options]);
      return child;
    },
  };
}

describe('createProcessAwsLogin', () => {
  it('runs aws with the terminal attached and no shell', async () => {
    const fake = fakeLauncher();
    const result = createProcessAwsLogin(fake.launch).run(['sso', 'login', '--profile', 'p']);
    fake.child.emit('exit', 0);
    expect(await result).toEqual({ ok: true });
    expect(fake.calls).toEqual([
      ['aws', ['sso', 'login', '--profile', 'p'], { stdio: 'inherit', shell: false }],
    ]);
  });

  it('reports a non-zero exit with its code', async () => {
    const fake = fakeLauncher();
    const result = createProcessAwsLogin(fake.launch).run(['login']);
    fake.child.emit('exit', 255);
    expect(await result).toEqual({ ok: false, reason: 'exit', code: 255 });
  });

  it('reports a signalled exit as code 1', async () => {
    const fake = fakeLauncher();
    const result = createProcessAwsLogin(fake.launch).run(['login']);
    fake.child.emit('exit', null);
    expect(await result).toEqual({ ok: false, reason: 'exit', code: 1 });
  });

  it('reports a missing binary as not-installed', async () => {
    const fake = fakeLauncher();
    const result = createProcessAwsLogin(fake.launch).run(['login']);
    fake.child.emit('error', Object.assign(new Error('spawn aws ENOENT'), { code: 'ENOENT' }));
    expect(await result).toEqual({ ok: false, reason: 'not-installed' });
  });

  it('raises any other launch failure with the command', async () => {
    const fake = fakeLauncher();
    const result = createProcessAwsLogin(fake.launch).run(['login']);
    fake.child.emit('error', Object.assign(new Error('spawn aws EACCES'), { code: 'EACCES' }));
    await expect(result).rejects.toThrow('could not run aws login: spawn aws EACCES');
  });
});
