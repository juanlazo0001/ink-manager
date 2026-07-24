export default function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">{label}</p>
      <p className="mt-1 text-sm text-fg">{value}</p>
    </div>
  )
}
