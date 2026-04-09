import { Navigate } from 'react-router-dom'
import { useAppStore } from '../store/useAppStore'

interface Props {
  children: React.ReactNode
  requireMode?: boolean
  requireDocuments?: boolean
}

export default function ProtectedRoute({ children, requireMode = false, requireDocuments = false }: Props) {
  const mode = useAppStore((s) => s.mode)
  const projectId = useAppStore((s) => s.projectId)

  if (requireMode && (!mode || !projectId)) {
    return <Navigate to="/mode" replace />
  }

  // Allow entry when document cache is empty; pages can hydrate from API on mount.
  if (requireDocuments && !projectId) {
    return <Navigate to="/upload" replace />
  }

  return <>{children}</>
}
