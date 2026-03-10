import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Zap } from 'lucide-react'

export function Layout({ children }: { children: ReactNode }) {
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
        </div>
      </header>
      <main className="flex-1">
        {children}
      </main>
    </div>
  )
}
