import { useState, useEffect, useCallback, useRef, memo } from 'react'
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react'
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
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const highlightCanvasRef = useRef<HTMLCanvasElement>(null)
  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!pdfUrl) return
    let cancelled = false
    setLoading(true)
    pdfjsLib.getDocument(pdfUrl).promise.then((doc) => {
      if (cancelled) return
      pdfDocRef.current = doc
      setPageCount(doc.numPages)
      setCurrentPage(1)
      setLoading(false)
    }).catch(() => {
      if (!cancelled) setLoading(false)
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

    const page = await doc.getPage(currentPage)
    const viewport = page.getViewport({ scale: zoom })
    canvas.width = viewport.width
    canvas.height = viewport.height
    const ctx = canvas.getContext('2d')!
    await page.render({ canvasContext: ctx, viewport, canvas } as any).promise

    const hlCanvas = highlightCanvasRef.current
    if (hlCanvas) {
      hlCanvas.width = viewport.width
      hlCanvas.height = viewport.height
      const hlCtx = hlCanvas.getContext('2d')!
      hlCtx.clearRect(0, 0, hlCanvas.width, hlCanvas.height)

      if (highlightBbox && highlightPage === currentPage) {
        hlCtx.fillStyle = 'rgba(250, 204, 21, 0.3)'
        hlCtx.strokeStyle = 'rgba(234, 179, 8, 0.8)'
        hlCtx.lineWidth = 2
        const x = highlightBbox.x * zoom
        const y = highlightBbox.y * zoom
        const w = highlightBbox.width * zoom
        const h = highlightBbox.height * zoom
        hlCtx.fillRect(x, y, w, h)
        hlCtx.strokeRect(x, y, w, h)
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
      if (document.fullscreenElement) {
        document.exitFullscreen()
      } else {
        containerRef.current.requestFullscreen()
      }
    }
  }

  if (!pdfUrl) {
    return (
      <div className="flex h-full items-center justify-center rounded-xl border border-surface-200 bg-surface-100">
        <p className="text-sm text-surface-400">No PDF loaded</p>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="flex h-full flex-col bg-surface-100 rounded-xl overflow-hidden border border-surface-200">
      <div className="flex items-center justify-between border-b border-surface-200 bg-white px-4 py-2">
        <span className="text-sm font-medium text-surface-700 truncate max-w-[200px]">
          {fileName}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setZoom(Math.max(0.5, zoom - 0.15))}
            className="rounded-lg p-1.5 text-surface-500 hover:bg-surface-100 transition-colors"
            aria-label="Zoom out"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="text-xs text-surface-500 w-12 text-center">{Math.round(zoom * 100)}%</span>
          <button
            onClick={() => setZoom(Math.min(3, zoom + 0.15))}
            className="rounded-lg p-1.5 text-surface-500 hover:bg-surface-100 transition-colors"
            aria-label="Zoom in"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <div className="mx-2 h-4 w-px bg-surface-200" />
          <button
            onClick={handleFullscreen}
            className="rounded-lg p-1.5 text-surface-500 hover:bg-surface-100 transition-colors"
            aria-label="Toggle fullscreen"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage <= 1}
            className="rounded-lg p-1.5 text-surface-500 hover:bg-surface-100 disabled:opacity-30 transition-colors"
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm text-surface-600">
            <span className="font-medium">{currentPage}</span>
            <span className="text-surface-400"> / {pageCount}</span>
          </span>
          <button
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage >= pageCount}
            className="rounded-lg p-1.5 text-surface-500 hover:bg-surface-100 disabled:opacity-30 transition-colors"
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 flex justify-center">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
          </div>
        ) : (
          <div className="relative inline-block">
            <canvas ref={canvasRef} className="shadow-lg rounded-sm" />
            <canvas
              ref={highlightCanvasRef}
              className="absolute top-0 left-0 pointer-events-none"
            />
          </div>
        )}
      </div>
    </div>
  )
}

const PDFViewer = memo(PDFViewerInner)
export default PDFViewer
