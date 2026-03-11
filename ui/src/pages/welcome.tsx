import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Zap,
  FolderOpen,
  Plus,
  FileDown,
  Terminal,
  Clock,
  BookOpen,
  Keyboard,
  ArrowRight,
} from 'lucide-react'
import { cn } from '../lib/utils'
import { type Project, getProjects, openProjectDialog, addProject, tauriOpenProject, isTauri } from '../lib/tauri-api'
import { useProject } from '../contexts/project-context'
import { ImportDialog } from '../components/import-dialog'
import { SHORTCUT_REFERENCE } from '../hooks/use-keyboard-shortcuts'

export function WelcomePage() {
  const navigate = useNavigate()
  const { setProjectPath } = useProject()
  const [recentProjects] = useState<Project[]>(() => getProjects().slice(0, 5))
  const [importOpen, setImportOpen] = useState(false)

  async function handleOpenProject() {
    if (isTauri()) {
      const path = await openProjectDialog()
      if (path) {
        const info = await tauriOpenProject(path)
        addProject({
          name: info.name,
          path,
          scenario_count: info.scenario_count,
          last_opened: new Date().toISOString(),
          pinned: false,
        })
        setProjectPath(path)
        navigate('/scenarios')
      }
    } else {
      navigate('/projects')
    }
  }

  function handleSelectRecentProject(project: Project) {
    setProjectPath(project.path)
    navigate('/scenarios')
  }

  const quickActions = [
    {
      icon: FolderOpen,
      label: 'Open Project',
      description: 'Open an existing project folder',
      onClick: handleOpenProject,
      color: 'violet',
    },
    {
      icon: Plus,
      label: 'New Project',
      description: 'Create a new muon project',
      onClick: () => navigate('/projects'),
      color: 'emerald',
    },
    {
      icon: FileDown,
      label: 'Import Collection',
      description: 'Import from Postman, cURL, or OpenAPI',
      onClick: () => setImportOpen(true),
      color: 'blue',
    },
    {
      icon: Terminal,
      label: 'View Scenarios',
      description: 'Browse existing scenarios',
      onClick: () => navigate('/scenarios'),
      color: 'amber',
    },
  ] as const

  const colorMap = {
    violet: 'bg-violet-500/10 text-violet-400 group-hover:bg-violet-500/20',
    emerald: 'bg-emerald-500/10 text-emerald-400 group-hover:bg-emerald-500/20',
    blue: 'bg-blue-500/10 text-blue-400 group-hover:bg-blue-500/20',
    amber: 'bg-amber-500/10 text-amber-400 group-hover:bg-amber-500/20',
  }

  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex items-center justify-center p-8">
      <div className="max-w-3xl w-full space-y-10">
        {/* Hero */}
        <div className="text-center space-y-4">
          <div className="inline-flex items-center gap-3 mb-2">
            <div className="w-12 h-12 rounded-xl bg-violet-500/20 flex items-center justify-center">
              <Zap className="w-7 h-7 text-violet-400" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-slate-100">
            Welcome to <span className="text-violet-400">muon</span>
          </h1>
          <p className="text-slate-400 text-lg max-w-md mx-auto">
            Declarative API scenario testing, powered by YAML
          </p>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-2 gap-3">
          {quickActions.map(({ icon: Icon, label, description, onClick, color }) => (
            <button
              key={label}
              onClick={onClick}
              className="group flex items-start gap-3 p-4 rounded-lg border border-slate-700/50 bg-slate-800/30 hover:bg-slate-800/60 hover:border-slate-600/50 transition-all text-left"
            >
              <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors', colorMap[color])}>
                <Icon className="w-5 h-5" />
              </div>
              <div>
                <div className="text-sm font-medium text-slate-200">{label}</div>
                <div className="text-xs text-slate-500 mt-0.5">{description}</div>
              </div>
            </button>
          ))}
        </div>

        {/* Recent Projects */}
        {recentProjects.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium text-slate-400 flex items-center gap-2">
                <Clock className="w-3.5 h-3.5" />
                Recent Projects
              </h2>
              <Link to="/projects" className="text-xs text-violet-400 hover:text-violet-300 flex items-center gap-1">
                View all <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
            <div className="space-y-1">
              {recentProjects.map((project) => (
                <button
                  key={project.path}
                  onClick={() => handleSelectRecentProject(project)}
                  className="w-full flex items-center justify-between p-2.5 rounded-md hover:bg-slate-800/50 transition-colors text-left group"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <FolderOpen className="w-4 h-4 text-slate-500 flex-shrink-0" />
                    <div className="min-w-0">
                      <div className="text-sm text-slate-300 truncate">{project.name}</div>
                      <div className="text-xs text-slate-600 truncate font-mono">{project.path}</div>
                    </div>
                  </div>
                  <div className="text-xs text-slate-600 flex-shrink-0">
                    {project.scenario_count} scenarios
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Footer links */}
        <div className="flex items-center justify-center gap-6 text-xs text-slate-600 pt-4 border-t border-slate-800/50">
          <a
            href="https://github.com/quantum-box/muon"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 hover:text-slate-400 transition-colors"
          >
            <BookOpen className="w-3.5 h-3.5" />
            Documentation
          </a>
          <button
            onClick={() => navigate('/settings')}
            className="flex items-center gap-1.5 hover:text-slate-400 transition-colors"
          >
            <Keyboard className="w-3.5 h-3.5" />
            Shortcuts
          </button>
          <div className="flex items-center gap-1">
            {SHORTCUT_REFERENCE.slice(0, 3).map((s) => (
              <span key={s.key} className="px-1.5 py-0.5 rounded bg-slate-800/50 font-mono">
                {s.key}
              </span>
            ))}
          </div>
        </div>
      </div>

      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  )
}
