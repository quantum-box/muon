import { useCallback, useRef, useState } from 'react'
import { runScenario } from '../lib/api'
import type { RunEvent, RunState, StepStatus } from '../lib/types'

const initialState: RunState = {
  status: 'idle',
  stepStatuses: [],
  stepResults: [],
  variables: {},
  result: null,
  error: null,
  currentStepIndex: null,
}

export function useRun() {
  const [state, setState] = useState<RunState>(initialState)
  const cancelRef = useRef<(() => void) | null>(null)

  const execute = useCallback((scenarioId: string, stepCount: number) => {
    // Cancel any in-flight run
    cancelRef.current?.()

    const pending: StepStatus[] = Array.from({ length: stepCount }, () => 'pending')
    setState({
      status: 'running',
      stepStatuses: pending,
      stepResults: Array.from({ length: stepCount }, () => null),
      variables: {},
      result: null,
      error: null,
      currentStepIndex: null,
    })

    const cancel = runScenario(
      scenarioId,
      (event: RunEvent) => {
        setState(prev => applyEvent(prev, event))
      },
      (error: string) => {
        setState(prev => ({ ...prev, status: 'error', error }))
      },
      () => {
        setState(prev => {
          if (prev.status === 'running') {
            return { ...prev, status: 'completed' }
          }
          return prev
        })
      },
    )

    cancelRef.current = cancel
  }, [])

  const reset = useCallback(() => {
    cancelRef.current?.()
    cancelRef.current = null
    setState(initialState)
  }, [])

  return { state, execute, reset }
}

function applyEvent(prev: RunState, event: RunEvent): RunState {
  switch (event.type) {
    case 'scenario_started':
      return {
        ...prev,
        status: 'running',
        stepStatuses: Array.from({ length: event.step_count }, () => 'pending' as StepStatus),
        stepResults: Array.from({ length: event.step_count }, () => null),
      }

    case 'step_started': {
      const statuses = [...prev.stepStatuses]
      statuses[event.index] = 'running'
      return { ...prev, stepStatuses: statuses, currentStepIndex: event.index }
    }

    case 'step_completed': {
      const statuses = [...prev.stepStatuses]
      statuses[event.index] = event.result.success ? 'passed' : 'failed'
      const results = [...prev.stepResults]
      results[event.index] = event.result
      return { ...prev, stepStatuses: statuses, stepResults: results }
    }

    case 'variable_updated':
      return {
        ...prev,
        variables: { ...prev.variables, [event.key]: event.value },
      }

    case 'scenario_completed':
      return {
        ...prev,
        status: 'completed',
        result: event.result,
        currentStepIndex: null,
      }

    default:
      return prev
  }
}
