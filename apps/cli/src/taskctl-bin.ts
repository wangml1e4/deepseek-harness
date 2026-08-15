#!/usr/bin/env node
/** Installed `taskctl` entry exposed by the main dsh package. */

/* v8 ignore file -- the built Taskboard Host acceptance executes this wrapper. */

import { runTaskctl } from '@deepseek-ai/dsh-taskctl'

process.exitCode = await runTaskctl(process.argv.slice(2))
