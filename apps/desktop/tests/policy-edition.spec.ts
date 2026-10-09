import { describe, expect, it } from 'vitest'
import { createElectronBuilderConfig } from '../scripts/electron-builder-config.mjs'
import { validateDesktopPackageEnvironment } from '../scripts/desktop-package-environment.mjs'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPluginProfile } from '../src/project-manager.ts'

const environment = { DSH_DESKTOP_EDITION: 'policy', DSH_DESKTOP_APP_ID: 'io.github.sdaniasdsd.dshchange', DSH_DESKTOP_UNSIGNED: '1' }
const target = { platform: 'win32', arch: 'x64' } as const

describe('independent policy edition packaging', () => {
  it('activates new profiles while preserving user settings on restart', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-policy-profile-'))
    try {
      writeFileSync(join(root, 'policy-workflows.patch.yml'), '[]')
      const profile = join(root, 'profile')
      createPluginProfile(profile, root)
      const path = join(profile, 'package.json')
      const manifest = JSON.parse(readFileSync(path, 'utf8')) as { dsh: { profile: { bundles: string[] } } }
      expect(manifest.dsh.profile.bundles).toContain('@deepseek-ai/dsh-experimental-task-strategy')
      manifest.dsh.profile.bundles = ['user-choice']
      writeFileSync(path, JSON.stringify(manifest))
      writeFileSync(join(profile, 'cordis.patch.yml'), '# saved user settings')
      createPluginProfile(profile, root)
      expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(manifest)
      expect(readFileSync(join(profile, 'cordis.patch.yml'), 'utf8')).toBe('# saved user settings')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  it('packages an unsigned independent edition without an official update service', () => {
    expect(() => { validateDesktopPackageEnvironment(environment, target, { unsigned: true }) }).not.toThrow()
    const config = createElectronBuilderConfig(environment, 'win32', 'x64')
    expect(config.productName).toBe('DSH Policy Edition')
    expect(config.extraMetadata.dshPolicyEdition).toBe(true)
    expect(config.extraMetadata.name).toBe('dsh-policy-desktop')
    expect(config.extraMetadata.productName).toBe('DSH Policy Edition')
    expect(config.protocols).toEqual([])
    expect(config.extraMetadata.dshMandatoryUpdatePolicy).toBeUndefined()
    expect(config.publish).toBeNull()
  })

  it('rejects official identity and signed or non-Windows policy builds', () => {
    expect(() => {
      validateDesktopPackageEnvironment({ ...environment, DSH_DESKTOP_APP_ID: 'com.deepseek.harness' }, target, { unsigned: true })
    }).toThrow('independent application ID')
    expect(() => { validateDesktopPackageEnvironment(environment, target) }).toThrow('unsigned Windows')
    expect(() => createElectronBuilderConfig({ ...environment, DSH_DESKTOP_UNSIGNED: '0' }, 'win32', 'x64')).toThrow('unsigned Windows')
    expect(() => {
      validateDesktopPackageEnvironment(environment, { platform: 'darwin', arch: 'x64' }, { unsigned: true })
    }).toThrow('unsigned Windows')
  })

  it('rejects unknown editions and keeps official packaging policy requirements', () => {
    expect(() => createElectronBuilderConfig({ ...environment, DSH_DESKTOP_EDITION: 'typo' }, 'win32', 'x64')).toThrow('edition')
    expect(() => {
      validateDesktopPackageEnvironment({ DSH_DESKTOP_APP_ID: 'com.example.app' }, target, { unsigned: true })
    }).toThrow('HTTPS origin')
  })
})
