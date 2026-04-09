import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { LogIn } from 'lucide-react'
import { phase2 } from '../services/api'

const TOKEN_KEY = 'slr-jwt'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [err, setErr] = useState('')
  const navigate = useNavigate()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')
    try {
      const r =
        mode === 'login'
          ? await phase2.login(email, password)
          : await phase2.register(email, password)
      localStorage.setItem(TOKEN_KEY, r.token)
      localStorage.setItem('slr-user-id', r.user.id)
      navigate('/dashboard')
    } catch {
      setErr('Authentication failed')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-50 p-4 dark:bg-surface-950">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-surface-200 bg-white p-6 shadow-sm dark:border-surface-700 dark:bg-surface-900">
        <div className="mb-4 flex items-center gap-2">
          <LogIn className="h-6 w-6 text-accent-600" />
          <h1 className="text-lg font-bold text-surface-900 dark:text-white">Account</h1>
        </div>
        <div className="mb-3 flex gap-2">
          <button type="button" className={`flex-1 rounded py-1 text-sm ${mode === 'login' ? 'bg-accent-100 text-accent-800' : 'text-surface-500'}`} onClick={() => setMode('login')}>Login</button>
          <button type="button" className={`flex-1 rounded py-1 text-sm ${mode === 'register' ? 'bg-accent-100 text-accent-800' : 'text-surface-500'}`} onClick={() => setMode('register')}>Register</button>
        </div>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          className="mb-2 w-full rounded-lg border border-surface-200 px-3 py-2 text-sm dark:border-surface-600 dark:bg-surface-800"
        />
        <input
          type="password"
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="mb-4 w-full rounded-lg border border-surface-200 px-3 py-2 text-sm dark:border-surface-600 dark:bg-surface-800"
        />
        {err && <p className="mb-2 text-sm text-red-600">{err}</p>}
        <button type="submit" className="btn-primary w-full">{mode === 'login' ? 'Sign in' : 'Create account'}</button>
        <p className="mt-4 text-center text-xs text-surface-500">
          <Link to="/" className="text-accent-600">Home</Link>
        </p>
      </form>
    </div>
  )
}
