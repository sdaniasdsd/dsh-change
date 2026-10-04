/** Copy a user's external DSH plugins into an isolated Desktop candidate profile. */

import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { globSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { satisfies } from 'semver'
import { resolveDesktopTargetBuildPaths } from './desktop-build-paths.mjs'
import { readDesktopCorePackageSet } from '../src/core-package-set.ts'

const APP_ROOT = resolve(import.meta.dirname, '..')
const REPOSITORY_ROOT = resolve(APP_ROOT, '..', '..')
const STRATEGY_PACKAGE = '@deepseek-ai/dsh-experimental-task-strategy'
const STRATEGY_PLUGIN_ID = 'experimental-task-strategy'
const RUNTIME_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] as const
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u

/** One source plugin's package identity and static target-runtime compatibility. */
export interface MigratedPluginRecord {
  readonly name: string
  readonly sourceVersion: string
  readonly candidateVersion: string
  readonly sourceDependencyKind: 'local-file' | 'version-range'
  readonly candidateDependencyKind: 'isolated-local-copy'
  readonly compatibility: 'compatible' | 'incompatible' | 'unverified'
  readonly incompatiblePeers: readonly string[]
}

/** Safe, value-free candidate migration report. */
export interface PluginMigrationReport {
  readonly schemaVersion: 1
  readonly sourceProfile: string
  readonly candidateProfile: string
  readonly plugins: readonly MigratedPluginRecord[]
  readonly bundles: readonly string[]
  readonly activeBundles: readonly string[]
  readonly inactiveBundles: readonly string[]
  readonly unavailableBundles: readonly string[]
  readonly strategyCarrier: { readonly package: string; readonly pluginId: string; readonly enabled: true }
  readonly settings: 'copied without values; source remains read-only'
}

/** One isolated candidate migration request. */
export interface MigratePluginProfileOptions {
  readonly sourceProfile: string
  readonly candidateBuildRoot: string
  readonly candidateRoot: string
  readonly candidateProfile: string
  readonly strategyPackageFile: string
  readonly targetPackageVersions?: Readonly<Record<string, string>>
  readonly runtimePackages?: readonly string[]
}

function isWithin(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
}

function packagePath(root: string, name: string): string {
  if (!PACKAGE_NAME.test(name)) throw new Error(`plugin migration: invalid package name: ${name}`)
  return join(root, 'node_modules', ...name.split('/'))
}

function assertNoSymlinkFrom(root: string, child: string): void {
  if (!isWithin(root, child)) throw new Error('plugin migration: candidate paths must remain inside the Desktop build output')
  const parts = relative(root, child).split(sep).filter(Boolean)
  let current = root
  for (const part of ['', ...parts]) {
    if (part) current = join(current, part)
    try {
      if (lstatSync(current).isSymbolicLink()) throw new Error('plugin migration: candidate output paths cannot contain symbolic links')
    } catch (error) {
      if (error instanceof Error && error.message.includes('cannot contain symbolic links')) throw error
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
  }
}

function packageDirectoryParts(name: string): string[] {
  return name.split('/')
}

function readManifest(path: string, subject: string): Record<string, unknown> {
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`plugin migration: invalid ${subject}`)
  return value as Record<string, unknown>
}

function recordDependencies(value: unknown, subject: string): Record<string, string> {
  if (value === undefined) return {}
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`plugin migration: invalid ${subject}`)
  const out: Record<string, string> = {}
  for (const [name, version] of Object.entries(value)) {
    if (typeof version !== 'string') throw new Error(`plugin migration: invalid ${subject} entry ${name}`)
    out[name] = version
  }
  return out
}

function workspacePackageVersions(): Record<string, string> {
  const versions: Record<string, string> = {}
  for (const path of globSync(['packages/*/*/package.json', 'vendor/*/package.json'], { cwd: REPOSITORY_ROOT })) {
    const manifest = readManifest(join(REPOSITORY_ROOT, path), path)
    if (typeof manifest.name === 'string' && typeof manifest.version === 'string') versions[manifest.name] = manifest.version
  }
  return versions
}

function isCorePeer(name: string): boolean {
  return name === '@deepseek-ai/cordis' || name.startsWith('@deepseek-ai/dsh-')
}

function classifyPeers(
  peerDependencies: Record<string, string>,
  targetVersions: Readonly<Record<string, string>> | undefined,
): { compatibility: MigratedPluginRecord['compatibility']; incompatiblePeers: string[] } {
  if (targetVersions === undefined) return { compatibility: 'unverified', incompatiblePeers: [] }
  const incompatiblePeers: string[] = []
  for (const [name, range] of Object.entries(peerDependencies).filter(([name]) => isCorePeer(name))) {
    const targetVersion = targetVersions[name]
    if (targetVersion === undefined || !satisfies(targetVersion, range, { includePrerelease: true })) {
      incompatiblePeers.push(`${name}@${range}`)
    }
  }
  return {
    compatibility: incompatiblePeers.length === 0 ? 'compatible' : 'incompatible',
    incompatiblePeers,
  }
}

function carrierPatch(): string {
  return [
    '',
    '# Added only to the isolated Desktop candidate; the user profile remains unchanged.',
    '- insert:',
    `    - id: ${STRATEGY_PLUGIN_ID}`,
    `      name: '${STRATEGY_PACKAGE}/cordis'`,
    '      config:',
    '        allowedPresets: [standard]',
    '',
  ].join('\n')
}

/**
 * Prepare an isolated copy of the source plugin declarations, patch and installed package bytes.
 * @param options - source and candidate locations plus local runtime package identities.
 * @returns a report containing package metadata only, never patch values.
 */
export function migratePluginProfile(options: MigratePluginProfileOptions): PluginMigrationReport {
  const sourceProfile = resolve(options.sourceProfile)
  const candidateBuildRoot = resolve(options.candidateBuildRoot)
  const candidateRoot = resolve(options.candidateRoot)
  const candidateProfile = resolve(options.candidateProfile)
  if (!isWithin(candidateBuildRoot, candidateRoot) || !isWithin(candidateRoot, candidateProfile)) {
    throw new Error('plugin migration: candidate paths must remain inside the Desktop build output')
  }
  if (!existsSync(candidateBuildRoot) || !lstatSync(candidateBuildRoot).isDirectory()) {
    throw new Error('plugin migration: Desktop build output must already exist as a real directory')
  }
  assertNoSymlinkFrom(candidateBuildRoot, candidateProfile)
  if (isWithin(sourceProfile, candidateRoot) || isWithin(candidateRoot, sourceProfile)) {
    throw new Error('plugin migration: source and candidate profiles must be disjoint')
  }
  if (existsSync(candidateRoot)) throw new Error(`plugin migration: candidate output already exists: ${candidateRoot}`)

  const sourcePackagePath = join(sourceProfile, 'package.json')
  const sourcePatchPath = join(sourceProfile, 'cordis.patch.yml')
  if (!existsSync(sourcePackagePath)) throw new Error(`plugin migration: source profile has no package.json: ${sourcePackagePath}`)
  if (!existsSync(sourcePatchPath)) throw new Error(`plugin migration: source profile has no cordis.patch.yml: ${sourcePatchPath}`)
  const sourceManifest = readManifest(sourcePackagePath, 'source package.json')
  const dsh = sourceManifest.dsh
  if (dsh === null || typeof dsh !== 'object' || Array.isArray(dsh)) throw new Error('plugin migration: source manifest has no dsh profile')
  const profile = (dsh as Record<string, unknown>).profile
  if (profile === null || typeof profile !== 'object' || Array.isArray(profile)) throw new Error('plugin migration: source manifest has no dsh.profile')
  const rawBundles = (profile as Record<string, unknown>).bundles
  if (!Array.isArray(rawBundles) || !rawBundles.every(bundle => typeof bundle === 'string')) {
    throw new Error('plugin migration: source bundle list is invalid')
  }
  const dependencies = recordDependencies(sourceManifest.dependencies, 'source dependencies')
  for (const name of Object.keys(dependencies)) packagePath(sourceProfile, name)
  const targetPackageVersions = options.targetPackageVersions
  const runtimePackages = new Set(options.runtimePackages ?? RUNTIME_BUNDLES)
  const candidateDependencies: Record<string, string> = { ...dependencies }
  const plugins: MigratedPluginRecord[] = []
  const copyInputs: { name: string; sourcePackage: string }[] = []
  for (const name of Object.keys(dependencies).sort()) {
    const sourcePackage = packagePath(sourceProfile, name)
    if (!isWithin(sourceProfile, resolve(sourcePackage))) throw new Error(`plugin migration: package path escaped source profile: ${name}`)
    const packageManifestPath = join(sourcePackage, 'package.json')
    if (!existsSync(packageManifestPath)) throw new Error(`plugin migration: installed dependency is missing: ${name}`)
    const pluginManifest = readManifest(packageManifestPath, `installed package ${name}`)
    if (pluginManifest.name !== name || typeof pluginManifest.version !== 'string') {
      throw new Error(`plugin migration: installed package identity mismatch: ${name}`)
    }
    const peers = recordDependencies(pluginManifest.peerDependencies, `${name} peerDependencies`)
    const peerStatus = classifyPeers(peers, targetPackageVersions)
    copyInputs.push({ name, sourcePackage })
    plugins.push({
      name,
      sourceVersion: pluginManifest.version,
      candidateVersion: pluginManifest.version,
      sourceDependencyKind: dependencies[name]?.startsWith('file:') ? 'local-file' : 'version-range',
      candidateDependencyKind: 'isolated-local-copy',
      ...peerStatus,
    })
  }

  const bundleNames = rawBundles as string[]
  const available = new Set([...Object.keys(dependencies), ...runtimePackages])
  const unavailableBundles = bundleNames.filter(name => !available.has(name))
  const incompatible = new Set(plugins
    .filter(plugin => plugin.compatibility === 'incompatible')
    .map(plugin => plugin.name))
  const inactiveBundles = bundleNames.filter(name => incompatible.has(name))
  const activeBundles = bundleNames.filter(name => !incompatible.has(name))
  const strategyPackagePath = join(candidateBuildRoot, 'package-set', 'desktop-packages', basename(options.strategyPackageFile))
  candidateDependencies[STRATEGY_PACKAGE] = `file:${relative(candidateProfile, strategyPackagePath).split(sep).join('/')}`
  sourceManifest.dependencies = candidateDependencies
  ;(profile as Record<string, unknown>).bundles = activeBundles
  const patchBytes = readFileSync(sourcePatchPath, 'utf8')
  const targetPatch = `${patchBytes.trimEnd()}${carrierPatch()}`
  const report: PluginMigrationReport = {
    schemaVersion: 1,
    sourceProfile,
    candidateProfile,
    plugins,
    bundles: [...bundleNames],
    activeBundles,
    inactiveBundles,
    unavailableBundles,
    strategyCarrier: { package: STRATEGY_PACKAGE, pluginId: STRATEGY_PLUGIN_ID, enabled: true },
    settings: 'copied without values; source remains read-only',
  }

  const stagingRoot = mkdtempSync(join(candidateBuildRoot, '.candidate-profile-'))
  try {
    const stagingProfile = join(stagingRoot, relative(candidateRoot, candidateProfile))
    const stagingPackagesRoot = join(stagingRoot, 'plugin-packages')
    mkdirSync(stagingPackagesRoot, { recursive: true })
    for (const { name, sourcePackage } of copyInputs) {
      const destination = join(candidateRoot, 'plugin-packages', ...packageDirectoryParts(name))
      if (!isWithin(join(candidateRoot, 'plugin-packages'), resolve(destination))) {
        throw new Error(`plugin migration: package path escaped candidate output: ${name}`)
      }
      const stagedDestination = join(stagingRoot, relative(candidateRoot, destination))
      mkdirSync(dirname(stagedDestination), { recursive: true })
      cpSync(sourcePackage, stagedDestination, {
        recursive: true,
        dereference: true,
        filter: path => !relative(sourcePackage, path).split(sep).includes('node_modules'),
      })
      const relativePackage = relative(candidateProfile, destination).split(sep).join('/')
      candidateDependencies[name] = `file:${relativePackage.startsWith('.') ? relativePackage : `./${relativePackage}`}`
    }
    mkdirSync(dirname(stagingProfile), { recursive: true })
    mkdirSync(stagingProfile)
    writeFileSync(join(stagingProfile, 'package.json'), `${JSON.stringify(sourceManifest, undefined, 2)}\n`, { mode: 0o600 })
    writeFileSync(join(stagingProfile, 'cordis.patch.yml'), targetPatch, { mode: 0o600 })
    writeFileSync(join(stagingRoot, 'migration-report.json'), `${JSON.stringify(report, undefined, 2)}\n`, { mode: 0o600 })
    renameSync(stagingRoot, candidateRoot)
  } catch (error) {
    rmSync(stagingRoot, { recursive: true, force: true })
    throw error
  }
  return report
}

function main(): void {
  const paths = resolveDesktopTargetBuildPaths()
  const { values } = parseArgs({ options: { 'source-profile': { type: 'string' } }, allowPositionals: false })
  const sourceProfile = resolve(values['source-profile'] ?? join(process.env.DSH_HOME ?? '', 'profiles', 'desktop'))
  const buildRoot = paths.root
  const candidateRoot = join(buildRoot, 'candidate-profile')
  const candidateProfile = join(candidateRoot, 'profiles', 'desktop')
  let strategyPackageFile = 'dsh-experimental-task-strategy-0.2.1-alpha.1.tgz'
  try {
    const packageSet = readDesktopCorePackageSet(paths.packageSet)
    const strategy = packageSet.packages.find(record => record.name === STRATEGY_PACKAGE)
    if (strategy === undefined) throw new Error(`plugin migration: package set omits ${STRATEGY_PACKAGE}`)
    strategyPackageFile = strategy.file
  } catch (error) {
    if (existsSync(join(paths.packageSet, 'desktop-packages.json'))) throw error
  }
  const report = migratePluginProfile({
    sourceProfile,
    candidateBuildRoot: buildRoot,
    candidateRoot,
    candidateProfile,
    strategyPackageFile,
    targetPackageVersions: workspacePackageVersions(),
    runtimePackages: RUNTIME_BUNDLES,
  })
  console.log(`desktop plugin migration: staged ${report.plugins.length} plugin package(s) at ${candidateProfile}`)
  console.log(`desktop plugin migration: ${report.unavailableBundles.length} bundle(s) unavailable`)
}

if (import.meta.main) main()
