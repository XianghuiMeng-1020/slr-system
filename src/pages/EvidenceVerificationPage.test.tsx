import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import EvidenceVerificationPage from './EvidenceVerificationPage'

const updateEvidenceMock = vi.fn()
const hydrateMock = vi.fn()
const loadDetailMock = vi.fn()
const addToastMock = vi.fn()
const setDocIndexMock = vi.fn()

const mockState = {
  documents: [
    {
      id: 'doc-1',
      name: 'Paper A.pdf',
      pageCount: 10,
      status: 'completed',
      labels: [],
      evidences: [
        {
          id: 'ev-1',
          text: 'This method improves learning outcomes.',
          page: 2,
          bboxJson: { x: 10, y: 10, width: 20, height: 5 },
          relevantCodes: ['c1'],
          confidence: 0.82,
          aiReason: 'Contains direct finding statement.',
          userResponse: null,
          userNote: '',
        },
        {
          id: 'ev-2',
          text: 'No significant effect was observed.',
          page: 4,
          bboxJson: { x: 8, y: 12, width: 18, height: 6 },
          relevantCodes: ['c2'],
          confidence: 0.4,
          aiReason: 'Contains null effect evidence.',
          userResponse: null,
          userNote: '',
        },
      ],
    },
  ],
  codingScheme: [
    { id: 'c1', code: 'METHOD', description: 'Method effect' },
    { id: 'c2', code: 'RESULT', description: 'Null result' },
  ],
  currentDocumentIndex: 0,
  setCurrentDocumentIndex: setDocIndexMock,
  updateEvidence: updateEvidenceMock,
  loadDocumentDetail: loadDetailMock,
  projectId: 'proj-1',
  addToast: addToastMock,
  hydrateProjectData: hydrateMock,
}

vi.mock('../store/useAppStore', () => ({
  useAppStore: <T,>(selector: (s: typeof mockState) => T): T => selector(mockState),
}))

vi.mock('../components/PDFViewer', () => ({
  default: () => <div data-testid="pdf-viewer">PDF</div>,
}))

vi.mock('../services/api', () => ({
  api: {
    exportProjectExtended: () => '/download',
    getDocumentPdfUrl: () => '/pdf',
  },
}))

describe('EvidenceVerificationPage', () => {
  beforeEach(() => {
    updateEvidenceMock.mockClear()
    Object.defineProperty(window, 'open', { value: vi.fn(), writable: true })
  })

  it('filters evidence by search text', () => {
    render(
      <MemoryRouter>
        <EvidenceVerificationPage />
      </MemoryRouter>,
    )

    expect(screen.getByText(/This method improves learning outcomes/i)).toBeInTheDocument()
    expect(screen.getByText(/No significant effect was observed/i)).toBeInTheDocument()

    const searchInput = screen.getByPlaceholderText(/Search evidence text/i)
    fireEvent.change(searchInput, { target: { value: 'null effect' } })

    expect(screen.queryByText(/This method improves learning outcomes/i)).not.toBeInTheDocument()
    expect(screen.getByText(/No significant effect was observed/i)).toBeInTheDocument()
  })

  it('supports keyboard Y/N on selected evidence', () => {
    render(
      <MemoryRouter>
        <EvidenceVerificationPage />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByText(/This method improves learning outcomes/i))
    fireEvent.keyDown(window, { key: 'y' })
    expect(updateEvidenceMock).toHaveBeenCalledWith('doc-1', 'ev-1', { userResponse: 'yes' })

    fireEvent.keyDown(window, { key: 'n' })
    expect(updateEvidenceMock).toHaveBeenCalledWith('doc-1', 'ev-1', { userResponse: 'no' })
  })

  it('supports combined filters and batch marking', () => {
    render(
      <MemoryRouter>
        <EvidenceVerificationPage />
      </MemoryRouter>,
    )

    const codeSelect = screen.getByText('All Codes').closest('select') as HTMLSelectElement
    fireEvent.change(codeSelect, { target: { value: 'c1' } })
    fireEvent.change(screen.getByPlaceholderText(/Page range/i), { target: { value: '2-2' } })
    fireEvent.change(screen.getByPlaceholderText(/Min confidence/i), { target: { value: '0.8' } })

    expect(screen.getByText(/This method improves learning outcomes/i)).toBeInTheDocument()
    expect(screen.queryByText(/No significant effect was observed/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByText(/Select Filtered/i))
    fireEvent.click(screen.getByText(/Batch Yes/i))

    expect(updateEvidenceMock).toHaveBeenCalledWith('doc-1', 'ev-1', { userResponse: 'yes' })
  })

  it('exports with selected format', () => {
    render(
      <MemoryRouter>
        <EvidenceVerificationPage />
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByLabelText(/Export format/i), { target: { value: 'json' } })
    fireEvent.click(screen.getByRole('button', { name: /Export results/i }))
    expect(window.open).toHaveBeenCalledWith('/download', '_blank')
  })
})
