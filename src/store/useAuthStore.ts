import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { phase2 } from '../services/api'

interface AuthUser {
  id: string
  email: string
}

interface AuthState {
  user: AuthUser | null
  token: string | null

  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string) => Promise<void>
  logout: () => void
  hydrate: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,

      login: async (email, password) => {
        const r = await phase2.login(email, password)
        localStorage.setItem('slr-jwt', r.token)
        localStorage.setItem('slr-user-id', r.user.id)
        set({ user: { id: r.user.id, email: r.user.email ?? email }, token: r.token })
      },

      register: async (email, password) => {
        const r = await phase2.register(email, password)
        localStorage.setItem('slr-jwt', r.token)
        localStorage.setItem('slr-user-id', r.user.id)
        set({ user: { id: r.user.id, email: r.user.email ?? email }, token: r.token })
      },

      logout: () => {
        localStorage.removeItem('slr-jwt')
        localStorage.removeItem('slr-user-id')
        set({ user: null, token: null })
      },

      hydrate: () => {
        const token = localStorage.getItem('slr-jwt')
        const userId = localStorage.getItem('slr-user-id')
        if (token && userId) {
          const stored = JSON.parse(localStorage.getItem('slr-auth-store') || '{}')
          const email = stored?.state?.user?.email || ''
          set({ token, user: { id: userId, email } })
        }
      },
    }),
    {
      name: 'slr-auth-store',
      partialize: (s) => ({ user: s.user, token: s.token }),
    },
  ),
)
