import { createContext, createElement, useContext, useMemo, useState } from 'react'

type Lang = 'en' | 'zh'
type Dict = Record<string, string>

const en: Dict = {
  loading: 'Loading...',
  uploadDocuments: 'Upload Documents',
  openDashboard: 'Open Dashboard',
}

const zh: Dict = {
  loading: '加载中...',
  uploadDocuments: '上传文档',
  openDashboard: '打开仪表板',
}

const dictByLang: Record<Lang, Dict> = { en, zh }

const I18nContext = createContext<{
  lang: Lang
  setLang: (lang: Lang) => void
  t: (key: string) => string
}>({
  lang: 'en',
  setLang: () => undefined,
  t: (k) => k,
})

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const browserLang = typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
  const [lang, setLang] = useState<Lang>((localStorage.getItem('slr-lang') as Lang) || browserLang)
  const value = useMemo(() => ({
    lang,
    setLang: (l: Lang) => {
      setLang(l)
      localStorage.setItem('slr-lang', l)
      document.documentElement.lang = l === 'zh' ? 'zh-CN' : 'en'
    },
    t: (key: string) => dictByLang[lang][key] || key,
  }), [lang])
  return createElement(I18nContext.Provider, { value }, children)
}

export function useI18n() {
  return useContext(I18nContext)
}
