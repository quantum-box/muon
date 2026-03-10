import { useState } from 'react'
import {
  X,
  Upload,
  Terminal,
  FileCode2,
  FileJson,
  AlertCircle,
  CheckCircle2,
  Loader2,
} from 'lucide-react'
import { cn } from '../lib/utils'
import { tauriImportPostman, tauriImportCurl, tauriImportOpenapi } from '../lib/tauri-api'

type ImportTab = 'postman' | 'curl' | 'openapi'

interface ImportDialogProps {
  open: boolean
  onClose: () => void
}

export function ImportDialog({ open, onClose }: ImportDialogProps) {
  const [tab, setTab] = useState<ImportTab>('postman')
  const [postmanInput, setPostmanInput] = useState('')
  const [curlInput, setCurlInput] = useState('')
  const [openapiInput, setOpenapiInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<unknown[] | null>(null)

  if (!open) return null

  function reset() {
    setError(null)
    setPreview(null)
  }

  async function handleImport() {
    reset()
    setLoading(true)
    try {
      let result: { scenarios: unknown[] }
      switch (tab) {
        case 'postman':
          if (!postmanInput.trim()) throw new Error('Please paste a Postman collection JSON')
          result = await tauriImportPostman(postmanInput)
          break
        case 'curl':
          if (!curlInput.trim()) throw new Error('Please paste a cURL command')
          result = await tauriImportCurl(curlInput)
          break
        case 'openapi':
          if (!openapiInput.trim()) throw new Error('Please provide an OpenAPI spec URL or JSON')
          result = await tauriImportOpenapi(openapiInput)
          break
      }
      setPreview(result.scenarios)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setLoading(false)
    }
  }

  function handleConfirm() {
    // In a full implementation, this would save the imported scenarios
    onClose()
    setPostmanInput('')
    setCurlInput('')
    setOpenapiInput('')
    setPreview(null)
    setError(null)
  }

  const tabs: { value: ImportTab; label: string; icon: typeof Upload }[] = [
    { value: 'postman', label: 'Postman', icon: FileJson },
    { value: 'curl', label: 'cURL', icon: Terminal },
    { value: 'openapi', label: 'OpenAPI', icon: FileCode2 },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-700/50 rounded-xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700/50">
          <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
            <Upload className="w-4 h-4 text-violet-400" />
            Import Scenarios
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-slate-800 text-slate-500 hover:text-slate-300 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-700/50 px-5">
          {tabs.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              onClick={() => { setTab(value); reset() }}
              className={cn(
                'flex items-center gap-1.5 px-4 py-2.5 text-sm border-b-2 -mb-[1px] transition-colors',
                tab === value
                  ? 'border-violet-500 text-violet-300'
                  : 'border-transparent text-slate-500 hover:text-slate-300',
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          {tab === 'postman' && (
            <div className="space-y-3">
              <p className="text-xs text-slate-400">
                Paste your Postman Collection JSON export below
              </p>
              <textarea
                placeholder='{"info": {"name": "My Collection"}, "item": [...]}'
                value={postmanInput}
                onChange={(e) => setPostmanInput(e.target.value)}
                className="w-full h-40 px-3 py-2 bg-slate-800/50 border border-slate-700/50 rounded-md text-xs text-slate-200 placeholder-slate-600 font-mono focus:outline-none focus:border-violet-500/50 resize-none"
              />
            </div>
          )}

          {tab === 'curl' && (
            <div className="space-y-3">
              <p className="text-xs text-slate-400">
                Paste a cURL command to convert into a scenario step
              </p>
              <textarea
                placeholder="curl -X POST https://api.example.com/users -H 'Content-Type: application/json' -d '{&quot;name&quot;: &quot;John&quot;}'"
                value={curlInput}
                onChange={(e) => setCurlInput(e.target.value)}
                className="w-full h-40 px-3 py-2 bg-slate-800/50 border border-slate-700/50 rounded-md text-xs text-slate-200 placeholder-slate-600 font-mono focus:outline-none focus:border-violet-500/50 resize-none"
              />
            </div>
          )}

          {tab === 'openapi' && (
            <div className="space-y-3">
              <p className="text-xs text-slate-400">
                Provide an OpenAPI/Swagger specification URL or paste the JSON/YAML content
              </p>
              <textarea
                placeholder="https://petstore.swagger.io/v2/swagger.json"
                value={openapiInput}
                onChange={(e) => setOpenapiInput(e.target.value)}
                className="w-full h-40 px-3 py-2 bg-slate-800/50 border border-slate-700/50 rounded-md text-xs text-slate-200 placeholder-slate-600 font-mono focus:outline-none focus:border-violet-500/50 resize-none"
              />
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-red-400/10 border border-red-400/20">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <span className="text-xs text-red-300">{error}</span>
            </div>
          )}

          {/* Preview */}
          {preview && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {preview.length} scenario(s) will be imported
              </div>
              <div className="max-h-32 overflow-auto bg-slate-800/50 rounded-md p-3">
                <pre className="text-xs text-slate-300 font-mono">
                  {JSON.stringify(preview, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-700/50">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-slate-400 hover:text-slate-300 transition-colors"
          >
            Cancel
          </button>
          {preview ? (
            <button
              onClick={handleConfirm}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-emerald-600 text-sm text-white rounded-md hover:bg-emerald-500 transition-colors"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              Confirm Import
            </button>
          ) : (
            <button
              onClick={handleImport}
              disabled={loading}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-violet-600 text-sm text-white rounded-md hover:bg-violet-500 transition-colors disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Upload className="w-3.5 h-3.5" />
              )}
              {loading ? 'Importing...' : 'Import'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
