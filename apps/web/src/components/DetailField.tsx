import { useThemePreset } from '../lib/useThemePreset'

export default function DetailField({ label, value }: { label: string; value: string }) {
  const { shape } = useThemePreset()
  const isEditorial = shape === 'editorial'
  return (
    <div>
      <p
        className={
          isEditorial
            ? 'font-jura text-[9.5px] font-semibold uppercase tracking-[0.28em] text-fg-muted'
            : 'text-xs font-medium uppercase tracking-wider text-fg-muted'
        }
      >
        {label}
      </p>
      <p className={isEditorial ? 'mt-1.5 text-[15.5px] text-fg' : 'mt-1 text-sm text-fg'}>{value}</p>
    </div>
  )
}
