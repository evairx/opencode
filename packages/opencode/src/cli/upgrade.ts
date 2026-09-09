export async function upgrade() {
  // evairx-1.0 is a pinned fork; it must never contact the upstream release
  // endpoints during startup or through the background server RPC.
  return
}
