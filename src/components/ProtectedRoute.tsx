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
  const documents = useAppStore((s) => s.documents)

  if (requireMode && (!mode || !projectId)) {
    return <Navigate to="/mode" replace />
  }

  if (requireDocuments && documents.length === 0) {
    return <Navigate to="/upload" replace />
  }

  return <>{children}</>
}
