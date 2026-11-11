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

/** `fetch` for the muon serve API, adding the bearer token when set. */
export function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = getApiToken()
  if (!token) return fetch(input, init)
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  return fetch(input, { ...init, headers })
}
