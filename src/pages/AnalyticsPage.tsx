import { useMemo, useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Grid3x3, Share2 } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { api } from '../services/api'

/** Evidence heatmap (documents × codes) + co-occurrence network summary. */
export default function AnalyticsPage() {
  const projectId = useAppStore((s) => s.projectId)
  const documents = useAppStore((s) => s.documents)
  const [scheme, setScheme] = useState<{ id: string; code: string }[]>([])
  const [matrix, setMatrix] = useState<Record<string, Record<string, number>>>({})

  useEffect(() => {
    if (!projectId) return
    api.getCodingScheme(projectId).then((items) => {
      setScheme(items.map((i) => ({ id: i.id, code: i.code })))
    })
  }, [projectId])

  useEffect(() => {
    if (!projectId || !scheme.length) return
    let cancelled = false
    ;(async () => {
      const next: Record<string, Record<string, number>> = {}
      for (const d of documents) {
        if (d.status !== 'completed') continue
        try {
          const detail = await api.getDocumentDetail(projectId, d.id)
          if (cancelled) return
          next[d.id] = {}
          for (const s of scheme) next[d.id][s.id] = 0
          for (const ev of detail.evidences) {
            for (const cid of ev.relevant_code_ids || []) {
              if (next[d.id][cid] !== undefined) next[d.id][cid] += 1
            }
          }
        } catch {
          /* skip */
        }
      }
      if (!cancelled) setMatrix(next)
    })()
    return () => {
      cancelled = true
    }
  }, [projectId, documents, scheme])

  const maxVal = useMemo(() => {
    let m = 1
    for (const row of Object.values(matrix)) {
      for (const v of Object.values(row)) m = Math.max(m, v)
    }
    return m
  }, [matrix])

  const cooccurrence = useMemo(() => {
    const pair: Record<string, number> = {}
    for (const row of Object.values(matrix)) {
      const codes = Object.entries(row)
        .filter(([, n]) => n > 0)
        .map(([id]) => id)
      for (let i = 0; i < codes.length; i++) {
        for (let j = i + 1; j < codes.length; j++) {
          const a = codes[i] < codes[j] ? codes[i] : codes[j]
          const b = codes[i] < codes[j] ? codes[j] : codes[i]
          const k = `${a}|${b}`
          pair[k] = (pair[k] || 0) + 1
        }
      }
    }
    return Object.entries(pair)
      .sort((x, y) => y[1] - x[1])
      .slice(0, 12)
  }, [matrix])

  const codeLabel = (id: string) => scheme.find((s) => s.id === id)?.code || id

  if (!projectId) {
    return (
      <div className="min-h-screen bg-surface-50 p-8 dark:bg-surface-950">
        <p className="text-surface-600 dark:text-surface-300">No project. <Link className="text-accent-600" to="/mode">Start</Link></p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-surface-50 p-6 dark:bg-surface-950">
      <div className="mx-auto max-w-6xl">
        <Link to="/dashboard" className="mb-6 inline-flex items-center gap-2 text-sm text-surface-500 hover:text-accent-600">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>

        <div className="mb-8 flex items-center gap-3">
          <Grid3x3 className="h-8 w-8 text-accent-600" />
          <div>
            <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Evidence heatmap</h1>
            <p className="text-sm text-surface-500 dark:text-surface-400">Count of evidence items per document × code (completed docs).</p>
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-surface-200 bg-white p-4 dark:border-surface-700 dark:bg-surface-900">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="border border-surface-200 p-2 text-left dark:border-surface-600">Document</th>
                {scheme.map((s) => (
                  <th key={s.id} className="border border-surface-200 p-2 text-xs font-medium dark:border-surface-600 max-w-[100px] truncate" title={s.code}>
                    {s.code}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {documents
                .filter((d) => d.status === 'completed')
                .map((d) => (
                  <tr key={d.id}>
                    <td className="border border-surface-200 p-2 dark:border-surface-600"> {d.name}</td>
                    {scheme.map((s) => {
                      const n = matrix[d.id]?.[s.id] ?? 0
                      const intensity = maxVal ? n / maxVal : 0
                      return (
                        <td
                          key={s.id}
                          className="border border-surface-200 p-2 text-center dark:border-surface-600"
                          style={{
                            backgroundColor: `rgba(59, 130, 246, ${0.15 + intensity * 0.65})`,
                          }}
                        >
                          {n || '—'}
                        </td>
                      )
                    })}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        <div className="mt-10 flex items-center gap-3">
          <Share2 className="h-7 w-7 text-accent-600" />
          <h2 className="text-xl font-semibold text-surface-900 dark:text-white">Code co-occurrence (top pairs)</h2>
        </div>
        <ul className="mt-4 space-y-2 rounded-xl border border-surface-200 bg-white p-4 dark:border-surface-700 dark:bg-surface-900">
          {cooccurrence.length === 0 && <li className="text-surface-500">No overlapping codes yet.</li>}
          {cooccurrence.map(([pair, n]) => {
            const [a, b] = pair.split('|')
            return (
              <li key={pair} className="flex justify-between text-sm">
                <span className="text-surface-700 dark:text-surface-200">
                  {codeLabel(a)} + {codeLabel(b)}
                </span>
                <span className="font-mono text-surface-500">{n} docs</span>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
