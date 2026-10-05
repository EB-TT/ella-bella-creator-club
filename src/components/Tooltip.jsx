import { useEffect, useId, useRef, useState } from 'react'

const DEFAULT_WIDTH = 280
const GAP = 6

/** Hint shown on hover and on keyboard focus. Positioned with `fixed` so
    scrolling table wrappers don't clip it. Line breaks in text are kept. Renders
    children as-is when there's no text. */
export function Tooltip({ text, children, className, width: maxWidth = DEFAULT_WIDTH }) {
  const id = useId()
  const ref = useRef(null)
  const [pos, setPos] = useState(null)

  // A fixed-position bubble would drift on scroll, so just hide it.
  useEffect(() => {
    if (!pos) return
    const hide = () => setPos(null)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => {
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
    }
  }, [pos])

  if (!text) return children

  function show() {
    const r = ref.current.getBoundingClientRect()
    const width = Math.min(maxWidth, window.innerWidth - 16)
    const left = Math.min(Math.max(8, r.left + r.width / 2 - width / 2), window.innerWidth - width - 8)
    // Flip above when there isn't room below.
    const above = r.bottom + 140 > window.innerHeight && r.top > 140
    setPos(above ? { left, width, bottom: window.innerHeight - r.top + GAP } : { left, width, top: r.bottom + GAP })
  }

  return (
    <span
      ref={ref}
      className={`vtip${className ? ` ${className}` : ''}`}
      tabIndex={0}
      aria-describedby={id}
      onMouseEnter={show}
      onMouseLeave={() => setPos(null)}
      onFocus={show}
      onBlur={() => setPos(null)}
      onKeyDown={(e) => e.key === 'Escape' && setPos(null)}
    >
      {children}
      <span
        role="tooltip"
        id={id}
        className="vtip__bubble"
        hidden={!pos}
        style={pos ? { left: pos.left, top: pos.top, bottom: pos.bottom, maxWidth: pos.width } : undefined}
      >
        {text}
      </span>
    </span>
  )
}
