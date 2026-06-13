// Probe a URL for readiness: resolves true if it responds below 500 within the
// timeout, false on error/timeout. Used to wait for iframe targets to come up.
export async function pollUrl(url: string, timeoutMs = 5000): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
    const response = await fetch(url, { cache: 'no-store', signal: controller.signal })
    clearTimeout(timeoutId)
    return response.status < 500
  } catch {
    return false
  }
}
