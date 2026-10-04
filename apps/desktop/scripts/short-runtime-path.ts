/** Run an operation against a short-lived Windows junction to avoid MAX_PATH in packaged smoke tests. */
import { mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export async function withShortRuntimePath<T>(runtimePath: string, operation: (path: string) => Promise<T>): Promise<T> {
  if (process.platform !== 'win32') return operation(runtimePath)

  const root = await mkdtemp(join(tmpdir(), 'dsh-smoke-'))
  const alias = join(root, 'runtime')
  try {
    await symlink(runtimePath, alias, 'junction')
    return await operation(alias)
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  }
}
