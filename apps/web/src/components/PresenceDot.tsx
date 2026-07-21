interface PresenceDotProps {
  online: boolean
  className?: string
  // Matches whatever surface the dot sits on top of (the border is what
  // creates the "cutout" ring separating it from the avatar) -- defaults to
  // the card background most callers use.
  borderClassName?: string
}

// Small avatar-corner indicator: green when the staff member has a live
// socket connection, grey otherwise. Meaningless for clients (they have no
// login) -- callers only render this for staff/artist avatars.
export default function PresenceDot({ online, className = '', borderClassName = 'border-surface' }: PresenceDotProps) {
  return (
    <span
      aria-label={online ? 'Online' : 'Offline'}
      title={online ? 'Online' : 'Offline'}
      className={`absolute right-0 bottom-0 h-2.5 w-2.5 rounded-full border-2 ${borderClassName} ${
        online ? 'bg-success' : 'bg-neutral'
      } ${className}`}
    />
  )
}
