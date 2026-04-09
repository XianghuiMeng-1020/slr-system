import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import ErrorBoundary from './components/ErrorBoundary'
import ProtectedRoute from './components/ProtectedRoute'
import AppHeader from './components/AppHeader'
import ToastContainer from './components/Toast'
import { useAuthStore } from './store/useAuthStore'
import { useI18n } from './i18n'

const WelcomePage = lazy(() => import('./pages/WelcomePage'))
const ModeSelectionPage = lazy(() => import('./pages/ModeSelectionPage'))
const UploadPage = lazy(() => import('./pages/UploadPage'))
const ThemeVerificationPage = lazy(() => import('./pages/ThemeVerificationPage'))
const EvidenceVerificationPage = lazy(() => import('./pages/EvidenceVerificationPage'))
const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const PrismaPage = lazy(() => import('./pages/PrismaPage'))
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage'))
const ShortcutSettingsPage = lazy(() => import('./pages/ShortcutSettingsPage'))
const ProjectSettingsPage = lazy(() => import('./pages/ProjectSettingsPage'))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const ConflictsPage = lazy(() => import('./pages/ConflictsPage'))

function LoadingFallback() {
  const { t } = useI18n()
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-50">
      <div className="text-center">
        <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
        <p className="text-sm text-surface-400">{t('loading')}</p>
      </div>
    </div>
  )
}

const HIDE_HEADER_PATHS = ['/', '/login']

function AppLayout() {
  const location = useLocation()
  const hydrate = useAuthStore((s) => s.hydrate)

  useEffect(() => { hydrate() }, [hydrate])

  const showHeader = !HIDE_HEADER_PATHS.includes(location.pathname)

  return (
    <>
      {showHeader && <AppHeader />}
      <Suspense fallback={<LoadingFallback />}>
        <Routes>
          <Route path="/" element={<WelcomePage />} />
          <Route path="/mode" element={<ProtectedRoute><ModeSelectionPage /></ProtectedRoute>} />
          <Route
            path="/upload"
            element={
              <ProtectedRoute requireMode>
                <UploadPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/theme-verification"
            element={
              <ProtectedRoute requireMode requireDocuments>
                <ThemeVerificationPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/evidence-verification"
            element={
              <ProtectedRoute requireMode requireDocuments>
                <EvidenceVerificationPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute requireMode>
                <DashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/prisma"
            element={
              <ProtectedRoute requireMode>
                <PrismaPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/analytics"
            element={
              <ProtectedRoute requireMode>
                <AnalyticsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/shortcuts"
            element={
              <ProtectedRoute requireMode>
                <ShortcutSettingsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute requireMode>
                <ProjectSettingsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/conflicts"
            element={
              <ProtectedRoute requireMode>
                <ConflictsPage />
              </ProtectedRoute>
            }
          />
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      <ToastContainer />
    </>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AppLayout />
      </BrowserRouter>
    </ErrorBoundary>
  )
}
