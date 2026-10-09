/** Resolve the independent fork's explicitly selected packaging edition. */
export function isPolicyEdition(environment = process.env) {
  const edition = environment.DSH_DESKTOP_EDITION
  if (edition === undefined || edition === '') return false
  if (edition !== 'policy') throw new Error('desktop edition: expected policy or an omitted edition')
  if (environment.DSH_DESKTOP_APP_ID !== 'io.github.sdaniasdsd.dshchange') {
    throw new Error('desktop edition: policy requires its independent application ID')
  }
  return true
}
