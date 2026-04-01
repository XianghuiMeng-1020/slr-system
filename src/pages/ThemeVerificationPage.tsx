import { useState, useEffect, useCallback, memo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Save,
  Download,
  ArrowLeft,
  FileText,
  Loader2,
} from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { api } from '../services/api'
import PDFViewer from '../components/PDFViewer'

type LabelValue = 'Present' | 'Absent' | 'Unclear'

const labelConfig: Record<LabelValue, { icon: typeof CheckCircle2; color: string; bg: string; pill: string }> = {
  Present: { icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200', pill: 'bg-emerald-100 text-emerald-700 border-emerald-300' },
  Absent: { icon: XCircle, color: 'text-rose-500', bg: 'bg-rose-50 border-rose-200', pill: 'bg-rose-100 text-rose-700 border-rose-300' },
  Unclear: { icon: HelpCircle, color: 'text-amber-500', bg: 'bg-amber-50/60 border-amber-200', pill: 'bg-amber-100 text-amber-700 border-amber-300' },
}

const LabelCard = memo(function LabelCard({
  schemeItem,
  label,
  isEditing,
  onEdit,
  onChange,
}: {
  schemeItem: { id: string; code: string; description: string }
  label: { value: string; confidence?: number | null } | undefined
  isEditing: boolean
  onEdit: () => void
  onChange: (value: LabelValue) => void
}) {
  const value = (label?.value || 'Unclear') as LabelValue
  const config = labelConfig[value]
  const Icon = config.icon
  const codeIsSameAsDesc = schemeItem.code.toLowerCase() === schemeItem.description.toLowerCase()
  const displayText = codeIsSameAsDesc ? schemeItem.code : schemeItem.description

  return (
    <div
      className={`group rounded-lg border p-3.5 transition-all cursor-pointer ${
        isEditing
          ? 'border-primary-300 bg-primary-50/40 shadow-sm ring-1 ring-primary-200'
          : `${config.bg} hover:shadow-sm`
      }`}
      onClick={onEdit}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-surface-800 leading-snug">{displayText}</p>
          {!codeIsSameAsDesc && schemeItem.code.length > 4 && (
            <p className="text-[11px] text-surface-400 mt-0.5 leading-tight">{schemeItem.code}</p>
          )}
          {label?.confidence != null && (
            <div className="mt-2 flex items-center gap-2">
              <div className="h-1 w-16 rounded-full bg-surface-200 overflow-hidden">
                <div
                  className={`h-full rounded-full ${value === 'Present' ? 'bg-emerald-400' : value === 'Absent' ? 'bg-rose-400' : 'bg-amber-400'}`}
                  style={{ width: `${label.confidence * 100}%` }}
                />
              </div>
              <span className="text-[10px] text-surface-400 tabular-nums">{Math.round(label.confidence * 100)}%</span>
            </div>
          )}
        </div>

        {isEditing ? (
          <div className="flex items-center gap-1 shrink-0" role="radiogroup" aria-label={`Label for ${displayText}`}>
            {(['Present', 'Absent', 'Unclear'] as LabelValue[]).map((v) => {
              const c = labelConfig[v]
              const VIcon = c.icon
              const selected = value === v
              return (
                <button
                  key={v}
                  onClick={(e) => { e.stopPropagation(); onChange(v) }}
                  role="radio"
                  aria-checked={selected}
                  className={`flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-all ${
                    selected ? `${c.pill} shadow-sm` : 'border-transparent bg-surface-100 text-surface-400 hover:bg-surface-200 hover:text-surface-600'
                  }`}
                >
                  <VIcon className="h-3 w-3" />
                  {v}
                </button>
              )
            })}
          </div>
        ) : (
          <span className={`shrink-0 inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium ${config.pill}`}>
            <Icon className="h-3 w-3" />
            {value}
          </span>
        )}
      </div>
    </div>
  )
})

export default function ThemeVerificationPage() {
  const navigate = useNavigate()
  const documents = useAppStore((s) => s.documents)
  const codingScheme = useAppStore((s) => s.codingScheme)
  const currentDocumentIndex = useAppStore((s) => s.currentDocumentIndex)
  const setCurrentDocumentIndex = useAppStore((s) => s.setCurrentDocumentIndex)
  const updateLabel = useAppStore((s) => s.updateLabel)
  const loadDocumentDetail = useAppStore((s) => s.loadDocumentDetail)
  const projectId = useAppStore((s) => s.projectId)
  const addToast = useAppStore((s) => s.addToast)

  const [editingLabel, setEditingLabel] = useState<string | null>(null)

  const currentDoc = documents[currentDocumentIndex]

  useEffect(() => {
    if (currentDoc && currentDoc.labels.length === 0 && currentDoc.status === 'completed') {
      loadDocumentDetail(currentDoc.id)
    }
  }, [currentDoc?.id, currentDoc?.labels.length, currentDoc?.status, loadDocumentDetail])

  const handleLabelChange = useCallback(
    (codeId: string, value: LabelValue) => {
      if (!currentDoc) return
      updateLabel(currentDoc.id, codeId, value)
      setEditingLabel(null)
    },
    [currentDoc, updateLabel],
  )

  const goToDoc = (delta: number) => {
    const next = currentDocumentIndex + delta
    if (next >= 0 && next < documents.length) setCurrentDocumentIndex(next)
  }

  const handleExport = () => {
    if (projectId) window.open(api.exportProject(projectId, 'excel'), '_blank')
  }

  if (!currentDoc) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <p className="text-surface-500">No documents uploaded.</p>
          <button onClick={() => navigate('/upload')} className="btn-primary mt-4">Go to Upload</button>
        </div>
      </div>
    )
  }

  const pdfUrl = projectId ? api.getDocumentPdfUrl(projectId, currentDoc.id) : null

  const groupedScheme = codingScheme.reduce(
    (acc, item) => {
      const cat = item.category || 'General'
      if (!acc[cat]) acc[cat] = []
      acc[cat].push(item)
      return acc
    },
    {} as Record<string, typeof codingScheme>,
  )

  const presentCount = currentDoc.labels.filter((l) => l.value === 'Present').length
  const absentCount = currentDoc.labels.filter((l) => l.value === 'Absent').length
  const unclearCount = currentDoc.labels.filter((l) => l.value === 'Unclear').length

  return (
    <div className="flex h-screen flex-col bg-surface-50">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-surface-200 bg-white px-4 py-2.5 shadow-sm">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/upload')}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-surface-500 hover:bg-surface-100 hover:text-surface-700 transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </button>
          <div className="h-4 w-px bg-surface-200" />
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-600 text-white">
              <BookOpen className="h-3.5 w-3.5" />
            </div>
            <span className="font-display text-sm font-bold text-surface-900">Theme Verification</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={() => goToDoc(-1)} disabled={currentDocumentIndex <= 0} className="rounded p-1 text-surface-400 hover:bg-surface-100 disabled:opacity-30" aria-label="Previous document">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5 text-primary-500" />
            <span className="text-xs font-medium text-surface-600 tabular-nums">{currentDocumentIndex + 1} / {documents.length}</span>
          </div>
          <button onClick={() => goToDoc(1)} disabled={currentDocumentIndex >= documents.length - 1} className="rounded p-1 text-surface-400 hover:bg-surface-100 disabled:opacity-30" aria-label="Next document">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <button onClick={() => addToast('success', 'All changes saved automatically')} className="btn-secondary text-xs py-1.5 px-3">
            <Save className="h-3.5 w-3.5" /> Save
          </button>
          <button onClick={handleExport} className="btn-primary text-xs py-1.5 px-3">
            <Download className="h-3.5 w-3.5" /> Export
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* PDF viewer */}
        <div className="w-1/2 p-2">
          <PDFViewer pdfUrl={pdfUrl} fileName={currentDoc.name} />
        </div>

        {/* Labels panel */}
        <div className="w-1/2 border-l border-surface-200 bg-white flex flex-col">
          <div className="px-5 py-3.5 border-b border-surface-100">
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-surface-900">Coding Labels</h2>
                <p className="text-[11px] text-surface-400 truncate max-w-[260px] mt-0.5">{currentDoc.name}</p>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                  <CheckCircle2 className="h-3 w-3" /> {presentCount}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-600">
                  <XCircle className="h-3 w-3" /> {absentCount}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-600">
                  <HelpCircle className="h-3 w-3" /> {unclearCount}
                </span>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-3">
            {currentDoc.labels.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-surface-400">
                <Loader2 className="h-7 w-7 animate-spin mb-2" />
                <p className="text-xs">Loading labels...</p>
              </div>
            ) : (
              Object.entries(groupedScheme).map(([category, items]) => (
                <div key={category} className="mb-5 last:mb-0">
                  {Object.keys(groupedScheme).length > 1 && (
                    <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-surface-400">{category}</h3>
                  )}
                  <div className="space-y-1.5">
                    {items.map((schemeItem) => (
                      <LabelCard
                        key={schemeItem.id}
                        schemeItem={schemeItem}
                        label={currentDoc.labels.find((l) => l.schemeItemId === schemeItem.id)}
                        isEditing={editingLabel === schemeItem.id}
                        onEdit={() => setEditingLabel(editingLabel === schemeItem.id ? null : schemeItem.id)}
                        onChange={(v) => handleLabelChange(schemeItem.id, v)}
                      />
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="border-t border-surface-100 px-5 py-2.5 flex items-center justify-between bg-surface-50/50">
            <span className="text-[10px] text-surface-400">Click any item to edit</span>
            <div className="flex items-center gap-1.5">
              <button onClick={() => goToDoc(-1)} disabled={currentDocumentIndex <= 0} className="btn-secondary text-[11px] py-1 px-2.5">
                <ChevronLeft className="h-3 w-3" /> Prev
              </button>
              <button onClick={() => goToDoc(1)} disabled={currentDocumentIndex >= documents.length - 1} className="btn-primary text-[11px] py-1 px-2.5">
                Next <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
