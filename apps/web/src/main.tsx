import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './context/AuthContext'
import { StudioProvider } from './context/StudioContext'
import { UserProfileProvider } from './context/UserProfileContext'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <StudioProvider>
        <UserProfileProvider>
          <App />
        </UserProfileProvider>
      </StudioProvider>
    </AuthProvider>
  </StrictMode>,
)
