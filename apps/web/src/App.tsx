import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import PageFade from './components/PageFade'
import ProtectedRoute from './components/ProtectedRoute'
import AppShellLayout from './components/AppShellLayout'
import AuthLayout from './components/AuthLayout'
import ResetPassword from './pages/ResetPassword'
import InviteAccept from './pages/InviteAccept'
import ArtistInviteAccept from './pages/ArtistInviteAccept'
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
import FlashGallery from './pages/FlashGallery'
import FlashPublicGallery from './pages/FlashPublicGallery'
import FlashPaymentResponse from './pages/FlashPaymentResponse'
import IntakeForm from './pages/IntakeForm'
import Policies from './pages/Policies'
import PublicPolicyPage from './pages/PublicPolicyPage'
import PlatformPolicyPage from './pages/PlatformPolicyPage'
import { PLATFORM_PRIVACY_POLICY_HTML, PLATFORM_TERMS_HTML } from './content/platformPolicies'
import Inquiries from './pages/Inquiries'
import InquiryDetail from './pages/InquiryDetail'
import MyInquiries from './pages/MyInquiries'
import MyProjectDetail from './pages/MyProjectDetail'
import EstimateResponse from './pages/EstimateResponse'
import EstimateRevisionResponse from './pages/EstimateRevisionResponse'
import DepositResponse from './pages/DepositResponse'
import SelfSchedule from './pages/SelfSchedule'
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

// The authenticated app shell (AppShellLayout: persistent Sidebar +
// every protected page) is ONE first-path-segment set -- keying the
// outer PageFade off the bare pathname (as this used to) meant every
// single in-shell navigation (Dashboard -> Clients -> Team, ...) still
// counted as "a new route" up here, forcing AnimatePresence to fully
// exit+enter the whole subtree, Sidebar included, on every click. Same
// underlying issue AuthLayout's own persistence claim turned out not to
// actually hold (verified via DOM node identity -- its background image
// is a fresh element after every /login <-> /forgot-password nav, despite
// that file's own comment) -- not fixed here, out of scope for this pass,
// but the same root cause. Any pathname whose first segment matches an
// app-shell route collapses to one shared key so the shell itself never
// re-enters; AppShellLayout's own inner AnimatePresence (keyed on the
// real pathname) still fades the routed page content on every navigation
// within it -- just without carrying Sidebar along for the ride.
const APP_SHELL_SEGMENTS = new Set([
  'dashboard',
  'clients',
  'calendar',
  'appointments',
  'artists',
  'inquiries',
  'my-inquiries',
  'settings',
  'profile',
  'team',
  'tasks',
  'conversations',
  'gift-cards',
  'flash',
])

function getPageFadeKey(pathname: string): string {
  const firstSegment = pathname.split('/')[1] ?? ''
  return APP_SHELL_SEGMENTS.has(firstSegment) ? 'app-shell' : pathname
}

// mode="popLayout" + a keyed <Routes> (rather than keying individual page
// elements) is the standard React Router + Framer Motion recipe:
// <Routes> itself becomes the thing that exits/enters as a whole when the
// key changes, so no per-page file needs to know about this at all.
// PageFade is a direct AnimatePresence child (forwardRef, same
// requirement as AuthLayout's own AuthCard) since it's a custom component,
// not a plain motion.div. Scoped to just the routed content -- TopBar/
// ConversationsPanel/ViewAsBanner are persistent chrome mounted outside
// this tree and never re-animate on navigation.
function AppRoutes() {
  const location = useLocation()
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      {/* relative z-10 lives on this element now (was a separate wrapper
          div) -- without it, every routed page's own top-level wrapper is
          a plain, non-positioned block, so under CSS's stacking-paint-
          order rules it paints BEHIND any positioned sibling with z-index
          0/auto, including TopBar's own fixed decorative layers (app-bg-
          photo/app-bg-wash), which mount AFTER this tree in the DOM.
          Harmless for Login/public routes -- TopBar returns null with no
          logged-in user, so those layers never mount there regardless;
          this only matters once an authenticated page and TopBar's
          background layers are both on screen at once.
          Discovered for real (not theorized) when app-bg-wash's own
          near-opaque fill visibly blotted out Dashboard's entire card
          grid in a screenshot. */}
      <PageFade key={getPageFadeKey(location.pathname)}>
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
          <Route path="/artist-invite/:token" element={<ArtistInviteAccept />} />
          <Route path="/confirm-email-change/:token" element={<ConfirmEmailChange />} />
        </Route>
        <Route path="/inquiry/:studioSlug" element={<IntakeForm />} />
        <Route path="/inquiry/:studioSlug/:formSlug" element={<IntakeForm />} />
        <Route path="/flash/:studioSlug/:artistId" element={<FlashPublicGallery />} />
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
        <Route path="/flash-payment/:token" element={<FlashPaymentResponse />} />
        <Route path="/schedule/:token" element={<SelfSchedule />} />
        <Route path="/appointments/pay-complete" element={<AppointmentPaymentComplete />} />
        <Route path="/gift-card/:code" element={<GiftCardResponse />} />
        <Route path="/waiver/:token" element={<WaiverSign />} />
        <Route path="/s/:code" element={<ShortLinkRedirect />} />
        {/* UI-1: Appointments was renamed Calendar (sidebar consolidation) --
            redirect so old bookmarks/links survive. */}
        <Route path="/appointments" element={<Navigate to="/calendar" replace />} />
        {/* UI-1: the standalone Artists list page folded into Team's Artists
            tab -- redirect so old bookmarks/links survive. Per-artist detail
            (below) is unaffected. */}
        <Route path="/artists" element={<Navigate to="/team?tab=artists" replace />} />
        {/* Every authenticated app page shares this one persistent shell
            (Sidebar + page-content fade, see AppShellLayout) -- auth is
            checked once here rather than per-page, and Sidebar mounts once
            regardless of which of these routes is active (see
            getPageFadeKey above for why that's actually true and not just
            intended). */}
        <Route element={<ProtectedRoute><AppShellLayout /></ProtectedRoute>}>
          <Route path="/gift-cards/:id" element={<GiftCardDetail />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/clients" element={<Clients />} />
          <Route path="/clients/import" element={<ClientImport />} />
          <Route
            path="/clients/:id"
            element={
              <ErrorBoundary label="ClientDetail">
                <ClientDetail />
              </ErrorBoundary>
            }
          />
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/appointments/:id" element={<AppointmentDetail />} />
          <Route path="/artists/new" element={<ArtistCreate />} />
          <Route path="/artists/:id" element={<ArtistDetail />} />
          <Route path="/inquiries" element={<Inquiries />} />
          <Route path="/inquiries/:id" element={<InquiryDetail />} />
          <Route path="/my-inquiries" element={<MyInquiries />} />
          <Route path="/my-inquiries/:id" element={<MyProjectDetail />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/team" element={<Team />} />
          <Route path="/flash" element={<FlashGallery />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/conversations/:id" element={<ConversationDeepLink />} />
        </Route>
        </Routes>
      </PageFade>
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
