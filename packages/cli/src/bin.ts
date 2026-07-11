#!/usr/bin/env node
import { createNodeTerminal } from 'blogwright-core';

import { main } from './cli.js';
import { createLogger } from './logger.js';

const makeTerminal = (opts: { plain: boolean }) => createNodeTerminal(opts);

main(process.argv.slice(2), makeTerminal)
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    createLogger(makeTerminal({ plain: true })).error(
      err instanceof Error ? err.message : String(err),
    );
    process.exitCode = 1;
  });
