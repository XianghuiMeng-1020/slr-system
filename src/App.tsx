import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import ErrorBoundary from './components/ErrorBoundary'
import ProtectedRoute from './components/ProtectedRoute'
import ToastContainer from './components/Toast'
import { useI18n } from './i18n'

const WelcomePage = lazy(() => import('./pages/WelcomePage'))
const ModeSelectionPage = lazy(() => import('./pages/ModeSelectionPage'))
const UploadPage = lazy(() => import('./pages/UploadPage'))
const ThemeVerificationPage = lazy(() => import('./pages/ThemeVerificationPage'))
const EvidenceVerificationPage = lazy(() => import('./pages/EvidenceVerificationPage'))
const DashboardPage = lazy(() => import('./pages/DashboardPage'))

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

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Suspense fallback={<LoadingFallback />}>
          <Routes>
            <Route path="/" element={<WelcomePage />} />
            <Route path="/mode" element={<ModeSelectionPage />} />
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
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
        <ToastContainer />
      </BrowserRouter>
    </ErrorBoundary>
  )
}
