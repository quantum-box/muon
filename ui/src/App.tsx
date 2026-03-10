import { Routes, Route } from 'react-router-dom'
import { Layout } from './components/layout'
import { ScenariosListPage } from './pages/scenarios-list'
import { ScenarioDetailPage } from './pages/scenario-detail'

export function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<ScenariosListPage />} />
        <Route path="/scenarios/:id" element={<ScenarioDetailPage />} />
      </Routes>
    </Layout>
  )
}
