import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { withShortRuntimePath } from '../scripts/short-runtime-path.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('withShortRuntimePath', () => {
  it('exposes the original runtime through a temporary short path and cleans the alias', async () => {
    const root = await mkdtemp(join(tmpdir(), 'desktop-short-runtime-test-'))
    roots.push(root)
    const runtime = join(root, 'runtime')
    await mkdir(runtime)
    await writeFile(join(runtime, 'marker.txt'), 'runtime contents')

    let aliasPath = ''
    const result = await withShortRuntimePath(runtime, async (alias) => {
      aliasPath = alias
      return await readFile(join(alias, 'marker.txt'), 'utf8')
    })

    expect(result).toBe('runtime contents')
    if (process.platform === 'win32') {
      expect(aliasPath).not.toBe(runtime)
      await expect(access(aliasPath)).rejects.toThrow()
    } else {
      expect(aliasPath).toBe(runtime)
    }
    expect(await readFile(join(runtime, 'marker.txt'), 'utf8')).toBe('runtime contents')
  })
})
