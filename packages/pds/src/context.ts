/**
 * The narrow slice of the host CLI's context this feature package depends on.
 * The CLI's OpsContext satisfies it structurally, so the dispatch boundary is
 * a plain assignment — this package never imports CLI types.
 */

import type { FileSystem, OpsConfig, SecretsManagerClient, Terminal } from 'blogwright-core';

/** Leveled logger surface the pds commands report through. */
export interface PdsLogger {
  info(msg: string): void;
  step(msg: string): void;
  ok(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

/** The ports the pds feature crosses: repo files and the operator's terminal. */
export interface PdsPorts {
  fs: FileSystem;
  terminal: Terminal;
}

/** Everything a pds command needs from its host — config, secrets, ports, logging. */
export interface PdsContext {
  env: string;
  domain: string | undefined;
  config: OpsConfig;
  clients: { secrets: SecretsManagerClient };
  ports: PdsPorts;
  logger: PdsLogger;
}
