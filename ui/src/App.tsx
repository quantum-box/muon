import { Routes, Route } from 'react-router-dom'
import { Layout } from './components/layout'
import { ProjectContextProvider } from './contexts/project-context'
import { WelcomePage } from './pages/welcome'
import { ProjectsPage } from './pages/projects'
import { ScenariosListPage } from './pages/scenarios-list'
import { ScenarioDetailPage } from './pages/scenario-detail'
import { StepEditorPage } from './pages/step-editor'
import { FlowEditorPage } from './pages/flow-editor'
import { EnvironmentsPage } from './pages/environments'
import { RunHistoryPage } from './pages/run-history'
import { SettingsPage } from './pages/settings'
import { RequestBuilderPage } from './pages/request-builder'

export function App() {
  return (
    <ProjectContextProvider>
      <Layout>
        <Routes>
          <Route path="/" element={<WelcomePage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/scenarios" element={<ScenariosListPage />} />
          <Route path="/scenarios/:id" element={<ScenarioDetailPage />} />
          <Route path="/scenarios/:id/edit" element={<StepEditorPage />} />
          <Route path="/scenarios/:id/flow" element={<FlowEditorPage />} />
          <Route path="/request" element={<RequestBuilderPage />} />
          <Route path="/environments" element={<EnvironmentsPage />} />
          <Route path="/history" element={<RunHistoryPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </Layout>
    </ProjectContextProvider>
  )
}
