import {
  ClientsIcon,
  EmailIcon,
  FacebookIcon,
  InstagramIcon,
  PhoneIcon,
  PhotoIcon,
} from '@/components/icons';
import { colors } from '@/theme';

/**
 * A quiet, monochrome glyph for an inquiry's channel.
 *
 * The API's `Channel` enum has exactly six values — EMAIL, INSTAGRAM,
 * FACEBOOK, PHONE, REFERRAL, FLASH_GALLERY (apps/api/prisma/schema.prisma).
 * PHONE covers walk-ins too: web's staff form labels that option
 * "Phone / Walk-in", and the schema's own comment says it is front desk
 * logging a walk-in or phone call. There is no separate walk-in value.
 *
 * **`Channel` is NOT exported from `packages/shared-types`** — ten enums
 * are generated from the schema and this is not one of them — so the map
 * is keyed by string and falls back rather than being typed against the
 * enum. Logged as a shared-types gap.
 *
 * Monochrome on purpose: the conversations list tints its channel swatch
 * with brand colour, but here the glyph sits in a meta line beneath a
 * description, where six brand colours would fight the status chip that
 * is the row's real signal.
 */
const GLYPHS: Record<string, (props: { size?: number; color: string }) => React.ReactElement> = {
  EMAIL: EmailIcon,
  INSTAGRAM: InstagramIcon,
  FACEBOOK: FacebookIcon,
  PHONE: PhoneIcon,
  // A referral came from another client, so it borrows the Clients glyph.
  REFERRAL: ClientsIcon,
  FLASH_GALLERY: PhotoIcon,
};

/** Spoken form, for the row's accessibility label. */
const LABELS: Record<string, string> = {
  EMAIL: 'Email',
  INSTAGRAM: 'Instagram',
  FACEBOOK: 'Facebook',
  PHONE: 'Phone or walk-in',
  REFERRAL: 'Referral',
  FLASH_GALLERY: 'Flash gallery',
};

export function channelLabelFor(channel: string | null | undefined): string {
  if (!channel) return 'Unknown channel';
  return LABELS[channel.toUpperCase()] ?? channel;
}

export function ChannelGlyph({
  channel,
  size = 13,
  color = colors.fgMuted,
}: {
  channel: string | null | undefined;
  size?: number;
  color?: string;
}) {
  const Icon = channel ? GLYPHS[channel.toUpperCase()] : undefined;
  // An unrecognised channel draws nothing rather than a guess — a wrong
  // glyph is worse than none, and the date beside it still reads.
  if (!Icon) return null;
  return <Icon size={size} color={color} />;
}
