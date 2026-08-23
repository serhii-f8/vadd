import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import './index.css'
import { AppShell } from './app/AppShell.js'
import { ThemeProvider } from './app/ThemeProvider.js'
import { QuestMap } from './map/QuestMap.js'
import { DebugPage } from './routes/DebugPage.js'
import { FocusView } from './routes/FocusView.js'
import { ObjectiveList } from './routes/ObjectiveList.js'
import { Today } from './routes/Today.js'

const root = document.getElementById('root')
if (!root) throw new Error('#root not found')
createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<ObjectiveList />} />
            <Route path="/o/:id" element={<FocusView />} />
            <Route path="/today" element={<Today />} />
            <Route path="/map" element={<QuestMap />} />
          </Route>
          {/* M0's page, deliberately outside the shell: it is the raw escape
              hatch (M1 design §8.2) and must keep working when the shell is
              what is broken. */}
          <Route path="/debug" element={<DebugPage />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
)
