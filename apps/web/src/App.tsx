import { forwardRef, useEffect, useRef, useState, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { pageTransition } from './lib/motion'
import ProtectedRoute from './components/ProtectedRoute'
import AuthLayout from './components/AuthLayout'
import ResetPassword from './pages/ResetPassword'
import InviteAccept from './pages/InviteAccept'
import ConfirmEmailChange from './pages/ConfirmEmailChange'
import Dashboard from './pages/Dashboard'
import Clients from './pages/Clients'
import ClientImport from './pages/ClientImport'
import ClientDetail from './pages/ClientDetail'
import Calendar from './pages/Calendar'
import AppointmentDetail from './pages/AppointmentDetail'
import ArtistDetail from './pages/ArtistDetail'
import ArtistCreate from './pages/ArtistCreate'
import Settings from './pages/Settings'
import Profile from './pages/Profile'
import Team from './pages/Team'
import IntakeForm from './pages/IntakeForm'
import Policies from './pages/Policies'
import PublicPolicyPage from './pages/PublicPolicyPage'
import PlatformPolicyPage from './pages/PlatformPolicyPage'
import { PLATFORM_PRIVACY_POLICY_HTML, PLATFORM_TERMS_HTML } from './content/platformPolicies'
import Inquiries from './pages/Inquiries'
import InquiryDetail from './pages/InquiryDetail'
import MyInquiries from './pages/MyInquiries'
import EstimateResponse from './pages/EstimateResponse'
import EstimateRevisionResponse from './pages/EstimateRevisionResponse'
import DepositResponse from './pages/DepositResponse'
import AppointmentPaymentComplete from './pages/AppointmentPaymentComplete'
import GiftCardResponse from './pages/GiftCardResponse'
import GiftCardDetail from './pages/GiftCardDetail'
import WaiverSign from './pages/WaiverSign'
import ShortLinkRedirect from './pages/ShortLinkRedirect'
import Tasks from './pages/Tasks'
import ConversationDeepLink from './pages/ConversationDeepLink'
import ConversationsPanel from './components/ConversationsPanel'
import TopBar from './components/TopBar'
import ViewAsBanner from './components/ViewAsBanner'
import ErrorBoundary from './components/ErrorBoundary'

// Iris reveal between routes -- the incoming page's own clip-path grows
// from a point at screen-center out past every corner (150% comfortably
// exceeds a centered circle's required radius -- see the CSS spec's
// percentage-resolves-against-diagonal/sqrt(2) formula -- at any realistic
// aspect ratio), progressively covering the outgoing page rather than the
// two crossfading.
//
// Once the circle finishes growing, `revealed` flips true and the
// `animate` target itself switches to `clipPath: 'none'` -- NOT a ref-based
// manual style clear (tried that first; Motion re-asserts its own
// `animate` target on every render, so a direct DOM mutation just gets
// overwritten on the next one -- the target has to change through Motion's
// own reactive model to actually stick). This matters because a lingering
// non-`none` clip-path -- even one large enough to clip nothing visible --
// creates a new containing block for every position: fixed descendant on
// the page, the same category of effect `transform` has. Found this the
// hard way: it silently broke a fixed-position ring decoration nested in
// Sidebar's own <aside> (since moved out to TopBar, see
// .arc-decor-sidebar-edge in index.css), which started behaving like
// `position: absolute` against this wrapper instead of the viewport.
//
// That circle(150%) -> none switch needs its own instant, zero-duration
// transition, scoped to clipPath specifically (not the whole `transition`
// prop -- that would also zero out the exit fade's own opacity transition,
// since `revealed` is still true whenever a settled page later exits) --
// also found the hard way. circle(...) and the keyword none aren't a
// valid interpolation pair, so letting Motion spring-animate between them
// produced genuine visual garbage: getComputedStyle briefly showed
// nonsense values like "circle(3.13% at 1.04% 1.04%)" mid-"transition".
// Since 150% already covers the entire viewport, the switch to none has
// zero visual difference on its own -- it only needs to be instant, not
// animated.
//
// `skipAnimation` handles the one case `onAnimationComplete` can't:
// AnimatePresence's `initial={false}` skips the enter transition entirely
// on the very first page load (as opposed to an in-app navigation), so
// nothing ever completes to trigger it -- that first instance starts
// already `revealed`, matching `initial={false}`'s own "don't animate,
// just render the settled state" intent instead of leaving a permanent
// clip-path behind.
const IrisReveal = forwardRef<HTMLDivElement, { children: ReactNode; skipAnimation: boolean }>(
  function IrisReveal({ children, skipAnimation }, ref) {
    const [revealed, setRevealed] = useState(skipAnimation)
    return (
      <motion.div
        ref={ref}
        className="relative z-10"
        initial={{ clipPath: 'circle(0% at 50% 50%)' }}
        animate={{ clipPath: revealed ? 'none' : 'circle(150% at 50% 50%)' }}
        exit={{ opacity: 0 }}
        transition={{ default: pageTransition, clipPath: revealed ? { duration: 0 } : pageTransition }}
        onAnimationComplete={() => setRevealed(true)}
      >
        {children}
      </motion.div>
    )
  },
)

// mode="popLayout" + a location-keyed <Routes> (rather than keying
// individual page elements) is the standard React Router + Framer Motion
// recipe: <Routes> itself becomes the thing that exits/enters as a whole
// on every pathname change, so no per-page file needs to know about this
// at all. IrisReveal is a direct AnimatePresence child (forwardRef, same
// requirement as AuthLayout's own AuthCard) since it's a custom component,
// not a plain motion.div. The outgoing page gets a plain, quick opacity
// exit -- not part of the "iris" look itself (it's fully covered by the
// incoming circle well before it would show), just insurance against any
// edge case where it isn't. Scoped to just the routed content -- TopBar/
// ConversationsPanel/ViewAsBanner are persistent chrome mounted outside
// this tree and never re-animate on navigation.
function AppRoutes() {
  const location = useLocation()
  // True only for whichever route the user actually lands on (the very
  // first AppRoutes render); flips false right after, before any
  // subsequent in-app navigation could occur -- passed down so only that
  // one IrisReveal instance skips its own animation.
  const isFirstRenderRef = useRef(true)
  useEffect(() => {
    isFirstRenderRef.current = false
  }, [])
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      {/* relative z-10 lives on this element now (was a separate wrapper
          div) -- without it, every routed page's own top-level wrapper is
          a plain, non-positioned block, so under CSS's stacking-paint-
          order rules it paints BEHIND any positioned sibling with z-index
          0/auto, including TopBar's own fixed decorative layers (app-bg-
          photo/app-bg-wash/arc-decor), which mount AFTER this tree in the
          DOM. Harmless for Login/public routes -- TopBar returns null
          with no logged-in user, so those layers never mount there
          regardless; this only matters once an authenticated page and
          TopBar's background layers are both on screen at once.
          Discovered for real (not theorized) when app-bg-wash's own
          near-opaque fill visibly blotted out Dashboard's entire card
          grid in a screenshot -- .arc-decor's own rings never exposed
          this same latent issue only because they have no opaque fill to
          reveal it. */}
      <IrisReveal key={location.pathname} skipAnimation={isFirstRenderRef.current}>
        <Routes location={location}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
        {/* Persistent-layout auth pages: AuthLayout renders the background/
            overlay/rings chrome ONCE and never unmounts while navigating
            between these five. Each is still its own real, directly-
            linkable URL (nested routes work identically to top-level ones
            on a fresh load); this only changes what happens when moving
            between them from within the app.
            /login and /forgot-password have no `element` of their own --
            AuthLayout renders its own SignInOrForgotCard for both
            (ignoring Outlet entirely for these two paths) so that shared
            component can own the email field as ONE persistent instance
            across the two, rather than each being a separate page
            component AuthLayout would otherwise swap between. These Route
            entries exist purely so the URLs still match/resolve. */}
        <Route element={<AuthLayout />}>
          <Route path="/login" element={null} />
          <Route path="/forgot-password" element={null} />
          <Route path="/reset-password/:token" element={<ResetPassword />} />
          <Route path="/invite/:token" element={<InviteAccept />} />
          <Route path="/confirm-email-change/:token" element={<ConfirmEmailChange />} />
        </Route>
        <Route path="/inquiry/:studioSlug" element={<IntakeForm />} />
        <Route path="/inquiry/:studioSlug/:formSlug" element={<IntakeForm />} />
        <Route path="/policies/:studioSlug" element={<Policies />} />
        {/* Platform-level (no studioSlug) -- Ink Manager's own Privacy
            Policy/Terms, distinct from the studio-scoped routes directly
            below. Live at the exact bare URLs a Twilio A2P 10DLC carrier
            review checks (https://web.inkmanager.app/privacy, /terms):
            no auth, no studioSlug segment, so these can't 404/dead-end
            into "this studio couldn't be found" the way the scoped routes
            do when visited without one. */}
        <Route path="/privacy" element={<PlatformPolicyPage title="Privacy Policy" bodyHtml={PLATFORM_PRIVACY_POLICY_HTML} />} />
        <Route path="/terms" element={<PlatformPolicyPage title="Terms & Conditions" bodyHtml={PLATFORM_TERMS_HTML} />} />
        <Route
          path="/privacy/:studioSlug"
          element={<PublicPolicyPage field="privacyPolicy" title="Privacy Policy" />}
        />
        <Route
          path="/terms/:studioSlug"
          element={<PublicPolicyPage field="termsAndConditions" title="Terms & Conditions" />}
        />
        <Route
          path="/refund-policy/:studioSlug"
          element={<PublicPolicyPage field="refundPolicy" title="Refund Policy" />}
        />
        <Route
          path="/deposit-policy/:studioSlug"
          element={<PublicPolicyPage field="depositPolicy" title="Deposit Policy" />}
        />
        <Route
          path="/reschedule-policy/:studioSlug"
          element={<PublicPolicyPage field="reschedulePolicy" title="Reschedule Policy" />}
        />
        <Route
          path="/communication-policy/:studioSlug"
          element={<PublicPolicyPage field="communicationPolicy" title="Communication Policy" />}
        />
        <Route path="/estimate/:token" element={<EstimateResponse />} />
        <Route path="/estimate-revision/:token" element={<EstimateRevisionResponse />} />
        <Route path="/deposit/:token" element={<DepositResponse />} />
        <Route path="/appointments/pay-complete" element={<AppointmentPaymentComplete />} />
        <Route path="/gift-card/:code" element={<GiftCardResponse />} />
        <Route path="/waiver/:token" element={<WaiverSign />} />
        <Route path="/s/:code" element={<ShortLinkRedirect />} />
        <Route
          path="/gift-cards/:id"
          element={
            <ProtectedRoute>
              <GiftCardDetail />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/clients"
          element={
            <ProtectedRoute>
              <Clients />
            </ProtectedRoute>
          }
        />
        <Route
          path="/clients/import"
          element={
            <ProtectedRoute>
              <ClientImport />
            </ProtectedRoute>
          }
        />
        <Route
          path="/clients/:id"
          element={
            <ProtectedRoute>
              <ErrorBoundary label="ClientDetail">
                <ClientDetail />
              </ErrorBoundary>
            </ProtectedRoute>
          }
        />
        <Route
          path="/calendar"
          element={
            <ProtectedRoute>
              <Calendar />
            </ProtectedRoute>
          }
        />
        {/* UI-1: Appointments was renamed Calendar (sidebar consolidation) --
            redirect so old bookmarks/links survive. */}
        <Route path="/appointments" element={<Navigate to="/calendar" replace />} />
        <Route
          path="/appointments/:id"
          element={
            <ProtectedRoute>
              <AppointmentDetail />
            </ProtectedRoute>
          }
        />
        {/* UI-1: the standalone Artists list page folded into Team's Artists
            tab -- redirect so old bookmarks/links survive. Per-artist detail
            (below) is unaffected. */}
        <Route path="/artists" element={<Navigate to="/team?tab=artists" replace />} />
        <Route
          path="/artists/new"
          element={
            <ProtectedRoute>
              <ArtistCreate />
            </ProtectedRoute>
          }
        />
        <Route
          path="/artists/:id"
          element={
            <ProtectedRoute>
              <ArtistDetail />
            </ProtectedRoute>
          }
        />
        <Route
          path="/inquiries"
          element={
            <ProtectedRoute>
              <Inquiries />
            </ProtectedRoute>
          }
        />
        <Route
          path="/inquiries/:id"
          element={
            <ProtectedRoute>
              <InquiryDetail />
            </ProtectedRoute>
          }
        />
        <Route
          path="/my-inquiries"
          element={
            <ProtectedRoute>
              <MyInquiries />
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <Settings />
            </ProtectedRoute>
          }
        />
        <Route
          path="/profile"
          element={
            <ProtectedRoute>
              <Profile />
            </ProtectedRoute>
          }
        />
        <Route
          path="/team"
          element={
            <ProtectedRoute>
              <Team />
            </ProtectedRoute>
          }
        />
        <Route
          path="/tasks"
          element={
            <ProtectedRoute>
              <Tasks />
            </ProtectedRoute>
          }
        />
        <Route
          path="/conversations/:id"
          element={
            <ProtectedRoute>
              <ConversationDeepLink />
            </ProtectedRoute>
          }
        />
        </Routes>
      </IrisReveal>
    </AnimatePresence>
  )
}

function App() {
  return (
    <BrowserRouter>
      <ErrorBoundary label="App">
        <AppRoutes />
      </ErrorBoundary>
      <ViewAsBanner />
      <TopBar />
      <ConversationsPanel />
    </BrowserRouter>
  )
}

export default App
