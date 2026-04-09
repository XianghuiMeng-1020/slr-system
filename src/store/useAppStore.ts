import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { api } from '../services/api'

export type Mode = 'theme-verification' | 'evidence-verification'

export interface CodingSchemeItem {
  id: string
  code: string
  description: string
  category?: string | null
}

export interface EvidenceItem {
  id: string
  text: string
  page: number
  bboxJson?: { x: number; y: number; width: number; height: number } | null
  relevantCodes: string[]
  extractedStats?: Array<{ type: string; value: string }>
  aiReason?: string
  exactQuote?: string
  evidenceType?: string
  confidence?: number | null
  userResponse?: 'yes' | 'no' | null
  userNote?: string
}

export interface DocumentLabel {
  id: string
  schemeItemId: string
  value: string
  confidence?: number | null
  userOverride?: string | null
  supportingEvidenceIds?: string[]
  reviewerId?: string | null
}

export interface UploadedDocument {
  id: string
  name: string
  pageCount: number
  labels: DocumentLabel[]
  evidences: EvidenceItem[]
  status: 'pending' | 'processing' | 'completed' | 'error'
}

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface Toast {
  id: string
  type: ToastType
  message: string
}

type ApiLikeError = { message?: string }

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as ApiLikeError).message || 'Unknown error')
  }
  return 'Unknown error'
}

type DetailLabelLike = {
  id: string
  scheme_item_id: string
  value: string
  confidence: number | null
  user_override: string | null
  supporting_evidence_ids?: string[]
  reviewer_id?: string | null
}

/** When dual-coding stores multiple rows per scheme, show the current reviewer’s row or the shared AI row. */
function pickLabelsForViewer(labels: DetailLabelLike[]): DetailLabelLike[] {
  const uid = typeof localStorage !== 'undefined' ? localStorage.getItem('slr-user-id') : null
  const bySid = new Map<string, DetailLabelLike[]>()
  for (const l of labels) {
    const sid = l.scheme_item_id
    if (!bySid.has(sid)) bySid.set(sid, [])
    bySid.get(sid)!.push(l)
  }
  const out: DetailLabelLike[] = []
  for (const arr of bySid.values()) {
    if (uid) {
      const mine = arr.find((x) => x.reviewer_id === uid)
      if (mine) {
        out.push(mine)
        continue
      }
      const neutral = arr.find((x) => !x.reviewer_id)
      out.push(neutral || arr[0])
    } else {
      out.push(arr.find((x) => !x.reviewer_id) || arr[0])
    }
  }
  return out
}

type DetailEvidenceLike = {
  id: string
  text: string
  page: number
  bbox_json: { x: number; y: number; width: number; height: number } | null
  relevant_code_ids: string[]
  extracted_stats?: Array<{ type: string; value: string }>
  ai_reason?: string | null
  exact_quote?: string | null
  evidence_type?: string | null
  confidence?: number | null
  user_response: string | null
  user_note: string | null
}

interface AppState {
  mode: Mode | null
  projectId: string | null
  documents: UploadedDocument[]
  codingScheme: CodingSchemeItem[]
  codingSchemeFileName: string | null
  currentDocumentIndex: number
  isProcessing: boolean
  isUploading: boolean
  processTaskId: string | null
  processProgress: { total: number; processed: number; completed: number; failed: number } | null
  toasts: Toast[]

  setMode: (mode: Mode) => void
  createProject: (mode: Mode) => Promise<string>
  ensureValidProject: () => Promise<boolean>
  hydrateProjectData: () => Promise<void>
  uploadDocuments: (files: File[]) => Promise<void>
  uploadCodingScheme: (file: File) => Promise<void>
  submitCodingSchemeText: (text: string) => Promise<void>
  removeDocument: (id: string) => Promise<void>
  processDocuments: () => Promise<void>
  loadDocumentDetail: (docId: string) => Promise<void>
  setCurrentDocumentIndex: (index: number) => void
  updateLabel: (docId: string, schemeItemId: string, value: string) => Promise<void>
  updateEvidence: (docId: string, evidenceId: string, data: { userResponse?: string; userNote?: string }) => Promise<void>
  addToast: (type: ToastType, message: string) => void
  removeToast: (id: string) => void
  reset: () => void
}

const genToastId = () => Math.random().toString(36).substring(2, 9)

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      mode: null,
      projectId: null,
      documents: [],
      codingScheme: [],
      codingSchemeFileName: null,
      currentDocumentIndex: 0,
      isProcessing: false,
      isUploading: false,
      processTaskId: null,
      processProgress: null,
      toasts: [],

      setMode: (mode) => set({ mode }),

      createProject: async (mode) => {
        const { projectId: existingId } = get()
        if (existingId) {
          const valid = await api.validateProject(existingId)
          if (valid) {
            try {
              await api.updateProjectMode(existingId, mode)
              set({
                mode: mode as Mode,
                documents: get().documents.map((d) => ({ ...d, labels: [], evidences: [], status: 'pending' as const })),
                currentDocumentIndex: 0,
              })
              return existingId
            } catch {
              // fall through to create new
            }
          }
        }
        try {
          const res = await api.createProject(mode)
          set({
            projectId: res.id,
            mode: mode as Mode,
            documents: [],
            codingScheme: [],
            codingSchemeFileName: null,
            currentDocumentIndex: 0,
          })
          return res.id
        } catch (e: unknown) {
          const msg = getErrorMessage(e)
          get().addToast('error', `Failed to create project: ${msg}`)
          throw e
        }
      },

      ensureValidProject: async () => {
        const { projectId, mode } = get()
        if (!projectId || !mode) return false
        const valid = await api.validateProject(projectId)
        if (valid) return true
        try {
          const res = await api.createProject(mode)
          set({ projectId: res.id, documents: [], codingScheme: [], codingSchemeFileName: null, processTaskId: null, processProgress: null })
          return true
        } catch (e: unknown) {
          get().addToast('error', `Failed to recreate project: ${getErrorMessage(e)}`)
          return false
        }
      },

      hydrateProjectData: async () => {
        const { projectId } = get()
        if (!projectId) return
        try {
          const [docs, scheme] = await Promise.all([api.listDocuments(projectId), api.getCodingScheme(projectId)])
          set((s) => ({
            ...s,
            documents: docs.map((d) => ({
              id: d.id,
              name: d.filename,
              pageCount: d.page_count,
              labels: s.documents.find((x) => x.id === d.id)?.labels || [],
              evidences: s.documents.find((x) => x.id === d.id)?.evidences || [],
              status: d.status as UploadedDocument['status'],
            })),
            codingScheme: scheme.map((i) => ({
              id: i.id,
              code: i.code,
              description: i.description,
              category: i.category,
            })),
          }))
        } catch (e: unknown) {
          get().addToast('error', `Failed to restore project data: ${getErrorMessage(e)}`)
        }
      },

      uploadDocuments: async (files) => {
        const { projectId } = get()
        if (!projectId) return
        set({ isUploading: true })
        try {
          const docs = await api.uploadDocuments(projectId, files)
          const newDocs: UploadedDocument[] = docs.map((d) => ({
            id: d.id,
            name: d.filename,
            pageCount: d.page_count,
            labels: [],
            evidences: [],
            status: d.status as UploadedDocument['status'],
          }))
          set((s) => ({ documents: [...s.documents, ...newDocs].slice(0, 50) }))
          get().addToast('success', `${docs.length} document(s) uploaded successfully`)
        } catch (e: unknown) {
          get().addToast('error', `Upload failed: ${getErrorMessage(e)}`)
        } finally {
          set({ isUploading: false })
        }
      },

      uploadCodingScheme: async (file) => {
        const { projectId } = get()
        if (!projectId) return
        try {
          const items = await api.uploadCodingScheme(projectId, file)
          set({
            codingScheme: items.map((i) => ({
              id: i.id,
              code: i.code,
              description: i.description,
              category: i.category,
            })),
            codingSchemeFileName: file.name,
          })
          get().addToast('success', `Coding scheme loaded: ${items.length} items`)
        } catch (e: unknown) {
          get().addToast('error', `Scheme upload failed: ${getErrorMessage(e)}`)
        }
      },

      submitCodingSchemeText: async (text) => {
        const { projectId } = get()
        if (!projectId) return
        try {
          const items = await api.submitCodingSchemeText(projectId, text)
          set({
            codingScheme: items.map((i) => ({
              id: i.id,
              code: i.code,
              description: i.description,
              category: i.category,
            })),
            codingSchemeFileName: 'Pasted text',
          })
          get().addToast('success', `Coding scheme loaded: ${items.length} items`)
        } catch (e: unknown) {
          get().addToast('error', `Scheme parsing failed: ${getErrorMessage(e)}`)
        }
      },

      removeDocument: async (id) => {
        const { projectId } = get()
        if (!projectId) return
        try {
          await api.deleteDocument(projectId, id)
          set((s) => ({ documents: s.documents.filter((d) => d.id !== id) }))
        } catch (e: unknown) {
          get().addToast('error', `Delete failed: ${getErrorMessage(e)}`)
        }
      },

      processDocuments: async () => {
        const { projectId } = get()
        if (!projectId) return
        set({ isProcessing: true, processProgress: null })
        try {
          const started = await api.processProject(projectId)
          set({ processTaskId: started.task_id, processProgress: { total: started.total, processed: 0, completed: 0, failed: 0 } })
          let loops = 0
          while (loops < 180) {
            const status = await api.getProcessStatus(projectId, started.task_id)
            set({ processProgress: { total: status.total, processed: status.processed, completed: status.completed, failed: status.failed } })
            if (status.status === 'completed' || status.status === 'failed') break
            await new Promise((r) => setTimeout(r, 1200))
            loops += 1
          }
          const docs = await api.listDocuments(projectId)
          set({
            documents: docs.map((d) => ({
              id: d.id,
              name: d.filename,
              pageCount: d.page_count,
              labels: get().documents.find((x) => x.id === d.id)?.labels || [],
              evidences: get().documents.find((x) => x.id === d.id)?.evidences || [],
              status: d.status as UploadedDocument['status'],
            })),
          })
          get().addToast('success', 'AI processing complete')
        } catch (e: unknown) {
          get().addToast('error', `Processing failed: ${getErrorMessage(e)}`)
        } finally {
          set({ isProcessing: false, processTaskId: null })
        }
      },

      loadDocumentDetail: async (docId) => {
        const { projectId } = get()
        if (!projectId) return
        try {
          const detail = await api.getDocumentDetail(projectId, docId)
          set((s) => ({
            documents: s.documents.map((d) =>
              d.id === docId
                ? {
                    ...d,
                    pageCount: detail.page_count,
                    status: detail.status as UploadedDocument['status'],
                    labels: pickLabelsForViewer(detail.labels as DetailLabelLike[]).map((l: DetailLabelLike) => ({
                      id: l.id,
                      schemeItemId: l.scheme_item_id,
                      value: l.user_override || l.value,
                      confidence: l.confidence,
                      userOverride: l.user_override,
                      supportingEvidenceIds: l.supporting_evidence_ids || [],
                      reviewerId: l.reviewer_id ?? null,
                    })),
                    evidences: detail.evidences.map((e: DetailEvidenceLike) => ({
                      id: e.id,
                      text: e.text,
                      page: e.page,
                      bboxJson: e.bbox_json,
                      relevantCodes: e.relevant_code_ids,
                      extractedStats: e.extracted_stats || [],
                      aiReason: e.ai_reason || '',
                      exactQuote: e.exact_quote || '',
                      evidenceType: e.evidence_type || '',
                      confidence: e.confidence ?? null,
                      userResponse: (e.user_response as EvidenceItem['userResponse']) ?? null,
                      userNote: e.user_note ?? '',
                    })),
                  }
                : d,
            ),
          }))
        } catch (e: unknown) {
          get().addToast('error', `Failed to load document: ${getErrorMessage(e)}`)
        }
      },

      setCurrentDocumentIndex: (index) => set({ currentDocumentIndex: index }),

      updateLabel: async (docId, schemeItemId, value) => {
        const { projectId } = get()
        if (!projectId) return
        const prevDocs = get().documents
        set((s) => ({
          documents: s.documents.map((d) =>
            d.id === docId
              ? { ...d, labels: d.labels.map((l) => (l.schemeItemId === schemeItemId ? { ...l, value, userOverride: value } : l)) }
              : d,
          ),
        }))
        try {
          const uid = typeof localStorage !== 'undefined' ? localStorage.getItem('slr-user-id') : null
          await api.updateLabels(projectId, docId, [
            { scheme_item_id: schemeItemId, value, ...(uid ? { reviewer_id: uid } : {}) },
          ])
        } catch (e: unknown) {
          set({ documents: prevDocs })
          get().addToast('error', `Save label failed: ${getErrorMessage(e)}`)
        }
      },

      updateEvidence: async (docId, evidenceId, data) => {
        const { projectId } = get()
        if (!projectId) return
        const prevDocs = get().documents
        set((s) => ({
          documents: s.documents.map((d) =>
            d.id === docId
              ? {
                  ...d,
                  evidences: d.evidences.map((e) =>
                    e.id === evidenceId
                      ? {
                          ...e,
                          ...(data.userResponse !== undefined && { userResponse: data.userResponse as EvidenceItem['userResponse'] }),
                          ...(data.userNote !== undefined && { userNote: data.userNote }),
                        }
                      : e,
                  ),
                }
              : d,
          ),
        }))
        try {
          await api.updateEvidence(projectId, docId, evidenceId, {
            user_response: data.userResponse,
            user_note: data.userNote,
          })
        } catch (e: unknown) {
          set({ documents: prevDocs })
          get().addToast('error', `Save failed: ${getErrorMessage(e)}`)
        }
      },

      addToast: (type, message) => {
        const id = genToastId()
        set((s) => ({ toasts: [...s.toasts, { id, type, message }] }))
        setTimeout(() => get().removeToast(id), 4000)
      },

      removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

      reset: () =>
        set({
          mode: null,
          projectId: null,
          documents: [],
          codingScheme: [],
          codingSchemeFileName: null,
          currentDocumentIndex: 0,
          isProcessing: false,
          isUploading: false,
          processTaskId: null,
          processProgress: null,
          toasts: [],
        }),
    }),
    {
      name: 'slr-system-store',
      partialize: (state) => ({
        mode: state.mode,
        projectId: state.projectId,
      }),
    },
  ),
)
