import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './context/AuthContext'
import { StudioProvider } from './context/StudioContext'
import { UserProfileProvider } from './context/UserProfileContext'
import { queryClient } from './lib/queryClient'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <StudioProvider>
          <UserProfileProvider>
            <App />
          </UserProfileProvider>
        </StudioProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
)
