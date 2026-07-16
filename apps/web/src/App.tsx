import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Clients from './pages/Clients'
import ClientDetail from './pages/ClientDetail'
import Appointments from './pages/Appointments'
import Artists from './pages/Artists'
import ArtistDetail from './pages/ArtistDetail'
import Settings from './pages/Settings'
import Profile from './pages/Profile'
import Team from './pages/Team'
import SignConsentForm from './pages/SignConsentForm'
import IntakeForm from './pages/IntakeForm'
import Inquiries from './pages/Inquiries'
import InquiryDetail from './pages/InquiryDetail'
import MyInquiries from './pages/MyInquiries'
import EstimateResponse from './pages/EstimateResponse'
import DepositResponse from './pages/DepositResponse'
import GiftCardResponse from './pages/GiftCardResponse'
import GiftCardDetail from './pages/GiftCardDetail'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/login" element={<Login />} />
        <Route path="/sign/:token" element={<SignConsentForm />} />
        <Route path="/inquiry/:studioSlug" element={<IntakeForm />} />
        <Route path="/estimate/:token" element={<EstimateResponse />} />
        <Route path="/deposit/:token" element={<DepositResponse />} />
        <Route path="/gift-card/:code" element={<GiftCardResponse />} />
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
              <ClientDetail />
            </ProtectedRoute>
          }
        />
        <Route
          path="/appointments"
          element={
            <ProtectedRoute>
              <Appointments />
            </ProtectedRoute>
          }
        />
        <Route
          path="/artists"
          element={
            <ProtectedRoute>
              <Artists />
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
      </Routes>
    </BrowserRouter>
  )
}

export default App
