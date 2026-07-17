import { useContext } from 'react'
import { ConversationPanelContext } from './conversation-panel-context'

export function useConversationPanel() {
  const context = useContext(ConversationPanelContext)

  if (!context) {
    throw new Error('useConversationPanel must be used within a ConversationPanelProvider')
  }

  return context
}
