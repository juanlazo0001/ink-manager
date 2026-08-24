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
