const BASE = import.meta.env.VITE_API_BASE_URL
  ? `${import.meta.env.VITE_API_BASE_URL}/api`
  : '/api'

class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

interface ApiEnvelope<T> {
  data: T
  message: string
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('slr-jwt') : null
  const res = await fetch(`${BASE}${url}`, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new ApiError(res.status, body || res.statusText)
  }
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('application/json')) {
    const json = await res.json()
    if (json && typeof json === 'object' && 'data' in json && 'message' in json) {
      return (json as ApiEnvelope<T>).data
    }
    return json as T
  }
  return res as unknown as T
}

export interface ProjectResponse {
  id: string
  mode: string
}

export interface DocumentResponse {
  id: string
  filename: string
  page_count: number
  status: string
  error_message?: string | null
}

export interface SchemeItemResponse {
  id: string
  code: string
  description: string
  category: string | null
}

export interface LabelResponse {
  id: string
  scheme_item_id: string
  value: string
  confidence: number | null
  user_override: string | null
  reviewer_id?: string | null
}

export interface EvidenceResponse {
  id: string
  text: string
  page: number
  bbox_json: { x: number; y: number; width: number; height: number } | null
  relevant_code_ids: string[]
  user_response: string | null
  user_note: string | null
}

export interface DocumentDetailResponse {
  id: string
  filename: string
  page_count: number
  status: string
  error_message?: string | null
  labels: LabelResponse[]
  evidences: EvidenceResponse[]
}

export interface ProcessTaskResponse {
  task_id: string
  total: number
}

export interface ProcessStatusResponse {
  task_id: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  total: number
  processed: number
  completed: number
  failed: number
}

export interface ProjectStatusResponse {
  total: number
  completed: number
  processing: number
  pending: number
}

interface PaginatedDocumentsResponse {
  items: DocumentResponse[]
  page: number
  per_page: number
  total_count: number
}

export const api = {
  createProject(mode: string) {
    return request<ProjectResponse>('/projects', {
      method: 'POST',
      body: JSON.stringify({ mode }),
    })
  },

  updateProjectMode(projectId: string, mode: string) {
    return request<ProjectResponse>(`/projects/${projectId}`, {
      method: 'PUT',
      body: JSON.stringify({ mode }),
    })
  },

  uploadDocuments(projectId: string, files: File[]) {
    const form = new FormData()
    files.forEach((f) => form.append('files', f))
    return request<DocumentResponse[]>(`/projects/${projectId}/documents`, {
      method: 'POST',
      body: form,
    })
  },

  uploadCodingScheme(projectId: string, file: File) {
    const form = new FormData()
    form.append('file', file)
    return request<SchemeItemResponse[]>(`/projects/${projectId}/coding-scheme`, {
      method: 'POST',
      body: form,
    })
  },

  submitCodingSchemeText(projectId: string, text: string) {
    return request<SchemeItemResponse[]>(`/projects/${projectId}/coding-scheme/text`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    })
  },

  processProject(projectId: string) {
    return request<ProcessTaskResponse>(`/projects/${projectId}/process`, {
      method: 'POST',
    })
  },

  getProcessStatus(projectId: string, taskId: string) {
    return request<ProcessStatusResponse>(`/projects/${projectId}/process/status?task_id=${encodeURIComponent(taskId)}`)
  },

  getProjectStatus(projectId: string) {
    return request<ProjectStatusResponse>(`/projects/${projectId}/status`)
  },

  listDocuments(projectId: string) {
    return request<PaginatedDocumentsResponse>(`/projects/${projectId}/documents?page=1&per_page=100`)
      .then((res) => res.items)
  },

  getDocumentDetail(projectId: string, docId: string) {
    return request<DocumentDetailResponse>(`/projects/${projectId}/documents/${docId}`)
  },

  getDocumentPdfUrl(projectId: string, docId: string) {
    return `${BASE}/projects/${projectId}/documents/${docId}/pdf`
  },

  updateLabels(
    projectId: string,
    docId: string,
    labels: { scheme_item_id: string; value: string; reviewer_id?: string | null; supporting_evidence_ids?: string[] }[],
  ) {
    return request<{ message: string }>(`/projects/${projectId}/documents/${docId}/labels`, {
      method: 'PUT',
      body: JSON.stringify({ labels }),
    })
  },

  updateEvidence(
    projectId: string,
    docId: string,
    evidenceId: string,
    data: { user_response?: string; user_note?: string },
  ) {
    return request<{ message: string }>(`/projects/${projectId}/documents/${docId}/evidences`, {
      method: 'PUT',
      body: JSON.stringify({ evidence_id: evidenceId, ...data }),
    })
  },

  getCodingScheme(projectId: string) {
    return request<SchemeItemResponse[]>(`/projects/${projectId}/coding-scheme`)
  },

  async validateProject(projectId: string): Promise<boolean> {
    try {
      await request<ProjectStatusResponse>(`/projects/${projectId}/status`)
      return true
    } catch {
      return false
    }
  },

  exportProject(projectId: string, format: 'excel' | 'csv' = 'excel') {
    return `${BASE}/projects/${projectId}/export?format=${format}`
  },

  exportProjectExtended(projectId: string, format: 'excel' | 'csv' | 'json' | 'bibtex' | 'ris' = 'excel') {
    return `${BASE}/projects/${projectId}/export?format=${format}`
  },

  deleteDocument(projectId: string, docId: string) {
    return request<{ message: string }>(`/projects/${projectId}/documents/${docId}`, {
      method: 'DELETE',
    })
  },

  deleteProject(projectId: string) {
    return request<{ message: string }>(`/projects/${projectId}`, {
      method: 'DELETE',
    })
  },
}

/** Phase 2: RAG, synthesis, analytics APIs (same /api base). */
export const phase2 = {
  chatWithPaper(
    projectId: string,
    docId: string,
    body: { question: string; history?: { role: string; content: string }[] },
  ) {
    return request<{ answer: string; citations: { page: number; section?: string; preview?: string }[] }>(
      `/projects/${projectId}/documents/${docId}/chat`,
      { method: 'POST', body: JSON.stringify(body) },
    )
  },
  synthesis(projectId: string, schemeItemId: string) {
    return request<{ synthesis: string; passages_used: number }>(`/projects/${projectId}/synthesis`, {
      method: 'POST',
      body: JSON.stringify({ scheme_item_id: schemeItemId }),
    })
  },
  getSettings(projectId: string) {
    return request<Record<string, unknown>>(`/projects/${projectId}/settings`)
  },
  putSettings(projectId: string, data: {
    custom_system_prompt?: string
    dual_coding_blind?: boolean
    notion_webhook_url?: string
    notion_integration_secret?: string
    notion_parent_page_id?: string
  }) {
    return request<Record<string, unknown>>(`/projects/${projectId}/settings`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  },
  indexEmbeddings(projectId: string) {
    return request<{ chunks_indexed: number; qdrant_upserted?: number; qdrant_enabled?: boolean }>(
      `/projects/${projectId}/index-embeddings`,
      { method: 'POST' },
    )
  },
  vectorSearch(projectId: string, query: string, top_k = 8) {
    return request<{ hits: { text: string; score: number; document_id?: string }[]; backend?: string }>(
      `/projects/${projectId}/vector-search`,
      {
        method: 'POST',
        body: JSON.stringify({ query, top_k }),
      },
    )
  },
  register(email: string, password: string) {
    return request<{ token: string; user: { id: string; email: string } }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
  },
  login(email: string, password: string) {
    return request<{ token: string; user: { id: string; email: string } }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
  },
  exportDocxDraft(projectId: string) {
    return `${BASE}/projects/${projectId}/export/docx-draft`
  },
  exportNvivo(projectId: string) {
    return `${BASE}/projects/${projectId}/export/nvivo`
  },
  feedback(
    projectId: string,
    body: { evidence_id: string; document_id: string; response: string; text_preview: string },
  ) {
    return request<{ stored: number }>(`/projects/${projectId}/active-learning/feedback`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
  },
  conflicts(projectId: string) {
    return request<{
      conflicts: Array<{
        document_id: string
        filename: string
        scheme_item_id: string
        code: string
        reviewer_a: string
        reviewer_b: string
      }>
    }>(`/projects/${projectId}/conflicts`)
  },
  irr(projectId: string) {
    return request<{
      percent_agreement?: number | null
      cohens_kappa?: number | null
      pairs?: number
      note?: string
      reviewers?: string[]
    }>(`/projects/${projectId}/irr`)
  },
  zoteroConnectApiKey(apiKey: string, projectId?: string) {
    return request<{ connected: boolean; userID: string; username: string }>('/integrations/zotero/connect-apikey', {
      method: 'POST',
      body: JSON.stringify({ api_key: apiKey, project_id: projectId }),
    })
  },
  zoteroAuthorize() {
    return request<{ authorization_url: string; oauth_token: string }>('/integrations/zotero/authorize', {
      method: 'POST',
    })
  },
  zoteroStatus(projectId?: string) {
    const qs = projectId ? `?project_id=${encodeURIComponent(projectId)}` : ''
    return request<{ connected: boolean; mode?: string; username?: string; userID?: string }>(`/integrations/zotero/status${qs}`)
  },
  zoteroImport(projectId: string, limit = 20) {
    return request<{ imported: number; items: { id: string; title: string }[] }>(
      `/projects/${projectId}/integrations/zotero/import`,
      { method: 'POST', body: JSON.stringify({ limit }) },
    )
  },
  exportNotionPage(projectId: string, title?: string) {
    return request<{ notion_page_id?: string; page: Record<string, unknown> }>(`/projects/${projectId}/export/notion-page`, {
      method: 'POST',
      body: JSON.stringify({ title }),
    })
  },
  processCelery(projectId: string) {
    return request<{ queued: number; note?: string; hint?: string }>(`/projects/${projectId}/process/celery`, {
      method: 'POST',
    })
  },
  vectorBackendStatus() {
    return request<{ qdrant_configured: boolean; qdrant_url: string; hint: string }>('/system/vector-backend')
  },
  listMembers(projectId: string) {
    return request<{ user_id: string; email: string; role: string }[]>(`/projects/${projectId}/members`)
  },
  addMember(projectId: string, email: string) {
    return request<{ status: string }>(`/projects/${projectId}/members?email=${encodeURIComponent(email)}`, {
      method: 'POST',
    })
  },
}
