#!/usr/bin/env node
import { createNodeFileSystem, createNodeTerminal } from 'blogwright-core';

import { createNodeModuleLoader } from './adapters/node-module-loader.js';
import { createProcessPackageManager } from './adapters/process-package-manager.js';
import { main } from './cli.js';
import { createContext } from './context.js';
import { createLogger } from './logger.js';

const makeTerminal = (opts: { plain: boolean }) => createNodeTerminal(opts);
// Plugin dispatch needs `fs`/`loader` for discovery before any environment
// (and therefore any OpsContext) is known - see cli.ts's `DiscoveryPortsFactory`.
const makeDiscoveryPorts = () => ({ fs: createNodeFileSystem(), loader: createNodeModuleLoader() });
// `blogwright plugin add`/`plugin remove` install and uninstall through the
// PackageManager port, likewise before any OpsContext exists - see cli.ts's
// `PackageManagerFactory`. The adapter resolves the repo and the manager
// governing it itself, so it needs nothing here but a FileSystem.
const makePackages = () => createProcessPackageManager(createNodeFileSystem());

main(process.argv.slice(2), makeTerminal, createContext, makeDiscoveryPorts, makePackages)
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    createLogger(makeTerminal({ plain: true })).error(
      err instanceof Error ? err.message : String(err),
    );
    process.exitCode = 1;
  });
