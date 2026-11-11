const SETTINGS_KEY = 'muon_settings'

/** API token saved in Settings, used when `muon serve` requires one. */
export function getApiToken(): string {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    const token = raw ? (JSON.parse(raw) as { api_token?: unknown }).api_token : ''
    return typeof token === 'string' ? token : ''
  } catch {
    return ''
  }
}

/** Send the browser to the server's Tachyon login, then back here. */
function goToLogin(loginUrl: string): void {
  if (!loginUrl.startsWith('/') || loginUrl.startsWith('//')) return
  const back = `${window.location.pathname}${window.location.search}`
  window.location.assign(`${loginUrl}?return_to=${encodeURIComponent(back)}`)
}

/**
 * `fetch` for the muon serve API. Adds the bearer token when one is set,
 * and redirects to Tachyon login when the server answers that a login
 * session is required.
 */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = getApiToken()
  let request = init
  if (token) {
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${token}`)
    request = { ...init, headers }
  }
  const response = await fetch(input, request)
  if (response.status === 401) {
    try {
      const body = (await response.clone().json()) as { login_url?: unknown }
      if (typeof body.login_url === 'string') goToLogin(body.login_url)
    } catch {
      // Not a login-required answer.
    }
  }
  return response
}

export interface SignedInUser {
  sub: string
  email?: string
}

/** The Tachyon user of the current session, or `null` when login is off or signed out. */
export async function fetchSignedInUser(): Promise<SignedInUser | null> {
  try {
    const response = await fetch('/.tachyon/auth/me')
    if (!response.ok) return null
    return (await response.json()) as SignedInUser
  } catch {
    return null
  }
}

/** End the Tachyon login session. */
export async function logout(): Promise<void> {
  await fetch('/.tachyon/auth/logout', { method: 'POST' })
  window.location.assign('/')
}
