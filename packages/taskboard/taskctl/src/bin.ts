#!/usr/bin/env node
/** Published taskctl executable. */

import { runTaskctl } from './index.ts'

process.exitCode = await runTaskctl(process.argv.slice(2))
