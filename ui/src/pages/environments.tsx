import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus,
  Trash2,
  Save,
  Eye,
  EyeOff,
  Loader2,
  AlertCircle,
  Settings2,
  X,
} from 'lucide-react'
import {
  listEnvironments,
  getEnvironment,
  updateEnvironment,
  deleteEnvironment,
} from '../lib/api'
import { cn } from '../lib/utils'
import type { Environment, EnvironmentListItem } from '../lib/types'

export function EnvironmentsPage() {
  const queryClient = useQueryClient()
  const [selectedEnv, setSelectedEnv] = useState<string | null>(null)
  const [showNewEnvDialog, setShowNewEnvDialog] = useState(false)
  const [newEnvName, setNewEnvName] = useState('')
  const [editingVars, setEditingVars] = useState<Record<string, string>>({})
  const [newVarKey, setNewVarKey] = useState('')
  const [newVarValue, setNewVarValue] = useState('')
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set())
  const [isDirty, setIsDirty] = useState(false)

  const { data: environments = [], isLoading: isLoadingList } = useQuery({
    queryKey: ['environments'],
    queryFn: listEnvironments,
  })

  const { data: envDetail, isLoading: isLoadingDetail } = useQuery({
    queryKey: ['environment', selectedEnv],
    queryFn: () => getEnvironment(selectedEnv!),
    enabled: !!selectedEnv,
  })

  const saveMutation = useMutation({
    mutationFn: (data: { name: string; variables: Record<string, string> }) =>
      updateEnvironment(data.name, { variables: data.variables }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['environments'] })
      queryClient.invalidateQueries({ queryKey: ['environment', selectedEnv] })
      setIsDirty(false)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteEnvironment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['environments'] })
      setSelectedEnv(null)
    },
  })

  const createMutation = useMutation({
    mutationFn: (name: string) =>
      updateEnvironment(name, { variables: {} }),
    onSuccess: (_, name) => {
      queryClient.invalidateQueries({ queryKey: ['environments'] })
      setSelectedEnv(name)
      setShowNewEnvDialog(false)
      setNewEnvName('')
    },
  })

  // Initialize editing vars when env loads
  const initVars = useCallback((env: Environment) => {
    setEditingVars({ ...env.variables })
    setIsDirty(false)
    setRevealedKeys(new Set())
  }, [])

  // When env detail loads, sync editing state
  if (envDetail && !isDirty && JSON.stringify(editingVars) !== JSON.stringify(envDetail.variables)) {
    initVars(envDetail)
  }

  function isSensitive(key: string): boolean {
    const lower = key.toLowerCase()
    return (
      lower.includes('secret') ||
      lower.includes('password') ||
      lower.includes('token') ||
      lower.includes('key') ||
      lower.includes('auth')
    )
  }

  function toggleReveal(key: string) {
    setRevealedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function handleVarChange(key: string, value: string) {
    setEditingVars((prev) => ({ ...prev, [key]: value }))
    setIsDirty(true)
  }

  function handleDeleteVar(key: string) {
    setEditingVars((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
    setIsDirty(true)
  }

  function handleAddVar() {
    if (!newVarKey.trim()) return
    setEditingVars((prev) => ({ ...prev, [newVarKey]: newVarValue }))
    setNewVarKey('')
    setNewVarValue('')
    setIsDirty(true)
  }

  function handleSave() {
    if (!selectedEnv) return
    saveMutation.mutate({ name: selectedEnv, variables: editingVars })
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      {/* Header */}
      <div className="border-b border-slate-700/50 bg-slate-800/30 px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Settings2 className="w-4 h-4 text-violet-400" />
          <h1 className="text-sm font-semibold text-slate-200">Environments</h1>
        </div>
        <button
          onClick={() => setShowNewEnvDialog(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-violet-600 hover:bg-violet-500 text-white transition-colors"
        >
          <Plus className="w-3 h-3" />
          New Environment
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar: environment list */}
        <div className="w-56 border-r border-slate-700/50 overflow-y-auto shrink-0">
          {isLoadingList ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-5 h-5 text-violet-500 animate-spin" />
            </div>
          ) : environments.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-xs text-slate-500">No environments</p>
              <p className="text-[10px] text-slate-600 mt-1">Create one to get started</p>
            </div>
          ) : (
            <div className="py-2">
              {environments.map((env: EnvironmentListItem) => (
                <button
                  key={env.name}
                  onClick={() => setSelectedEnv(env.name)}
                  className={cn(
                    'w-full text-left px-4 py-2.5 text-xs transition-colors',
                    selectedEnv === env.name
                      ? 'bg-violet-500/10 text-violet-300 border-r-2 border-violet-500'
                      : 'text-slate-400 hover:text-slate-300 hover:bg-slate-800/50',
                  )}
                >
                  <div className="font-medium">{env.name}</div>
                  <div className="text-[10px] text-slate-600 mt-0.5">
                    {env.variable_count} variable{env.variable_count !== 1 ? 's' : ''}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Main: variable editor */}
        <div className="flex-1 overflow-auto">
          {!selectedEnv ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-600 gap-2">
              <Settings2 className="w-8 h-8 text-slate-700" />
              <p className="text-sm">Select an environment</p>
              <p className="text-xs">or create a new one to manage variables</p>
            </div>
          ) : isLoadingDetail ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-5 h-5 text-violet-500 animate-spin" />
            </div>
          ) : (
            <div className="p-6">
              {/* Env header */}
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-lg font-semibold text-slate-200">{selectedEnv}</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {Object.keys(editingVars).length} variable{Object.keys(editingVars).length !== 1 ? 's' : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {isDirty && (
                    <span className="text-[10px] text-amber-400 font-medium">Unsaved changes</span>
                  )}
                  <button
                    onClick={handleSave}
                    disabled={!isDirty || saveMutation.isPending}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                      isDirty
                        ? 'bg-violet-600 hover:bg-violet-500 text-white'
                        : 'bg-slate-700 text-slate-500 cursor-not-allowed',
                    )}
                  >
                    {saveMutation.isPending ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Save className="w-3 h-3" />
                    )}
                    Save
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`Delete environment "${selectedEnv}"?`)) {
                        deleteMutation.mutate(selectedEnv)
                      }
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                    Delete
                  </button>
                </div>
              </div>

              {/* Variables table */}
              <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-700/50">
                      <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider w-1/3">
                        Variable
                      </th>
                      <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                        Value
                      </th>
                      <th className="w-20" />
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(editingVars).map(([key, value]) => (
                      <tr key={key} className="border-b border-slate-700/30 group">
                        <td className="px-4 py-2">
                          <span className="text-xs font-mono text-violet-400">{key}</span>
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            <input
                              type={isSensitive(key) && !revealedKeys.has(key) ? 'password' : 'text'}
                              value={value}
                              onChange={(e) => handleVarChange(key, e.target.value)}
                              className="flex-1 bg-transparent border-0 text-xs font-mono text-slate-300 focus:outline-none focus:ring-0 p-0"
                            />
                            {isSensitive(key) && (
                              <button
                                onClick={() => toggleReveal(key)}
                                className="text-slate-600 hover:text-slate-400 transition-colors"
                              >
                                {revealedKeys.has(key) ? (
                                  <EyeOff className="w-3.5 h-3.5" />
                                ) : (
                                  <Eye className="w-3.5 h-3.5" />
                                )}
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-right">
                          <button
                            onClick={() => handleDeleteVar(key)}
                            className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 transition-all p-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Add new variable row */}
                <div className="flex items-center gap-2 px-4 py-2.5 border-t border-slate-700/30 bg-slate-800/30">
                  <input
                    type="text"
                    value={newVarKey}
                    onChange={(e) => setNewVarKey(e.target.value)}
                    placeholder="Variable name"
                    onKeyDown={(e) => e.key === 'Enter' && handleAddVar()}
                    className="w-1/3 bg-slate-900/50 border border-slate-700/50 rounded px-2.5 py-1.5 text-xs font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-violet-500/50"
                  />
                  <input
                    type="text"
                    value={newVarValue}
                    onChange={(e) => setNewVarValue(e.target.value)}
                    placeholder="Value"
                    onKeyDown={(e) => e.key === 'Enter' && handleAddVar()}
                    className="flex-1 bg-slate-900/50 border border-slate-700/50 rounded px-2.5 py-1.5 text-xs font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-violet-500/50"
                  />
                  <button
                    onClick={handleAddVar}
                    disabled={!newVarKey.trim()}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs text-violet-400 hover:text-violet-300 hover:bg-violet-500/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add
                  </button>
                </div>
              </div>

              {saveMutation.isError && (
                <div className="mt-4 flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-md">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                  <span className="text-xs text-red-300">
                    {saveMutation.error instanceof Error ? saveMutation.error.message : 'Failed to save'}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* New environment dialog */}
      {showNewEnvDialog && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-slate-800 border border-slate-700 rounded-lg shadow-2xl p-6 w-full max-w-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-200">New Environment</h3>
              <button
                onClick={() => setShowNewEnvDialog(false)}
                className="text-slate-500 hover:text-slate-300"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <input
              type="text"
              value={newEnvName}
              onChange={(e) => setNewEnvName(e.target.value)}
              placeholder="Environment name (e.g. production)"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newEnvName.trim()) {
                  createMutation.mutate(newEnvName.trim())
                }
              }}
              className="w-full bg-slate-900/50 border border-slate-700/50 rounded-md px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-violet-500/50 mb-4"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowNewEnvDialog(false)}
                className="px-3 py-1.5 rounded-md text-xs font-medium text-slate-400 hover:text-slate-300 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => newEnvName.trim() && createMutation.mutate(newEnvName.trim())}
                disabled={!newEnvName.trim() || createMutation.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-violet-600 hover:bg-violet-500 text-white transition-colors disabled:opacity-50"
              >
                {createMutation.isPending && <Loader2 className="w-3 h-3 animate-spin" />}
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
