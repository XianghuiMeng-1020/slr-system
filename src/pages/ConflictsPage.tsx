import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, GitMerge } from 'lucide-react'
import { phase2 } from '../services/api'
import { useAppStore } from '../store/useAppStore'

type ConflictRow = {
  document_id: string
  filename: string
  scheme_item_id: string
  code: string
  reviewer_a: string
  reviewer_b: string
}

export default function ConflictsPage() {
  const navigate = useNavigate()
  const projectId = useAppStore((s) => s.projectId)
  const hydrateProjectData = useAppStore((s) => s.hydrateProjectData)
  const [rows, setRows] = useState<ConflictRow[]>([])
  const [irr, setIrr] = useState<{
    percent_agreement?: number | null
    cohens_kappa?: number | null
    pairs?: number
    note?: string
  } | null>(null)

  useEffect(() => {
    hydrateProjectData()
  }, [hydrateProjectData])

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    ;(async () => {
      try {
        const [c, i] = await Promise.all([phase2.conflicts(projectId), phase2.irr(projectId)])
        if (!cancelled) {
          setRows(c.conflicts || [])
          setIrr(i)
        }
      } catch {
        if (!cancelled) {
          setRows([])
          setIrr(null)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId])

  return (
    <div className="min-h-screen bg-surface-50 p-6 dark:bg-surface-950">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-surface-200 bg-white px-3 py-2 text-sm text-surface-600 dark:border-surface-700 dark:bg-surface-900 dark:text-surface-200"
          >
            <ArrowLeft className="h-4 w-4" /> Dashboard
          </button>
          <div className="flex items-center gap-2 text-surface-700 dark:text-surface-100">
            <GitMerge className="h-5 w-5 text-amber-600" />
            <h1 className="text-xl font-semibold">Coding conflicts</h1>
          </div>
        </div>

        {irr && (
          <div className="mb-6 rounded-xl border border-surface-200 bg-white p-4 text-sm dark:border-surface-700 dark:bg-surface-900">
            <h2 className="mb-2 font-semibold text-surface-800 dark:text-surface-100">Inter-rater summary</h2>
            {irr.note ? (
              <p className="text-surface-500">{irr.note}</p>
            ) : (
              <ul className="space-y-1 text-surface-600 dark:text-surface-300">
                <li>Pairs: {irr.pairs ?? 0}</li>
                <li>Percent agreement: {irr.percent_agreement != null ? `${(irr.percent_agreement * 100).toFixed(1)}%` : '—'}</li>
                <li>Cohen&apos;s κ: {irr.cohens_kappa != null ? irr.cohens_kappa.toFixed(3) : '—'}</li>
              </ul>
            )}
          </div>
        )}

        <div className="rounded-xl border border-surface-200 bg-white dark:border-surface-700 dark:bg-surface-900">
          <div className="border-b border-surface-200 px-4 py-3 dark:border-surface-700">
            <p className="text-sm text-surface-600 dark:text-surface-300">
              Rows where two reviewers (with distinct <code className="text-xs">reviewer_id</code>) disagree on the same code.
            </p>
          </div>
          {rows.length === 0 ? (
            <p className="p-6 text-sm text-surface-500">No conflicts found, or fewer than two reviewers have labeled documents.</p>
          ) : (
            <ul className="divide-y divide-surface-100 dark:divide-surface-800">
              {rows.map((r) => (
                <li key={`${r.document_id}-${r.scheme_item_id}`} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-surface-800 dark:text-surface-100">{r.code}</p>
                      <p className="text-xs text-surface-500">{r.filename}</p>
                    </div>
                    <Link
                      to={`/evidence-verification?doc=${encodeURIComponent(r.document_id)}`}
                      className="inline-flex min-h-[44px] items-center rounded-lg bg-primary-50 px-3 py-2 text-sm font-medium text-primary-700 hover:bg-primary-100 dark:bg-primary-950 dark:text-primary-200"
                    >
                      Open document
                    </Link>
                  </div>
                  <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                    <div className="rounded border border-rose-100 bg-rose-50/80 px-3 py-2 dark:border-rose-900 dark:bg-rose-950/40">
                      <span className="text-xs text-rose-700 dark:text-rose-300">Reviewer A</span>
                      <p className="font-medium text-surface-800 dark:text-surface-100">{r.reviewer_a}</p>
                    </div>
                    <div className="rounded border border-emerald-100 bg-emerald-50/80 px-3 py-2 dark:border-emerald-900 dark:bg-emerald-950/40">
                      <span className="text-xs text-emerald-700 dark:text-emerald-300">Reviewer B</span>
                      <p className="font-medium text-surface-800 dark:text-surface-100">{r.reviewer_b}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
