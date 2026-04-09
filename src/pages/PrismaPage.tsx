import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, GitBranch } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'

/** PRISMA-style flow diagram (counts from current project). */
export default function PrismaPage() {
  const projectId = useAppStore((s) => s.projectId)
  const documents = useAppStore((s) => s.documents)

  const stats = useMemo(() => {
    const total = documents.length
    const completed = documents.filter((d) => d.status === 'completed').length
    const pending = documents.filter((d) => d.status === 'pending').length
    const processing = documents.filter((d) => d.status === 'processing').length
    const err = documents.filter((d) => d.status === 'error').length
    return { total, completed, pending, processing, err, screened: completed + err }
  }, [documents])

  if (!projectId) {
    return (
      <div className="min-h-screen bg-surface-50 p-8 dark:bg-surface-950">
        <p className="text-surface-600 dark:text-surface-300">No project. <Link className="text-accent-600" to="/mode">Start</Link></p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-surface-50 to-white p-6 dark:from-surface-950 dark:to-surface-900">
      <div className="mx-auto max-w-4xl">
        <Link to="/dashboard" className="mb-6 inline-flex items-center gap-2 text-sm text-surface-500 hover:text-accent-600 dark:text-surface-400">
          <ArrowLeft className="h-4 w-4" /> Back to dashboard
        </Link>
        <div className="flex items-center gap-3 mb-8">
          <GitBranch className="h-8 w-8 text-accent-600" />
          <div>
            <h1 className="text-2xl font-bold text-surface-900 dark:text-white">PRISMA flow (live)</h1>
            <p className="text-sm text-surface-500 dark:text-surface-400">Screening counts update from your uploaded documents.</p>
          </div>
        </div>

        <div className="rounded-2xl border border-surface-200 bg-white p-8 shadow-sm dark:border-surface-700 dark:bg-surface-900">
          <svg viewBox="0 0 400 420" className="mx-auto w-full max-w-md text-surface-800 dark:text-surface-100">
            <rect x="120" y="10" width="160" height="48" rx="8" fill="currentColor" className="text-accent-100 dark:text-accent-900/40" stroke="currentColor" strokeWidth="2" />
            <text x="200" y="40" textAnchor="middle" className="fill-surface-900 text-sm font-semibold dark:fill-white">Records identified</text>
            <text x="200" y="58" textAnchor="middle" className="fill-surface-600 text-xs dark:fill-surface-300">{stats.total} documents</text>

            <line x1="200" y1="58" x2="200" y2="88" stroke="currentColor" strokeWidth="2" className="text-surface-400" />
            <polygon points="200,98 190,88 210,88" fill="currentColor" className="text-surface-400" />

            <rect x="100" y="98" width="200" height="56" rx="8" fill="currentColor" className="text-surface-100 dark:text-surface-800" stroke="currentColor" strokeWidth="2" />
            <text x="200" y="125" textAnchor="middle" className="fill-surface-900 text-sm font-medium dark:fill-white">Screening</text>
            <text x="200" y="145" textAnchor="middle" className="fill-surface-600 text-xs dark:fill-surface-300">Pending {stats.pending} · Processing {stats.processing}</text>

            <line x1="200" y1="154" x2="200" y2="180" stroke="currentColor" strokeWidth="2" className="text-surface-400" />
            <polygon points="200,190 190,180 210,180" fill="currentColor" className="text-surface-400" />

            <rect x="100" y="190" width="200" height="56" rx="8" fill="currentColor" className="text-emerald-100 dark:text-emerald-900/30" stroke="currentColor" strokeWidth="2" />
            <text x="200" y="217" textAnchor="middle" className="fill-surface-900 text-sm font-medium dark:fill-white">Included (completed)</text>
            <text x="200" y="237" textAnchor="middle" className="fill-surface-600 text-xs dark:fill-surface-300">{stats.completed} coded</text>

            <line x1="200" y1="246" x2="200" y2="272" stroke="currentColor" strokeWidth="2" className="text-surface-400" />
            <polygon points="200,282 190,272 210,272" fill="currentColor" className="text-surface-400" />

            <rect x="100" y="282" width="200" height="56" rx="8" fill="currentColor" className="text-amber-100 dark:text-amber-900/30" stroke="currentColor" strokeWidth="2" />
            <text x="200" y="309" textAnchor="middle" className="fill-surface-900 text-sm font-medium dark:fill-white">Excluded / errors</text>
            <text x="200" y="329" textAnchor="middle" className="fill-surface-600 text-xs dark:fill-surface-300">{stats.err} failed</text>

            <line x1="200" y1="338" x2="200" y2="364" stroke="currentColor" strokeWidth="2" className="text-surface-400" />
            <polygon points="200,374 190,364 210,364" fill="currentColor" className="text-surface-400" />

            <rect x="80" y="374" width="240" height="40" rx="8" fill="currentColor" className="text-accent-50 dark:text-accent-950/50" stroke="currentColor" strokeWidth="2" />
            <text x="200" y="399" textAnchor="middle" className="fill-surface-900 text-sm font-semibold dark:fill-white">Synthesis-ready: {stats.completed}</text>
          </svg>
        </div>
      </div>
    </div>
  )
}
