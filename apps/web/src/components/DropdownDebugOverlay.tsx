import { useEffect, useState } from 'react'

// A read-only geometry readout for diagnosing dropdown placement on a real
// phone, shown ONLY when the URL carries `?dropdownDebug=1`.
//
// It exists because the specialties dropdown misbehaved on the owner's iOS
// Safari through three rounds of fixes that each looked correct in a
// simulated viewport. Simulating iOS is guesswork; this prints what the
// device actually reports, so the next round starts from measurements. It
// renders nothing at all without the flag, so it cannot affect normal use.
//
// Remove once the placement is confirmed good on-device.
interface Reading {
  innerW: number
  innerH: number
  vvW: number | null
  vvH: number | null
  vvLeft: number | null
  vvTop: number | null
  vvScale: number | null
  layoutW: number
  anchor: string
  panel: string
  panelVisible: string
}

function read(): Reading {
  const vv = window.visualViewport
  const input = document.querySelector('input[placeholder^="Search or add"]') as HTMLElement | null
  const panels = [...document.body.children].filter(
    (el) => el.tagName === 'DIV' && getComputedStyle(el as HTMLElement).position === 'fixed',
  ) as HTMLElement[]
  const panel = panels.filter((p) => p.querySelector('button')).pop() ?? null

  const box = (el: HTMLElement | null) => {
    if (!el) return 'none'
    const r = el.getBoundingClientRect()
    return `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`
  }

  let visible = 'n/a'
  if (panel) {
    const r = panel.getBoundingClientRect()
    const top = vv?.offsetTop ?? 0
    const left = vv?.offsetLeft ?? 0
    const h = vv?.height ?? window.innerHeight
    const w = vv?.width ?? window.innerWidth
    const inside = r.top >= top - 1 && r.bottom <= top + h + 1 && r.left >= left - 1 && r.right <= left + w + 1
    visible = inside ? 'INSIDE band' : 'OUTSIDE band'
  }

  return {
    innerW: window.innerWidth,
    innerH: window.innerHeight,
    vvW: vv ? Math.round(vv.width) : null,
    vvH: vv ? Math.round(vv.height) : null,
    vvLeft: vv ? Math.round(vv.offsetLeft) : null,
    vvTop: vv ? Math.round(vv.offsetTop) : null,
    vvScale: vv ? Math.round(vv.scale * 100) / 100 : null,
    layoutW: document.documentElement.clientWidth,
    anchor: box(input),
    panel: box(panel),
    panelVisible: visible,
  }
}

export default function DropdownDebugOverlay() {
  const enabled =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('dropdownDebug')
  const [r, setR] = useState<Reading | null>(null)

  useEffect(() => {
    if (!enabled) return
    const tick = () => setR(read())
    tick()
    const id = window.setInterval(tick, 400)
    window.visualViewport?.addEventListener('resize', tick)
    window.visualViewport?.addEventListener('scroll', tick)
    return () => {
      window.clearInterval(id)
      window.visualViewport?.removeEventListener('resize', tick)
      window.visualViewport?.removeEventListener('scroll', tick)
    }
  }, [enabled])

  if (!enabled || !r) return null

  return (
    // Pinned to the top of the LAYOUT viewport with a very high z-index so it
    // stays readable while the keyboard is up. Deliberately not interactive.
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 2147483647,
        pointerEvents: 'none',
        background: 'rgba(0,0,0,0.82)',
        color: '#fff',
        font: '11px/1.35 ui-monospace, Menlo, monospace',
        padding: '6px 8px',
        whiteSpace: 'pre-wrap',
      }}
    >
      {`window   ${r.innerW}x${r.innerH}   layoutW ${r.layoutW}
visualVP ${r.vvW}x${r.vvH} @ ${r.vvLeft},${r.vvTop}  scale ${r.vvScale}
anchor   ${r.anchor}
panel    ${r.panel}
verdict  ${r.panelVisible}`}
    </div>
  )
}
