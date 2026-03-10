import { useState } from 'react'
import {
  Settings as SettingsIcon,
  Clock,
  Keyboard,
  Info,
  Plus,
  Trash2,
  ExternalLink,
} from 'lucide-react'
import { cn } from '../lib/utils'
import { type AppSettings, getSettings, saveSettings } from '../lib/tauri-api'
import { SHORTCUT_REFERENCE } from '../hooks/use-keyboard-shortcuts'

type SettingsTab = 'general' | 'shortcuts' | 'about'

export function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings>(getSettings)
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')
  const [newHeaderKey, setNewHeaderKey] = useState('')
  const [newHeaderValue, setNewHeaderValue] = useState('')
  const [saved, setSaved] = useState(false)

  function handleSave(updated: AppSettings) {
    setSettings(updated)
    saveSettings(updated)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  function handleAddHeader() {
    if (!newHeaderKey.trim()) return
    const updated = {
      ...settings,
      default_headers: {
        ...settings.default_headers,
        [newHeaderKey.trim()]: newHeaderValue,
      },
    }
    handleSave(updated)
    setNewHeaderKey('')
    setNewHeaderValue('')
  }

  function handleRemoveHeader(key: string) {
    const headers = { ...settings.default_headers }
    delete headers[key]
    handleSave({ ...settings, default_headers: headers })
  }

  const tabs: { value: SettingsTab; label: string; icon: typeof SettingsIcon }[] = [
    { value: 'general', label: 'General', icon: SettingsIcon },
    { value: 'shortcuts', label: 'Keyboard Shortcuts', icon: Keyboard },
    { value: 'about', label: 'About', icon: Info },
  ]

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-slate-100 flex items-center gap-2">
          <SettingsIcon className="w-5 h-5 text-violet-400" />
          Settings
        </h1>
        {saved && (
          <span className="text-xs text-emerald-400">Settings saved</span>
        )}
      </div>

      <div className="flex gap-6">
        {/* Tab sidebar */}
        <div className="w-48 flex-shrink-0 space-y-1">
          {tabs.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              onClick={() => setActiveTab(value)}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors text-left',
                activeTab === value
                  ? 'bg-violet-500/10 text-violet-300'
                  : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/50',
              )}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 min-w-0">
          {activeTab === 'general' && (
            <div className="space-y-6">
              {/* Theme */}
              <Section title="Theme" description="Visual appearance (coming soon)">
                <div className="flex items-center gap-2">
                  {(['dark', 'light'] as const).map((theme) => (
                    <button
                      key={theme}
                      onClick={() => handleSave({ ...settings, theme })}
                      className={cn(
                        'px-4 py-2 rounded-md text-sm border transition-colors capitalize',
                        settings.theme === theme
                          ? 'border-violet-500 bg-violet-500/10 text-violet-300'
                          : 'border-slate-700/50 text-slate-500 hover:border-slate-600',
                        theme === 'light' && 'opacity-50 cursor-not-allowed',
                      )}
                      disabled={theme === 'light'}
                    >
                      {theme}
                    </button>
                  ))}
                </div>
              </Section>

              {/* Default timeout */}
              <Section
                title="Default Timeout"
                description="Default request timeout in seconds"
              >
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-slate-500" />
                  <input
                    type="number"
                    min={1}
                    max={300}
                    value={settings.default_timeout}
                    onChange={(e) =>
                      handleSave({
                        ...settings,
                        default_timeout: Number(e.target.value) || 30,
                      })
                    }
                    className="w-24 px-3 py-1.5 bg-slate-800/50 border border-slate-700/50 rounded-md text-sm text-slate-200 focus:outline-none focus:border-violet-500/50"
                  />
                  <span className="text-xs text-slate-500">seconds</span>
                </div>
              </Section>

              {/* Default headers */}
              <Section
                title="Default Headers"
                description="Headers added to every request"
              >
                <div className="space-y-2">
                  {Object.entries(settings.default_headers).map(([key, value]) => (
                    <div
                      key={key}
                      className="flex items-center gap-2 group"
                    >
                      <span className="text-xs text-slate-300 font-mono w-40 truncate">
                        {key}
                      </span>
                      <span className="text-xs text-slate-500 font-mono flex-1 truncate">
                        {value}
                      </span>
                      <button
                        onClick={() => handleRemoveHeader(key)}
                        className="p-1 opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 transition-all"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}

                  <div className="flex items-center gap-2 mt-2">
                    <input
                      type="text"
                      placeholder="Header name"
                      value={newHeaderKey}
                      onChange={(e) => setNewHeaderKey(e.target.value)}
                      className="w-40 px-2 py-1.5 bg-slate-800/50 border border-slate-700/50 rounded text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-violet-500/50 font-mono"
                    />
                    <input
                      type="text"
                      placeholder="Value"
                      value={newHeaderValue}
                      onChange={(e) => setNewHeaderValue(e.target.value)}
                      className="flex-1 px-2 py-1.5 bg-slate-800/50 border border-slate-700/50 rounded text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-violet-500/50 font-mono"
                      onKeyDown={(e) => e.key === 'Enter' && handleAddHeader()}
                    />
                    <button
                      onClick={handleAddHeader}
                      className="p-1.5 border border-slate-700/50 rounded hover:bg-slate-800/50 text-slate-500 hover:text-slate-300 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </Section>
            </div>
          )}

          {activeTab === 'shortcuts' && (
            <div className="space-y-4">
              <p className="text-sm text-slate-400 mb-4">
                Keyboard shortcuts for common actions
              </p>
              <div className="border border-slate-700/50 rounded-lg overflow-hidden">
                {SHORTCUT_REFERENCE.map((s, i) => (
                  <div
                    key={s.key}
                    className={cn(
                      'flex items-center justify-between px-4 py-3',
                      i > 0 && 'border-t border-slate-800/50',
                    )}
                  >
                    <span className="text-sm text-slate-300">{s.description}</span>
                    <kbd className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-slate-400 font-mono">
                      {s.key}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'about' && (
            <div className="space-y-6">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-14 h-14 rounded-xl bg-violet-500/20 flex items-center justify-center">
                  <span className="text-2xl font-bold text-violet-400">mu</span>
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-slate-100">muon</h2>
                  <p className="text-sm text-slate-500">
                    Declarative API Scenario Test Runner
                  </p>
                  <p className="text-xs text-slate-600 mt-0.5 font-mono">
                    v0.1.0
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <a
                  href="https://github.com/quantum-box/muon"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between p-3 rounded-md border border-slate-700/50 hover:bg-slate-800/50 transition-colors group"
                >
                  <span className="text-sm text-slate-300">GitHub Repository</span>
                  <ExternalLink className="w-4 h-4 text-slate-600 group-hover:text-slate-400" />
                </a>
                <a
                  href="https://github.com/quantum-box/muon/issues"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between p-3 rounded-md border border-slate-700/50 hover:bg-slate-800/50 transition-colors group"
                >
                  <span className="text-sm text-slate-300">Report an Issue</span>
                  <ExternalLink className="w-4 h-4 text-slate-600 group-hover:text-slate-400" />
                </a>
                <a
                  href="https://github.com/quantum-box/muon/blob/main/LICENSE"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between p-3 rounded-md border border-slate-700/50 hover:bg-slate-800/50 transition-colors group"
                >
                  <span className="text-sm text-slate-300">License (MIT)</span>
                  <ExternalLink className="w-4 h-4 text-slate-600 group-hover:text-slate-400" />
                </a>
              </div>

              <p className="text-xs text-slate-600 mt-4">
                Built with Rust, React, and Tauri
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Section({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-medium text-slate-200">{title}</h3>
        <p className="text-xs text-slate-500 mt-0.5">{description}</p>
      </div>
      {children}
    </div>
  )
}
