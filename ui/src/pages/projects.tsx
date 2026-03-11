import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  FolderOpen,
  Plus,
  Star,
  Clock,
  Search,
  MoreVertical,
  Trash2,
  FileText,
  X,
} from 'lucide-react'
import { cn, formatTimestamp } from '../lib/utils'
import {
  type Project,
  getProjects,
  addProject,
  removeProject,
  togglePinProject,
  openProjectDialog,
  tauriOpenProject,
  tauriCreateProject,
  isTauri,
} from '../lib/tauri-api'
import { useProject } from '../contexts/project-context'

export function ProjectsPage() {
  const navigate = useNavigate()
  const { setProjectPath } = useProject()
  const [projects, setProjects] = useState<Project[]>(getProjects)
  const [search, setSearch] = useState('')
  const [menuOpen, setMenuOpen] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    const matched = projects.filter(
      (p) => p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q),
    )
    // Pinned first, then by last_opened
    return matched.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1
      if (!a.pinned && b.pinned) return 1
      return new Date(b.last_opened).getTime() - new Date(a.last_opened).getTime()
    })
  }, [projects, search])

  async function handleOpenProject() {
    if (isTauri()) {
      const path = await openProjectDialog()
      if (!path) return
      const info = await tauriOpenProject(path)
      const updated = addProject({
        name: info.name,
        path,
        scenario_count: info.scenario_count,
        last_opened: new Date().toISOString(),
        pinned: false,
      })
      setProjects(updated)
      setProjectPath(path)
      navigate('/scenarios')
    }
  }

  async function handleNewProject() {
    if (isTauri()) {
      const path = await openProjectDialog()
      if (!path) return
      const info = await tauriCreateProject(path)
      const updated = addProject({
        name: info.name,
        path: info.path,
        scenario_count: 0,
        last_opened: new Date().toISOString(),
        pinned: false,
      })
      setProjects(updated)
      setProjectPath(info.path)
      navigate('/scenarios')
    }
  }

  function handleRemove(path: string) {
    const updated = removeProject(path)
    setProjects(updated)
    setMenuOpen(null)
  }

  function handleTogglePin(path: string) {
    const updated = togglePinProject(path)
    setProjects(updated)
    setMenuOpen(null)
  }

  function handleSelectProject(project: Project) {
    setProjectPath(project.path)
    navigate('/scenarios')
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Projects</h1>
          <p className="text-sm text-slate-500 mt-1">
            Manage your muon test projects
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleNewProject}
            className="flex items-center gap-2 px-3 py-2 rounded-md border border-slate-700/50 text-sm text-slate-300 hover:bg-slate-800/50 transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Project
          </button>
          <button
            onClick={handleOpenProject}
            className="flex items-center gap-2 px-3 py-2 rounded-md bg-violet-600 text-sm text-white hover:bg-violet-500 transition-colors"
          >
            <FolderOpen className="w-4 h-4" />
            Open Project
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        <input
          type="text"
          placeholder="Search projects..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-8 py-2 bg-slate-800/50 border border-slate-700/50 rounded-md text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-violet-500/50"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Project Grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <FolderOpen className="w-12 h-12 text-slate-700 mx-auto mb-4" />
          <h3 className="text-sm font-medium text-slate-400 mb-1">
            {search ? 'No matching projects' : 'No projects yet'}
          </h3>
          <p className="text-xs text-slate-600 mb-4">
            {search
              ? 'Try a different search term'
              : 'Open an existing project folder or create a new one'}
          </p>
          {!search && (
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={handleOpenProject}
                className="text-xs text-violet-400 hover:text-violet-300"
              >
                Open Project
              </button>
              <span className="text-slate-700">or</span>
              <button
                onClick={handleNewProject}
                className="text-xs text-violet-400 hover:text-violet-300"
              >
                Create New
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((project) => (
            <div
              key={project.path}
              className="group relative border border-slate-700/50 rounded-lg bg-slate-800/30 hover:bg-slate-800/50 hover:border-slate-600/50 transition-all cursor-pointer"
              onClick={() => handleSelectProject(project)}
            >
              <div className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <FolderOpen className="w-4 h-4 text-violet-400 flex-shrink-0" />
                    <span className="text-sm font-medium text-slate-200 truncate">
                      {project.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    {project.pinned && (
                      <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setMenuOpen(menuOpen === project.path ? null : project.path)
                      }}
                      className="p-1 rounded hover:bg-slate-700/50 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <MoreVertical className="w-3.5 h-3.5 text-slate-500" />
                    </button>
                  </div>
                </div>

                <div className="text-xs text-slate-600 font-mono truncate mb-3">
                  {project.path}
                </div>

                <div className="flex items-center justify-between text-xs text-slate-500">
                  <div className="flex items-center gap-1">
                    <FileText className="w-3 h-3" />
                    {project.scenario_count} scenarios
                  </div>
                  <div className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatTimestamp(project.last_opened)}
                  </div>
                </div>
              </div>

              {/* Context menu */}
              {menuOpen === project.path && (
                <div className="absolute right-2 top-10 z-10 w-40 bg-slate-800 border border-slate-700 rounded-md shadow-lg py-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleTogglePin(project.path)
                    }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700/50"
                  >
                    <Star className={cn('w-3 h-3', project.pinned && 'fill-amber-400 text-amber-400')} />
                    {project.pinned ? 'Unpin' : 'Pin to top'}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleRemove(project.path)
                    }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-slate-700/50"
                  >
                    <Trash2 className="w-3 h-3" />
                    Remove
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
