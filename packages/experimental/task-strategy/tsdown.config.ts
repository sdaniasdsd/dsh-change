import { defineConfig } from 'tsdown'

/** Build the independent strategy library and its separately opt-in Cordis carrier. */
export default defineConfig([
  {
    entry: ['src/index.ts', 'src/cordis.ts'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
])
