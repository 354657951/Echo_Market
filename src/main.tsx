import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import './auth-multi.css'
import { BrowserRouter } from './router/AppRouter'

// 应用入口：严格模式帮助在开发阶段发现不安全的副作用。
createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
