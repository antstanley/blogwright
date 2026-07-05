#!/usr/bin/env node
import { main } from './cli.js';
import { createLogger } from './logger.js';

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    createLogger().error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
