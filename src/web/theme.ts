export type Theme = 'system' | 'light' | 'dark'

const KEY = 'hesapp-theme'

export function getTheme(): Theme {
  try {
    const value = localStorage.getItem(KEY)
    if (value === 'light' || value === 'dark') return value
  } catch {
    // depolama kapalıysa sistem teması
  }
  return 'system'
}

export function applyTheme(theme: Theme = getTheme()) {
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
}

export function setTheme(theme: Theme) {
  try {
    if (theme === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, theme)
  } catch {
    // seçim saklanamadı; yine de uygulanır
  }
  applyTheme(theme)
}

export function watchSystemTheme() {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme())
}
