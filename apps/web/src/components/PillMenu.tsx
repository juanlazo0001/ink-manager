import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { dropdownVariants, uiSpringTransition } from '../lib/motion'
import { CheckIcon, ChevronDownIcon } from './icons'

// Compact button + dropdown for a single filter/sort dimension -- trigger
// button, click-outside-to-close, absolute panel listing options with a
// checkmark on the active one. Originally built once for Conversations
// (its own Filter and Sort pills), extracted here so any other list view
// wanting the same pattern (Tasks, Inquiries & Projects, ...) reuses one
// implementation instead of a second copy -- same discipline already
// applied to ArtistAvatar/StatusPill elsewhere in this codebase.
export default function PillMenu<T extends string>({
  label,
  icon,
  value,
  options,
  onChange,
  isEditorial,
  active = false,
}: {
  label: string
  icon: ReactNode
  value: T
  options: ReadonlyArray<{ value: T; label: string }>
  onChange: (value: T) => void
  isEditorial: boolean
  active?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={
          isEditorial
            ? [
                'editorial-btn-secondary flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 transition',
                active ? 'border-accent bg-accent/10 text-accent' : 'border-transparent text-fg-muted hover:border-border-strong',
              ].join(' ')
            : [
                'flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors duration-fast ease-out',
                active ? 'bg-accent text-accent-fg' : 'text-fg-muted hover:text-fg',
              ].join(' ')
        }
      >
        {icon}
        {label}
        <ChevronDownIcon className="h-3 w-3 shrink-0" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="absolute z-10 mt-1 w-44 rounded-lg border border-border bg-surface-inset py-1 shadow-lg"
            variants={dropdownVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={uiSpringTransition}
          >
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onChange(option.value)
                  setOpen(false)
                }}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-fg hover:bg-surface"
              >
                {option.label}
                {value === option.value && <CheckIcon className="h-4 w-4 shrink-0 text-accent" />}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
