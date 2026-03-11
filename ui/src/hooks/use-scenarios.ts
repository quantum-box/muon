import { useQuery } from '@tanstack/react-query'
import { fetchScenarios, fetchScenario } from '../lib/api'
import { isTauri, tauriListScenarios, tauriGetScenario } from '../lib/tauri-api'

export function useScenarios(path?: string | null) {
  return useQuery({
    queryKey: path ? ['scenarios', path] : ['scenarios'],
    queryFn: () => {
      if (path && isTauri()) {
        return tauriListScenarios(path)
      }
      return fetchScenarios()
    },
  })
}

export function useScenario(id: string, path?: string | null) {
  return useQuery({
    queryKey: path ? ['scenario', path, id] : ['scenario', id],
    queryFn: () => {
      if (path && isTauri()) {
        return tauriGetScenario(path, id)
      }
      return fetchScenario(id)
    },
    enabled: !!id,
  })
}
