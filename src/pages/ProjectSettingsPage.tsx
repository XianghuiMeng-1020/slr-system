import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Settings2, Sparkles, BookOpen, Database, Cloud } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { phase2 } from '../services/api'

export default function ProjectSettingsPage() {
  const projectId = useAppStore((s) => s.projectId)
  const [prompt, setPrompt] = useState('')
  const [blind, setBlind] = useState(false)
  const [notion, setNotion] = useState('')
  const [notionSecret, setNotionSecret] = useState('')
  const [notionParent, setNotionParent] = useState('')
  const [msg, setMsg] = useState('')
  const [indexing, setIndexing] = useState(false)
  const [zoteroConnected, setZoteroConnected] = useState(false)
  const [zoteroUser, setZoteroUser] = useState<string | undefined>()
  const [zoteroMode, setZoteroMode] = useState<string | undefined>()
  const [zoteroApiKey, setZoteroApiKey] = useState('')
  const [zoteroConnecting, setZoteroConnecting] = useState(false)
  const [vectorHint, setVectorHint] = useState('')

  useEffect(() => {
    if (!projectId) return
    phase2.getSettings(projectId).then((s) => {
      setPrompt(String(s.custom_system_prompt || ''))
      setBlind(Boolean(s.dual_coding_blind))
      setNotion(String(s.notion_webhook_url || ''))
      setNotionSecret(String(s.notion_integration_secret || ''))
      setNotionParent(String(s.notion_parent_page_id || ''))
    }).catch(() => {})
    phase2.zoteroStatus().then((z) => {
      setZoteroConnected(z.connected)
      setZoteroUser(z.username || z.userID)
      setZoteroMode(z.mode)
    }).catch(() => {})
    phase2.vectorBackendStatus().then((v) => {
      setVectorHint(v.qdrant_configured ? `Qdrant: ${v.qdrant_url || 'on'}` : 'Qdrant: off (set QDRANT_URL on server)')
    }).catch(() => {})
  }, [projectId])

  const save = async () => {
    if (!projectId) return
    setMsg('')
    try {
      await phase2.putSettings(projectId, {
        custom_system_prompt: prompt || undefined,
        dual_coding_blind: blind,
        notion_webhook_url: notion || undefined,
        notion_integration_secret: notionSecret || undefined,
        notion_parent_page_id: notionParent || undefined,
      })
      setMsg('Saved.')
    } catch {
      setMsg('Save failed.')
    }
  }

  const indexEmb = async () => {
    if (!projectId) return
    setIndexing(true)
    try {
      const r = await phase2.indexEmbeddings(projectId)
      const extra = r.qdrant_enabled ? ` (Qdrant upserted: ${r.qdrant_upserted ?? 0})` : ''
      setMsg(`Indexed ${r.chunks_indexed} chunks.${extra}`)
    } catch {
      setMsg('Index failed.')
    } finally {
      setIndexing(false)
    }
  }

  const connectZoteroApiKey = async () => {
    if (!zoteroApiKey.trim()) return setMsg('Paste your Zotero API Key first.')
    setZoteroConnecting(true)
    setMsg('')
    try {
      const r = await phase2.zoteroConnectApiKey(zoteroApiKey.trim())
      setZoteroConnected(true)
      setZoteroUser(r.username || r.userID)
      setZoteroMode('apikey')
      setMsg(`Zotero connected! User: ${r.username || r.userID}`)
    } catch {
      setMsg('Zotero API Key verification failed. Check that the key is correct.')
    } finally {
      setZoteroConnecting(false)
    }
  }

  const importZotero = async () => {
    if (!projectId) return
    setMsg('')
    try {
      const r = await phase2.zoteroImport(projectId, 25)
      setMsg(`Imported ${r.imported} items from Zotero as document stubs.`)
    } catch {
      setMsg('Zotero import failed (connect Zotero first).')
    }
  }

  const exportNotion = async () => {
    if (!projectId) return
    setMsg('')
    try {
      const r = await phase2.exportNotionPage(projectId)
      setMsg(`Notion page created: ${r.notion_page_id || 'ok'}`)
    } catch {
      setMsg('Notion export failed (integration secret + parent page id required).')
    }
  }

  const queueCelery = async () => {
    if (!projectId) return
    setMsg('')
    try {
      const r = await phase2.processCelery(projectId)
      setMsg(`Celery queued ${r.queued} job(s). ${r.note || ''}`)
    } catch {
      setMsg('Celery queue failed (broker/worker not running?).')
    }
  }

  if (!projectId) {
    return (
      <div className="min-h-screen p-8 dark:bg-surface-950">
        <p className="text-surface-600"><Link className="text-accent-600" to="/mode">Create a project first</Link></p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-surface-50 p-6 dark:bg-surface-950">
      <div className="mx-auto max-w-2xl">
        <Link to="/dashboard" className="mb-6 inline-flex items-center gap-2 text-sm text-surface-500">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <div className="flex items-center gap-2 mb-6">
          <Settings2 className="h-8 w-8 text-accent-600" />
          <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Project settings (Phase 2)</h1>
        </div>

        <div className="space-y-4 rounded-xl border border-surface-200 bg-white p-6 dark:border-surface-700 dark:bg-surface-900">
          <p className="text-xs text-surface-500">{vectorHint}</p>
          <div>
            <label className="text-sm font-medium text-surface-700 dark:text-surface-200">Custom system prompt</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              className="mt-1 w-full rounded-lg border border-surface-200 p-2 text-sm dark:border-surface-600 dark:bg-surface-800"
              placeholder="Instructions for extraction / labeling (used on re-process)"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-surface-700 dark:text-surface-200">
            <input type="checkbox" checked={blind} onChange={(e) => setBlind(e.target.checked)} />
            Dual-coding blind mode
          </label>
          <div>
            <label className="text-sm font-medium text-surface-700 dark:text-surface-200">Notion outbound webhook (optional)</label>
            <input
              value={notion}
              onChange={(e) => setNotion(e.target.value)}
              className="mt-1 w-full rounded-lg border border-surface-200 p-2 text-sm dark:border-surface-600 dark:bg-surface-800"
              placeholder="https://hooks... (evidence updates POST here)"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-surface-700 dark:text-surface-200">Notion integration secret (export)</label>
            <input
              type="password"
              value={notionSecret}
              onChange={(e) => setNotionSecret(e.target.value)}
              className="mt-1 w-full rounded-lg border border-surface-200 p-2 text-sm dark:border-surface-600 dark:bg-surface-800"
              placeholder="secret_..."
            />
          </div>
          <div>
            <label className="text-sm font-medium text-surface-700 dark:text-surface-200">Notion parent page id (export)</label>
            <input
              value={notionParent}
              onChange={(e) => setNotionParent(e.target.value)}
              className="mt-1 w-full rounded-lg border border-surface-200 p-2 text-sm dark:border-surface-600 dark:bg-surface-800"
              placeholder="UUID of page the integration can append children to"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void save()} className="btn-primary">Save settings</button>
            <button
              type="button"
              onClick={() => void indexEmb()}
              disabled={indexing}
              className="btn-secondary inline-flex items-center gap-1"
            >
              <Sparkles className="h-4 w-4" /> {indexing ? 'Indexing…' : 'Rebuild vector index'}
            </button>
          </div>
        </div>

        <div className="mt-6 space-y-3 rounded-xl border border-surface-200 bg-white p-6 dark:border-surface-700 dark:bg-surface-900">
          <h2 className="text-sm font-semibold text-surface-800 dark:text-surface-100 flex items-center gap-2">
            <BookOpen className="h-4 w-4" /> Zotero
          </h2>
          <p className="text-xs text-surface-500">
            <strong>Status:</strong>{' '}
            {zoteroConnected ? (
              <span className="font-medium text-emerald-600">
                connected via {zoteroMode || 'apikey'} ({zoteroUser || 'ok'})
              </span>
            ) : (
              'not connected'
            )}
          </p>
          {!zoteroConnected && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-surface-700 dark:text-surface-200">
                Zotero API Key
              </label>
              <p className="text-xs text-surface-400">
                Get yours at{' '}
                <a href="https://www.zotero.org/settings/keys" target="_blank" rel="noopener noreferrer" className="text-accent-600 underline">
                  zotero.org/settings/keys
                </a>
                {' '}&rarr; Create new private key
              </p>
              <input
                type="password"
                value={zoteroApiKey}
                onChange={(e) => setZoteroApiKey(e.target.value)}
                className="w-full rounded-lg border border-surface-200 p-2 text-sm dark:border-surface-600 dark:bg-surface-800"
                placeholder="Paste your Zotero API key here"
              />
              <button
                type="button"
                onClick={() => void connectZoteroApiKey()}
                disabled={zoteroConnecting}
                className="btn-primary text-sm"
              >
                {zoteroConnecting ? 'Verifying…' : 'Connect Zotero'}
              </button>
            </div>
          )}
          {zoteroConnected && (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void importZotero()} className="btn-secondary text-sm">
                Import top items as stubs
              </button>
            </div>
          )}
        </div>

        <div className="mt-6 space-y-3 rounded-xl border border-surface-200 bg-white p-6 dark:border-surface-700 dark:bg-surface-900">
          <h2 className="text-sm font-semibold text-surface-800 dark:text-surface-100 flex items-center gap-2">
            <Cloud className="h-4 w-4" /> Notion page export
          </h2>
          <button type="button" onClick={() => void exportNotion()} className="btn-secondary text-sm">Create snapshot page in Notion</button>
        </div>

        <div className="mt-6 space-y-3 rounded-xl border border-surface-200 bg-white p-6 dark:border-surface-700 dark:bg-surface-900">
          <h2 className="text-sm font-semibold text-surface-800 dark:text-surface-100 flex items-center gap-2">
            <Database className="h-4 w-4" /> Celery processing
          </h2>
          <p className="text-xs text-surface-500">Requires Redis broker and worker: celery -A celery_app worker -l info</p>
          <button type="button" onClick={() => void queueCelery()} className="btn-secondary text-sm">Queue pending docs on Celery</button>
        </div>

        {msg && <p className="mt-4 text-sm text-accent-700 dark:text-accent-300">{msg}</p>}
      </div>
    </div>
  )
}
