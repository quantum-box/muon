import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

export interface ShortcutDef {
  key: string
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
  description: string
  action: () => void
}

const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)

function matchesShortcut(e: KeyboardEvent, s: ShortcutDef): boolean {
  const mod = s.ctrl ?? false
  const modPressed = isMac ? e.metaKey : e.ctrlKey
  if (mod !== modPressed) return false
  if ((s.shift ?? false) !== e.shiftKey) return false
  if ((s.alt ?? false) !== e.altKey) return false
  return e.key.toLowerCase() === s.key.toLowerCase()
}

export function useKeyboardShortcuts(shortcuts: ShortcutDef[]): void {
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      // Skip when focused on input/textarea/contenteditable
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if ((e.target as HTMLElement)?.isContentEditable) return

      for (const s of shortcuts) {
        if (matchesShortcut(e, s)) {
          e.preventDefault()
          s.action()
          return
        }
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [shortcuts])
}

export function useGlobalShortcuts(): void {
  const navigate = useNavigate()

  useKeyboardShortcuts([
    {
      key: 'n',
      ctrl: true,
      description: 'New scenario',
      action: () => navigate('/scenarios'),
    },
    {
      key: 'o',
      ctrl: true,
      description: 'Open project',
      action: () => navigate('/projects'),
    },
    {
      key: ',',
      ctrl: true,
      description: 'Settings',
      action: () => navigate('/settings'),
    },
  ])
}

export const SHORTCUT_REFERENCE: { key: string; description: string }[] = [
  { key: isMac ? '⌘+Enter' : 'Ctrl+Enter', description: 'Run current scenario' },
  { key: isMac ? '⌘+S' : 'Ctrl+S', description: 'Save current scenario' },
  { key: isMac ? '⌘+N' : 'Ctrl+N', description: 'New scenario' },
  { key: isMac ? '⌘+O' : 'Ctrl+O', description: 'Open project' },
  { key: isMac ? '⌘+,' : 'Ctrl+,', description: 'Settings' },
]

export const MOD_KEY = isMac ? '⌘' : 'Ctrl'
