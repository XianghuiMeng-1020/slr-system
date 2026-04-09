import { useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, BarChart3, PieChart, FileText, Search } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'

export default function DashboardPage() {
  const navigate = useNavigate()
  const documents = useAppStore((s) => s.documents)
  const hydrateProjectData = useAppStore((s) => s.hydrateProjectData)

  useEffect(() => { hydrateProjectData() }, [hydrateProjectData])

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

  return (
    <div className="min-h-screen bg-surface-50 p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-center justify-between">
          <button onClick={() => navigate('/upload')} className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm text-surface-600 border border-surface-200">
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <div className="flex items-center gap-2 text-surface-700">
            <BarChart3 className="h-5 w-5 text-primary-600" />
            <h1 className="text-xl font-semibold">Project Dashboard</h1>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <Card title="Documents" value={String(documents.length)} icon={<FileText className="h-4 w-4" />} />
          <Card title="Total Evidence" value={String(stats.totalEvidence)} icon={<Search className="h-4 w-4" />} />
          <Card title="Reviewed Evidence" value={`${stats.reviewedEvidence} (${reviewedPct}%)`} icon={<BarChart3 className="h-4 w-4" />} />
          <Card title="Total Labels" value={String(stats.present + stats.absent + stats.unclear)} icon={<PieChart className="h-4 w-4" />} />
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-surface-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-surface-700">Label Distribution</h2>
            <div className="space-y-2 text-xs">
              <Bar label="Present" value={stats.present} total={labelTotal} color="bg-emerald-500" />
              <Bar label="Absent" value={stats.absent} total={labelTotal} color="bg-rose-500" />
              <Bar label="Unclear" value={stats.unclear} total={labelTotal} color="bg-amber-500" />
            </div>
          </div>

          <div className="rounded-xl border border-surface-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-surface-700">Evidence Per Document</h2>
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

function Card({ title, value, icon }: { title: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-surface-200 bg-white p-4">
      <div className="mb-2 flex items-center gap-2 text-xs text-surface-500">{icon}{title}</div>
      <p className="text-xl font-semibold text-surface-800">{value}</p>
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
