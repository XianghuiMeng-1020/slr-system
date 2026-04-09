import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { LogIn, Eye, EyeOff, ArrowRight } from 'lucide-react'
import { useAuthStore } from '../store/useAuthStore'

function getPasswordStrength(pw: string): { level: 0 | 1 | 2 | 3; label: string; color: string } {
  if (pw.length < 6) return { level: 0, label: 'Too short', color: 'bg-surface-300' }
  let score = 0
  if (pw.length >= 8) score++
  if (/[A-Z]/.test(pw)) score++
  if (/[0-9]/.test(pw)) score++
  if (/[^A-Za-z0-9]/.test(pw)) score++
  if (score <= 1) return { level: 1, label: 'Weak', color: 'bg-red-500' }
  if (score <= 2) return { level: 2, label: 'Medium', color: 'bg-amber-500' }
  return { level: 3, label: 'Strong', color: 'bg-emerald-500' }
}

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const login = useAuthStore((s) => s.login)
  const register = useAuthStore((s) => s.register)

  const pwStrength = getPasswordStrength(password)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')
    setLoading(true)
    try {
      if (mode === 'login') {
        await login(email, password)
      } else {
        await register(email, password)
      }
      navigate('/mode')
    } catch {
      setErr(mode === 'login' ? 'Invalid email or password' : 'Registration failed — email may already exist')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-surface-50 via-white to-primary-50/30 p-4 dark:from-surface-950 dark:via-surface-950 dark:to-surface-900">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <Link to="/" className="inline-flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-600 text-white">
              <LogIn className="h-5 w-5" />
            </div>
            <span className="font-display text-xl font-bold text-surface-900 dark:text-white">
              SLR<span className="text-primary-600">System</span>
            </span>
          </Link>
        </div>

        <form onSubmit={submit} className="rounded-2xl border border-surface-200 bg-white p-6 shadow-lg dark:border-surface-700 dark:bg-surface-900">
          <h1 className="mb-1 text-xl font-bold text-surface-900 dark:text-white">
            {mode === 'login' ? 'Welcome back' : 'Create account'}
          </h1>
          <p className="mb-5 text-sm text-surface-500">
            {mode === 'login' ? 'Sign in to continue your review' : 'Start your systematic literature review'}
          </p>

          <div className="mb-4 flex rounded-lg border border-surface-200 p-0.5 dark:border-surface-600">
            <button
              type="button"
              className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${mode === 'login' ? 'bg-primary-600 text-white shadow-sm' : 'text-surface-500 hover:text-surface-700'}`}
              onClick={() => { setMode('login'); setErr('') }}
            >
              Login
            </button>
            <button
              type="button"
              className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${mode === 'register' ? 'bg-primary-600 text-white shadow-sm' : 'text-surface-500 hover:text-surface-700'}`}
              onClick={() => { setMode('register'); setErr('') }}
            >
              Register
            </button>
          </div>

          <label className="mb-1 block text-sm font-medium text-surface-700 dark:text-surface-300">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="mb-3 w-full rounded-lg border border-surface-200 px-3 py-2.5 text-sm outline-none transition-colors focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-surface-600 dark:bg-surface-800 dark:focus:ring-primary-900"
          />

          <label className="mb-1 block text-sm font-medium text-surface-700 dark:text-surface-300">Password</label>
          <div className="relative mb-1">
            <input
              type={showPw ? 'text' : 'password'}
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'register' ? 'At least 6 characters' : '••••••••'}
              className="w-full rounded-lg border border-surface-200 px-3 py-2.5 pr-10 text-sm outline-none transition-colors focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-surface-600 dark:bg-surface-800 dark:focus:ring-primary-900"
            />
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowPw(!showPw)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-surface-400 hover:text-surface-600"
            >
              {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>

          {mode === 'register' && password.length > 0 && (
            <div className="mb-3">
              <div className="mb-1 flex gap-1">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className={`h-1.5 flex-1 rounded-full transition-colors ${i <= pwStrength.level ? pwStrength.color : 'bg-surface-200 dark:bg-surface-700'}`}
                  />
                ))}
              </div>
              <p className={`text-xs ${pwStrength.level >= 3 ? 'text-emerald-600' : pwStrength.level >= 2 ? 'text-amber-600' : 'text-red-500'}`}>
                {pwStrength.label}
              </p>
            </div>
          )}
          {mode === 'login' && <div className="mb-3" />}

          {err && (
            <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
              {err}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-primary flex w-full items-center justify-center gap-2"
          >
            {loading ? (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              <>
                {mode === 'login' ? 'Sign in' : 'Create account'}
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>

          <p className="mt-4 text-center text-xs text-surface-500">
            <Link to="/" className="text-primary-600 hover:underline">Back to home</Link>
          </p>
        </form>
      </div>
    </div>
  )
}
