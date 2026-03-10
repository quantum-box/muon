import { useQuery } from '@tanstack/react-query'
import { fetchScenarios, fetchScenario } from '../lib/api'

export function useScenarios() {
  return useQuery({
    queryKey: ['scenarios'],
    queryFn: fetchScenarios,
  })
}

export function useScenario(id: string) {
  return useQuery({
    queryKey: ['scenario', id],
    queryFn: () => fetchScenario(id),
    enabled: !!id,
  })
}
