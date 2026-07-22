import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'
import ThemeApplier from './components/ThemeApplier'
import { AuthProvider } from './context/AuthContext'
import { SocketProvider } from './context/SocketContext'
import { StudioProvider } from './context/StudioContext'
import { UserProfileProvider } from './context/UserProfileContext'
import { ViewAsProvider } from './context/ViewAsContext'
import { ConversationPanelProvider } from './context/ConversationPanelContext'
import { queryClient } from './lib/queryClient'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ThemeApplier />
        <SocketProvider>
          <StudioProvider>
            <UserProfileProvider>
              {/* Needs to be inside UserProfileProvider -- it calls that
                  context's refresh() on every view-as start/exit so
                  useUserProfile() (role/permissions, backed by GET /users/me)
                  reflects the impersonated user, not just the raw JWT. */}
              <ViewAsProvider>
                <ConversationPanelProvider>
                  <App />
                </ConversationPanelProvider>
              </ViewAsProvider>
            </UserProfileProvider>
          </StudioProvider>
        </SocketProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
)
