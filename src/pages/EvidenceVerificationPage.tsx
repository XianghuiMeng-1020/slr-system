import { useState, useEffect, useCallback, memo } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronLeft,
  ChevronRight,
  ThumbsUp,
  ThumbsDown,
  MessageSquare,
  Save,
  Download,
  ArrowLeft,
  FileText,
  Search,
  ExternalLink,
  MapPin,
  StickyNote,
  CheckCircle2,
  XCircle,
  Filter,
  Loader2,
} from 'lucide-react'
import { useAppStore, type EvidenceItem } from '../store/useAppStore'
import { api } from '../services/api'
import PDFViewer from '../components/PDFViewer'

const EvidenceCard = memo(function EvidenceCard({
  evidence,
  index,
  isSelected,
  codeName,
  noteExpanded,
  onClick,
  onResponse,
  onToggleNote,
  onNoteChange,
}: {
  evidence: EvidenceItem
  index: number
  isSelected: boolean
  codeName: string | null
  noteExpanded: boolean
  onClick: () => void
  onResponse: (r: 'yes' | 'no') => void
  onToggleNote: () => void
  onNoteChange: (note: string) => void
}) {
  return (
    <div
      className={`rounded-xl border-2 p-4 cursor-pointer transition-all duration-200 ${
        isSelected
          ? 'border-accent-400 bg-accent-50/50 shadow-md ring-1 ring-accent-200'
          : evidence.userResponse
            ? 'border-surface-200 bg-surface-50'
            : 'border-surface-200 bg-white hover:border-accent-200 hover:shadow-sm'
      }`}
      onClick={onClick}
      role="button"
      aria-label={`Evidence ${index + 1}: ${evidence.text.slice(0, 60)}...`}
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent-100 text-xs font-bold text-accent-700">
            {index + 1}
          </span>
          {codeName && (
            <span className="rounded-md bg-surface-100 px-2 py-0.5 text-xs font-medium text-surface-600">{codeName}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <MapPin className="h-3.5 w-3.5 text-surface-400" />
          <span className="text-xs text-surface-400">p.{evidence.page}</span>
          {isSelected && <ExternalLink className="h-3.5 w-3.5 text-accent-500 ml-1" />}
        </div>
      </div>

      <p className="text-sm text-surface-700 leading-relaxed mb-3 line-clamp-3">"{evidence.text}"</p>

      <div className="flex items-center gap-2">
        <span className="text-xs text-surface-400 mr-1">Does this evidence support your coding decision?</span>
        <button
          onClick={(e) => { e.stopPropagation(); onResponse('yes') }}
          className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
            evidence.userResponse === 'yes'
              ? 'bg-green-100 text-green-700 border border-green-300 shadow-sm'
              : 'bg-surface-100 text-surface-500 hover:bg-green-50 hover:text-green-600'
          }`}
          aria-pressed={evidence.userResponse === 'yes'}
          aria-label="Yes, this evidence supports my decision"
        >
          <ThumbsUp className="h-3.5 w-3.5" /> Yes
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onResponse('no') }}
          className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
            evidence.userResponse === 'no'
              ? 'bg-red-100 text-red-700 border border-red-300 shadow-sm'
              : 'bg-surface-100 text-surface-500 hover:bg-red-50 hover:text-red-600'
          }`}
          aria-pressed={evidence.userResponse === 'no'}
          aria-label="No, this evidence does not support my decision"
        >
          <ThumbsDown className="h-3.5 w-3.5" /> No
        </button>

        <button
          onClick={(e) => { e.stopPropagation(); onToggleNote() }}
          className={`ml-auto flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all ${
            noteExpanded || evidence.userNote ? 'bg-blue-100 text-blue-700' : 'bg-surface-100 text-surface-400 hover:bg-blue-50 hover:text-blue-500'
          }`}
          aria-expanded={noteExpanded}
          aria-label="Toggle note"
        >
          <StickyNote className="h-3.5 w-3.5" /> Note
        </button>

        {evidence.userResponse && <CheckCircle2 className="h-4 w-4 text-green-500 ml-1" />}
      </div>

      <AnimatePresence>
        {noteExpanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="mt-3 pt-3 border-t border-surface-200">
              <div className="flex items-center gap-1.5 mb-2">
                <MessageSquare className="h-3.5 w-3.5 text-blue-500" />
                <span className="text-xs font-medium text-surface-600">Optional Note</span>
              </div>
              <textarea
                value={evidence.userNote || ''}
                onChange={(e) => onNoteChange(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                placeholder="Add your reasoning or observations about this evidence..."
                className="w-full rounded-lg border border-surface-200 bg-surface-50 px-3 py-2 text-sm text-surface-700 placeholder:text-surface-400 focus:border-blue-300 focus:ring-1 focus:ring-blue-200 focus:outline-none resize-none"
                rows={3}
                aria-label="Evidence note"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
})

export default function EvidenceVerificationPage() {
  const navigate = useNavigate()
  const {
    documents, codingScheme, currentDocumentIndex, setCurrentDocumentIndex,
    updateEvidence, loadDocumentDetail, projectId, addToast,
  } = useAppStore()

  const [selectedEvidence, setSelectedEvidence] = useState<EvidenceItem | null>(null)
  const [noteExpanded, setNoteExpanded] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'reviewed'>('all')

  const currentDoc = documents[currentDocumentIndex]

  useEffect(() => {
    if (currentDoc && currentDoc.evidences.length === 0 && currentDoc.status === 'completed') {
      loadDocumentDetail(currentDoc.id)
    }
  }, [currentDoc?.id, currentDoc?.evidences.length, currentDoc?.status, loadDocumentDetail])

  const goToDoc = (delta: number) => {
    const next = currentDocumentIndex + delta
    if (next >= 0 && next < documents.length) {
      setCurrentDocumentIndex(next)
      setSelectedEvidence(null)
    }
  }

  const handleResponse = useCallback((evidenceId: string, response: 'yes' | 'no') => {
    if (!currentDoc) return
    updateEvidence(currentDoc.id, evidenceId, { userResponse: response })
  }, [currentDoc, updateEvidence])

  const handleNoteChange = useCallback((evidenceId: string, note: string) => {
    if (!currentDoc) return
    updateEvidence(currentDoc.id, evidenceId, { userNote: note })
  }, [currentDoc, updateEvidence])

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

  const filteredEvidences = currentDoc.evidences.filter((e) => {
    if (filterStatus === 'pending') return !e.userResponse
    if (filterStatus === 'reviewed') return !!e.userResponse
    return true
  })

  const reviewedCount = currentDoc.evidences.filter((e) => e.userResponse).length
  const totalCount = currentDoc.evidences.length
  const progressPercent = totalCount > 0 ? (reviewedCount / totalCount) * 100 : 0

  return (
    <div className="flex h-screen flex-col bg-surface-100">
      <div className="flex items-center justify-between border-b border-surface-200 bg-white px-4 py-3">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/upload')} className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-surface-600 hover:bg-surface-100 transition-colors" aria-label="Back to upload">
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <div className="h-5 w-px bg-surface-200" aria-hidden="true" />
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-600 text-white">
              <Search className="h-4 w-4" />
            </div>
            <span className="font-display font-bold text-surface-900">Evidence Verification</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button onClick={() => goToDoc(-1)} disabled={currentDocumentIndex <= 0} className="rounded-lg p-1.5 text-surface-500 hover:bg-surface-100 disabled:opacity-30" aria-label="Previous document">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-accent-500" />
            <span className="text-sm font-medium text-surface-700">{currentDocumentIndex + 1} / {documents.length}</span>
          </div>
          <button onClick={() => goToDoc(1)} disabled={currentDocumentIndex >= documents.length - 1} className="rounded-lg p-1.5 text-surface-500 hover:bg-surface-100 disabled:opacity-30" aria-label="Next document">
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={() => { addToast('success', 'All changes saved automatically') }} className="btn-secondary text-sm py-2" aria-label="Save changes">
            <Save className="h-4 w-4" /> Save
          </button>
          <button onClick={handleExport} className="btn-primary text-sm py-2" aria-label="Export results">
            <Download className="h-4 w-4" /> Export
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="w-1/2 p-3">
          <PDFViewer
            pdfUrl={pdfUrl}
            fileName={currentDoc.name}
            highlightPage={selectedEvidence?.page}
            highlightBbox={selectedEvidence?.bboxJson}
          />
        </div>

        <div className="w-1/2 border-l border-surface-200 bg-white flex flex-col">
          <div className="border-b border-surface-200 px-6 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-display text-lg font-semibold text-surface-900">Evidence Review</h2>
                <p className="text-sm text-surface-500 truncate max-w-sm">{currentDoc.name}</p>
              </div>
              <div className="flex items-center gap-2" role="group" aria-label="Filter evidence">
                <Filter className="h-4 w-4 text-surface-400" />
                {(['all', 'pending', 'reviewed'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilterStatus(f)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                      filterStatus === f ? 'bg-accent-100 text-accent-700' : 'text-surface-400 hover:bg-surface-100'
                    }`}
                    aria-pressed={filterStatus === f}
                  >
                    {f.charAt(0).toUpperCase() + f.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-3 flex items-center gap-3">
              <div
                className="flex-1 h-2 rounded-full bg-surface-100 overflow-hidden"
                role="progressbar"
                aria-valuenow={reviewedCount}
                aria-valuemax={totalCount}
                aria-label={`${reviewedCount} of ${totalCount} evidence reviewed`}
              >
                <motion.div
                  className="h-full bg-gradient-to-r from-accent-500 to-accent-600 rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${progressPercent}%` }}
                  transition={{ duration: 0.5, ease: 'easeOut' }}
                />
              </div>
              <span className="text-xs font-medium text-surface-500">{reviewedCount}/{totalCount}</span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
            {currentDoc.evidences.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-surface-400">
                <Loader2 className="h-8 w-8 animate-spin mb-3" />
                <p className="text-sm">Loading evidence...</p>
              </div>
            ) : filteredEvidences.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-surface-400">
                <Search className="h-10 w-10 mb-3 opacity-40" />
                <p className="text-sm">
                  {filterStatus === 'pending' ? 'All evidence has been reviewed!' : 'No evidence found for this filter.'}
                </p>
              </div>
            ) : (
              filteredEvidences.map((evidence, i) => {
                const code = codingScheme.find((c) => evidence.relevantCodes.includes(c.id))
                return (
                  <EvidenceCard
                    key={evidence.id}
                    evidence={evidence}
                    index={i}
                    isSelected={selectedEvidence?.id === evidence.id}
                    codeName={code ? `${code.code}: ${code.description}` : null}
                    noteExpanded={noteExpanded === evidence.id}
                    onClick={() => setSelectedEvidence(evidence)}
                    onResponse={(r) => handleResponse(evidence.id, r)}
                    onToggleNote={() => setNoteExpanded(noteExpanded === evidence.id ? null : evidence.id)}
                    onNoteChange={(note) => handleNoteChange(evidence.id, note)}
                  />
                )
              })
            )}
          </div>

          <div className="border-t border-surface-200 px-6 py-3 flex items-center justify-between bg-surface-50">
            <div className="flex items-center gap-3 text-xs text-surface-400">
              <span className="flex items-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                {currentDoc.evidences.filter((e) => e.userResponse === 'yes').length} supported
              </span>
              <span className="flex items-center gap-1">
                <XCircle className="h-3.5 w-3.5 text-red-400" />
                {currentDoc.evidences.filter((e) => e.userResponse === 'no').length} not supported
              </span>
            </div>
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
