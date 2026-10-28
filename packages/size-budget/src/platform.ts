/**
 * The single platform every install size is measured for. A package with a
 * native binary (DuckDB) ships one optional package per platform and the
 * installer keeps only the host's, so sizes measured on the host would differ
 * between a laptop and CI. Measuring for one fixed target instead makes the
 * budget the same wherever it runs. linux-x64 (glibc) is what CI runs on.
 */

import type { PlatformConstraints } from './ports.js';

export interface PlatformTarget {
  readonly os: string;
  readonly cpu: string;
  readonly libc: string;
}

export const INSTALL_TARGET: PlatformTarget = { os: 'linux', cpu: 'x64', libc: 'glibc' };

/** The target as one token, e.g. `linux-x64-glibc` - how the baseline file records it. */
export function targetLabel(target: PlatformTarget): string {
  return `${target.os}-${target.cpu}-${target.libc}`;
}

/** True when a manifest restricts the platforms it installs on. */
export function isPlatformSpecific(constraints: PlatformConstraints): boolean {
  return [constraints.os, constraints.cpu, constraints.libc].some(
    (list) => list !== undefined && list.length > 0,
  );
}

/** Whether npm would install a package with these constraints on `target`. */
export function installsOn(constraints: PlatformConstraints, target: PlatformTarget): boolean {
  return (
    allows(constraints.os, target.os) &&
    allows(constraints.cpu, target.cpu) &&
    // libc only constrains Linux installs.
    (target.os !== 'linux' || allows(constraints.libc, target.libc))
  );
}

/**
 * npm's rule for one constraint list: `!value` blocks a value; when any
 * positive entry is present the value must be one of them.
 */
function allows(list: readonly string[] | undefined, value: string): boolean {
  if (list === undefined || list.length === 0) return true;
  if (list.includes(`!${value}`)) return false;
  const positives = list.filter((entry) => !entry.startsWith('!'));
  return positives.length === 0 || positives.includes(value);
}
