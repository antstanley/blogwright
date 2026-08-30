#!/usr/bin/env node
import { createNodeFileSystem, createNodeTerminal } from 'blogwright-core';

import { createNodeModuleLoader } from './adapters/node-module-loader.js';
import { main } from './cli.js';
import { createContext } from './context.js';
import { createLogger } from './logger.js';

const makeTerminal = (opts: { plain: boolean }) => createNodeTerminal(opts);
// Plugin dispatch needs `fs`/`loader` for discovery before any environment
// (and therefore any OpsContext) is known - see cli.ts's `DiscoveryPortsFactory`.
const makeDiscoveryPorts = () => ({ fs: createNodeFileSystem(), loader: createNodeModuleLoader() });

main(process.argv.slice(2), makeTerminal, createContext, makeDiscoveryPorts)
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    createLogger(makeTerminal({ plain: true })).error(
      err instanceof Error ? err.message : String(err),
    );
    process.exitCode = 1;
  });
