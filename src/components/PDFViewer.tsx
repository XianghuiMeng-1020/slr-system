import { useState, useEffect, useCallback, useRef, memo } from 'react'
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize2, AlertTriangle } from 'lucide-react'
import * as pdfjsLib from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url,
).toString()

interface PDFViewerProps {
  pdfUrl: string | null
  fileName: string
  highlightPage?: number
  highlightBbox?: { x: number; y: number; width: number; height: number } | null
}

function PDFViewerInner({ pdfUrl, fileName, highlightPage, highlightBbox }: PDFViewerProps) {
  const [pageCount, setPageCount] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [zoom, setZoom] = useState(1.2)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const highlightCanvasRef = useRef<HTMLCanvasElement>(null)
  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null)

  useEffect(() => {
    if (!pdfUrl) return
    let cancelled = false
    setLoading(true)
    setError(null)
    pdfjsLib.getDocument({ url: pdfUrl, withCredentials: false }).promise.then((doc) => {
      if (cancelled) return
      pdfDocRef.current = doc
      setPageCount(doc.numPages)
      setCurrentPage(1)
      setLoading(false)
    }).catch((err) => {
      if (cancelled) return
      setLoading(false)
      setError(err?.message || 'Failed to load PDF.')
    })
    return () => { cancelled = true }
  }, [pdfUrl])

  useEffect(() => {
    if (highlightPage && highlightPage >= 1 && highlightPage <= pageCount) {
      setCurrentPage(highlightPage)
    }
  }, [highlightPage, pageCount])

  const renderPage = useCallback(async () => {
    const doc = pdfDocRef.current
    const canvas = canvasRef.current
    if (!doc || !canvas || currentPage < 1 || currentPage > doc.numPages) return

    if (renderTaskRef.current) {
      renderTaskRef.current.cancel()
      renderTaskRef.current = null
    }

    try {
      const page = await doc.getPage(currentPage)
      const viewport = page.getViewport({ scale: zoom })

      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.floor(viewport.width * dpr)
      canvas.height = Math.floor(viewport.height * dpr)
      canvas.style.width = `${Math.floor(viewport.width)}px`
      canvas.style.height = `${Math.floor(viewport.height)}px`

      const ctx = canvas.getContext('2d')!
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      const task = page.render({ canvasContext: ctx, viewport, canvas } as any)
      renderTaskRef.current = task
      await task.promise
      renderTaskRef.current = null

      const hlCanvas = highlightCanvasRef.current
      if (hlCanvas) {
        hlCanvas.width = Math.floor(viewport.width * dpr)
        hlCanvas.height = Math.floor(viewport.height * dpr)
        hlCanvas.style.width = `${Math.floor(viewport.width)}px`
        hlCanvas.style.height = `${Math.floor(viewport.height)}px`
        const hlCtx = hlCanvas.getContext('2d')!
        hlCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
        hlCtx.clearRect(0, 0, viewport.width, viewport.height)

        if (highlightBbox && highlightPage === currentPage) {
          hlCtx.fillStyle = 'rgba(250, 204, 21, 0.3)'
          hlCtx.strokeStyle = 'rgba(234, 179, 8, 0.8)'
          hlCtx.lineWidth = 2
          hlCtx.fillRect(highlightBbox.x * zoom, highlightBbox.y * zoom, highlightBbox.width * zoom, highlightBbox.height * zoom)
          hlCtx.strokeRect(highlightBbox.x * zoom, highlightBbox.y * zoom, highlightBbox.width * zoom, highlightBbox.height * zoom)
        }
      }
    } catch (err: any) {
      if (err?.name !== 'RenderingCancelledException') {
        console.error('PDF render error:', err)
      }
    }
  }, [currentPage, zoom, highlightBbox, highlightPage])

  useEffect(() => {
    renderPage()
  }, [renderPage])

  const goToPage = (page: number) => {
    if (page >= 1 && page <= pageCount) setCurrentPage(page)
  }

  const handleFullscreen = () => {
    if (containerRef.current) {
      if (document.fullscreenElement) document.exitFullscreen()
      else containerRef.current.requestFullscreen()
    }
  }

  if (!pdfUrl) {
    return (
      <div className="flex h-full items-center justify-center rounded-xl border border-surface-200 bg-surface-50">
        <p className="text-sm text-surface-400">No PDF loaded</p>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="flex h-full flex-col rounded-xl overflow-hidden border border-surface-200 bg-white">
      <div className="flex items-center justify-between border-b border-surface-200 px-4 py-2 bg-surface-50">
        <span className="text-xs font-medium text-surface-500 truncate max-w-[180px]" title={fileName}>
          {fileName}
        </span>
        <div className="flex items-center gap-0.5">
          <button onClick={() => setZoom(Math.max(0.5, zoom - 0.2))} className="rounded p-1 text-surface-400 hover:text-surface-600 hover:bg-surface-100" aria-label="Zoom out">
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <span className="text-[10px] text-surface-400 w-9 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(Math.min(3, zoom + 0.2))} className="rounded p-1 text-surface-400 hover:text-surface-600 hover:bg-surface-100" aria-label="Zoom in">
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <div className="mx-1 h-3 w-px bg-surface-200" />
          <button onClick={handleFullscreen} className="rounded p-1 text-surface-400 hover:text-surface-600 hover:bg-surface-100" aria-label="Fullscreen">
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1} className="rounded p-1 text-surface-400 hover:text-surface-600 disabled:opacity-30" aria-label="Previous page">
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="text-xs text-surface-500 tabular-nums">
            <span className="font-medium text-surface-700">{currentPage}</span> / {pageCount}
          </span>
          <button onClick={() => goToPage(currentPage + 1)} disabled={currentPage >= pageCount} className="rounded p-1 text-surface-400 hover:text-surface-600 disabled:opacity-30" aria-label="Next page">
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-surface-100 flex justify-center p-3">
        {error ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <AlertTriangle className="h-8 w-8 text-red-400 mb-2" />
            <p className="text-sm font-medium text-surface-700">Failed to load PDF</p>
            <p className="text-xs text-surface-400 mt-1 max-w-xs">{error}</p>
            <button
              onClick={() => {
                setError(null)
                setLoading(true)
                if (pdfUrl) {
                  pdfjsLib.getDocument({ url: pdfUrl, withCredentials: false }).promise
                    .then((doc) => { pdfDocRef.current = doc; setPageCount(doc.numPages); setCurrentPage(1); setLoading(false) })
                    .catch((e) => { setLoading(false); setError(e?.message || 'Retry failed') })
                }
              }}
              className="mt-3 rounded-lg bg-primary-50 px-4 py-1.5 text-xs font-medium text-primary-600 hover:bg-primary-100"
            >
              Retry
            </button>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-primary-200 border-t-primary-600" />
          </div>
        ) : (
          <div className="relative inline-block">
            <canvas ref={canvasRef} className="shadow-lg rounded" />
            <canvas ref={highlightCanvasRef} className="absolute top-0 left-0 pointer-events-none" />
          </div>
        )}
      </div>
    </div>
  )
}

const PDFViewer = memo(PDFViewerInner)
export default PDFViewer
