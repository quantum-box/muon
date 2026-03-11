import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from 'react'
import { openProjectDialog, isTauri } from '../lib/tauri-api'

interface ProjectContextValue {
  projectPath: string | null
  setProjectPath: (path: string | null) => void
  openDirectory: () => Promise<string | null>
}

const ProjectContext = createContext<ProjectContextValue | null>(null)

const STORAGE_KEY = 'muon_current_project'

export function ProjectContextProvider({ children }: { children: ReactNode }) {
  const [projectPath, setProjectPathState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY)
    } catch {
      return null
    }
  })

  // Persist to localStorage whenever the path changes
  useEffect(() => {
    try {
      if (projectPath) {
        localStorage.setItem(STORAGE_KEY, projectPath)
      } else {
        localStorage.removeItem(STORAGE_KEY)
      }
    } catch {
      // localStorage unavailable
    }
  }, [projectPath])

  const setProjectPath = useCallback((path: string | null) => {
    setProjectPathState(path)
  }, [])

  const openDirectory = useCallback(async (): Promise<string | null> => {
    if (!isTauri()) return null
    const selected = await openProjectDialog()
    if (selected) {
      setProjectPathState(selected)
    }
    return selected
  }, [])

  return (
    <ProjectContext.Provider value={{ projectPath, setProjectPath, openDirectory }}>
      {children}
    </ProjectContext.Provider>
  )
}

export function useProject(): ProjectContextValue {
  const ctx = useContext(ProjectContext)
  if (!ctx) {
    throw new Error('useProject must be used within a ProjectContextProvider')
  }
  return ctx
}
