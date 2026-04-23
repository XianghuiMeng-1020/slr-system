import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Settings2, Sparkles, BookOpen, Database, Cloud, Users, Copy, Check } from 'lucide-react'
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
  const [members, setMembers] = useState<{ user_id: string; email: string; role: string }[]>([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteMsg, setInviteMsg] = useState('')
  const [copied, setCopied] = useState(false)

  const refreshMembers = useCallback(() => {
    if (!projectId) return
    phase2.listMembers(projectId).then(setMembers).catch(() => {})
  }, [projectId])

  useEffect(() => {
    if (!projectId) return
    phase2.getSettings(projectId).then((s) => {
      setPrompt(String(s.custom_system_prompt || ''))
      setBlind(Boolean(s.dual_coding_blind))
      setNotion(String(s.notion_webhook_url || ''))
      setNotionSecret(String(s.notion_integration_secret || ''))
      setNotionParent(String(s.notion_parent_page_id || ''))
    }).catch(() => {})
    phase2.zoteroStatus(projectId).then((z) => {
      setZoteroConnected(z.connected)
      setZoteroUser(z.username || z.userID)
      setZoteroMode(z.mode)
    }).catch(() => {})
    phase2.vectorBackendStatus().then((v) => {
      setVectorHint(v.qdrant_configured ? `Qdrant: ${v.qdrant_url || 'on'}` : 'Qdrant: off (set QDRANT_URL on server)')
    }).catch(() => {})
    refreshMembers()
  }, [projectId, refreshMembers])

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

  const [zoteroMsg, setZoteroMsg] = useState('')

  const connectZoteroApiKey = async () => {
    if (!zoteroApiKey.trim()) { setZoteroMsg('Please paste your Zotero API Key first.'); return }
    setZoteroConnecting(true)
    setZoteroMsg('')
    try {
      const r = await phase2.zoteroConnectApiKey(zoteroApiKey.trim(), projectId ?? undefined)
      setZoteroConnected(true)
      setZoteroUser(r.username || r.userID)
      setZoteroMode('apikey')
      setZoteroMsg(`Connected! User: ${r.username || r.userID}`)
    } catch (e: unknown) {
      const detail = e instanceof Error ? e.message : String(e)
      if (detail.includes('401') || detail.toLowerCase().includes('authenticated')) {
        setZoteroMsg('Login session expired. Please log out and log in again, then retry.')
      } else {
        setZoteroMsg(`Connection failed: ${detail.slice(0, 200)}`)
      }
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

  const inviteMember = async () => {
    if (!projectId || !inviteEmail.trim()) return
    setInviteMsg('')
    try {
      await phase2.addMember(projectId, inviteEmail.trim())
      setInviteMsg(`✓ ${inviteEmail.trim()} added to project.`)
      setInviteEmail('')
      refreshMembers()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('404')) {
        setInviteMsg('User not found — they must register first at this URL.')
      } else {
        setInviteMsg(`Failed: ${msg.slice(0, 120)}`)
      }
    }
  }

  const copyProjectLink = () => {
    const url = `${window.location.origin}/?project=${projectId}`
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
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
    <div className="min-h-screen bg-surface-50 dark:bg-surface-950">
      <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6">
        <div className="flex items-center gap-2 mb-6">
          <Settings2 className="h-7 w-7 text-accent-600" />
          <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Project Settings</h1>
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
          {zoteroMsg && (
            <p className={`text-sm ${zoteroMsg.startsWith('Connected') ? 'text-emerald-600' : 'text-red-600'}`}>
              {zoteroMsg}
            </p>
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

        {/* ── Collaborators ───────────────────────────────────── */}
        <div className="mt-6 space-y-4 rounded-xl border border-surface-200 bg-white p-6 dark:border-surface-700 dark:bg-surface-900">
          <h2 className="text-sm font-semibold text-surface-800 dark:text-surface-100 flex items-center gap-2">
            <Users className="h-4 w-4" /> Collaborators &amp; Sharing
          </h2>

          {/* Project ID + copy link */}
          <div className="rounded-lg bg-surface-50 dark:bg-surface-800 p-3 space-y-1">
            <p className="text-xs text-surface-500">Project ID</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded bg-surface-100 dark:bg-surface-700 px-2 py-1 text-xs font-mono text-surface-800 dark:text-surface-100 select-all">
                {projectId}
              </code>
              <button
                type="button"
                onClick={copyProjectLink}
                className="inline-flex items-center gap-1 rounded-lg border border-surface-200 dark:border-surface-600 px-2 py-1 text-xs text-surface-600 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700"
              >
                {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                {copied ? 'Copied!' : 'Copy link'}
              </button>
            </div>
            <p className="text-xs text-surface-400">Share this link with collaborators so they open the same project.</p>
          </div>

          {/* Current members */}
          {members.length > 0 && (
            <div>
              <p className="text-xs font-medium text-surface-600 dark:text-surface-300 mb-1">Current team members</p>
              <ul className="space-y-1">
                {members.map((m) => (
                  <li key={m.user_id} className="flex items-center justify-between text-xs rounded-lg bg-surface-50 dark:bg-surface-800 px-3 py-1.5">
                    <span className="text-surface-800 dark:text-surface-100">{m.email}</span>
                    <span className="text-surface-400 capitalize">{m.role}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Add member */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-surface-600 dark:text-surface-300">
              Add coder by email
            </p>
            <p className="text-xs text-surface-400">
              The coder must first register at this site. Then paste their email below.
            </p>
            <div className="flex gap-2">
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void inviteMember()}
                placeholder="coder@example.com"
                className="flex-1 rounded-lg border border-surface-200 p-2 text-sm dark:border-surface-600 dark:bg-surface-800"
              />
              <button type="button" onClick={() => void inviteMember()} className="btn-primary text-sm">
                Add
              </button>
            </div>
            {inviteMsg && (
              <p className={`text-xs ${inviteMsg.startsWith('✓') ? 'text-emerald-600' : 'text-red-500'}`}>
                {inviteMsg}
              </p>
            )}
          </div>

          {/* Quick reference for pre-created accounts */}
          <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950 p-3 space-y-1">
            <p className="text-xs font-semibold text-amber-800 dark:text-amber-200">Pre-created coder accounts (from setup script)</p>
            <div className="text-xs text-amber-700 dark:text-amber-300 font-mono space-y-0.5">
              <div>First Coder  — coder1@slr.local / Slr2026#1</div>
              <div>Second Coder — coder2@slr.local / Slr2026#2</div>
              <div>Third Coder  — coder3@slr.local / Slr2026#3</div>
            </div>
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
              Change passwords after first login for security.
            </p>
          </div>
        </div>

        {msg && <p className="mt-4 text-sm text-accent-700 dark:text-accent-300">{msg}</p>}
      </div>
    </div>
  )
}
