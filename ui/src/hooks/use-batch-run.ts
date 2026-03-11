import { useCallback, useRef, useState } from 'react'
import { tauriRunMultipleScenarios } from '../lib/tauri-api'

export interface BatchRunState {
  status: 'idle' | 'running' | 'completed'
  total: number
  completed: number
  passed: number
  failed: number
  scenarioStatuses: Map<string, 'pending' | 'running' | 'passed' | 'failed'>
  currentScenarioId: string | null
  duration_ms: number | null
}

const initialState: BatchRunState = {
  status: 'idle',
  total: 0,
  completed: 0,
  passed: 0,
  failed: 0,
  scenarioStatuses: new Map(),
  currentScenarioId: null,
  duration_ms: null,
}

interface BatchStartedPayload {
  ids: string[]
  total: number
}

interface BatchScenarioStartedPayload {
  id: string
}

interface BatchScenarioCompletedPayload {
  id: string
  success: boolean
  duration_ms: number
}

interface BatchCompletedPayload {
  total: number
  passed: number
  failed: number
  duration_ms: number
}

export function useBatchRun() {
  const [state, setState] = useState<BatchRunState>(initialState)
  const unlistenRefs = useRef<Array<() => void>>([])

  const cleanup = useCallback(() => {
    for (const unlisten of unlistenRefs.current) {
      unlisten()
    }
    unlistenRefs.current = []
  }, [])

  const execute = useCallback(
    async (path: string, ids: string[]) => {
      // Clean up previous listeners
      cleanup()

      // Initialize state with all scenarios as pending
      const statuses = new Map<string, 'pending' | 'running' | 'passed' | 'failed'>()
      for (const id of ids) {
        statuses.set(id, 'pending')
      }

      setState({
        status: 'running',
        total: ids.length,
        completed: 0,
        passed: 0,
        failed: 0,
        scenarioStatuses: statuses,
        currentScenarioId: null,
        duration_ms: null,
      })

      // Set up Tauri event listeners
      try {
        const { listen } = await import('@tauri-apps/api/event')

        const unlistenBatchStarted = await listen<BatchStartedPayload>(
          'batch-started',
          (event) => {
            const newStatuses = new Map<string, 'pending' | 'running' | 'passed' | 'failed'>()
            for (const id of event.payload.ids) {
              newStatuses.set(id, 'pending')
            }
            setState((prev) => ({
              ...prev,
              total: event.payload.total,
              scenarioStatuses: newStatuses,
            }))
          },
        )

        const unlistenScenarioStarted = await listen<BatchScenarioStartedPayload>(
          'batch-scenario-started',
          (event) => {
            setState((prev) => {
              const updated = new Map(prev.scenarioStatuses)
              updated.set(event.payload.id, 'running')
              return {
                ...prev,
                currentScenarioId: event.payload.id,
                scenarioStatuses: updated,
              }
            })
          },
        )

        const unlistenScenarioCompleted = await listen<BatchScenarioCompletedPayload>(
          'batch-scenario-completed',
          (event) => {
            setState((prev) => {
              const updated = new Map(prev.scenarioStatuses)
              updated.set(event.payload.id, event.payload.success ? 'passed' : 'failed')
              return {
                ...prev,
                completed: prev.completed + 1,
                passed: event.payload.success ? prev.passed + 1 : prev.passed,
                failed: event.payload.success ? prev.failed : prev.failed + 1,
                scenarioStatuses: updated,
              }
            })
          },
        )

        const unlistenBatchCompleted = await listen<BatchCompletedPayload>(
          'batch-completed',
          (event) => {
            setState((prev) => ({
              ...prev,
              status: 'completed',
              passed: event.payload.passed,
              failed: event.payload.failed,
              duration_ms: event.payload.duration_ms,
              currentScenarioId: null,
            }))
            cleanup()
          },
        )

        unlistenRefs.current = [
          unlistenBatchStarted,
          unlistenScenarioStarted,
          unlistenScenarioCompleted,
          unlistenBatchCompleted,
        ]
      } catch {
        // listen() not available (browser mode) -- fall through
      }

      // Invoke the Tauri command
      try {
        await tauriRunMultipleScenarios(path, ids)
      } catch (err) {
        // If invocation itself fails, mark completed with all failed
        setState((prev) => ({
          ...prev,
          status: 'completed',
          failed: prev.total,
          currentScenarioId: null,
        }))
        cleanup()
        throw err
      }
    },
    [cleanup],
  )

  const reset = useCallback(() => {
    cleanup()
    setState(initialState)
  }, [cleanup])

  return { state, execute, reset }
}
