import { createContext } from 'react'

export interface ConversationPanelContextValue {
  isOpen: boolean
  activeConversationId: string | null
  // Opens the panel; if a conversationId is given, jumps straight to that
  // thread (used by "Message" entry points and task deep links). Omit to
  // just open to the list.
  openPanel: (conversationId?: string) => void
  closePanel: () => void
}

export const ConversationPanelContext = createContext<ConversationPanelContextValue | undefined>(undefined)
