#!/usr/bin/env node
import { createNodeTerminal } from 'blogwright-core';

import { main } from './cli.js';
import { createLogger } from './logger.js';

const terminal = createNodeTerminal();

main(process.argv.slice(2), terminal)
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    createLogger(terminal).error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
