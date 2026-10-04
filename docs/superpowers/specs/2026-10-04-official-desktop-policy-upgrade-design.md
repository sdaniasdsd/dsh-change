# Official Desktop and Task Strategy Upgrade Design

English | [中文](2026-10-04-official-desktop-policy-upgrade-design.zh.md)

## Goal

Build a Windows x64 Desktop development baseline from the official `dsh-v0.2.1-alpha.1` prerelease, while carrying forward the existing independent Task Strategy capability and the user's current DSH plugins. The official release remains authoritative for the Desktop shell, DSH runtime, built-in bundles, plugin manager, and all upstream behavior. The resulting Desktop build is the candidate future development and daily-use version; it does not replace the existing installation or profile until the user has tried it.

The accepted upstream source is tag `dsh-v0.2.1-alpha.1`, commit `5badb15009ae1756c3afe0ae0cef1faafc290ccc`. This is a prerelease, so the build and handoff must identify it as such rather than imply it is a stable release.

## Component boundary

Task Strategy remains an author decision/policy component, not a DSH plugin registry or a plugin-management feature. It chooses a named strategy, derives an ordered execution plan, and records the progress of delegated work. The original DSH jobs, agents, subagents, tools, and execution lifecycle continue to perform the concrete tasks.

The existing optional Cordis carrier is only the adapter that exposes the independent strategy library to DSH. Keep the library and carrier as separate exports and keep the adapter explicitly opt-in in the Desktop profile. Do not turn author strategies into plugin rows or silently change the default execution path. Preserve the one-shot agent-preset override behavior where it can be adapted to the current upstream subagent API without changing child permissions or lifecycle semantics.

## Migration approach

Start from the exact official release tree and port the feature selectively. Do not merge the old branch wholesale, reset the existing main branch, or copy old package/catalog snapshots over upstream files. Upstream Desktop, Web, plugin, runtime, and generated catalog changes win. Reconcile the intersecting strategy/subagent code against current upstream APIs, then regenerate derived catalogs and paired documentation from their owning sources.

Carry forward the independent `@deepseek-ai/dsh-experimental-task-strategy` package, its tests, examples, and documentation, adapting peer dependencies and API types to the release. Preserve strategy registry validation, bounded ordered-stage execution, author preference variants, progress visibility through original jobs, and the separate Cordis entry point. Keep the upstream subagent implementation as the base and reapply only the minimal optional preset-selection extension needed by Task Strategy.

Inventory the current DSH plugins before migration. Preserve plugin package identity/version, dependencies, bundle ordering, and user-authored profile patches where compatible with the new runtime. Do not copy generated `node_modules`, caches, runtime binaries, or stale lockfiles. Report incompatible or unavailable plugins instead of silently dropping, upgrading, or disabling them. Treat the existing profile as read-only during build and retain it as the rollback source; stage the migrated profile separately for the candidate Desktop.

## Desktop integration and opt-in

Add the strategy package and its workspace dependency closure to the Desktop-produced local package set so the installed Desktop can resolve it without relying on a registry. Keep the official package-set integrity validation and lockfile guarantees intact. The Desktop project metadata may include the package as a dependency, while the Desktop profile's ordered bundles and Cordis patch remain the explicit activation controls.

The candidate profile must contain an opt-in patch entry for the strategy carrier and author-provided strategy configuration. Existing plugin bundles retain their order unless dependency/API compatibility requires a documented change. Do not edit the user's active Desktop profile or global DSH home as a side effect of compiling the candidate.

## Build and acceptance

Produce an unsigned Windows x64 package using the official Desktop packaging workflow; no signing certificate has been requested. The artifact must identify the upstream prerelease version and the carried-forward strategy revision. Keep package output and build caches inside the isolated worktree's ignored Desktop build directory.

Before handoff, verify the migration with focused checks for the strategy library/carrier and subagent integration, then run the official Windows x64 packaging pipeline. Start the resulting candidate in an isolated profile and confirm that the Desktop Host and frontend launch, the strategy service is opt-in and discoverable when enabled, a strategy can create and execute an ordered plan through original DSH jobs, progress is visible, and migrated compatible plugins load. Record failed checks and plugin compatibility exceptions in the handoff rather than presenting an unverified build as complete.

## Rollout and safeguards

Keep the user's existing checkout, branch, app installation, and DSH home unchanged during migration. Work on a branch based on the exact upstream tag. The candidate package and isolated profile are for user evaluation; only after the user confirms it works should the future development baseline or daily-use installation be switched. Preserve the prior source ref and profile for rollback.

Do not publish either mirror, create a release, or replace an installed app as part of this migration unless separately requested. If the latest upstream API makes a requested strategy behavior incompatible with preserving DSH lifecycle semantics, stop at that boundary and report the concrete conflict for a product decision.
