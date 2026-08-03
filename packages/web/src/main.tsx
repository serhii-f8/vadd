import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { DebugPage } from './DebugPage.js'
import './index.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root not found')
createRoot(root).render(
  <StrictMode>
    <DebugPage />
  </StrictMode>,
)
