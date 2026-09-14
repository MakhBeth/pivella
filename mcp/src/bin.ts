#!/usr/bin/env node
/** Entry point del comando `pivella-mcp` (campo `bin` di `mcp/package.json`). */
import pkg from '../package.json';

import { log, main } from './cli';

main(process.argv.slice(2), process.env, pkg.version).catch((err: unknown) => {
  log(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
