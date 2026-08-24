import Svg, { Circle, Line, Path, Polyline, Rect } from 'react-native-svg';

/**
 * The app's icons, drawn from apps/web's own `icons.tsx`.
 *
 * Web does not use an icon library — every glyph there is hand-drawn
 * inline SVG on a `0 0 20 20` viewBox with
 * `fill="none" stroke="currentColor" strokeWidth="1.5"`. So "use the same
 * library" had no answer, and "the visually identical equivalent" would
 * have meant picking Feather glyphs that are merely close: Feather's grid
 * has no corner radius, its message-square has no tail, its check-square
 * has a different tick geometry.
 *
 * These are the SAME PATHS, copied coordinate-for-coordinate, rendered
 * through react-native-svg. Not an approximation of web's icons — web's
 * icons.
 *
 * react-native-svg 15.12.1 is the version Expo SDK 54 itself bundles
 * (`expo/bundledNativeModules.json`), which also means it ships inside
 * Expo Go — no custom dev client needed to run this on the owner's phone.
 *
 * Feather is still used for glyphs web has no counterpart for (the form
 * controls, chevrons inside rows, the flash-piece affordances). This
 * module covers navigation, which is where the two clients sit side by
 * side and a mismatch reads as two different products.
 */

export interface IconProps {
  size?: number;
  color: string;
}

/** Every web icon shares these. `strokeWidth` scales with the box, as SVG does. */
function box(size: number) {
  return { width: size, height: size, viewBox: '0 0 20 20' } as const;
}
const STROKE = 1.5;

/** Sidebar "Dashboard" — four rounded squares. Mobile: the Home tab. */
export function DashboardIcon({ size = 20, color }: IconProps) {
  return (
    <Svg {...box(size)} fill="none" stroke={color} strokeWidth={STROKE}>
      <Rect x="2.5" y="2.5" width="6" height="6" rx="1.5" />
      <Rect x="11.5" y="2.5" width="6" height="6" rx="1.5" />
      <Rect x="2.5" y="11.5" width="6" height="6" rx="1.5" />
      <Rect x="11.5" y="11.5" width="6" height="6" rx="1.5" />
    </Svg>
  );
}

/** Sidebar "My Inquiries" — a document with two rules. */
export function DocumentIcon({ size = 20, color }: IconProps) {
  return (
    <Svg {...box(size)} fill="none" stroke={color} strokeWidth={STROKE}>
      <Path d="M5.5 2.5h6l3 3v12a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-14a1 1 0 0 1 1-1Z" strokeLinejoin="round" />
      <Line x1="7" y1="10" x2="13" y2="10" />
      <Line x1="7" y1="13" x2="13" y2="13" />
    </Svg>
  );
}

/** Sidebar "Calendar" — mobile's Schedule tab. */
export function AppointmentsIcon({ size = 20, color }: IconProps) {
  return (
    <Svg {...box(size)} fill="none" stroke={color} strokeWidth={STROKE}>
      <Rect x="2.5" y="4" width="15" height="13" rx="2" />
      <Line x1="2.5" y1="8" x2="17.5" y2="8" />
      <Line x1="6" y1="2.5" x2="6" y2="5.5" />
      <Line x1="14" y1="2.5" x2="14" y2="5.5" />
    </Svg>
  );
}

/** The chat FAB's own glyph — a speech bubble with a tail. */
export function MessageIcon({ size = 20, color }: IconProps) {
  return (
    <Svg {...box(size)} fill="none" stroke={color} strokeWidth={STROKE}>
      <Path
        d="M3 4.5h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H8l-4 3v-3H3a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** The top bar's Tasks glyph — a rounded square with a tick. */
export function TasksIcon({ size = 20, color }: IconProps) {
  return (
    <Svg {...box(size)} fill="none" stroke={color} strokeWidth={STROKE}>
      <Rect x="3" y="3" width="14" height="14" rx="2" />
      <Polyline points="6.5 10 8.5 12 13.5 7" strokeLinejoin="round" />
    </Svg>
  );
}

/** The top bar's bell. */
export function BellIcon({ size = 20, color }: IconProps) {
  return (
    <Svg {...box(size)} fill="none" stroke={color} strokeWidth={STROKE}>
      <Path d="M5 8a5 5 0 0 1 10 0c0 3.5 1.2 4.8 1.2 4.8H3.8S5 11.5 5 8Z" strokeLinejoin="round" />
      <Path d="M8 15.5a2 2 0 0 0 4 0" />
    </Svg>
  );
}

export function ChevronDownIcon({ size = 20, color }: IconProps) {
  return (
    <Svg {...box(size)} fill="none" stroke={color} strokeWidth={STROKE}>
      <Polyline points="5.5 8 10 12.5 14.5 8" />
    </Svg>
  );
}

/** Sidebar "Flash Gallery". */
export function PhotoIcon({ size = 20, color }: IconProps) {
  return (
    <Svg {...box(size)} fill="none" stroke={color} strokeWidth={STROKE}>
      <Rect x="2.5" y="3.5" width="15" height="13" rx="1.5" />
      <Circle cx="7" cy="8" r="1.5" />
      <Path d="M3 14.5 7.5 10l3 3 2.5-2.5L17 14" strokeLinejoin="round" />
    </Svg>
  );
}

/* ------------------------------------------------------------------ *
 * Card header actions — web's own glyphs, path for path.
 * ------------------------------------------------------------------ */

/** Send — the paper plane on web's "Send Inquiry via Email". */
export function SendIcon({ size = 20, color }: IconProps) {
  return (
    <Svg {...box(size)} fill="none" stroke={color} strokeWidth={STROKE}>
      <Path d="M17.5 2.5 2.5 8.8l5.8 2.4 2.4 5.8L17.5 2.5Z" strokeLinejoin="round" />
    </Svg>
  );
}

/** Plus — web's "New Inquiry". */
export function PlusIcon({ size = 20, color }: IconProps) {
  return (
    <Svg {...box(size)} fill="none" stroke={color} strokeWidth={STROKE}>
      <Line x1="10" y1="4" x2="10" y2="16" strokeLinecap="round" />
      <Line x1="4" y1="10" x2="16" y2="10" strokeLinecap="round" />
    </Svg>
  );
}

/** Gift card — web's `GiftCardIcon`, the ribboned card. */
export function GiftCardIcon({ size = 20, color }: IconProps) {
  return (
    <Svg {...box(size)} fill="none" stroke={color} strokeWidth={STROKE}>
      <Rect x="2.5" y="7" width="15" height="10.5" rx="1.5" />
      <Line x1="10" y1="7" x2="10" y2="17.5" />
      <Path d="M10 7c-1.1-2.6-2.9-3.7-3.9-2.9-1 .8-.2 2.9 3.9 2.9Z" strokeLinejoin="round" />
      <Path d="M10 7c1.1-2.6 2.9-3.7 3.9-2.9 1 .8.2 2.9-3.9 2.9Z" strokeLinejoin="round" />
    </Svg>
  );
}

/**
 * Download — web's `DownloadIcon`, on the signed deposit-form and waiver
 * rows. Web renders it at the ROW size (32pt circle), not the header's 44.
 */
export function DownloadIcon({ size = 20, color }: IconProps) {
  return (
    <Svg {...box(size)} fill="none" stroke={color} strokeWidth={STROKE}>
      <Path d="M10 3v9.5m0 0 3.5-3.5M10 12.5 6.5 9" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M4 14v1.5A1.5 1.5 0 0 0 5.5 17h9a1.5 1.5 0 0 0 1.5-1.5V14" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** Trash — web's `TrashIcon`, on the contact card's remove control. */
export function TrashIcon({ size = 20, color }: IconProps) {
  return (
    <Svg {...box(size)} fill="none" stroke={color} strokeWidth={STROKE}>
      <Path
        d="M4 6h12M8 6V4.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V6M6 6l.6 9.4a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9L14 6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Line x1="8.5" y1="8.75" x2="8.5" y2="13.25" strokeLinecap="round" />
      <Line x1="11.5" y1="8.75" x2="11.5" y2="13.25" strokeLinecap="round" />
    </Svg>
  );
}

/** Search — web's `SearchIcon`, on "Merge with another client". */
export function SearchIcon({ size = 20, color }: IconProps) {
  return (
    <Svg {...box(size)} fill="none" stroke={color} strokeWidth={STROKE}>
      <Circle cx="9" cy="9" r="6" />
      <Line x1="17" y1="17" x2="13.2" y2="13.2" strokeLinecap="round" />
    </Svg>
  );
}

/* ------------------------------------------------------------------ *
 * Add-a-contact combo glyphs.
 *
 * Web writes these as the text links "+ Add phone" and "+ Add email";
 * the owner asked for icon-only. A bare plus twice over would give the
 * two groups the same button, so each is its own glyph: the set's
 * existing handset and envelope, shrunk into the lower-left of the box,
 * with a plus in the corner the shape vacates.
 *
 * Drawn rather than borrowed — web has no combo glyph — but every
 * coordinate is derived from `PhoneIcon` and `EmailIcon` so the family
 * still reads as one set.
 * ------------------------------------------------------------------ */

/** The plus in the top-right corner of both combo glyphs. Stroke is
 *  inherited from the parent `Svg`, as every other glyph here does. */
function CornerPlus() {
  return (
    <>
      <Line x1="15.25" y1="2.75" x2="15.25" y2="7.25" strokeLinecap="round" />
      <Line x1="13" y1="5" x2="17.5" y2="5" strokeLinecap="round" />
    </>
  );
}

/** Add a phone number. */
export function PhonePlusIcon({ size = 20, color }: IconProps) {
  return (
    <Svg {...box(size)} fill="none" stroke={color} strokeWidth={STROKE}>
      {/* PhoneIcon's path, scaled to 0.78 about the lower-left. */}
      <Path
        d="M5.9 6.6h-1.6A1.2 1.2 0 0 0 3.1 7.9c.3 4.7 4.1 8.5 8.8 8.8a1.2 1.2 0 0 0 1.3-1.2v-1.6a.8.8 0 0 0-.6-.8l-1.8-.4a.8.8 0 0 0-.8.3l-.5.7a8.2 8.2 0 0 1-3.5-3.5l.7-.5a.8.8 0 0 0 .3-.8l-.4-1.8a.8.8 0 0 0-.8-.6Z"
        strokeLinejoin="round"
      />
      <CornerPlus />
    </Svg>
  );
}

/** Add an email address. */
export function MailPlusIcon({ size = 20, color }: IconProps) {
  return (
    <Svg {...box(size)} fill="none" stroke={color} strokeWidth={STROKE}>
      {/* EmailIcon's rect and flap, shortened to clear the corner plus. */}
      <Rect x="2.5" y="6.5" width="12" height="9" rx="2" />
      <Path d="M3.4 7.6 8.5 11.6l5.1-4" strokeLinecap="round" strokeLinejoin="round" />
      <CornerPlus />
    </Svg>
  );
}

/* ------------------------------------------------------------------ *
 * Channel glyphs.
 *
 * One per value of the API's `Channel` enum — EMAIL, INSTAGRAM, FACEBOOK,
 * PHONE, REFERRAL, FLASH_GALLERY. Four are apps/web's own paths; PHONE
 * has no web equivalent and is drawn to match the set's weight; REFERRAL
 * reuses the two-figure Clients glyph, since a referral IS another client.
 *
 * Deliberately MONOCHROME. The conversations list tints its channel
 * swatches with brand colour, but this glyph sits in a quiet meta line
 * under a description, where six brand colours would compete with the
 * status chip that is the row's actual signal.
 * ------------------------------------------------------------------ */

/** Email — web's `EmailIcon`. */
export function EmailIcon({ size = 20, color }: IconProps) {
  return (
    <Svg {...box(size)} fill="none" stroke={color} strokeWidth={STROKE}>
      <Rect x="2.5" y="4.5" width="15" height="11" rx="2" />
      <Path d="M3.5 5.75 10 10.75l6.5-5" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** Instagram — web's `InstagramIcon`. */
export function InstagramIcon({ size = 20, color }: IconProps) {
  return (
    <Svg {...box(size)} fill="none" stroke={color} strokeWidth={STROKE}>
      <Rect x="3" y="3" width="14" height="14" rx="4" />
      <Circle cx="10" cy="10" r="3.25" />
      <Circle cx="14.25" cy="5.75" r="0.75" fill={color} stroke="none" />
    </Svg>
  );
}

/** Facebook — web's `FacebookIcon`. */
export function FacebookIcon({ size = 20, color }: IconProps) {
  return (
    <Svg {...box(size)} fill="none" stroke={color} strokeWidth={STROKE}>
      <Circle cx="10" cy="10" r="7.5" />
      <Path
        d="M11.75 7.25h-1a1.25 1.25 0 0 0-1.25 1.25v1h2.25l-.3 1.75h-1.95V15"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/**
 * Phone — a handset. No web equivalent exists (web labels this channel
 * "Phone / Walk-in" in a select and never draws it), so this is drawn to
 * the set's 1.5 stroke and 20-unit box.
 */
export function PhoneIcon({ size = 20, color }: IconProps) {
  return (
    <Svg {...box(size)} fill="none" stroke={color} strokeWidth={STROKE}>
      <Path
        d="M6.5 3.5h-2A1.5 1.5 0 0 0 3 5.2c.4 6 5.3 10.9 11.3 11.3a1.5 1.5 0 0 0 1.7-1.5v-2a1 1 0 0 0-.8-1l-2.3-.5a1 1 0 0 0-1 .4l-.7.9a10.5 10.5 0 0 1-4.5-4.5l.9-.7a1 1 0 0 0 .4-1l-.5-2.3a1 1 0 0 0-1-.8Z"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Menu — three rules, web's `MenuIcon` path for path. */
export function MenuIcon({ size = 20, color }: IconProps) {
  return (
    <Svg {...box(size)} fill="none" stroke={color} strokeWidth={STROKE}>
      <Line x1="3" y1="5.5" x2="17" y2="5.5" />
      <Line x1="3" y1="10" x2="17" y2="10" />
      <Line x1="3" y1="14.5" x2="17" y2="14.5" />
    </Svg>
  );
}

/** Team — a badge/roster glyph, matching web's Team nav icon family. */
export function TeamIcon({ size = 20, color }: IconProps) {
  return (
    <Svg {...box(size)} fill="none" stroke={color} strokeWidth={STROKE}>
      <Rect x="4" y="2.5" width="12" height="15" rx="1.5" />
      <Circle cx="10" cy="8" r="2" />
      <Path d="M6.5 14.5c0-2 1.6-3 3.5-3s3.5 1 3.5 3" strokeLinecap="round" />
    </Svg>
  );
}

/** Clients — two figures, web's `ClientsIcon` path for path. */
export function ClientsIcon({ size = 20, color }: IconProps) {
  return (
    <Svg {...box(size)} fill="none" stroke={color} strokeWidth={STROKE}>
      <Circle cx="7" cy="6.5" r="2.5" />
      <Path d="M2.5 16c0-3 2-4.5 4.5-4.5s4.5 1.5 4.5 4.5" />
      <Circle cx="14" cy="7" r="2" />
      <Path d="M12.5 11.2c2 .1 3.5 1.5 3.5 4.3" />
    </Svg>
  );
}

/**
 * Scan — four corner brackets and a scan line, web's `ScanIcon` path for
 * path (apps/web/src/components/icons.tsx).
 */
export function ScanIcon({ size = 20, color }: IconProps) {
  return (
    <Svg {...box(size)} fill="none" stroke={color} strokeWidth={STROKE}>
      <Path d="M3 7V4.5A1.5 1.5 0 0 1 4.5 3H7" strokeLinecap="round" />
      <Path d="M13 3h2.5A1.5 1.5 0 0 1 17 4.5V7" strokeLinecap="round" />
      <Path d="M17 13v2.5a1.5 1.5 0 0 1-1.5 1.5H13" strokeLinecap="round" />
      <Path d="M7 17H4.5A1.5 1.5 0 0 1 3 15.5V13" strokeLinecap="round" />
      <Line x1="3" y1="10" x2="17" y2="10" strokeLinecap="round" />
    </Svg>
  );
}

/** The account menu's Settings glyph — three sliders. */
export function SettingsIcon({ size = 20, color }: IconProps) {
  return (
    <Svg {...box(size)} fill="none" stroke={color} strokeWidth={STROKE}>
      <Line x1="3" y1="5" x2="17" y2="5" />
      <Line x1="3" y1="10" x2="17" y2="10" />
      <Line x1="3" y1="15" x2="17" y2="15" />
      <Circle cx="7" cy="5" r="1.6" fill={color} stroke="none" />
      <Circle cx="13" cy="10" r="1.6" fill={color} stroke="none" />
      <Circle cx="9" cy="15" r="1.6" fill={color} stroke="none" />
    </Svg>
  );
}

export function LogoutIcon({ size = 20, color }: IconProps) {
  return (
    <Svg {...box(size)} fill="none" stroke={color} strokeWidth={STROKE}>
      <Path d="M8 3H4.5a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1H8" />
      <Path d="M13 6.5 16.5 10 13 13.5" />
      <Line x1="16.5" y1="10" x2="7.5" y2="10" />
    </Svg>
  );
}

/** The account menu's Profile entry. Web uses ClientsIcon's single figure. */
export function PersonIcon({ size = 20, color }: IconProps) {
  return (
    <Svg {...box(size)} fill="none" stroke={color} strokeWidth={STROKE}>
      <Circle cx="10" cy="6.5" r="2.5" />
      <Path d="M5.5 16c0-3 2-4.5 4.5-4.5s4.5 1.5 4.5 4.5" />
    </Svg>
  );
}
