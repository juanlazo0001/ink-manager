import { useState, type ReactNode } from 'react'
import { ConversationPanelContext } from './conversation-panel-context'

export function ConversationPanelProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)

  function openPanel(conversationId?: string) {
    if (conversationId) setActiveConversationId(conversationId)
    setIsOpen(true)
  }

  function closePanel() {
    setIsOpen(false)
  }

  return (
    <ConversationPanelContext.Provider value={{ isOpen, activeConversationId, openPanel, closePanel }}>
      {children}
    </ConversationPanelContext.Provider>
  )
}
