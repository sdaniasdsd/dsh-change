import { describe, expect, it } from 'vitest'
import { createElectronBuilderConfig } from '../scripts/electron-builder-config.mjs'
import { validateDesktopPackageEnvironment } from '../scripts/desktop-package-environment.mjs'

const environment = { DSH_DESKTOP_EDITION: 'policy', DSH_DESKTOP_APP_ID: 'io.github.sdaniasdsd.dshchange', DSH_DESKTOP_UNSIGNED: '1' }
const target = { platform: 'win32', arch: 'x64' } as const

describe('independent policy edition packaging', () => {
  it('packages an unsigned independent edition without an official update service', () => {
    expect(() => { validateDesktopPackageEnvironment(environment, target, { unsigned: true }) }).not.toThrow()
    const config = createElectronBuilderConfig(environment, 'win32', 'x64')
    expect(config.productName).toBe('DSH Policy Edition')
    expect(config.extraMetadata.dshPolicyEdition).toBe(true)
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
