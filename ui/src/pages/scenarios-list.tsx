import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, PlayCircle, Loader2, AlertCircle, FolderOpen } from 'lucide-react'
import { useScenarios } from '../hooks/use-scenarios'
import { useProject } from '../contexts/project-context'
import { ScenarioCard } from '../components/scenario-card'
import { cn } from '../lib/utils'

export function ScenariosListPage() {
  const { projectPath, openDirectory } = useProject()
  const { data: scenarios, isLoading, error } = useScenarios(projectPath)
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set())

  const allTags = useMemo(() => {
    if (!scenarios) return []
    const tags = new Set(scenarios.flatMap(s => s.tags))
    return Array.from(tags).sort()
  }, [scenarios])

  const filtered = useMemo(() => {
    if (!scenarios) return []
    return scenarios.filter(s => {
      const matchesSearch = !search ||
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        s.description.toLowerCase().includes(search.toLowerCase())
      const matchesTags = selectedTags.size === 0 ||
        s.tags.some(t => selectedTags.has(t))
      return matchesSearch && matchesTags
    })
  }, [scenarios, search, selectedTags])

  const toggleTag = (tag: string) => {
    setSelectedTags(prev => {
      const next = new Set(prev)
      if (next.has(tag)) next.delete(tag)
      else next.add(tag)
      return next
    })
  }

  const handleRun = (id: string) => {
    navigate(`/scenarios/${id}?autorun=true`)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="w-6 h-6 text-violet-500 animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-3">
        <AlertCircle className="w-8 h-8 text-red-400" />
        <p className="text-sm text-slate-400">Failed to load scenarios</p>
        <p className="text-xs text-slate-600 font-mono">{error.message}</p>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Scenarios</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {scenarios?.length ?? 0} scenario{(scenarios?.length ?? 0) !== 1 ? 's' : ''} loaded
          </p>
        </div>
        {scenarios && scenarios.length > 0 && (
          <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-violet-600 hover:bg-violet-500 text-white transition-colors shadow-sm shadow-violet-500/20">
            <PlayCircle className="w-3.5 h-3.5" />
            Run All
          </button>
        )}
      </div>

      {/* Filters */}
      {scenarios && scenarios.length > 0 && (
        <div className="space-y-3 mb-6">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              placeholder="Search scenarios..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-slate-800/50 border border-slate-700/50 rounded-lg pl-9 pr-4 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20 transition-all"
            />
          </div>

          {/* Tags */}
          {allTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {allTags.map(tag => (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  className={cn(
                    'px-2 py-1 text-xs font-mono rounded-md border transition-colors',
                    selectedTags.has(tag)
                      ? 'bg-violet-500/20 border-violet-500/40 text-violet-300'
                      : 'bg-slate-800/50 border-slate-700/50 text-slate-500 hover:border-slate-600 hover:text-slate-400',
                  )}
                >
                  {tag}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* List */}
      {filtered.length > 0 ? (
        <div className="space-y-2">
          {filtered.map(s => (
            <ScenarioCard key={s.id} scenario={s} onRun={handleRun} isRunning={false} />
          ))}
        </div>
      ) : scenarios && scenarios.length > 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Search className="w-8 h-8 text-slate-700" />
          <p className="text-sm text-slate-500">No scenarios match your filters</p>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 gap-3 border border-dashed border-slate-700/50 rounded-lg">
          <FolderOpen className="w-10 h-10 text-slate-700" />
          <p className="text-sm text-slate-400">
            {projectPath ? 'No scenarios found' : 'No project selected'}
          </p>
          <p className="text-xs text-slate-600">
            {projectPath
              ? 'Place .yaml files in your scenarios directory'
              : 'Open a project folder to get started'}
          </p>
          {!projectPath && (
            <button
              onClick={openDirectory}
              className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-violet-600 hover:bg-violet-500 text-white transition-colors"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              Open Project
            </button>
          )}
        </div>
      )}
    </div>
  )
}
