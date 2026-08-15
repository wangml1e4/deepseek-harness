import { defineConfig } from 'tsdown'

/**
 * The dsh CLI ships the profile launcher and the Taskboard command entry.
 * The root tsdown builds only `lib/types/index.js`, so this override points at
 * both files referenced by package.json `bin`; reachable modules bundle with them.
 * Declarations come from `tsc -b` (dts: false), matching every package.
 */
export default defineConfig({
  entry: ['lib/types/bin.js', 'lib/types/taskctl-bin.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
