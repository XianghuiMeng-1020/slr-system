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
  BarChart3,
  Loader2,
} from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { api } from '../services/api'
import PDFViewer from '../components/PDFViewer'

type LabelValue = 'Present' | 'Absent' | 'Unclear'

const labelConfig: Record<LabelValue, { icon: typeof CheckCircle2; color: string; bg: string }> = {
  Present: { icon: CheckCircle2, color: 'text-green-600', bg: 'bg-green-50 border-green-200' },
  Absent: { icon: XCircle, color: 'text-red-500', bg: 'bg-red-50 border-red-200' },
  Unclear: { icon: HelpCircle, color: 'text-amber-500', bg: 'bg-amber-50 border-amber-200' },
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

  return (
    <div
      className={`rounded-xl border p-3 transition-all ${isEditing ? 'border-primary-300 bg-primary-50/50 shadow-sm' : config.bg}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-xs font-bold text-surface-700 shadow-sm border border-surface-200">
            {schemeItem.code}
          </span>
          <div>
            <p className="text-sm font-medium text-surface-800">{schemeItem.description}</p>
            {label?.confidence != null && (
              <div className="mt-1 flex items-center gap-2">
                <div
                  className="h-1.5 w-20 rounded-full bg-surface-200"
                  role="progressbar"
                  aria-valuenow={Math.round(label.confidence * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`Confidence: ${Math.round(label.confidence * 100)}%`}
                >
                  <div className="h-full rounded-full bg-primary-500" style={{ width: `${label.confidence * 100}%` }} />
                </div>
                <span className="text-xs text-surface-400">{Math.round(label.confidence * 100)}% conf.</span>
              </div>
            )}
          </div>
        </div>

        {isEditing ? (
          <div className="flex items-center gap-1" role="radiogroup" aria-label={`Label for ${schemeItem.description}`}>
            {(['Present', 'Absent', 'Unclear'] as LabelValue[]).map((v) => {
              const c = labelConfig[v]
              return (
                <button
                  key={v}
                  onClick={() => onChange(v)}
                  role="radio"
                  aria-checked={value === v}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    value === v ? `${c.bg} border ${c.color}` : 'bg-surface-100 text-surface-500 hover:bg-surface-200'
                  }`}
                >
                  {v}
                </button>
              )
            })}
          </div>
        ) : (
          <button
            onClick={onEdit}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${config.bg} ${config.color}`}
            aria-label={`Edit label: currently ${value}`}
            aria-expanded={false}
          >
            <config.icon className="h-3.5 w-3.5" />
            {value}
          </button>
        )}
      </div>
    </div>
  )
})

export default function ThemeVerificationPage() {
  const navigate = useNavigate()
  const { documents, codingScheme, currentDocumentIndex, setCurrentDocumentIndex, updateLabel, loadDocumentDetail, projectId, addToast } =
    useAppStore()

  const [editingLabel, setEditingLabel] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

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

  const handleSave = async () => {
    setSaving(true)
    addToast('success', 'All changes saved automatically')
    setSaving(false)
  }

  const handleExport = () => {
    if (projectId) {
      window.open(api.exportProject(projectId, 'excel'), '_blank')
    }
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
      const cat = item.category || 'Uncategorized'
      if (!acc[cat]) acc[cat] = []
      acc[cat].push(item)
      return acc
    },
    {} as Record<string, typeof codingScheme>,
  )

  return (
    <div className="flex h-screen flex-col bg-surface-100">
      <div className="flex items-center justify-between border-b border-surface-200 bg-white px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/upload')}
            className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-surface-600 hover:bg-surface-100 transition-colors"
            aria-label="Back to upload"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <div className="h-5 w-px bg-surface-200" aria-hidden="true" />
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-600 text-white">
              <BookOpen className="h-4 w-4" />
            </div>
            <span className="font-display font-bold text-surface-900">Theme Verification</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button onClick={() => goToDoc(-1)} disabled={currentDocumentIndex <= 0} className="rounded-lg p-1.5 text-surface-500 hover:bg-surface-100 disabled:opacity-30" aria-label="Previous document">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary-500" />
            <span className="text-sm font-medium text-surface-700">{currentDocumentIndex + 1} / {documents.length}</span>
          </div>
          <button onClick={() => goToDoc(1)} disabled={currentDocumentIndex >= documents.length - 1} className="rounded-lg p-1.5 text-surface-500 hover:bg-surface-100 disabled:opacity-30" aria-label="Next document">
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={handleSave} disabled={saving} className="btn-secondary text-sm py-2" aria-label="Save changes">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
          </button>
          <button onClick={handleExport} className="btn-primary text-sm py-2" aria-label="Export results">
            <Download className="h-4 w-4" /> Export
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="w-1/2 p-3">
          <PDFViewer pdfUrl={pdfUrl} fileName={currentDoc.name} />
        </div>

        <div className="w-1/2 border-l border-surface-200 bg-white flex flex-col">
          <div className="border-b border-surface-200 px-6 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-display text-lg font-semibold text-surface-900">Coding Labels</h2>
                <p className="text-sm text-surface-500 truncate max-w-sm">{currentDoc.name}</p>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-1 text-green-700">
                  <CheckCircle2 className="h-3.5 w-3.5" /> {currentDoc.labels.filter((l) => l.value === 'Present').length}
                </span>
                <span className="flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-1 text-red-600">
                  <XCircle className="h-3.5 w-3.5" /> {currentDoc.labels.filter((l) => l.value === 'Absent').length}
                </span>
                <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-amber-600">
                  <HelpCircle className="h-3.5 w-3.5" /> {currentDoc.labels.filter((l) => l.value === 'Unclear').length}
                </span>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-4">
            {currentDoc.labels.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-surface-400">
                <Loader2 className="h-8 w-8 animate-spin mb-3" />
                <p className="text-sm">Loading labels...</p>
              </div>
            ) : (
              Object.entries(groupedScheme).map(([category, items]) => (
                <div key={category} className="mb-6">
                  <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-surface-400">
                    <BarChart3 className="h-3.5 w-3.5" /> {category}
                  </h3>
                  <div className="space-y-2">
                    {items.map((schemeItem) => (
                      <LabelCard
                        key={schemeItem.id}
                        schemeItem={schemeItem}
                        label={currentDoc.labels.find((l) => l.schemeItemId === schemeItem.id)}
                        isEditing={editingLabel === schemeItem.id}
                        onEdit={() => setEditingLabel(schemeItem.id)}
                        onChange={(v) => handleLabelChange(schemeItem.id, v)}
                      />
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="border-t border-surface-200 px-6 py-3 flex items-center justify-between bg-surface-50">
            <span className="text-xs text-surface-400">Click any label to modify the AI suggestion</span>
            <div className="flex items-center gap-2">
              <button onClick={() => goToDoc(-1)} disabled={currentDocumentIndex <= 0} className="btn-secondary text-xs py-1.5 px-3">
                <ChevronLeft className="h-3.5 w-3.5" /> Previous
              </button>
              <button onClick={() => goToDoc(1)} disabled={currentDocumentIndex >= documents.length - 1} className="btn-primary text-xs py-1.5 px-3">
                Next <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
