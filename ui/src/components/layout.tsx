import {
  Check,
  ChevronDown,
  FolderOpen,
  Globe,
  History,
  Library,
  List,
  PanelLeftClose,
  PanelLeftOpen,
  Send,
  Settings,
  Wand2,
  X,
  Zap,
} from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useProject } from '../contexts/project-context'
import { useEnvironments } from '../hooks/use-environments'
import { useGlobalShortcuts } from '../hooks/use-keyboard-shortcuts'
import { getSettings, isTauri, saveSettings } from '../lib/tauri-api'
import { cn } from '../lib/utils'

const navItems = [
  { to: '/projects', label: 'Projects', icon: FolderOpen },
  { to: '/scenarios', label: 'Scenarios', icon: List },
  { to: '/collections', label: 'Collections', icon: Library },
  { to: '/request', label: 'API Client', icon: Send },
  { to: '/generate', label: 'Generator', icon: Wand2 },
  { to: '/environments', label: 'Environments', icon: Globe },
  { to: '/history', label: 'History', icon: History },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export function Layout({ children }: { children: ReactNode }) {
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(
    () => getSettings().sidebar_collapsed,
  )

  useGlobalShortcuts()

  function toggleCollapse() {
    const next = !collapsed
    setCollapsed(next)
    const s = getSettings()
    saveSettings({ ...s, sidebar_collapsed: next })
  }

  function isActive(to: string) {
    if (to === '/scenarios') {
      return (
        location.pathname === '/scenarios' ||
        location.pathname.startsWith('/scenarios/')
      )
    }
    return location.pathname === to || location.pathname.startsWith(`${to}/`)
  }

  // Welcome page gets a minimal layout (no sidebar)
  const isWelcome = location.pathname === '/'
  if (isWelcome) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col">
        <Header />
        <main className="flex-1">{children}</main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside
          className={cn(
            'flex flex-col border-r border-slate-700/50 bg-slate-900/80 transition-all duration-200',
            collapsed ? 'w-12' : 'w-48',
          )}
        >
          <nav className="flex-1 py-2 space-y-0.5 px-1.5">
            {navItems.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                title={collapsed ? label : undefined}
                className={cn(
                  'flex items-center gap-2.5 rounded-md text-xs font-medium transition-colors',
                  collapsed ? 'justify-center px-2 py-2' : 'px-3 py-2',
                  isActive(to)
                    ? 'text-violet-300 bg-violet-500/10'
                    : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/50',
                )}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                {!collapsed && <span>{label}</span>}
              </Link>
            ))}
          </nav>

          {/* Collapse toggle */}
          <button
            onClick={toggleCollapse}
            className="flex items-center justify-center p-2 mx-1.5 mb-2 rounded-md text-slate-600 hover:text-slate-400 hover:bg-slate-800/50 transition-colors"
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? (
              <PanelLeftOpen className="w-4 h-4" />
            ) : (
              <PanelLeftClose className="w-4 h-4" />
            )}
          </button>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-auto">{children}</main>
      </div>

      {/* Status bar */}
      <StatusBar />
    </div>
  )
}

function Header() {
  const { projectPath, openDirectory } = useProject()
  const projectName = projectPath?.split('/').pop() ?? null

  return (
    <header className="border-b border-slate-700/50 bg-slate-900/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="px-4 h-11 flex items-center justify-between">
        <div className="flex items-center">
          <Link to="/" className="flex items-center gap-2 group">
            <div className="w-6 h-6 rounded-md bg-violet-500/20 flex items-center justify-center group-hover:bg-violet-500/30 transition-colors">
              <Zap className="w-3.5 h-3.5 text-violet-400" />
            </div>
            <span className="text-sm font-semibold tracking-tight">
              <span className="text-violet-400">mu</span>
              <span className="text-slate-300">on</span>
            </span>
          </Link>
          <span className="ml-2 text-[10px] text-slate-600 font-mono">
            desktop API client
          </span>
        </div>

        <div className="flex items-center gap-2">
          <EnvironmentSwitcher />

          {/* Project selector */}
          <button
            onClick={openDirectory}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 transition-colors"
            title={projectPath ?? 'Open project folder'}
          >
            <FolderOpen className="w-3.5 h-3.5" />
            <span className="max-w-[200px] truncate">
              {projectName ?? 'Open Project'}
            </span>
          </button>
        </div>
      </div>
    </header>
  )
}

function EnvironmentSwitcher() {
  const { environments, activeId, activeEnvironment, setActive } =
    useEnvironments()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
          activeEnvironment
            ? 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
            : 'bg-slate-800/50 text-slate-500 hover:text-slate-400 hover:bg-slate-800',
        )}
      >
        <Globe className="w-3 h-3" />
        <span className="max-w-[120px] truncate">
          {activeEnvironment?.name ?? 'No Environment'}
        </span>
        <ChevronDown className="w-3 h-3" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-56 bg-slate-800 border border-slate-700 rounded-lg shadow-2xl overflow-hidden z-50">
          <div className="px-3 py-2 border-b border-slate-700/50">
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
              Environment
            </p>
          </div>
          <div className="py-1 max-h-64 overflow-y-auto">
            {/* No environment option */}
            <button
              onClick={() => {
                setActive(null)
                setOpen(false)
              }}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors',
                !activeId
                  ? 'text-emerald-400 bg-emerald-500/10'
                  : 'text-slate-400 hover:text-slate-300 hover:bg-slate-800/50',
              )}
            >
              <X className="w-3 h-3" />
              <span>No Environment</span>
              {!activeId && <Check className="w-3 h-3 ml-auto" />}
            </button>

            {environments.map(env => (
              <button
                key={env.id}
                onClick={() => {
                  setActive(env.id)
                  setOpen(false)
                }}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors',
                  activeId === env.id
                    ? 'text-emerald-400 bg-emerald-500/10'
                    : 'text-slate-400 hover:text-slate-300 hover:bg-slate-800/50',
                )}
              >
                <Globe className="w-3 h-3" />
                <span className="truncate">{env.name}</span>
                <span className="ml-auto text-[10px] text-slate-600">
                  {env.variables.filter(v => v.enabled).length} vars
                </span>
                {activeId === env.id && (
                  <Check className="w-3 h-3 text-emerald-400" />
                )}
              </button>
            ))}

            {environments.length === 0 && (
              <div className="px-3 py-4 text-center">
                <p className="text-[10px] text-slate-600">
                  No environments yet
                </p>
              </div>
            )}
          </div>
          <div className="border-t border-slate-700/50">
            <Link
              to="/environments"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-2 text-xs text-slate-500 hover:text-violet-400 hover:bg-slate-800/50 transition-colors"
            >
              <Settings className="w-3 h-3" />
              Manage Environments
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}

function StatusBar() {
  const { projectPath } = useProject()
  const { activeEnvironment } = useEnvironments()

  return (
    <div className="h-6 border-t border-slate-700/50 bg-slate-900/80 flex items-center px-3 gap-4 text-[10px] text-slate-600 font-mono">
      <div className="flex items-center gap-1.5">
        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
        {isTauri() ? 'Desktop' : 'Web'}
      </div>
      {activeEnvironment && (
        <div className="flex items-center gap-1.5 text-emerald-500">
          <Globe className="w-3 h-3" />
          {activeEnvironment.name}
        </div>
      )}
      {projectPath && (
        <div className="flex items-center gap-1.5 truncate" title={projectPath}>
          <FolderOpen className="w-3 h-3 flex-shrink-0" />
          <span className="truncate">{projectPath}</span>
        </div>
      )}
      <div className="flex-1" />
      <div>muon v0.3.2</div>
    </div>
  )
}
