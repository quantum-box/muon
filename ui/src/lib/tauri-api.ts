// Tauri-aware API layer
// Detects Tauri runtime vs browser and routes calls accordingly

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown
  }
}

export function isTauri(): boolean {
  return typeof window !== 'undefined' && window.__TAURI_INTERNALS__ != null
}

type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>

let _invoke: InvokeFn | null = null

async function getInvoke(): Promise<InvokeFn> {
  if (_invoke) return _invoke
  if (!isTauri()) {
    throw new Error('Tauri invoke is not available in browser mode')
  }
  const { invoke } = await import('@tauri-apps/api/core')
  _invoke = invoke as InvokeFn
  return _invoke
}

// --- Project management (Tauri-only, localStorage fallback) ---

export interface Project {
  name: string
  path: string
  scenario_count: number
  last_opened: string
  pinned: boolean
}

const PROJECTS_KEY = 'muon_projects'

export function getProjects(): Project[] {
  try {
    const raw = localStorage.getItem(PROJECTS_KEY)
    return raw ? (JSON.parse(raw) as Project[]) : []
  } catch {
    return []
  }
}

export function saveProjects(projects: Project[]): void {
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects))
}

export function addProject(project: Project): Project[] {
  const projects = getProjects().filter((p) => p.path !== project.path)
  projects.unshift(project)
  saveProjects(projects)
  return projects
}

export function removeProject(path: string): Project[] {
  const projects = getProjects().filter((p) => p.path !== path)
  saveProjects(projects)
  return projects
}

export function togglePinProject(path: string): Project[] {
  const projects = getProjects().map((p) =>
    p.path === path ? { ...p, pinned: !p.pinned } : p,
  )
  saveProjects(projects)
  return projects
}

// --- Tauri dialog wrappers ---

export async function openProjectDialog(): Promise<string | null> {
  if (!isTauri()) return null
  const { open } = await import('@tauri-apps/plugin-dialog')
  const selected = await open({ directory: true, title: 'Open Project' })
  return typeof selected === 'string' ? selected : null
}

// --- Tauri IPC commands (with browser fallback) ---

export async function tauriImportPostman(
  data: string,
): Promise<{ scenarios: unknown[] }> {
  if (isTauri()) {
    const invoke = await getInvoke()
    return invoke('import_postman', { data })
  }
  const res = await fetch('/api/import/postman', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  })
  if (!res.ok) throw new Error(`Import failed: ${res.status}`)
  return res.json()
}

export async function tauriImportCurl(
  curl: string,
): Promise<{ scenarios: unknown[] }> {
  if (isTauri()) {
    const invoke = await getInvoke()
    return invoke('import_curl', { curl })
  }
  const res = await fetch('/api/import/curl', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ curl }),
  })
  if (!res.ok) throw new Error(`Import failed: ${res.status}`)
  return res.json()
}

export async function tauriImportOpenapi(
  source: string,
): Promise<{ scenarios: unknown[] }> {
  if (isTauri()) {
    const invoke = await getInvoke()
    return invoke('import_openapi', { source })
  }
  const res = await fetch('/api/import/openapi', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source }),
  })
  if (!res.ok) throw new Error(`Import failed: ${res.status}`)
  return res.json()
}

export async function tauriCreateProject(
  path: string,
): Promise<{ name: string; path: string }> {
  if (isTauri()) {
    const invoke = await getInvoke()
    return invoke('create_project', { path })
  }
  return { name: path.split('/').pop() ?? 'New Project', path }
}

export async function tauriOpenProject(
  path: string,
): Promise<{ name: string; scenario_count: number }> {
  if (isTauri()) {
    const invoke = await getInvoke()
    return invoke('open_project', { path })
  }
  return { name: path.split('/').pop() ?? 'Project', scenario_count: 0 }
}

// --- Run history (localStorage for browser, SQLite via Tauri) ---

export interface RunHistoryItem {
  id: string
  scenario_id: string
  scenario_name: string
  status: 'passed' | 'failed' | 'error'
  duration_ms: number
  step_count: number
  steps_passed: number
  timestamp: string
}

const HISTORY_KEY = 'muon_run_history'

export function getRunHistory(): RunHistoryItem[] {
  if (isTauri()) {
    // In Tauri mode, history comes from SQLite via IPC
    // For now, fall back to localStorage
  }
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    return raw ? (JSON.parse(raw) as RunHistoryItem[]) : []
  } catch {
    return []
  }
}

export function addRunHistory(entry: RunHistoryItem): void {
  const history = getRunHistory()
  history.unshift(entry)
  // Keep last 500 entries
  if (history.length > 500) history.length = 500
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history))
}

export function clearRunHistory(): void {
  localStorage.removeItem(HISTORY_KEY)
}

// --- Settings (localStorage) ---

export interface AppSettings {
  theme: 'dark' | 'light'
  default_timeout: number
  default_headers: Record<string, string>
  sidebar_collapsed: boolean
}

const SETTINGS_KEY = 'muon_settings'

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  default_timeout: 30,
  default_headers: {},
  sidebar_collapsed: false,
}

export function getSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}
