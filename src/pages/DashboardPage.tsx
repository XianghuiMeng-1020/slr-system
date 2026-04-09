import { useMemo, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BarChart3, PieChart, FileText, Search, GitBranch, Grid3x3, Keyboard, Settings2, GitMerge, Sparkles, BookOpen, Zap, ArrowRight } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { useAuthStore } from '../store/useAuthStore'
import { phase2 } from '../services/api'

export default function DashboardPage() {
  const navigate = useNavigate()
  const documents = useAppStore((s) => s.documents)
  const projectId = useAppStore((s) => s.projectId)
  const hydrateProjectData = useAppStore((s) => s.hydrateProjectData)
  const user = useAuthStore((s) => s.user)

  const [zoteroConnected, setZoteroConnected] = useState(false)

  useEffect(() => { hydrateProjectData() }, [hydrateProjectData])
  useEffect(() => {
    if (!projectId) return
    phase2.zoteroStatus(projectId).then((z) => setZoteroConnected(z.connected)).catch(() => {})
  }, [projectId])

  const displayName = user?.email ? user.email.split('@')[0] : null

  const stats = useMemo(() => {
    let present = 0
    let absent = 0
    let unclear = 0
    let reviewedEvidence = 0
    let totalEvidence = 0
    const evidencePerDoc: Array<{ name: string; count: number }> = []
    for (const d of documents) {
      evidencePerDoc.push({ name: d.name, count: d.evidences.length })
      totalEvidence += d.evidences.length
      reviewedEvidence += d.evidences.filter((e) => e.userResponse).length
      for (const l of d.labels) {
        if (l.value === 'Present') present += 1
        else if (l.value === 'Absent') absent += 1
        else unclear += 1
      }
    }
    return { present, absent, unclear, reviewedEvidence, totalEvidence, evidencePerDoc }
  }, [documents])

  const labelTotal = Math.max(1, stats.present + stats.absent + stats.unclear)
  const reviewedPct = stats.totalEvidence > 0 ? Math.round((stats.reviewedEvidence / stats.totalEvidence) * 100) : 0
  const isEmpty = documents.length === 0

  return (
    <div className="min-h-screen bg-surface-50 dark:bg-surface-950">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        {displayName && (
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-surface-900 dark:text-white">
              Hi, {displayName}
            </h1>
            <p className="text-sm text-surface-500">Welcome to your project dashboard</p>
          </div>
        )}

        {isEmpty && (
          <div className="mb-8 rounded-2xl border border-primary-200 bg-gradient-to-br from-primary-50 to-white p-6 dark:border-primary-900 dark:from-primary-950/50 dark:to-surface-900">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-100 text-primary-600 dark:bg-primary-900 dark:text-primary-300">
                <Sparkles className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Set up your project</h2>
                <p className="mt-1 text-sm text-surface-500">Complete these steps to get started with your review.</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <SetupCard
                    done={documents.length > 0}
                    title="Upload documents"
                    desc="Add PDFs for analysis"
                    action={() => navigate('/upload')}
                    icon={<FileText className="h-4 w-4" />}
                  />
                  <SetupCard
                    done={zoteroConnected}
                    title="Connect Zotero"
                    desc="Import from your library"
                    action={() => navigate('/settings')}
                    icon={<BookOpen className="h-4 w-4" />}
                  />
                  <SetupCard
                    done={false}
                    title="Run AI analysis"
                    desc="Process your documents"
                    action={() => navigate('/upload')}
                    icon={<Zap className="h-4 w-4" />}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Link to="/conflicts" className="inline-flex items-center gap-1 rounded-lg border border-surface-200 bg-white px-3 py-2 text-sm hover:bg-surface-50 dark:border-surface-600 dark:bg-surface-900 dark:hover:bg-surface-800"><GitMerge className="h-4 w-4" /> Conflicts</Link>
          <Link to="/prisma" className="inline-flex items-center gap-1 rounded-lg border border-surface-200 bg-white px-3 py-2 text-sm hover:bg-surface-50 dark:border-surface-600 dark:bg-surface-900 dark:hover:bg-surface-800"><GitBranch className="h-4 w-4" /> PRISMA</Link>
          <Link to="/analytics" className="inline-flex items-center gap-1 rounded-lg border border-surface-200 bg-white px-3 py-2 text-sm hover:bg-surface-50 dark:border-surface-600 dark:bg-surface-900 dark:hover:bg-surface-800"><Grid3x3 className="h-4 w-4" /> Heatmap</Link>
          <Link to="/settings" className="inline-flex items-center gap-1 rounded-lg border border-surface-200 bg-white px-3 py-2 text-sm hover:bg-surface-50 dark:border-surface-600 dark:bg-surface-900 dark:hover:bg-surface-800"><Settings2 className="h-4 w-4" /> Settings</Link>
          <Link to="/shortcuts" className="inline-flex items-center gap-1 rounded-lg border border-surface-200 bg-white px-3 py-2 text-sm hover:bg-surface-50 dark:border-surface-600 dark:bg-surface-900 dark:hover:bg-surface-800"><Keyboard className="h-4 w-4" /> Shortcuts</Link>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <Card title="Documents" value={String(documents.length)} icon={<FileText className="h-4 w-4" />} />
          <Card title="Total Evidence" value={String(stats.totalEvidence)} icon={<Search className="h-4 w-4" />} />
          <Card title="Reviewed Evidence" value={`${stats.reviewedEvidence} (${reviewedPct}%)`} icon={<BarChart3 className="h-4 w-4" />} />
          <Card title="Total Labels" value={String(stats.present + stats.absent + stats.unclear)} icon={<PieChart className="h-4 w-4" />} />
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-surface-200 bg-white p-4 dark:border-surface-700 dark:bg-surface-900">
            <h2 className="mb-3 text-sm font-semibold text-surface-700 dark:text-surface-200">Label Distribution</h2>
            <div className="space-y-2 text-xs">
              <Bar label="Present" value={stats.present} total={labelTotal} color="bg-emerald-500" />
              <Bar label="Absent" value={stats.absent} total={labelTotal} color="bg-rose-500" />
              <Bar label="Unclear" value={stats.unclear} total={labelTotal} color="bg-amber-500" />
            </div>
          </div>

          <div className="rounded-xl border border-surface-200 bg-white p-4 dark:border-surface-700 dark:bg-surface-900">
            <h2 className="mb-3 text-sm font-semibold text-surface-700 dark:text-surface-200">Evidence Per Document</h2>
            <div className="max-h-80 space-y-2 overflow-auto">
              {stats.evidencePerDoc.map((d) => (
                <Bar key={d.name} label={d.name} value={d.count} total={Math.max(1, ...stats.evidencePerDoc.map((x) => x.count))} color="bg-primary-500" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function SetupCard({ done, title, desc, action, icon }: { done: boolean; title: string; desc: string; action: () => void; icon: React.ReactNode }) {
  return (
    <button
      onClick={action}
      className={`flex items-start gap-3 rounded-xl border p-3 text-left transition-colors ${
        done
          ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30'
          : 'border-surface-200 bg-white hover:border-primary-300 hover:bg-primary-50/50 dark:border-surface-700 dark:bg-surface-800 dark:hover:border-primary-800'
      }`}
    >
      <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${done ? 'bg-emerald-100 text-emerald-600' : 'bg-surface-100 text-surface-500 dark:bg-surface-700'}`}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${done ? 'text-emerald-700 line-through dark:text-emerald-400' : 'text-surface-800 dark:text-surface-100'}`}>{title}</p>
        <p className="text-xs text-surface-500">{desc}</p>
      </div>
      {!done && <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-surface-400" />}
    </button>
  )
}

function Card({ title, value, icon }: { title: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-surface-200 bg-white p-4 dark:border-surface-700 dark:bg-surface-900">
      <div className="mb-2 flex items-center gap-2 text-xs text-surface-500 dark:text-surface-400">{icon}{title}</div>
      <p className="text-xl font-semibold text-surface-800 dark:text-surface-100">{value}</p>
    </div>
  )
}

function Bar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = Math.round((value / total) * 100)
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="truncate text-surface-600">{label}</span>
        <span className="tabular-nums text-surface-500">{value} ({pct}%)</span>
      </div>
      <div className="h-2 rounded bg-surface-100">
        <div className={`h-full rounded ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
