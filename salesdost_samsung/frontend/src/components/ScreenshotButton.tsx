import { useCallback, useRef, useState } from 'react'
import { Camera, Check, Loader2 } from 'lucide-react'

/**
 * A floating screenshot button fixed at bottom-right.
 * It captures the full page using html2canvas and downloads the result as a PNG.
 * The button is positioned above the footer so it never overlaps content.
 */
export function ScreenshotButton() {
  const [state, setState] = useState<'idle' | 'capturing' | 'done'>('idle')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleClick = useCallback(async () => {
    if (state !== 'idle') return
    setState('capturing')

    try {
      // Dynamically import to keep the initial bundle small
      const html2canvas = (await import('html2canvas')).default

      const canvas = await html2canvas(document.documentElement, {
        // Scroll to top so the full viewport is captured correctly
        scrollX: 0,
        scrollY: -window.scrollY,
        // Use the actual window width/height as canvas dimensions
        windowWidth: document.documentElement.scrollWidth,
        windowHeight: document.documentElement.scrollHeight,
        useCORS: true,
        allowTaint: true,
        logging: false,
        // Skip the screenshot button itself to avoid it appearing in the output
        ignoreElements: (el) => el.id === 'screenshot-fab',
      })

      // Download as PNG
      const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-')
      const link = document.createElement('a')
      link.download = `dashboard-${timestamp}.png`
      link.href = canvas.toDataURL('image/png')
      link.click()

      setState('done')
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setState('idle'), 2500)
    } catch (err) {
      console.error('Screenshot failed:', err)
      setState('idle')
    }
  }, [state])

  return (
    <button
      id="screenshot-fab"
      onClick={handleClick}
      disabled={state === 'capturing'}
      aria-label="Take screenshot"
      title={
        state === 'capturing' ? 'Capturing…' :
        state === 'done'      ? 'Saved!' :
                                'Take screenshot'
      }
      style={{
        position: 'fixed',
        bottom: '52px',          // sits just above the 40-px footer
        right: '20px',
        zIndex: 30,
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: state === 'idle' ? '10px' : '9px 14px',
        borderRadius: '50px',
        border: 'none',
        cursor: state === 'capturing' ? 'default' : 'pointer',
        boxShadow: '0 4px 14px rgba(0,0,0,0.15)',
        transition: 'all 0.2s ease',
        fontSize: '13px',
        fontWeight: 600,
        lineHeight: 1,
        background:
          state === 'done' ? '#10b981' :
          state === 'capturing' ? '#6366f1' :
          'linear-gradient(135deg, #6366f1 0%, #818cf8 100%)',
        color: '#fff',
        userSelect: 'none',
        whiteSpace: 'nowrap',
        // Subtle scale on hover handled via filter; no hover event required
      }}
      onMouseEnter={e => {
        if (state === 'idle') {
          (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-2px)'
          ;(e.currentTarget as HTMLButtonElement).style.boxShadow = '0 6px 20px rgba(99,102,241,0.4)'
        }
      }}
      onMouseLeave={e => {
        ;(e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)'
        ;(e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 14px rgba(0,0,0,0.15)'
      }}
    >
      {state === 'capturing' && (
        <>
          <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} />
          <span>Capturing…</span>
        </>
      )}
      {state === 'done' && (
        <>
          <Check size={15} />
          <span>Saved!</span>
        </>
      )}
      {state === 'idle' && (
        <Camera size={18} />
      )}
    </button>
  )
}
