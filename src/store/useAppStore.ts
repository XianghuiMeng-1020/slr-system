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
  userResponse?: 'yes' | 'no' | null
  userNote?: string
}

export interface DocumentLabel {
  id: string
  schemeItemId: string
  value: string
  confidence?: number | null
  userOverride?: string | null
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

interface AppState {
  mode: Mode | null
  projectId: string | null
  documents: UploadedDocument[]
  codingScheme: CodingSchemeItem[]
  codingSchemeFileName: string | null
  currentDocumentIndex: number
  isProcessing: boolean
  isUploading: boolean
  toasts: Toast[]

  setMode: (mode: Mode) => void
  createProject: (mode: Mode) => Promise<string>
  ensureValidProject: () => Promise<boolean>
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
      toasts: [],

      setMode: (mode) => set({ mode }),

      createProject: async (mode) => {
        try {
          const res = await api.createProject(mode)
          set({ projectId: res.id, mode: mode as Mode })
          return res.id
        } catch (e: any) {
          get().addToast('error', `Failed to create project: ${e.message}`)
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
          set({ projectId: res.id, documents: [], codingScheme: [], codingSchemeFileName: null })
          return true
        } catch (e: any) {
          get().addToast('error', `Failed to recreate project: ${e.message}`)
          return false
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
        } catch (e: any) {
          get().addToast('error', `Upload failed: ${e.message}`)
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
        } catch (e: any) {
          get().addToast('error', `Scheme upload failed: ${e.message}`)
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
        } catch (e: any) {
          get().addToast('error', `Scheme parsing failed: ${e.message}`)
        }
      },

      removeDocument: async (id) => {
        const { projectId } = get()
        if (!projectId) return
        try {
          await api.deleteDocument(projectId, id)
          set((s) => ({ documents: s.documents.filter((d) => d.id !== id) }))
        } catch (e: any) {
          get().addToast('error', `Delete failed: ${e.message}`)
        }
      },

      processDocuments: async () => {
        const { projectId } = get()
        if (!projectId) return
        set({ isProcessing: true })
        try {
          await api.processProject(projectId)
          const docs = await api.listDocuments(projectId)
          set((s) => ({
            documents: s.documents.map((d) => {
              const updated = docs.find((dd) => dd.id === d.id)
              return updated ? { ...d, status: updated.status as UploadedDocument['status'], pageCount: updated.page_count } : d
            }),
          }))
          get().addToast('success', 'AI processing complete')
        } catch (e: any) {
          get().addToast('error', `Processing failed: ${e.message}`)
        } finally {
          set({ isProcessing: false })
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
                    labels: detail.labels.map((l) => ({
                      id: l.id,
                      schemeItemId: l.scheme_item_id,
                      value: l.user_override || l.value,
                      confidence: l.confidence,
                      userOverride: l.user_override,
                    })),
                    evidences: detail.evidences.map((e) => ({
                      id: e.id,
                      text: e.text,
                      page: e.page,
                      bboxJson: e.bbox_json,
                      relevantCodes: e.relevant_code_ids,
                      userResponse: (e.user_response as EvidenceItem['userResponse']) ?? null,
                      userNote: e.user_note ?? '',
                    })),
                  }
                : d,
            ),
          }))
        } catch (e: any) {
          get().addToast('error', `Failed to load document: ${e.message}`)
        }
      },

      setCurrentDocumentIndex: (index) => set({ currentDocumentIndex: index }),

      updateLabel: async (docId, schemeItemId, value) => {
        const { projectId } = get()
        if (!projectId) return
        set((s) => ({
          documents: s.documents.map((d) =>
            d.id === docId
              ? { ...d, labels: d.labels.map((l) => (l.schemeItemId === schemeItemId ? { ...l, value, userOverride: value } : l)) }
              : d,
          ),
        }))
        try {
          await api.updateLabels(projectId, docId, [{ scheme_item_id: schemeItemId, value }])
        } catch (e: any) {
          get().addToast('error', `Save label failed: ${e.message}`)
        }
      },

      updateEvidence: async (docId, evidenceId, data) => {
        const { projectId } = get()
        if (!projectId) return
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
        } catch (e: any) {
          get().addToast('error', `Save failed: ${e.message}`)
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
