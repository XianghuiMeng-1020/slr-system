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
  const res = await fetch(`${BASE}${url}`, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
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

  updateLabels(projectId: string, docId: string, labels: { scheme_item_id: string; value: string }[]) {
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
