import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'

const pkgDir = fileURLToPath(new URL('../', import.meta.url))
const built = ['../lib/index.js', '../lib/cordis.js'].every(path => existsSync(new URL(path, import.meta.url)))

describe.skipIf(!built)('published task strategy black-box behavior', () => {
  it('exercises composed services and model JSON under plain Node', async () => {
    const { exitCode, stdout, stderr } = await execa(process.execPath,
      ['--test', '--test-reporter=tap', 'tests/blackbox.mjs'], {
        cwd: pkgDir, stdin: 'ignore', timeout: 55_000, killSignal: 'SIGKILL', reject: false,
      })
    expect(exitCode, `${stdout}\n${stderr}`).toBe(0)
    expect(stdout).toMatch(/# fail 0/)
  })
})
