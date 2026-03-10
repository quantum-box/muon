import { Routes, Route } from 'react-router-dom'
import { Layout } from './components/layout'
import { ScenariosListPage } from './pages/scenarios-list'
import { ScenarioDetailPage } from './pages/scenario-detail'
import { StepEditorPage } from './pages/step-editor'
import { FlowEditorPage } from './pages/flow-editor'
import { EnvironmentsPage } from './pages/environments'

export function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<ScenariosListPage />} />
        <Route path="/scenarios/:id" element={<ScenarioDetailPage />} />
        <Route path="/scenarios/:id/edit" element={<StepEditorPage />} />
        <Route path="/scenarios/:id/flow" element={<FlowEditorPage />} />
        <Route path="/environments" element={<EnvironmentsPage />} />
      </Routes>
    </Layout>
  )
}
