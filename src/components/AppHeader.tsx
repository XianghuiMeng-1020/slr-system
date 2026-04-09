import { useState, useRef, useEffect } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { BookOpen, LogIn, LogOut, Settings2, ChevronDown, User } from 'lucide-react'
import { useAuthStore } from '../store/useAuthStore'
import { useAppStore } from '../store/useAppStore'

export default function AppHeader() {
  const navigate = useNavigate()
  const location = useLocation()
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const projectId = useAppStore((s) => s.projectId)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleLogout = () => {
    logout()
    setMenuOpen(false)
    navigate('/')
  }

  const isActive = (path: string) => location.pathname === path

  const displayName = user?.email ? user.email.split('@')[0] : 'User'
  const initials = displayName.slice(0, 2).toUpperCase()

  return (
    <header className="sticky top-0 z-50 border-b border-surface-200 bg-white/80 backdrop-blur-lg dark:border-surface-700 dark:bg-surface-900/80">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
        <Link to="/" className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-600 text-white">
            <BookOpen className="h-4.5 w-4.5" />
          </div>
          <span className="font-display text-lg font-bold text-surface-900 dark:text-white">
            SLR<span className="text-primary-600">System</span>
          </span>
        </Link>

        {user && projectId && (
          <nav className="hidden items-center gap-1 md:flex">
            <NavLink to="/dashboard" active={isActive('/dashboard')}>Dashboard</NavLink>
            <NavLink to="/upload" active={isActive('/upload')}>Upload</NavLink>
            <NavLink to="/settings" active={isActive('/settings')}>Settings</NavLink>
          </nav>
        )}

        <div className="flex items-center gap-3">
          {user ? (
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="flex items-center gap-2 rounded-full border border-surface-200 py-1.5 pl-1.5 pr-3 text-sm font-medium text-surface-700 transition-colors hover:bg-surface-50 dark:border-surface-600 dark:text-surface-200 dark:hover:bg-surface-800"
              >
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-100 text-xs font-bold text-primary-700 dark:bg-primary-900 dark:text-primary-200">
                  {initials}
                </div>
                <span className="hidden sm:inline">{displayName}</span>
                <ChevronDown className="h-3.5 w-3.5 text-surface-400" />
              </button>

              {menuOpen && (
                <div className="absolute right-0 mt-2 w-56 rounded-xl border border-surface-200 bg-white py-1 shadow-lg dark:border-surface-700 dark:bg-surface-900">
                  <div className="border-b border-surface-100 px-4 py-2.5 dark:border-surface-700">
                    <p className="text-sm font-medium text-surface-900 dark:text-white">{displayName}</p>
                    <p className="text-xs text-surface-500">{user.email}</p>
                  </div>
                  <Link
                    to="/settings"
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-2 px-4 py-2 text-sm text-surface-700 hover:bg-surface-50 dark:text-surface-200 dark:hover:bg-surface-800"
                  >
                    <Settings2 className="h-4 w-4" /> Project Settings
                  </Link>
                  <Link
                    to="/mode"
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-2 px-4 py-2 text-sm text-surface-700 hover:bg-surface-50 dark:text-surface-200 dark:hover:bg-surface-800"
                  >
                    <User className="h-4 w-4" /> Switch Mode
                  </Link>
                  <button
                    onClick={handleLogout}
                    className="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                  >
                    <LogOut className="h-4 w-4" /> Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <Link
              to="/login"
              className="inline-flex items-center gap-1.5 rounded-lg border border-primary-200 bg-primary-50 px-4 py-2 text-sm font-medium text-primary-700 transition-colors hover:bg-primary-100 dark:border-primary-800 dark:bg-primary-900/30 dark:text-primary-300"
            >
              <LogIn className="h-4 w-4" /> Login
            </Link>
          )}
        </div>
      </div>
    </header>
  )
}

function NavLink({ to, active, children }: { to: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
        active
          ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
          : 'text-surface-600 hover:bg-surface-50 hover:text-surface-900 dark:text-surface-300 dark:hover:bg-surface-800'
      }`}
    >
      {children}
    </Link>
  )
}
