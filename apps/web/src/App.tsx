import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Clients from './pages/Clients'
import ClientDetail from './pages/ClientDetail'
import Calendar from './pages/Calendar'
import AppointmentDetail from './pages/AppointmentDetail'
import ArtistDetail from './pages/ArtistDetail'
import ArtistCreate from './pages/ArtistCreate'
import Settings from './pages/Settings'
import Profile from './pages/Profile'
import Team from './pages/Team'
import SignConsentForm from './pages/SignConsentForm'
import IntakeForm from './pages/IntakeForm'
import Policies from './pages/Policies'
import PublicPolicyPage from './pages/PublicPolicyPage'
import Inquiries from './pages/Inquiries'
import InquiryDetail from './pages/InquiryDetail'
import MyInquiries from './pages/MyInquiries'
import EstimateResponse from './pages/EstimateResponse'
import DepositResponse from './pages/DepositResponse'
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

function App() {
  return (
    <BrowserRouter>
      <ErrorBoundary label="App">
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/login" element={<Login />} />
        <Route path="/sign/:token" element={<SignConsentForm />} />
        <Route path="/inquiry/:studioSlug" element={<IntakeForm />} />
        <Route path="/policies/:studioSlug" element={<Policies />} />
        <Route
          path="/privacy/:studioSlug"
          element={<PublicPolicyPage field="privacyPolicy" title="Privacy Policy" />}
        />
        <Route
          path="/terms/:studioSlug"
          element={<PublicPolicyPage field="termsAndConditions" title="Terms & Conditions" />}
        />
        <Route path="/estimate/:token" element={<EstimateResponse />} />
        <Route path="/deposit/:token" element={<DepositResponse />} />
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
      </ErrorBoundary>
      <ViewAsBanner />
      <TopBar />
      <ConversationsPanel />
    </BrowserRouter>
  )
}

export default App
