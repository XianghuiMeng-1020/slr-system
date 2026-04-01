import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Upload,
  FileText,
  FileArchive,
  Table2,
  X,
  AlertCircle,
  CheckCircle2,
  Loader2,
  ClipboardPaste,
} from 'lucide-react'
import { useAppStore } from '../store/useAppStore'

export default function UploadPage() {
  const navigate = useNavigate()
  const mode = useAppStore((s) => s.mode)
  const documents = useAppStore((s) => s.documents)
  const codingScheme = useAppStore((s) => s.codingScheme)
  const codingSchemeFileName = useAppStore((s) => s.codingSchemeFileName)
  const isProcessing = useAppStore((s) => s.isProcessing)
  const isUploading = useAppStore((s) => s.isUploading)
  const uploadDocuments = useAppStore((s) => s.uploadDocuments)
  const removeDocument = useAppStore((s) => s.removeDocument)
  const uploadCodingScheme = useAppStore((s) => s.uploadCodingScheme)
  const submitCodingSchemeText = useAppStore((s) => s.submitCodingSchemeText)
  const processDocuments = useAppStore((s) => s.processDocuments)
  const addToast = useAppStore((s) => s.addToast)
  const ensureValidProject = useAppStore((s) => s.ensureValidProject)

  const [dragActive, setDragActive] = useState(false)
  const [schemeDragActive, setSchemeDragActive] = useState(false)
  const [validating, setValidating] = useState(true)
  const [schemeTab, setSchemeTab] = useState<'upload' | 'paste'>('upload')
  const [pasteText, setPasteText] = useState('')
  const [pasteSubmitting, setPasteSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false
    ensureValidProject().then((ok) => {
      if (cancelled) return
      setValidating(false)
      if (!ok) navigate('/mode')
    })
    return () => { cancelled = true }
  }, [ensureValidProject, navigate])

  const handleDocFiles = useCallback(
    async (files: FileList | File[]) => {
      const arr = Array.from(files).filter(
        (f) => f.type === 'application/pdf' || f.name.endsWith('.zip'),
      )
      if (arr.length === 0) {
        addToast('warning', 'Please select PDF or ZIP files only.')
        return
      }
      if (arr.length + documents.length > 50) {
        addToast('warning', 'Maximum 50 documents allowed.')
        return
      }
      await uploadDocuments(arr)
    },
    [uploadDocuments, documents.length, addToast],
  )

  const handleSchemeFile = useCallback(
    async (file: File) => {
      const ext = file.name.split('.').pop()?.toLowerCase()
      if (!['csv', 'xlsx', 'xls', 'json'].includes(ext || '')) {
        addToast('warning', 'Please upload a CSV, XLSX, or JSON file.')
        return
      }
      await uploadCodingScheme(file)
    },
    [uploadCodingScheme, addToast],
  )

  const handleDrop = useCallback(
    (e: React.DragEvent, type: 'docs' | 'scheme') => {
      e.preventDefault()
      if (type === 'docs') {
        setDragActive(false)
        handleDocFiles(e.dataTransfer.files)
      } else {
        setSchemeDragActive(false)
        const file = e.dataTransfer.files[0]
        if (file) handleSchemeFile(file)
      }
    },
    [handleDocFiles, handleSchemeFile],
  )

  const handlePasteSubmit = useCallback(async () => {
    if (!pasteText.trim()) {
      addToast('warning', 'Please paste your coding scheme first.')
      return
    }
    setPasteSubmitting(true)
    await submitCodingSchemeText(pasteText.trim())
    setPasteSubmitting(false)
  }, [pasteText, submitCodingSchemeText, addToast])

  const canProceed = documents.length > 0 && codingScheme.length > 0

  const handleContinue = async () => {
    if (!canProceed) return
    await processDocuments()
    navigate(mode === 'theme-verification' ? '/theme-verification' : '/evidence-verification')
  }

  if (validating) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-50">
        <div className="text-center">
          <Loader2 className="mx-auto mb-4 h-10 w-10 animate-spin text-primary-600" />
          <p className="text-sm text-surface-400">Validating project...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-surface-50 via-white to-primary-50/20">
      <nav className="fixed top-0 inset-x-0 z-50 glass">
        <div className="mx-auto max-w-7xl flex items-center justify-between px-6 py-4">
          <button
            onClick={() => navigate('/mode')}
            className="flex items-center gap-3 text-surface-600 hover:text-surface-900 transition-colors"
            aria-label="Go back to mode selection"
          >
            <ArrowLeft className="h-5 w-5" />
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-600 text-white">
                <BookOpen className="h-4 w-4" />
              </div>
              <span className="font-display font-bold text-surface-900">
                SLR<span className="text-primary-600">System</span>
              </span>
            </div>
          </button>
          <div className="flex items-center gap-2 text-sm text-surface-400" aria-label="Progress steps">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-100 text-xs font-bold text-primary-600">
              <CheckCircle2 className="h-3.5 w-3.5" />
            </span>
            <span className="text-primary-600">Mode</span>
            <span className="mx-2 text-surface-300" aria-hidden="true">→</span>
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-600 text-xs font-bold text-white">
              2
            </span>
            Upload
            <span className="mx-2 text-surface-300" aria-hidden="true">→</span>
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-200 text-xs font-bold text-surface-500">
              3
            </span>
            <span className="text-surface-400">Review</span>
          </div>
        </div>
      </nav>

      <div className="pt-28 pb-20 px-6">
        <div className="mx-auto max-w-5xl">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-12">
            <h1 className="font-display text-4xl sm:text-5xl font-bold text-surface-900">Upload Documents</h1>
            <p className="mt-4 text-lg text-surface-500 max-w-xl mx-auto">
              Upload your PDF papers and coding scheme to begin the{' '}
              {mode === 'theme-verification' ? 'theme' : 'evidence'} verification process.
            </p>
          </motion.div>

          <div className="grid lg:grid-cols-2 gap-8">
            {/* PDF Upload */}
            <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 }} className="card">
              <div className="flex items-center gap-3 mb-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-100 text-primary-600">
                  <FileText className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="font-display text-lg font-semibold text-surface-900">Research Papers</h2>
                  <p className="text-xs text-surface-400">PDF files or ZIP archive — Max 50 documents</p>
                </div>
              </div>

              <div
                onDragOver={(e) => { e.preventDefault(); setDragActive(true) }}
                onDragLeave={() => setDragActive(false)}
                onDrop={(e) => handleDrop(e, 'docs')}
                className={`relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 transition-all ${
                  dragActive ? 'border-primary-400 bg-primary-50' : 'border-surface-300 hover:border-primary-300 hover:bg-surface-50'
                }`}
                role="region"
                aria-label="Document upload area"
              >
                {isUploading ? (
                  <Loader2 className="h-10 w-10 mb-3 text-primary-500 animate-spin" />
                ) : (
                  <Upload className={`h-10 w-10 mb-3 ${dragActive ? 'text-primary-500' : 'text-surface-400'}`} />
                )}
                <p className="text-sm font-medium text-surface-700">
                  {isUploading ? 'Uploading...' : 'Drag & drop files here'}
                </p>
                {!isUploading && <p className="mt-1 text-xs text-surface-400">or</p>}
                {!isUploading && (
                  <label className="mt-3 cursor-pointer rounded-lg bg-primary-50 px-4 py-2 text-sm font-medium text-primary-600 hover:bg-primary-100 transition-colors">
                    Browse Files
                    <input
                      type="file"
                      className="hidden"
                      multiple
                      accept=".pdf,.zip"
                      onChange={(e) => {
                        if (e.target.files) handleDocFiles(e.target.files)
                        e.target.value = ''
                      }}
                    />
                  </label>
                )}
                <div className="mt-3 flex items-center gap-4 text-xs text-surface-400">
                  <span className="flex items-center gap-1"><FileText className="h-3.5 w-3.5" /> PDF</span>
                  <span className="flex items-center gap-1"><FileArchive className="h-3.5 w-3.5" /> ZIP</span>
                </div>
              </div>

              {documents.length > 0 && (
                <div className="mt-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-surface-700">
                      {documents.length} document{documents.length > 1 ? 's' : ''} uploaded
                    </span>
                    <span className="text-xs text-surface-400">{50 - documents.length} slots remaining</span>
                  </div>
                  <div className="max-h-48 overflow-y-auto space-y-1.5 rounded-lg">
                    <AnimatePresence>
                      {documents.map((doc) => (
                        <motion.div
                          key={doc.id}
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="flex items-center justify-between rounded-lg bg-surface-50 px-3 py-2"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <FileText className="h-4 w-4 shrink-0 text-primary-500" />
                            <span className="text-sm text-surface-700 truncate">{doc.name}</span>
                            <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                              doc.status === 'completed' ? 'bg-green-100 text-green-700'
                                : doc.status === 'processing' ? 'bg-blue-100 text-blue-700'
                                : doc.status === 'error' ? 'bg-red-100 text-red-700'
                                : 'bg-surface-100 text-surface-500'
                            }`}>
                              {doc.status}
                            </span>
                          </div>
                          <button
                            onClick={() => removeDocument(doc.id)}
                            className="p-1 text-surface-400 hover:text-red-500 transition-colors"
                            aria-label={`Remove ${doc.name}`}
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                </div>
              )}
            </motion.div>

            {/* Coding Scheme Upload / Paste */}
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 }} className="card">
              <div className="flex items-center gap-3 mb-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-100 text-accent-600">
                  <Table2 className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="font-display text-lg font-semibold text-surface-900">Coding Scheme</h2>
                  <p className="text-xs text-surface-400">Upload a file or paste your coding categories directly</p>
                </div>
              </div>

              {codingScheme.length > 0 ? (
                <div className="rounded-xl border border-green-200 bg-green-50 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-5 w-5 text-green-600" />
                      <span className="text-sm font-medium text-green-800">{codingSchemeFileName}</span>
                    </div>
                    <button
                      onClick={() => { useAppStore.setState({ codingScheme: [], codingSchemeFileName: null }); setPasteText('') }}
                      className="text-xs text-surface-400 hover:text-red-500"
                      aria-label="Remove coding scheme"
                    >
                      Remove
                    </button>
                  </div>
                  <div className="max-h-52 overflow-y-auto space-y-1.5">
                    {codingScheme.map((item, idx) => {
                      const isShortCode = item.code.length <= 4
                      const codeIsSameAsDesc = item.code.toLowerCase() === item.description.toLowerCase()
                      return (
                        <div key={item.id} className="flex items-start gap-2.5 rounded-lg bg-white px-3 py-2 text-sm">
                          <span className="shrink-0 mt-0.5 flex items-center justify-center rounded-full bg-accent-100 text-xs font-semibold text-accent-700 h-5 w-5">
                            {idx + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            {!codeIsSameAsDesc && isShortCode && (
                              <span className="inline-block rounded bg-accent-50 px-1.5 py-0.5 text-xs font-bold text-accent-700 mr-2">{item.code}</span>
                            )}
                            <span className="text-surface-700">{codeIsSameAsDesc ? item.code : item.description}</span>
                            {!codeIsSameAsDesc && !isShortCode && (
                              <p className="text-xs text-surface-400 mt-0.5 truncate">{item.code}</p>
                            )}
                          </div>
                          {item.category && (
                            <span className="shrink-0 text-xs text-surface-400 bg-surface-100 px-2 py-0.5 rounded-full">{item.category}</span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex rounded-lg bg-surface-100 p-0.5 mb-4" role="tablist">
                    <button
                      role="tab"
                      aria-selected={schemeTab === 'upload'}
                      onClick={() => setSchemeTab('upload')}
                      className={`flex-1 flex items-center justify-center gap-1.5 rounded-md py-2 text-xs font-medium transition-all ${
                        schemeTab === 'upload' ? 'bg-white text-surface-900 shadow-sm' : 'text-surface-500 hover:text-surface-700'
                      }`}
                    >
                      <Upload className="h-3.5 w-3.5" /> Upload File
                    </button>
                    <button
                      role="tab"
                      aria-selected={schemeTab === 'paste'}
                      onClick={() => setSchemeTab('paste')}
                      className={`flex-1 flex items-center justify-center gap-1.5 rounded-md py-2 text-xs font-medium transition-all ${
                        schemeTab === 'paste' ? 'bg-white text-surface-900 shadow-sm' : 'text-surface-500 hover:text-surface-700'
                      }`}
                    >
                      <ClipboardPaste className="h-3.5 w-3.5" /> Paste Text
                    </button>
                  </div>

                  {schemeTab === 'upload' ? (
                    <div
                      onDragOver={(e) => { e.preventDefault(); setSchemeDragActive(true) }}
                      onDragLeave={() => setSchemeDragActive(false)}
                      onDrop={(e) => handleDrop(e, 'scheme')}
                      className={`relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 transition-all ${
                        schemeDragActive ? 'border-accent-400 bg-accent-50' : 'border-surface-300 hover:border-accent-300 hover:bg-surface-50'
                      }`}
                      role="region"
                      aria-label="Coding scheme upload area"
                    >
                      <Table2 className={`h-10 w-10 mb-3 ${schemeDragActive ? 'text-accent-500' : 'text-surface-400'}`} />
                      <p className="text-sm font-medium text-surface-700">Upload your coding scheme</p>
                      <p className="mt-1 text-xs text-surface-400">CSV, XLSX, or JSON format</p>
                      <label className="mt-3 cursor-pointer rounded-lg bg-accent-50 px-4 py-2 text-sm font-medium text-accent-600 hover:bg-accent-100 transition-colors">
                        Browse Files
                        <input
                          type="file"
                          className="hidden"
                          accept=".csv,.xlsx,.xls,.json"
                          onChange={(e) => {
                            const f = e.target.files?.[0]
                            if (f) handleSchemeFile(f)
                            e.target.value = ''
                          }}
                        />
                      </label>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <textarea
                        value={pasteText}
                        onChange={(e) => setPasteText(e.target.value)}
                        placeholder={'Paste your coding scheme here. Supported formats:\n\nJSON:  [{"code": "C1", "description": "..."}]\nCSV:   code,description\\nC1,My category\nLines: C1: Description of code 1\\nC2: Description of code 2'}
                        className="w-full rounded-xl border border-surface-300 bg-surface-50 px-4 py-3 text-sm text-surface-700 placeholder:text-surface-400 focus:border-accent-300 focus:ring-1 focus:ring-accent-200 focus:outline-none resize-none font-mono"
                        rows={8}
                        aria-label="Paste coding scheme text"
                      />
                      <button
                        onClick={handlePasteSubmit}
                        disabled={!pasteText.trim() || pasteSubmitting}
                        className="w-full flex items-center justify-center gap-2 rounded-lg bg-accent-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {pasteSubmitting ? (
                          <><Loader2 className="h-4 w-4 animate-spin" /> Parsing...</>
                        ) : (
                          <><CheckCircle2 className="h-4 w-4" /> Apply Coding Scheme</>
                        )}
                      </button>
                    </div>
                  )}
                </>
              )}

              <div className="mt-4 flex items-start gap-2 rounded-lg bg-blue-50 p-3">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-blue-500" />
                <p className="text-xs text-blue-700 leading-relaxed">
                  {schemeTab === 'paste' && codingScheme.length === 0
                    ? 'Paste JSON, CSV, or simple "Code: Description" lines. Each line becomes one coding item.'
                    : `Your coding scheme defines the categories used for analysis. The system will use this to ${
                        mode === 'theme-verification'
                          ? 'automatically label each document'
                          : 'extract relevant evidence from each document'
                      }.`}
                </p>
              </div>
            </motion.div>
          </div>

          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }} className="mt-12 text-center">
            {!canProceed && (
              <p className="mb-4 text-sm text-surface-400">Upload at least one document and a coding scheme to continue.</p>
            )}
            <button
              onClick={handleContinue}
              disabled={!canProceed || isProcessing}
              className="btn-primary text-lg px-10 py-4"
            >
              {isProcessing ? (
                <><Loader2 className="h-5 w-5 animate-spin" /> Processing...</>
              ) : (
                <>Start {mode === 'theme-verification' ? 'Theme Verification' : 'Evidence Verification'} <ArrowRight className="h-5 w-5" /></>
              )}
            </button>
          </motion.div>
        </div>
      </div>
    </div>
  )
}
