import { clientBundle } from '../../client/tsdown.client.ts'
import { typertPlugin } from '@deepseek-ai/dsh-typert-generator/tsdown'

export default clientBundle('@deepseek-ai/dsh-experimental-task-strategy', ['lib/types/index.js'], {
  hostPhase: true,
  lib: { plugins: [typertPlugin({ mode: 'package', faces: ['host'] })] },
  companions: [{
    entry: ['lib/types/cordis.js'], outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
    fixedExtension: false, dts: false, clean: false,
  }],
})
