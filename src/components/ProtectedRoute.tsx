import { Navigate } from 'react-router-dom'
import { useAppStore } from '../store/useAppStore'
import { useAuthStore } from '../store/useAuthStore'

interface Props {
  children: React.ReactNode
  requireMode?: boolean
  requireDocuments?: boolean
  requireAuth?: boolean
}

export default function ProtectedRoute({
  children,
  requireMode = false,
  requireDocuments = false,
  requireAuth = true,
}: Props) {
  const mode = useAppStore((s) => s.mode)
  const projectId = useAppStore((s) => s.projectId)
  const user = useAuthStore((s) => s.user)
  const token = useAuthStore((s) => s.token)

  // Check token from both store and localStorage (handles hydration lag)
  const isAuthenticated = !!(user || token || localStorage.getItem('slr-jwt'))

  if (requireAuth && !isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  if (requireMode && (!mode || !projectId)) {
    return <Navigate to="/mode" replace />
  }

  if (requireDocuments && !projectId) {
    return <Navigate to="/upload" replace />
  }

  return <>{children}</>
}
