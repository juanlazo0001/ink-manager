type IconProps = { className?: string }

export function DashboardIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <rect x="2.5" y="2.5" width="6" height="6" rx="1.5" />
      <rect x="11.5" y="2.5" width="6" height="6" rx="1.5" />
      <rect x="2.5" y="11.5" width="6" height="6" rx="1.5" />
      <rect x="11.5" y="11.5" width="6" height="6" rx="1.5" />
    </svg>
  )
}

export function ClientsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <circle cx="7" cy="6.5" r="2.5" />
      <path d="M2.5 16c0-3 2-4.5 4.5-4.5s4.5 1.5 4.5 4.5" />
      <circle cx="14" cy="7" r="2" />
      <path d="M12.5 11.2c2 .1 3.5 1.5 3.5 4.3" />
    </svg>
  )
}

export function AppointmentsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <rect x="2.5" y="4" width="15" height="13" rx="2" />
      <line x1="2.5" y1="8" x2="17.5" y2="8" />
      <line x1="6" y1="2.5" x2="6" y2="5.5" />
      <line x1="14" y1="2.5" x2="14" y2="5.5" />
    </svg>
  )
}

export function ArtistsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <path d="M10 2.5c3 4 5.5 7.3 5.5 10a5.5 5.5 0 1 1-11 0c0-2.7 2.5-6 5.5-10Z" />
    </svg>
  )
}

// An ID-badge silhouette (card + photo + name lines) -- deliberately not
// another two-person icon like ClientsIcon, since at sidebar size the two
// used to be indistinguishable.
export function TeamIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <rect x="4" y="2.5" width="12" height="15" rx="2" />
      <circle cx="10" cy="8" r="2.25" />
      <path d="M6.75 14.5c.55-2 2-3 3.25-3s2.7 1 3.25 3" />
      <line x1="7" y1="4.75" x2="13" y2="4.75" />
    </svg>
  )
}

export function SettingsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <line x1="3" y1="5" x2="17" y2="5" />
      <line x1="3" y1="10" x2="17" y2="10" />
      <line x1="3" y1="15" x2="17" y2="15" />
      <circle cx="7" cy="5" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="13" cy="10" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="9" cy="15" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function LogoutIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <path d="M8 3H4.5a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1H8" />
      <path d="M13 6.5 16.5 10 13 13.5" />
      <line x1="16.5" y1="10" x2="7.5" y2="10" />
    </svg>
  )
}

export function SearchIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <circle cx="9" cy="9" r="6" />
      <line x1="17" y1="17" x2="13.2" y2="13.2" />
    </svg>
  )
}

export function BellIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <path d="M5 8a5 5 0 0 1 10 0c0 3.5 1.2 4.8 1.2 4.8H3.8S5 11.5 5 8Z" strokeLinejoin="round" />
      <path d="M8 15.5a2 2 0 0 0 4 0" />
    </svg>
  )
}

export function ChevronDownIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <polyline points="5.5 8 10 12.5 14.5 8" />
    </svg>
  )
}

export function ArrowUpRightIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <line x1="6" y1="14" x2="14" y2="6" />
      <polyline points="7.5 6 14 6 14 12.5" />
    </svg>
  )
}

export function PlusIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <line x1="10" y1="4" x2="10" y2="16" />
      <line x1="4" y1="10" x2="16" y2="10" />
    </svg>
  )
}

export function DocumentIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <path d="M5.5 2.5h6l3 3v12a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-14a1 1 0 0 1 1-1Z" strokeLinejoin="round" />
      <line x1="7" y1="10" x2="13" y2="10" />
      <line x1="7" y1="13" x2="13" y2="13" />
    </svg>
  )
}

export function CheckIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <polyline points="4.5 10.5 8 14 15.5 6" />
    </svg>
  )
}

export function CloseIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <line x1="5" y1="5" x2="15" y2="15" />
      <line x1="15" y1="5" x2="5" y2="15" />
    </svg>
  )
}

export function ArrowLeftIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <line x1="16" y1="10" x2="4" y2="10" />
      <polyline points="9 5 4 10 9 15" />
    </svg>
  )
}

export function MenuIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <line x1="3" y1="5.5" x2="17" y2="5.5" />
      <line x1="3" y1="10" x2="17" y2="10" />
      <line x1="3" y1="14.5" x2="17" y2="14.5" />
    </svg>
  )
}

export function PhotoIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <rect x="2.5" y="3.5" width="15" height="13" rx="1.5" />
      <circle cx="7" cy="8" r="1.5" />
      <path d="M3 14.5 7.5 10l3 3 2.5-2.5L17 14" strokeLinejoin="round" />
    </svg>
  )
}

export function TasksIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <rect x="3" y="3" width="14" height="14" rx="2" />
      <polyline points="6.5 10 8.5 12 13.5 7" strokeLinejoin="round" />
    </svg>
  )
}

export function MessageIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <path d="M3 4.5h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H8l-4 3v-3H3a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z" strokeLinejoin="round" />
    </svg>
  )
}

export function AttachmentIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <path d="M14 6.5v7a4 4 0 0 1-8 0v-8a2.5 2.5 0 0 1 5 0v7.5a1 1 0 0 1-2 0v-7" strokeLinecap="round" />
    </svg>
  )
}

export function SendIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path d="M17.5 2.5 2.5 8.8l5.8 2.4 2.4 5.8L17.5 2.5Z" />
    </svg>
  )
}

export function DownloadIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <path d="M10 3v9.5m0 0 3.5-3.5M10 12.5 6.5 9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 14v1.5A1.5 1.5 0 0 0 5.5 17h9a1.5 1.5 0 0 0 1.5-1.5V14" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function InfoIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <circle cx="10" cy="10" r="7.5" />
      <line x1="10" y1="9" x2="10" y2="14" />
      <circle cx="10" cy="6.3" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function TagIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <path d="M3 3h6l8 8-6 6-8-8V3Z" strokeLinejoin="round" />
      <circle cx="7" cy="7" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function GiftCardIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <rect x="2.5" y="7" width="15" height="10.5" rx="1.5" />
      <line x1="10" y1="7" x2="10" y2="17.5" />
      <path d="M10 7c-1.1-2.6-2.9-3.7-3.9-2.9-1 .8-.2 2.9 3.9 2.9Z" strokeLinejoin="round" />
      <path d="M10 7c1.1-2.6 2.9-3.7 3.9-2.9 1 .8.2 2.9-3.9 2.9Z" strokeLinejoin="round" />
    </svg>
  )
}

export function ArchiveIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <rect x="2.5" y="3" width="15" height="4" rx="1" strokeLinejoin="round" />
      <path d="M3.5 7v8a1.5 1.5 0 0 0 1.5 1.5h10A1.5 1.5 0 0 0 16.5 15V7" strokeLinejoin="round" />
      <line x1="8" y1="10.5" x2="12" y2="10.5" strokeLinecap="round" />
    </svg>
  )
}

export function MoreIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" stroke="none" className={className}>
      <circle cx="4" cy="10" r="1.6" />
      <circle cx="10" cy="10" r="1.6" />
      <circle cx="16" cy="10" r="1.6" />
    </svg>
  )
}

export function FilterIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <path d="M3 4.5h14l-5.5 6.2v4.3l-3 1.5v-5.8L3 4.5Z" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

export function SortIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <path d="M6.5 16V4M6.5 4 3.5 7M6.5 4l3 3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.5 4v12M13.5 16l3-3M13.5 16l-3-3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function SparkleIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <path d="M10 3v3M10 14v3M3 10h3M14 10h3M5.5 5.5l2 2M12.5 12.5l2 2M14.5 5.5l-2 2M7.5 12.5l-2 2" strokeLinecap="round" />
    </svg>
  )
}

export function ViewIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <path d="M1.5 10S4.5 4 10 4s8.5 6 8.5 6-3 6-8.5 6-8.5-6-8.5-6Z" strokeLinejoin="round" />
      <circle cx="10" cy="10" r="2.5" />
    </svg>
  )
}

export function PencilIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <path d="M13.5 3.5 16.5 6.5 7 16H4v-3z" strokeLinejoin="round" />
      <line x1="12" y1="5" x2="15" y2="8" />
    </svg>
  )
}

// iOS-style "share" glyph -- arrow up out of a box. Used for Share-with-
// artist actions (Phase UI-3).
export function TrashIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <path d="M4 6h12M8 6V4.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V6M6 6l.6 9.4a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9L14 6" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="8.5" y1="8.75" x2="8.5" y2="13.25" strokeLinecap="round" />
      <line x1="11.5" y1="8.75" x2="11.5" y2="13.25" strokeLinecap="round" />
    </svg>
  )
}

export function ShareIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <path d="M10 2.5v9.5" strokeLinecap="round" />
      <path d="M6.5 6 10 2.5 13.5 6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 9.5v6a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// Neutral clock face -- "not run yet" / generic time-related states.
export function ClockIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 5.5V10l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// Loading spinner -- pair with Tailwind's animate-spin utility at the call
// site (e.g. className="h-4 w-4 animate-spin").
export function SpinnerIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className}>
      <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.5" opacity="0.25" />
      <path d="M17.5 10a7.5 7.5 0 0 0-7.5-7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

// Artist social links (Phase: artist social profile links) -- simple line
// glyphs matching this file's convention, not brand-mark logos.
export function InstagramIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <rect x="3" y="3" width="14" height="14" rx="4" />
      <circle cx="10" cy="10" r="3.25" />
      <circle cx="14.25" cy="5.75" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function FacebookIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M11.75 7.25h-1a1.25 1.25 0 0 0-1.25 1.25v1h2.25l-.3 1.75h-1.95V15" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function CopyIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <rect x="7.5" y="7.5" width="9" height="9" rx="1.5" />
      <path d="M5.5 12.5h-1A1.5 1.5 0 0 1 3 11V4.5A1.5 1.5 0 0 1 4.5 3H11a1.5 1.5 0 0 1 1.5 1.5v1" strokeLinecap="round" />
    </svg>
  )
}

// Classic two-column grip-dot glyph -- the universal "drag here" affordance
// (matches MoreIcon's filled-dot style rather than a stroked one, since at
// this size filled dots read more clearly as a grip than outlined ones).
export function DragHandleIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" stroke="none" className={className}>
      <circle cx="7" cy="5" r="1.4" />
      <circle cx="13" cy="5" r="1.4" />
      <circle cx="7" cy="10" r="1.4" />
      <circle cx="13" cy="10" r="1.4" />
      <circle cx="7" cy="15" r="1.4" />
      <circle cx="13" cy="15" r="1.4" />
    </svg>
  )
}

// Four viewfinder corner brackets -- the universal "scan" affordance
// (camera/QR scanner apps), used by the front-desk scanner's own nav item.
export function ScanIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <path d="M3 7V4.5A1.5 1.5 0 0 1 4.5 3H7" strokeLinecap="round" />
      <path d="M13 3h2.5A1.5 1.5 0 0 1 17 4.5V7" strokeLinecap="round" />
      <path d="M17 13v2.5a1.5 1.5 0 0 1-1.5 1.5H13" strokeLinecap="round" />
      <path d="M7 17H4.5A1.5 1.5 0 0 1 3 15.5V13" strokeLinecap="round" />
      <line x1="3" y1="10" x2="17" y2="10" strokeLinecap="round" />
    </svg>
  )
}

// Classic map pin -- the deposit confirmation's studio-address link, small
// and inline next to the small address copy, not a standalone nav-sized
// glyph, so it's deliberately plainer (one outline + one dot) than the
// other icons here.
export function MapPinIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <path d="M10 18s6-5.5 6-10.5a6 6 0 1 0-12 0C4 12.5 10 18 10 18Z" strokeLinejoin="round" />
      <circle cx="10" cy="7.5" r="2" />
    </svg>
  )
}

// Google's own official "G" mark, fixed brand colors (not currentColor --
// unlike every other icon in this file, this one is never meant to
// recolor with surrounding text; Google's own brand guidelines call for
// the multicolor mark specifically on a "Google Calendar"-style action,
// not a monochrome recolor). Standard 18x18 four-path version.
export function GoogleGIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 18 18" className={className}>
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
      />
    </svg>
  )
}
