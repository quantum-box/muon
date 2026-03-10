import { type ReactNode, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  Zap,
  FolderOpen,
  List,
  Globe,
  History,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'
import { cn } from '../lib/utils'
import { isTauri, getSettings, saveSettings } from '../lib/tauri-api'
import { useGlobalShortcuts } from '../hooks/use-keyboard-shortcuts'

const navItems = [
  { to: '/projects', label: 'Projects', icon: FolderOpen },
  { to: '/scenarios', label: 'Scenarios', icon: List },
  { to: '/environments', label: 'Environments', icon: Globe },
  { to: '/history', label: 'History', icon: History },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export function Layout({ children }: { children: ReactNode }) {
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(() => getSettings().sidebar_collapsed)

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
    return location.pathname === to || location.pathname.startsWith(to + '/')
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
  return (
    <header className="border-b border-slate-700/50 bg-slate-900/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="px-4 h-11 flex items-center">
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
          API scenario runner
        </span>
      </div>
    </header>
  )
}

function StatusBar() {
  return (
    <div className="h-6 border-t border-slate-700/50 bg-slate-900/80 flex items-center px-3 gap-4 text-[10px] text-slate-600 font-mono">
      <div className="flex items-center gap-1.5">
        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
        {isTauri() ? 'Desktop' : 'Web'}
      </div>
      <div className="flex-1 truncate">muon v0.1.0</div>
    </div>
  )
}
