import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import './index.css'
import { DebugPage } from './routes/DebugPage.js'
import { FocusView } from './routes/FocusView.js'
import { ObjectiveList } from './routes/ObjectiveList.js'
import { Today } from './routes/Today.js'

const root = document.getElementById('root')
if (!root) throw new Error('#root not found')
createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ObjectiveList />} />
        <Route path="/o/:id" element={<FocusView />} />
        <Route path="/today" element={<Today />} />
        {/* M0's page, unchanged, kept as the escape hatch (M1 design §8.2). */}
        <Route path="/debug" element={<DebugPage />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
