import { AnimatePresence } from 'framer-motion'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import PageFade from './PageFade'

// Shared, persistent shell for every authenticated app page (Dashboard,
// Clients, Calendar, Team, ...) -- Sidebar renders exactly once here and
// stays mounted across navigation between any of them, since this
// component itself is never remounted by React Router's Outlet-based
// nesting (only App.tsx's own top-level PageFade key would force that,
// and that key is deliberately coarse -- see getPageFadeKey -- rather
// than the full pathname, specifically so navigating within the app
// shell doesn't count as "leaving" it).
//
// The page-fade transition still happens on every navigation -- it's
// just scoped to this inner AnimatePresence, wrapping only the routed
// page content (Outlet), not Sidebar. Previously every one of these 16
// pages rendered its own <Sidebar /> plus this exact wrapper markup
// inline, which meant React fully unmounted and remounted Sidebar (along
// with everything else) on every single page-to-page navigation, purely
// because the OUTER PageFade's key was the full location.pathname.
export default function AppShellLayout() {
  const location = useLocation()

  return (
    <div className="flex min-h-screen bg-bg text-fg">
      <Sidebar />

      <div className="min-w-0 flex-1 overflow-y-auto">
        <AnimatePresence mode="popLayout" initial={false}>
          <PageFade key={location.pathname}>
            <Outlet />
          </PageFade>
        </AnimatePresence>
      </div>
    </div>
  )
}
