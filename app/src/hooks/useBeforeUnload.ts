import { useEffect } from 'react'

/**
 * While `enabled` is true, show the browser's native "Leave/Reload site?"
 * confirmation before the tab unloads — so users don't lose uploaded/extracted
 * data (which lives in memory only) on an accidental refresh or close.
 *
 * The prompt text is fixed by the browser and cannot be customised.
 */
export function useBeforeUnload(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = '' // required by Chrome/Edge to trigger the prompt
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [enabled])
}
