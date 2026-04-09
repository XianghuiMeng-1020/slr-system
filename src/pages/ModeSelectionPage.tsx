import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { CheckCircle2, Search, ArrowRight, Loader2 } from 'lucide-react'
import { useAppStore, type Mode } from '../store/useAppStore'

const modes: {
  id: Mode
  icon: typeof CheckCircle2
  title: string
  subtitle: string
  description: string
  features: string[]
  iconBg: string
  borderHover: string
}[] = [
  {
    id: 'theme-verification',
    icon: CheckCircle2,
    title: 'Theme Verification',
    subtitle: 'AI labels, you verify',
    description:
      'The system automatically applies your coding scheme to each document. You review the AI-generated labels alongside the original PDF and confirm or adjust them.',
    features: [
      'Auto-generated labels per coding item',
      'Side-by-side PDF & label view',
      'Confidence scores for each label',
      'Bulk edit and export support',
    ],
    iconBg: 'bg-primary-100 text-primary-600',
    borderHover: 'hover:border-primary-400',
  },
  {
    id: 'evidence-verification',
    icon: Search,
    title: 'Evidence Verification',
    subtitle: 'AI finds evidence, you decide',
    description:
      'The system surfaces relevant evidence passages from each document. Click any evidence to locate it in the PDF, then decide if it supports a coding decision. You make the final call.',
    features: [
      'AI-extracted evidence passages',
      'Click-to-locate in original PDF',
      'Yes/No response per evidence',
      'Optional notes for research logging',
    ],
    iconBg: 'bg-accent-100 text-accent-600',
    borderHover: 'hover:border-accent-400',
  },
]

export default function ModeSelectionPage() {
  const navigate = useNavigate()
  const createProject = useAppStore((s) => s.createProject)
  const ensureValidProject = useAppStore((s) => s.ensureValidProject)
  const currentMode = useAppStore((s) => s.mode)
  const projectId = useAppStore((s) => s.projectId)
  const [selectedMode, setSelectedMode] = useState<Mode | null>(currentMode)
  const [isCreating, setIsCreating] = useState(false)

  const handleSelect = (mode: Mode) => {
    setSelectedMode(mode)
  }

  const handleContinue = async () => {
    if (!selectedMode) return
    setIsCreating(true)
    try {
      if (selectedMode === currentMode && projectId) {
        const valid = await ensureValidProject()
        if (valid) {
          navigate('/upload')
          return
        }
      }
      await createProject(selectedMode)
      navigate('/upload')
    } catch {
      // toast handled in store
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-surface-50 via-white to-primary-50/20">
      <div className="flex items-center justify-center gap-2 border-b border-surface-200 bg-white/60 px-6 py-3 text-sm text-surface-400 backdrop-blur dark:border-surface-700 dark:bg-surface-900/60" role="navigation" aria-label="Progress">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-600 text-xs font-bold text-white">1</span>
        Select Mode
        <span className="mx-2 text-surface-300" aria-hidden="true">→</span>
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-200 text-xs font-bold text-surface-500">2</span>
        <span className="text-surface-400">Upload</span>
        <span className="mx-2 text-surface-300" aria-hidden="true">→</span>
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-200 text-xs font-bold text-surface-500">3</span>
        <span className="text-surface-400">Review</span>
      </div>

      <div className="py-12 px-6">
        <div className="mx-auto max-w-4xl">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-12">
            <h1 className="font-display text-4xl sm:text-5xl font-bold text-surface-900">Choose Your Review Mode</h1>
            <p className="mt-4 text-lg text-surface-500 max-w-xl mx-auto">
              Select the verification approach that best matches your research methodology.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-8" role="radiogroup" aria-label="Select review mode">
            {modes.map((mode, i) => {
              const isSelected = selectedMode === mode.id
              return (
                <motion.button
                  key={mode.id}
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.15, duration: 0.5 }}
                  onClick={() => handleSelect(mode.id)}
                  role="radio"
                  aria-checked={isSelected}
                  className={`card text-left cursor-pointer border-2 transition-all duration-300 ${mode.borderHover} ${
                    isSelected
                      ? `border-transparent ring-2 ring-offset-2 ${
                          mode.id === 'theme-verification' ? 'ring-primary-500' : 'ring-accent-500'
                        } shadow-xl`
                      : 'border-surface-200'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className={`flex h-14 w-14 items-center justify-center rounded-2xl ${mode.iconBg}`}>
                      <mode.icon className="h-7 w-7" />
                    </div>
                    {isSelected && (
                      <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        className={`flex h-8 w-8 items-center justify-center rounded-full ${
                          mode.id === 'theme-verification' ? 'bg-primary-600' : 'bg-accent-600'
                        } text-white`}
                      >
                        <CheckCircle2 className="h-5 w-5" />
                      </motion.div>
                    )}
                  </div>
                  <div className="mt-5">
                    <h2 className="font-display text-2xl font-bold text-surface-900">{mode.title}</h2>
                    <p className={`mt-1 text-sm font-medium ${mode.id === 'theme-verification' ? 'text-primary-600' : 'text-accent-600'}`}>
                      {mode.subtitle}
                    </p>
                    <p className="mt-3 text-surface-500 leading-relaxed text-sm">{mode.description}</p>
                  </div>
                  <ul className="mt-5 space-y-2.5">
                    {mode.features.map((f) => (
                      <li key={f} className="flex items-center gap-2.5 text-sm text-surface-600">
                        <CheckCircle2
                          className={`h-4 w-4 shrink-0 ${mode.id === 'theme-verification' ? 'text-primary-500' : 'text-accent-500'}`}
                        />
                        {f}
                      </li>
                    ))}
                  </ul>
                </motion.button>
              )
            })}
          </div>

          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }} className="mt-12 text-center">
            <button onClick={handleContinue} disabled={!selectedMode || isCreating} className="btn-primary text-lg px-10 py-4">
              {isCreating ? (
                <><Loader2 className="h-5 w-5 animate-spin" /> Creating project...</>
              ) : (
                <>Continue to Upload <ArrowRight className="h-5 w-5" /></>
              )}
            </button>
          </motion.div>
        </div>
      </div>
    </div>
  )
}
