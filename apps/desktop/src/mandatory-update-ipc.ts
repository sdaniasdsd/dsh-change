/** Dependency-free names and arguments shared with the sandboxed mandatory-update preload. */
/** Renderer argument used by editions without a mandatory-update service. */
export const MANDATORY_UPDATE_DISABLED_ARGUMENT = '--dsh-mandatory-update-disabled'

/** Channels serving configured mandatory-update status and actions. */
export const MANDATORY_IPC = {
  status: 'dsh-desktop:mandatory-status', state: 'dsh-desktop:mandatory-state', action: 'dsh-desktop:mandatory-action',
} as const
