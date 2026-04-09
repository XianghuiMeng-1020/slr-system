import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Keyboard } from 'lucide-react'

const DEFAULTS: Record<string, string> = {
  nextEvidence: 'j',
  prevEvidence: 'k',
  markYes: 'y',
  markNo: 'n',
  nextDoc: 'ArrowRight',
  prevDoc: 'ArrowLeft',
  export: 'e',
}

const STORAGE = 'slr-shortcuts'

function loadShortcuts(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE)
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    /* ignore */
  }
  return DEFAULTS
}

export default function ShortcutSettingsPage() {
  const [map, setMap] = useState(loadShortcuts)

  const save = () => {
    localStorage.setItem(STORAGE, JSON.stringify(map))
  }

  return (
    <div className="min-h-screen bg-surface-50 p-6 dark:bg-surface-950">
      <div className="mx-auto max-w-lg">
        <Link to="/dashboard" className="mb-6 inline-flex items-center gap-2 text-sm text-surface-500">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <div className="flex items-center gap-2 mb-6">
          <Keyboard className="h-7 w-7 text-accent-600" />
          <h1 className="text-xl font-bold text-surface-900 dark:text-white">Keyboard shortcuts</h1>
        </div>
        <p className="text-sm text-surface-500 mb-4 dark:text-surface-400">
          Stored locally in your browser. Evidence page uses built-in shortcuts; this panel documents and lets you customize key labels for reference.
        </p>
        <div className="space-y-3 rounded-xl border border-surface-200 bg-white p-4 dark:border-surface-700 dark:bg-surface-900">
          {Object.entries(map).map(([k, v]) => (
            <label key={k} className="flex items-center justify-between gap-2 text-sm">
              <span className="text-surface-600 dark:text-surface-300">{k}</span>
              <input
                value={v}
                onChange={(e) => setMap((m) => ({ ...m, [k]: e.target.value }))}
                className="rounded border border-surface-200 px-2 py-1 font-mono text-xs dark:border-surface-600 dark:bg-surface-800"
              />
            </label>
          ))}
          <button type="button" onClick={save} className="btn-primary w-full mt-2">Save</button>
        </div>
      </div>
    </div>
  )
}
