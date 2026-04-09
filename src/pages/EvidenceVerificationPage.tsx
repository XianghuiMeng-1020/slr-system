import { useState, useEffect, useCallback, useRef, memo, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
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
  Keyboard,
  MessageCircle,
  Columns2,
} from 'lucide-react'
import { useAppStore, type EvidenceItem } from '../store/useAppStore'
import { api, phase2 } from '../services/api'
import PDFViewer from '../components/PDFViewer'

const EvidenceCard = memo(function EvidenceCard({
  evidence,
  index,
  isSelected,
  codeName,
  noteExpanded,
  selectedForBatch,
  onClick,
  onResponse,
  onToggleNote,
  onNoteChange,
  onToggleSelect,
}: {
  evidence: EvidenceItem
  index: number
  isSelected: boolean
  codeName: string | null
  noteExpanded: boolean
  selectedForBatch: boolean
  onClick: () => void
  onResponse: (r: 'yes' | 'no') => void
  onToggleNote: () => void
  onNoteChange: (note: string) => void
  onToggleSelect: () => void
}) {
  const [localNote, setLocalNote] = useState(evidence.userNote || '')
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null)

  const handleLocalNoteChange = useCallback((value: string) => {
    setLocalNote(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => onNoteChange(value), 500)
  }, [onNoteChange])

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current) }, [])

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
          <input
            type="checkbox"
            checked={selectedForBatch}
            onChange={(e) => { e.stopPropagation(); onToggleSelect() }}
            onClick={(e) => e.stopPropagation()}
            aria-label="Select evidence for batch review"
          />
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
      <div className="mb-2 flex items-center justify-between gap-2 text-[11px] text-surface-500">
        <span>{evidence.evidenceType || 'contextual'}{evidence.confidence != null ? ` · ${Math.round(evidence.confidence * 100)}%` : ''}</span>
        {evidence.extractedStats && evidence.extractedStats.length > 0 && (
          <span className="rounded bg-surface-100 px-1.5 py-0.5">{evidence.extractedStats.length} stats</span>
        )}
      </div>

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
                value={localNote}
                onChange={(e) => handleLocalNoteChange(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                placeholder="Add your reasoning or observations about this evidence..."
                className="w-full rounded-lg border border-surface-200 bg-surface-50 px-3 py-2 text-sm text-surface-700 placeholder:text-surface-400 focus:border-blue-300 focus:ring-1 focus:ring-blue-200 focus:outline-none resize-none"
                rows={3}
                aria-label="Evidence note"
              />
              {evidence.aiReason && (
                <div className="mt-2 rounded-lg bg-blue-50 px-2 py-1.5 text-xs text-blue-700">
                  <span className="font-medium">Why selected: </span>{evidence.aiReason}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
})

export default function EvidenceVerificationPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const documents = useAppStore((s) => s.documents)
  const codingScheme = useAppStore((s) => s.codingScheme)
  const currentDocumentIndex = useAppStore((s) => s.currentDocumentIndex)
  const setCurrentDocumentIndex = useAppStore((s) => s.setCurrentDocumentIndex)
  const updateEvidence = useAppStore((s) => s.updateEvidence)
  const loadDocumentDetail = useAppStore((s) => s.loadDocumentDetail)
  const projectId = useAppStore((s) => s.projectId)
  const addToast = useAppStore((s) => s.addToast)
  const hydrateProjectData = useAppStore((s) => s.hydrateProjectData)

  const [selectedEvidence, setSelectedEvidence] = useState<EvidenceItem | null>(null)
  const [noteExpanded, setNoteExpanded] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'reviewed'>('all')
  const [query, setQuery] = useState('')
  const [codeFilter, setCodeFilter] = useState<string>('all')
  const [pageRange, setPageRange] = useState('')
  const [minConfidence, setMinConfidence] = useState(0)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [visibleCount, setVisibleCount] = useState(80)
  const [leftWidth, setLeftWidth] = useState<number>(() => Number(localStorage.getItem('evidence-left-width') || '50'))
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [exportFormat, setExportFormat] = useState<'excel' | 'csv' | 'json' | 'bibtex' | 'ris'>('excel')
  const resizingRef = useRef(false)
  const [compareDocId, setCompareDocId] = useState<string | null>(null)
  const [chatOpen, setChatOpen] = useState(false)
  const [chatInput, setChatInput] = useState('')
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([])
  const [chatLoading, setChatLoading] = useState(false)

  const currentDoc = documents[currentDocumentIndex]

  const filteredEvidences = useMemo(() => (currentDoc?.evidences || []).filter((e) => {
    if (filterStatus === 'pending' && e.userResponse) return false
    if (filterStatus === 'reviewed' && !e.userResponse) return false
    if (query && !(`${e.text} ${e.aiReason || ''} ${e.exactQuote || ''}`.toLowerCase().includes(query.toLowerCase()))) return false
    if (codeFilter !== 'all' && !e.relevantCodes.includes(codeFilter)) return false
    if (minConfidence > 0 && (e.confidence || 0) < minConfidence) return false
    if (pageRange.trim()) {
      const m = pageRange.match(/^(\d+)(?:-(\d+))?$/)
      if (m) {
        const start = Number(m[1])
        const end = Number(m[2] || m[1])
        if (!(e.page >= start && e.page <= end)) return false
      }
    }
    return true
  }), [currentDoc, filterStatus, query, codeFilter, minConfidence, pageRange])

  useEffect(() => {
    if (documents.length === 0) {
      hydrateProjectData()
    }
  }, [documents.length, hydrateProjectData])

  useEffect(() => {
    const docId = searchParams.get('doc')
    if (!docId || documents.length === 0) return
    const idx = documents.findIndex((d) => d.id === docId)
    if (idx >= 0) setCurrentDocumentIndex(idx)
  }, [searchParams, documents, setCurrentDocumentIndex])

  useEffect(() => {
    if (currentDoc && currentDoc.evidences.length === 0 && currentDoc.status === 'completed') {
      loadDocumentDetail(currentDoc.id)
    }
  }, [currentDoc, loadDocumentDetail])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizingRef.current) return
      const pct = Math.min(75, Math.max(30, (e.clientX / window.innerWidth) * 100))
      setLeftWidth(pct)
      localStorage.setItem('evidence-left-width', String(pct))
    }
    const onUp = () => { resizingRef.current = false }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  const goToDoc = useCallback((delta: number) => {
    const next = currentDocumentIndex + delta
    if (next >= 0 && next < documents.length) {
      setCurrentDocumentIndex(next)
      setSelectedEvidence(null)
      setVisibleCount(80)
      setSelectedIds(new Set())
    }
  }, [currentDocumentIndex, documents.length, setCurrentDocumentIndex])

  const handleResponse = useCallback((evidenceId: string, response: 'yes' | 'no') => {
    if (!currentDoc) return
    updateEvidence(currentDoc.id, evidenceId, { userResponse: response })
    const ev = currentDoc.evidences.find((e) => e.id === evidenceId)
    if (projectId && ev) {
      phase2
        .feedback(projectId, {
          evidence_id: evidenceId,
          document_id: currentDoc.id,
          response,
          text_preview: ev.text,
        })
        .catch(() => {})
    }
  }, [currentDoc, updateEvidence, projectId])

  const handleNoteChange = useCallback((evidenceId: string, note: string) => {
    if (!currentDoc) return
    updateEvidence(currentDoc.id, evidenceId, { userNote: note })
  }, [currentDoc, updateEvidence])

  const handleExport = useCallback(() => {
    if (projectId) window.open(api.exportProjectExtended(projectId, exportFormat), '_blank')
  }, [projectId, exportFormat])

  const sendPaperChat = useCallback(async () => {
    if (!projectId || !currentDoc) return
    const q = chatInput.trim()
    if (!q) return
    setChatInput('')
    const histForApi = chatMessages.map((m) => ({ role: m.role, content: m.content }))
    setChatMessages((prev) => [...prev, { role: 'user', content: q }])
    setChatLoading(true)
    try {
      const r = await phase2.chatWithPaper(projectId, currentDoc.id, {
        question: q,
        history: histForApi,
      })
      setChatMessages((prev) => [...prev, { role: 'assistant', content: r.answer }])
    } catch {
      setChatMessages((prev) => [...prev, { role: 'assistant', content: 'Chat request failed. Is the API running?' }])
    } finally {
      setChatLoading(false)
    }
  }, [projectId, currentDoc, chatInput, chatMessages])

  useEffect(() => {
    setChatMessages([])
  }, [currentDoc?.id])

  const markBatch = useCallback((value: 'yes' | 'no') => {
    if (!currentDoc || selectedIds.size === 0) return
    selectedIds.forEach((id) => updateEvidence(currentDoc.id, id, { userResponse: value }))
  }, [currentDoc, selectedIds, updateEvidence])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!currentDoc) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        handleExport()
      } else if (e.key.toLowerCase() === 'j') {
        e.preventDefault()
        const list = filteredEvidences
        if (!list.length) return
        const idx = Math.max(0, list.findIndex((x) => x.id === selectedEvidence?.id))
        setSelectedEvidence(list[Math.min(list.length - 1, idx + 1)])
      } else if (e.key.toLowerCase() === 'k') {
        e.preventDefault()
        const list = filteredEvidences
        if (!list.length) return
        const idx = Math.max(0, list.findIndex((x) => x.id === selectedEvidence?.id))
        setSelectedEvidence(list[Math.max(0, idx - 1)])
      } else if (e.key.toLowerCase() === 'y' && selectedEvidence) {
        e.preventDefault()
        updateEvidence(currentDoc.id, selectedEvidence.id, { userResponse: 'yes' })
      } else if (e.key.toLowerCase() === 'n' && selectedEvidence) {
        e.preventDefault()
        updateEvidence(currentDoc.id, selectedEvidence.id, { userResponse: 'no' })
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        goToDoc(1)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        goToDoc(-1)
      } else if (e.key === '?') {
        e.preventDefault()
        setShowShortcuts((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [currentDoc, filteredEvidences, selectedEvidence, updateEvidence, handleExport, goToDoc])

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

        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={compareDocId || ''}
            onChange={(e) => setCompareDocId(e.target.value || null)}
            className="rounded-lg border border-surface-200 bg-white px-2 py-1 text-xs text-surface-600 max-w-[140px]"
            title="Split-screen second document"
            aria-label="Compare with document"
          >
            <option value="">— Split: off —</option>
            {documents.filter((d) => d.id !== currentDoc.id).map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setChatOpen((v) => !v)}
            className={`rounded-lg px-2 py-1.5 text-xs font-medium ${chatOpen ? 'bg-accent-100 text-accent-700' : 'text-surface-600 hover:bg-surface-100'}`}
            aria-pressed={chatOpen}
          >
            <MessageCircle className="inline h-3.5 w-3.5 mr-1" /> Chat
          </button>
          <select
            value={exportFormat}
            onChange={(e) => setExportFormat(e.target.value as typeof exportFormat)}
            className="rounded-lg border border-surface-200 bg-white px-2 py-1 text-xs text-surface-600"
            aria-label="Export format"
          >
            <option value="excel">Excel</option>
            <option value="csv">CSV</option>
            <option value="json">JSON</option>
            <option value="bibtex">BibTeX</option>
            <option value="ris">RIS</option>
          </select>
          <button onClick={() => { addToast('success', 'All changes saved automatically') }} className="btn-secondary text-sm py-2" aria-label="Save changes">
            <Save className="h-4 w-4" /> Save
          </button>
          <button onClick={handleExport} className="btn-primary text-sm py-2" aria-label="Export results">
            <Download className="h-4 w-4" /> Export
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-col p-3 min-h-0" style={{ width: `${leftWidth}%` }}>
          <div className={`flex min-h-0 flex-1 gap-2 ${compareDocId ? 'flex-row' : 'flex-col'}`}>
            <div className="min-h-0 flex-1 flex flex-col">
              <div className="mb-1 flex items-center gap-1 text-[10px] text-surface-400">
                <Columns2 className="h-3 w-3" /> Primary
              </div>
              <div className="min-h-0 flex-1">
                <PDFViewer
                  pdfUrl={pdfUrl}
                  fileName={currentDoc.name}
                  highlightPage={selectedEvidence?.page}
                  highlightBbox={selectedEvidence?.bboxJson}
                  highlights={currentDoc.evidences.map((e) => ({ page: e.page, bbox: e.bboxJson || null }))}
                />
              </div>
            </div>
            {compareDocId && projectId && (
              <div className="min-h-0 flex-1 flex flex-col border-l border-surface-200 pl-2">
                <div className="mb-1 text-[10px] text-surface-400">Compare</div>
                <div className="min-h-0 flex-1">
                  <PDFViewer
                    pdfUrl={api.getDocumentPdfUrl(projectId, compareDocId)}
                    fileName={documents.find((d) => d.id === compareDocId)?.name || 'compare.pdf'}
                    highlightPage={undefined}
                    highlightBbox={undefined}
                    highlights={[]}
                  />
                </div>
              </div>
            )}
          </div>
          {chatOpen && projectId && (
            <div className="mt-2 flex max-h-80 flex-col rounded-lg border border-surface-200 bg-white p-2 text-sm shadow-sm">
              <div className="mb-2 max-h-40 space-y-1 overflow-y-auto text-xs">
                {chatMessages.length === 0 && <p className="text-surface-400">Ask about this paper (RAG).</p>}
                {chatMessages.map((m, i) => (
                  <div key={i} className={m.role === 'user' ? 'text-accent-800' : 'text-surface-700'}>
                    <span className="font-semibold">{m.role === 'user' ? 'You' : 'AI'}:</span> {m.content}
                  </div>
                ))}
                {chatLoading && <p className="text-surface-400">Thinking…</p>}
              </div>
              <div className="flex gap-2">
                <input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      void sendPaperChat()
                    }
                  }}
                  placeholder="Ask a question about this PDF…"
                  className="flex-1 rounded border border-surface-200 px-2 py-1 text-xs"
                />
                <button
                  type="button"
                  className="btn-primary py-1 px-3 text-xs"
                  disabled={chatLoading || !chatInput.trim()}
                  onClick={() => void sendPaperChat()}
                >
                  Send
                </button>
              </div>
            </div>
          )}
        </div>

        <div
          className="w-1 cursor-col-resize bg-surface-200 hover:bg-primary-300"
          onMouseDown={() => { resizingRef.current = true }}
          aria-label="Resize panels"
        />

        <div className="border-l border-surface-200 bg-white flex flex-col" style={{ width: `${100 - leftWidth}%` }}>
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

            <div className="mt-3 grid grid-cols-2 gap-2">
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search evidence text / reason" className="rounded border border-surface-200 px-2 py-1 text-xs" />
              <select value={codeFilter} onChange={(e) => setCodeFilter(e.target.value)} className="rounded border border-surface-200 px-2 py-1 text-xs">
                <option value="all">All Codes</option>
                {codingScheme.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
              </select>
              <input value={pageRange} onChange={(e) => setPageRange(e.target.value)} placeholder="Page range (e.g. 3-8)" className="rounded border border-surface-200 px-2 py-1 text-xs" />
              <input type="number" min={0} max={1} step={0.05} value={minConfidence} onChange={(e) => setMinConfidence(Number(e.target.value) || 0)} placeholder="Min confidence" className="rounded border border-surface-200 px-2 py-1 text-xs" />
            </div>

            <div className="mt-2 flex items-center gap-2">
              <button onClick={() => markBatch('yes')} className="rounded bg-green-50 px-2 py-1 text-xs text-green-700">Batch Yes</button>
              <button onClick={() => markBatch('no')} className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">Batch No</button>
              <button onClick={() => setSelectedIds(new Set(filteredEvidences.map((e) => e.id)))} className="rounded bg-surface-100 px-2 py-1 text-xs text-surface-600">Select Filtered</button>
              <button onClick={() => setSelectedIds(new Set())} className="rounded bg-surface-100 px-2 py-1 text-xs text-surface-600">Clear Selection</button>
              <button onClick={() => setShowShortcuts((v) => !v)} className="ml-auto flex items-center gap-1 rounded bg-surface-100 px-2 py-1 text-xs text-surface-600"><Keyboard className="h-3 w-3" /> Shortcuts</button>
            </div>

            <div className="mt-3 flex items-center gap-3">
              <div
                className="flex-1 h-2 rounded-full bg-surface-100 overflow-hidden"
                role="progressbar"
                aria-valuenow={reviewedCount}
                aria-valuemin={0}
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

          <div
            className="flex-1 overflow-y-auto px-6 py-4 space-y-3"
            onScroll={(e) => {
              const el = e.currentTarget
              if (el.scrollTop + el.clientHeight > el.scrollHeight - 220) setVisibleCount((v) => v + 60)
            }}
          >
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
              filteredEvidences.slice(0, visibleCount).map((evidence, i) => {
                const code = codingScheme.find((c) => evidence.relevantCodes.includes(c.id))
                return (
                  <EvidenceCard
                    key={evidence.id}
                    evidence={evidence}
                    index={i}
                    isSelected={selectedEvidence?.id === evidence.id}
                    codeName={code ? `${code.code}: ${code.description}` : null}
                    noteExpanded={noteExpanded === evidence.id}
                    selectedForBatch={selectedIds.has(evidence.id)}
                    onClick={() => setSelectedEvidence(evidence)}
                    onResponse={(r) => handleResponse(evidence.id, r)}
                    onToggleNote={() => setNoteExpanded(noteExpanded === evidence.id ? null : evidence.id)}
                    onNoteChange={(note) => handleNoteChange(evidence.id, note)}
                    onToggleSelect={() => {
                      setSelectedIds((prev) => {
                        const next = new Set(prev)
                        if (next.has(evidence.id)) next.delete(evidence.id)
                        else next.add(evidence.id)
                        return next
                      })
                    }}
                  />
                )
              })
            )}
            {filteredEvidences.length > visibleCount && (
              <div className="py-2 text-center">
                <button onClick={() => setVisibleCount((v) => v + 80)} className="rounded bg-surface-100 px-3 py-1 text-xs text-surface-600">Load more</button>
              </div>
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
      {showShortcuts && (
        <div className="fixed bottom-4 right-4 z-50 rounded-lg border border-surface-200 bg-white p-3 text-xs text-surface-600 shadow-lg">
          <p className="font-semibold text-surface-700">Keyboard shortcuts</p>
          <p>J/K: next/prev evidence</p>
          <p>Y/N: mark selected yes/no</p>
          <p>Left/Right: switch document</p>
          <p>Ctrl/Cmd+E: export</p>
          <p>?: toggle this help</p>
        </div>
      )}
    </div>
  )
}
