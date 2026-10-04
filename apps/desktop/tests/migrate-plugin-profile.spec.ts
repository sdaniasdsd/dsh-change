import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { migratePluginProfile } from '../scripts/migrate-plugin-profile.ts'

const roots: string[] = []

function hash(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function fixture(): { root: string; build: string; source: string; target: string; targetProfile: string } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-plugin-migration-'))
  roots.push(root)
  const build = join(root, 'desktop-build')
  mkdirSync(build)
  const source = join(root, 'source', 'profiles', 'desktop')
  const target = join(build, 'candidate')
  const targetProfile = join(target, 'profiles', 'desktop')
  const plugin = join(source, 'node_modules', 'dsh-demo-plugin')
  mkdirSync(plugin, { recursive: true })
  writeFileSync(join(plugin, 'package.json'), JSON.stringify({ name: 'dsh-demo-plugin', version: '1.2.3', dependencies: {} }))
  writeFileSync(join(plugin, 'index.js'), 'export function apply() {}\n')
  writeFileSync(join(source, 'package.json'), JSON.stringify({
    name: 'dsh desktop', version: '0.2.1-alpha.1',
    dependencies: { 'dsh-demo-plugin': '^1.2.0' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh-demo-plugin', 'dsh-missing-plugin'] } },
  }))
  writeFileSync(join(source, 'cordis.patch.yml'), '# private setting\n- id: demo\n  config:\n    apiKey: super-secret-value\n')
  writeFileSync(join(source, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n')
  return { root, build, source, target, targetProfile }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('candidate plugin profile migration', () => {
  it('preserves ordered bundles and exact installed package versions without mutating the source', () => {
    const f = fixture()
    const sourceFiles = ['package.json', 'cordis.patch.yml', 'pnpm-lock.yaml'].map(file => join(f.source, file))
    const before = sourceFiles.map(hash)
    const result = migratePluginProfile({
      sourceProfile: f.source,
      candidateBuildRoot: f.build,
      candidateRoot: f.target,
      candidateProfile: f.targetProfile,
      strategyPackageFile: 'dsh-experimental-task-strategy-0.2.1-alpha.1.tgz',
    })
    const manifest = JSON.parse(readFileSync(join(f.targetProfile, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
      dsh: { profile: { bundles: string[] } }
    }
    expect(manifest.dsh.profile.bundles).toEqual(['@deepseek-ai/dsh-base', 'dsh-demo-plugin', 'dsh-missing-plugin'])
    expect(manifest.dependencies['dsh-demo-plugin']).toBe('file:../../plugin-packages/dsh-demo-plugin')
    expect(manifest.dependencies['@deepseek-ai/dsh-experimental-task-strategy']).toContain('dsh-experimental-task-strategy-0.2.1-alpha.1.tgz')
    expect(result.plugins).toMatchObject([{ name: 'dsh-demo-plugin', sourceVersion: '1.2.3', candidateVersion: '1.2.3' }])
    expect(result.unavailableBundles).toEqual(['dsh-missing-plugin'])
    expect(existsSync(join(f.target, 'plugin-packages', 'dsh-demo-plugin', 'index.js'))).toBe(true)
    expect(sourceFiles.map(hash)).toEqual(before)
    expect(existsSync(join(f.target, 'migration-report.json'))).toBe(true)
  })

  it('refuses a candidate path outside the build output and refuses overwrites', () => {
    const f = fixture()
    expect(() => migratePluginProfile({
      sourceProfile: f.source,
      candidateBuildRoot: f.build,
      candidateRoot: resolve(f.build, '..', 'escape'),
      candidateProfile: resolve(f.build, '..', 'escape', 'profiles', 'desktop'),
      strategyPackageFile: 'strategy.tgz',
    })).toThrow(/inside the Desktop build output/u)
    mkdirSync(f.targetProfile, { recursive: true })
    expect(() => migratePluginProfile({
      sourceProfile: f.source,
      candidateBuildRoot: f.build,
      candidateRoot: f.target,
      candidateProfile: f.targetProfile,
      strategyPackageFile: 'strategy.tgz',
    })).toThrow(/already exists/u)
  })

  it('rejects a candidate directory that is a symlink outside the build output', () => {
    const f = fixture()
    const outside = join(f.build, '..', 'outside')
    mkdirSync(outside)
    symlinkSync(outside, f.target, 'junction')
    expect(() => migratePluginProfile({
      sourceProfile: f.source,
      candidateBuildRoot: f.build,
      candidateRoot: f.target,
      candidateProfile: f.targetProfile,
      strategyPackageFile: 'strategy.tgz',
    })).toThrow(/symbolic links/u)
    expect(existsSync(join(outside, 'profiles', 'desktop'))).toBe(false)
  })

  it('rejects dependency names that are not safe npm package paths', () => {
    const f = fixture()
    const sourceManifest = JSON.parse(readFileSync(join(f.source, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }
    sourceManifest.dependencies['..\\outside'] = '1.0.0'
    writeFileSync(join(f.source, 'package.json'), JSON.stringify(sourceManifest))
    expect(() => migratePluginProfile({
      sourceProfile: f.source,
      candidateBuildRoot: f.build,
      candidateRoot: f.target,
      candidateProfile: f.targetProfile,
      strategyPackageFile: 'strategy.tgz',
    })).toThrow(/invalid package name/u)
    expect(existsSync(join(f.root, 'outside'))).toBe(false)
  })

  it('stores distinct scoped package names in distinct candidate paths', () => {
    const f = fixture()
    const manifestPath = join(f.source, 'package.json')
    const sourceManifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      dependencies: Record<string, string>
      dsh: { profile: { bundles: string[] } }
    }
    for (const name of ['@a__b/c', '@a/b__c']) {
      const packageRoot = join(f.source, 'node_modules', ...name.split('/'))
      mkdirSync(packageRoot, { recursive: true })
      writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ name, version: '1.0.0' }))
      writeFileSync(join(packageRoot, 'index.js'), name)
      sourceManifest.dependencies[name] = '1.0.0'
      sourceManifest.dsh.profile.bundles.push(name)
    }
    writeFileSync(manifestPath, JSON.stringify(sourceManifest))
    migratePluginProfile({
      sourceProfile: f.source,
      candidateBuildRoot: f.build,
      candidateRoot: f.target,
      candidateProfile: f.targetProfile,
      strategyPackageFile: 'strategy.tgz',
    })
    expect(readFileSync(join(f.target, 'plugin-packages', '@a__b', 'c', 'index.js'), 'utf8')).toBe('@a__b/c')
    expect(readFileSync(join(f.target, 'plugin-packages', '@a', 'b__c', 'index.js'), 'utf8')).toBe('@a/b__c')
  })

  it('redacts secret-like patch values from its report while preserving them in the candidate patch', () => {
    const f = fixture()
    const result = migratePluginProfile({
      sourceProfile: f.source,
      candidateBuildRoot: f.build,
      candidateRoot: f.target,
      candidateProfile: f.targetProfile,
      strategyPackageFile: 'strategy.tgz',
    })
    const report = JSON.stringify(result)
    expect(report).not.toContain('super-secret-value')
    expect(readFileSync(join(f.targetProfile, 'cordis.patch.yml'), 'utf8')).toContain('super-secret-value')
  })

  it('keeps statically incompatible plugins present but inactive in the candidate profile', () => {
    const f = fixture()
    const packageManifest = join(f.source, 'node_modules', 'dsh-demo-plugin', 'package.json')
    writeFileSync(packageManifest, JSON.stringify({
      name: 'dsh-demo-plugin', version: '1.2.3', peerDependencies: { '@deepseek-ai/dsh-tools': '^9.0.0' },
    }))
    const result = migratePluginProfile({
      sourceProfile: f.source,
      candidateBuildRoot: f.build,
      candidateRoot: f.target,
      candidateProfile: f.targetProfile,
      strategyPackageFile: 'strategy.tgz',
      targetPackageVersions: { '@deepseek-ai/dsh-tools': '0.2.1-alpha.1' },
    })
    const candidateManifest = JSON.parse(readFileSync(join(f.targetProfile, 'package.json'), 'utf8')) as {
      dsh: { profile: { bundles: string[] } }
    }
    expect(result.plugins[0]?.compatibility).toBe('incompatible')
    expect(result.inactiveBundles).toEqual(['dsh-demo-plugin'])
    expect(candidateManifest.dsh.profile.bundles).not.toContain('dsh-demo-plugin')
    expect(readFileSync(join(f.source, 'package.json'), 'utf8')).toContain('dsh-demo-plugin')
  })
})
