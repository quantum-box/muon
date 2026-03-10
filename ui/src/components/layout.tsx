import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Zap, List, Settings2 } from 'lucide-react'
import { cn } from '../lib/utils'

export function Layout({ children }: { children: ReactNode }) {
  const location = useLocation()

  const navItems = [
    { to: '/', label: 'Scenarios', icon: List },
    { to: '/environments', label: 'Environments', icon: Settings2 },
  ]

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col">
      <header className="border-b border-slate-700/50 bg-slate-900/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-[1440px] mx-auto px-6 h-14 flex items-center">
          <Link to="/" className="flex items-center gap-2 group">
            <div className="w-7 h-7 rounded-md bg-violet-500/20 flex items-center justify-center group-hover:bg-violet-500/30 transition-colors">
              <Zap className="w-4 h-4 text-violet-400" />
            </div>
            <span className="text-lg font-semibold tracking-tight">
              <span className="text-violet-400">mu</span>
              <span className="text-slate-300">on</span>
            </span>
          </Link>
          <span className="ml-3 text-xs text-slate-600 font-mono">API scenario runner</span>

          <nav className="ml-8 flex items-center gap-1">
            {navItems.map(({ to, label, icon: Icon }) => {
              const isActive = to === '/'
                ? location.pathname === '/' || location.pathname.startsWith('/scenarios')
                : location.pathname.startsWith(to)
              return (
                <Link
                  key={to}
                  to={to}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                    isActive
                      ? 'text-violet-300 bg-violet-500/10'
                      : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/50',
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </Link>
              )
            })}
          </nav>
        </div>
      </header>
      <main className="flex-1">
        {children}
      </main>
    </div>
  )
}
