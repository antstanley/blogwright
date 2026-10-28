import { describe, expect, it } from 'vitest';

import { INSTALL_TARGET, installsOn, isPlatformSpecific, targetLabel } from './platform.js';

describe('targetLabel', () => {
  it('joins os, cpu and libc', () => {
    expect(targetLabel(INSTALL_TARGET)).toBe('linux-x64-glibc');
  });
});

describe('isPlatformSpecific', () => {
  it('is true when any constraint list has an entry', () => {
    expect(isPlatformSpecific({ os: ['darwin'] })).toBe(true);
    expect(isPlatformSpecific({ cpu: ['!arm'] })).toBe(true);
    expect(isPlatformSpecific({ libc: ['musl'] })).toBe(true);
  });

  it('is false with no constraints or only empty lists', () => {
    expect(isPlatformSpecific({})).toBe(false);
    expect(isPlatformSpecific({ os: [], cpu: [] })).toBe(false);
  });
});

describe('installsOn', () => {
  it('installs an unconstrained package everywhere', () => {
    expect(installsOn({}, INSTALL_TARGET)).toBe(true);
  });

  it('installs the variant built for the target', () => {
    expect(installsOn({ os: ['linux'], cpu: ['x64'], libc: ['glibc'] }, INSTALL_TARGET)).toBe(true);
  });

  it('skips variants for another os, cpu or libc', () => {
    expect(installsOn({ os: ['darwin'], cpu: ['x64'] }, INSTALL_TARGET)).toBe(false);
    expect(installsOn({ os: ['linux'], cpu: ['arm64'] }, INSTALL_TARGET)).toBe(false);
    expect(installsOn({ os: ['linux'], cpu: ['x64'], libc: ['musl'] }, INSTALL_TARGET)).toBe(false);
  });

  it('honours negated entries', () => {
    expect(installsOn({ os: ['!win32'] }, INSTALL_TARGET)).toBe(true);
    expect(installsOn({ os: ['!linux'] }, INSTALL_TARGET)).toBe(false);
  });

  it('ignores libc for a non-Linux target', () => {
    expect(installsOn({ libc: ['musl'] }, { os: 'darwin', cpu: 'arm64', libc: 'glibc' })).toBe(
      true,
    );
  });
});
