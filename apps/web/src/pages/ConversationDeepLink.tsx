import { useEffect } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { useConversationPanel } from '../context/useConversationPanel'

// Task deep links (e.g. NEW_CONVERSATION) point here -- there's no full
// conversation page, the panel is a global floating overlay, so this just
// opens the panel to the right thread and bounces back to the dashboard.
export default function ConversationDeepLink() {
  const { id } = useParams<{ id: string }>()
  const { openPanel } = useConversationPanel()

  useEffect(() => {
    if (id) openPanel(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  return <Navigate to="/dashboard" replace />
}
