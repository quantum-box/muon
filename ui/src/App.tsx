import { Route, Routes } from 'react-router-dom'
import { Layout } from './components/layout'
import { CollectionsPage } from './pages/collections'
import { ProjectContextProvider } from './contexts/project-context'
import { EnvironmentsPage } from './pages/environments'
import { FlowEditorPage } from './pages/flow-editor'
import { ProjectsPage } from './pages/projects'
import { RequestBuilderPage } from './pages/request-builder'
import { RunHistoryPage } from './pages/run-history'
import { ScenarioDetailPage } from './pages/scenario-detail'
import { ScenariosListPage } from './pages/scenarios-list'
import { SettingsPage } from './pages/settings'
import { StepEditorPage } from './pages/step-editor'
import { WelcomePage } from './pages/welcome'

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
          <Route path="/collections" element={<CollectionsPage />} />
          <Route path="/environments" element={<EnvironmentsPage />} />
          <Route path="/history" element={<RunHistoryPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </Layout>
    </ProjectContextProvider>
  )
}
