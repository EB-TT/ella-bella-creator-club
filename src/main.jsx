import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { TikTokSetup } from './components/TikTokSetup'
import './styles/app.css'

// The one public page: rendered instead of the app, so it never hits the login gate.
const isTikTokSetup = window.location.pathname.replace(/\/+$/, '') === '/tiktok-setup'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>{isTikTokSetup ? <TikTokSetup /> : <App />}</React.StrictMode>
)
