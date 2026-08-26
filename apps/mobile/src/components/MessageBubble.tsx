import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { isMessageEdited } from '@/lib/conversations';
import { linkify, truncateMiddle } from '@/lib/linkify';
import type { DisplayMessage } from '@/lib/threadRows';
import { chat, colors, hairline, radius, space, type } from '@/theme';
import { timeOfDay } from '@/lib/time';

/**
 * Is this attachment something we can show inline?
 *
 * Chat attachments go through Cloudinary's `image/upload` endpoint (the
 * same `/uploads/signature` apps/web's composer uses), so outbound ones
 * are always images. Inbound attachments arrive from whatever the client
 * sent over SMS/Email and are not guaranteed to be, so anything that
 * doesn't look like an image keeps the plain paperclip note rather than
 * rendering a broken frame.
 */
function isImageUrl(url: string): boolean {
  return /\.(jpe?g|png|gif|webp|avif|heic|bmp)(\?|$)/i.test(url) || /\/image\/upload\//.test(url);
}

/** How far the thread slides to reveal timestamps. Also the gutter width. */
export const REVEAL_WIDTH = 68;

/**
 * Message text, with URLs turned into links.
 *
 * Opened in the in-app browser rather than handed to Safari: it keeps the
 * person in the thread they were reading, which matters when the link is
 * something a client just sent and the reply is half-typed.
 */
function Body({ body, own }: { body: string; own: boolean }) {
  const parts = linkify(body);
  const bodyStyle = [styles.body, own ? styles.bodyOwn : styles.bodyTheirs];

  if (parts.length === 1 && parts[0].kind === 'text') {
    return <Text style={bodyStyle}>{body}</Text>;
  }

  return (
    <Text style={bodyStyle}>
      {parts.map((part, i) =>
        part.kind === 'text' ? (
          <Text key={i}>{part.value}</Text>
        ) : (
          <Text
            key={i}
            style={[styles.link, own ? styles.linkOwn : styles.linkTheirs]}
            onPress={() => {
              void WebBrowser.openBrowserAsync(part.href).catch(() => {
                // A malformed href is the client's, not ours — silently
                // doing nothing beats an alert about their typo.
              });
            }}
            accessibilityRole="link"
          >
            {truncateMiddle(part.value)}
          </Text>
        ),
      )}
    </Text>
  );
}

export function MessageBubble({
  message,
  own,
  showMeta,
  showAuthor,
  grouped,
  lastInGroup,
  attribution,
  isLastOutgoing,
  revealX,
  onRetry,
  onOpenImage,
  onLongPress,
  viewerUserId,
  onScrollToMessage,
}: {
  message: DisplayMessage;
  own: boolean;
  /** False when this bubble continues a burst — the meta row is drawn once per burst. */
  showMeta: boolean;
  /** GROUP threads only: whose message this is, when it isn't the viewer's. */
  showAuthor: boolean;
  /** Continues a run from the same side — tighter gap above (§2.1). */
  grouped: boolean;
  /** Last bubble of its group: the only one that gets a tail (§2.1). */
  lastInGroup: boolean;
  /** `SENT BY {NAME}` / `{NAME}` above a group's first bubble (§2.1). */
  attribution: string | null;
  /**
   * Spec §2.2: the delivery status line renders under the LAST outgoing
   * message only, not under every one of them.
   */
  isLastOutgoing: boolean;
  /** Thread-wide drag offset. Negative slides everything left. */
  revealX: SharedValue<number>;
  onRetry?: () => void;
  /** Opens the full-screen viewer on the tapped image. */
  onOpenImage?: (urls: string[], index: number) => void;
  /** Long-press opens the action sheet (react / reply / copy / edit). */
  onLongPress?: () => void;
  viewerUserId?: string;
  /** Tapping a quoted reply jumps to the message it quotes. */
  onScrollToMessage?: (messageId: string) => void;
}) {
  const failed = message.status === 'failed';
  const pending = message.status === 'pending';
  const authorName = message.author?.name ?? message.author?.email ?? null;

  // One reaction per person per message, so this collapses to a count per
  // emoji and remembers whether the viewer's own is among them.
  const reactionSummary = (message.reactions ?? []).reduce<
    { emoji: string; count: number; mine: boolean }[]
  >((acc, r) => {
    const existing = acc.find((e) => e.emoji === r.emoji);
    const mine = (existing?.mine ?? false) || r.userId === viewerUserId;
    if (existing) {
      existing.count += 1;
      existing.mine = mine;
    } else {
      acc.push({ emoji: r.emoji, count: 1, mine });
    }
    return acc;
  }, []);

  const attachments = message.attachments ?? [];
  const images = attachments.filter(isImageUrl);
  const others = attachments.filter((url) => !isImageUrl(url));

  /*
   * ITEM 3. An image with nothing else to say IS the bubble.
   *
   * A photo inside a filled, padded, bordered container is a photo in a
   * frame; Messages renders it as the thing itself, corners rounded, and
   * so does this. The moment there is text, a quote, or a stray non-image
   * attachment, the bubble comes back — those need a ground to sit on.
   */
  const bare = images.length > 0 && !message.body && !message.replyTo && others.length === 0;

  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: revealX.value }] }));

  return (
    <Animated.View
      style={[
        styles.wrap,
        own ? styles.wrapOwn : styles.wrapTheirs,
        // ITEM 1: the grouped/new-run rhythm.
        grouped ? styles.wrapGrouped : styles.wrapNewRun,
        slide,
      ]}
    >
      {/*
        §2.1 sender attribution. Replaces AE's `showAuthor` line, which
        only ever named an incoming sender in a group thread; the spec
        also wants OUTGOING groups attributed when a colleague sent them,
        because a shared inbox otherwise reads as one anonymous voice.
      */}
      {attribution ? <Text style={styles.attribution}>{attribution}</Text> : null}

      {/* The badge is a SIBLING of the bubble, on the surface — see the
          delivery-states note below for why it is not inside it. */}
      {failed ? <View style={styles.failBadge}><Feather name="alert-circle" size={18} color={chat.alert} /></View> : null}

      <Pressable
          onLongPress={onLongPress}
          delayLongPress={300}
          accessibilityRole={onLongPress ? 'button' : undefined}
          accessibilityHint={onLongPress ? 'Long press for message actions' : undefined}
          style={[
            bare ? styles.bare : styles.bubble,
            !bare && (own ? styles.bubbleOwn : styles.bubbleTheirs),
            // §2.1: the tail is one squared corner on the group's last
            // bubble — own bottom-right, incoming bottom-left. Drawn by
            // collapsing the radius rather than by an SVG notch: it reads
            // identically at this radius and costs no extra view.
            !bare && lastInGroup && (own ? styles.tailOwn : styles.tailTheirs),
            pending && styles.bubblePending,
            // A failed send gets a red edge — the one place red belongs on
            // this screen, because something genuinely did not happen.
            failed && (bare ? styles.bareFailed : styles.bubbleFailed),
          ]}
        >
          {message.replyTo ? (
            <Pressable
              onPress={() => onScrollToMessage?.(message.replyTo!.id)}
              accessibilityRole="button"
              accessibilityLabel={`In reply to ${message.replyTo.author?.name ?? 'a message'}`}
              style={[styles.quote, own ? styles.quoteOwn : styles.quoteTheirs]}
            >
              <Text style={[styles.quoteAuthor, own ? styles.bodyOwn : styles.bodyTheirs]} numberOfLines={1}>
                {message.replyTo.author?.name ?? message.replyTo.author?.email ?? 'Message'}
              </Text>
              <Text style={[styles.quoteBody, own ? styles.bodyOwn : styles.bodyTheirs]} numberOfLines={2}>
                {message.replyTo.body || 'Image'}
              </Text>
            </Pressable>
          ) : null}

          {message.body ? <Body body={message.body} own={own} /> : null}

          {images.length > 0 ? (
            <View
              style={[
                styles.images,
                // A fixed width for the tiled case, so the grid wraps at
                // exactly two per row. Left to flex it collapsed to a
                // single column: the bubble is a flex child now and was
                // being shrunk to one tile's width before the row could
                // claim its two.
                images.length > 1 && styles.imagesGrid,
                message.body ? styles.imagesAfterText : null,
              ]}
            >
              {images.map((url, index) => (
                <Pressable
                  key={url}
                  onPress={() => onOpenImage?.(images, index)}
                  onLongPress={onLongPress}
                  delayLongPress={300}
                  accessibilityRole="button"
                  accessibilityLabel={`Attached image ${index + 1} of ${images.length}. Opens full screen.`}
                  style={({ pressed }) => [
                    styles.imageWrap,
                    // One image gets the full width; several tile 2-up.
                    images.length === 1 ? styles.imageSolo : styles.imageTiled,
                    bare && styles.imageBare,
                    pressed && styles.pressed,
                  ]}
                >
                  <Image source={{ uri: url }} style={styles.image} contentFit="cover" transition={140} />
                </Pressable>
              ))}
            </View>
          ) : null}

          {others.length > 0 ? (
            <View style={styles.attachmentNote}>
              <Feather name="paperclip" size={12} color={own ? colors.accentFg : colors.fgMuted} />
              <Text style={[styles.attachmentLabel, own ? styles.bodyOwn : styles.bodyTheirs]}>
                {others.length} attachment{others.length === 1 ? '' : 's'}
              </Text>
            </View>
          ) : null}

          {/*
            ITEM 5. The badge overlaps the bubble's corner the way a
            tapback does, instead of sitting on its own line underneath.
            Absolute, so it costs the row no height and cannot push the
            next bubble down.
          */}
          {reactionSummary.length > 0 ? (
            <View
              style={[styles.reactions, own ? styles.reactionsOwn : styles.reactionsTheirs]}
              pointerEvents="none"
            >
              {reactionSummary.map((r) => (
                <View key={r.emoji} style={[styles.reaction, r.mine && styles.reactionMine]}>
                  <Text style={styles.reactionGlyph}>{r.emoji}</Text>
                  {r.count > 1 ? <Text style={styles.reactionCount}>{r.count}</Text> : null}
                </View>
              ))}
            </View>
          ) : null}
        </Pressable>

      {/*
        ITEM 2. The timestamp sits in a gutter hung off the RIGHT EDGE OF
        THE ROW — `left: '100%'` on this full-width wrapper, so it starts
        exactly where the screen ends — and rides in on the same drag that
        slides the bubbles.

        It anchored to the bubble at first, which put it a few pixels
        after whatever the bubble's own width happened to be: every
        timestamp was visible at rest, mid-thread, which is the opposite
        of the feature. Measured at 281px inside a 390pt frame before this.
      */}
      <View style={styles.revealGutter} pointerEvents="none">
        <Text style={styles.revealTime} numberOfLines={1}>
          {timeOfDay(message.createdAt)}
        </Text>
      </View>

      {/*
        §2.4 DELIVERY STATES — SURFACE-ANCHORED, which is the compensating
        rule the owner's red-bubble ruling depends on.
        ────────────────────────────────────────────────────────────────
        The bubble is now brand-red. Alert-red on brand-red is invisible,
        so failure NEVER recolours the fill: the badge sits on the espresso
        surface at the bubble's outer-left, and the status line sits below
        on the same surface. Both read against the page, not against the
        message. Do not "just tint the failed bubble" — that is exactly
        what this shape exists to prevent.

        Truth constraint: only QUEUED / SENT / FAILED render. The
        investigation found no status column, so SENT means "the API
        persisted it" and nothing here claims delivery. (See the report —
        `metadata.deliveryStatus` now exists and could make DELIVERED
        truthful, but rev D keeps it dormant and this session obeys that.)
      */}
      {failed ? (
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel="Not delivered. Tap to retry."
          hitSlop={8}
          style={({ pressed }) => [
            styles.failedRow,
            own ? styles.failedRowOwn : styles.failedRowTheirs,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.failedLabel}>NOT DELIVERED · TAP TO RETRY</Text>
        </Pressable>
      ) : pending && showMeta ? (
        <View style={[styles.meta, own ? styles.metaOwn : styles.metaTheirs]}>
          <Text style={styles.metaText}>SENDING…</Text>
        </View>
      ) : own && isLastOutgoing && showMeta ? (
        /*
         * §2.2: under the last outgoing message only. "SENT" is the whole
         * truth the API can support today.
         */
        <View style={[styles.meta, styles.metaOwn]}>
          <Text style={styles.metaText}>SENT</Text>
        </View>
      ) : null}
    </Animated.View>
  );
}

/** Whether this message would render as a bare image — the sheet needs it too. */
export function messageImages(message: DisplayMessage): string[] {
  return (message.attachments ?? []).filter(isImageUrl);
}

export { isMessageEdited };

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: space.lg, maxWidth: '100%' },
  wrapOwn: { alignItems: 'flex-end' },
  wrapTheirs: { alignItems: 'flex-start' },
  /*
   * ITEM 1, the two gaps. Messages runs consecutive bubbles almost
   * touching and opens a real gap when the speaker changes; the contrast
   * between the two IS the grouping cue, so both numbers matter.
   */
  /* §2.1 gaps: intra-group 2, inter-group 10. AE shipped 2 / 12. */
  wrapGrouped: { marginTop: 2 },
  wrapNewRun: { marginTop: 10 },

  /* §2.1 attribution: Jura 10 caps, muted, above the group's first bubble. */
  attribution: {
    ...type.label,
    fontSize: 10,
    color: chat.textMuted,
    marginBottom: 3,
    marginHorizontal: space.sm,
  },

  bubble: {
    /* §2.1: max width 78%, padding 10x14, radius 18 (radius.bubble). */
    maxWidth: '78%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.bubble,
    borderWidth: hairline,
  },
  /*
   * THE OWNER RULING (Juan, 2026-08-26). Outgoing bubbles are red —
   * `chat.bubbleOwnBg` = `colors.dangerStrong` — the second sanctioned
   * red fill in this app after the CHAT tab. Was `colors.accent` (gold).
   * Its compensating rule is the surface-anchored failure treatment
   * above; the two ship together or not at all.
   */
  bubbleOwn: { backgroundColor: chat.bubbleOwnBg, borderColor: chat.bubbleOwnBg },
  bubbleTheirs: { backgroundColor: chat.bubbleInBg, borderColor: colors.border },

  /* §2.1 tail: the group's last bubble squares off its inner-bottom
     corner toward its own side. */
  tailOwn: { borderBottomRightRadius: 5 },
  tailTheirs: { borderBottomLeftRadius: 5 },
  bubblePending: { opacity: 0.55 },
  bubbleFailed: { borderColor: colors.dangerStrong },

  /* An image bubble is the image: no fill, no padding, no border. */
  bare: { maxWidth: '84%' },
  bareFailed: { borderWidth: hairline, borderColor: colors.dangerStrong, borderRadius: radius.bubble },

  /* Line height down from 23 to 21 at the same 16px size: Messages sets
     its text tighter than a reading column, because a chat line is a
     sentence rather than a paragraph. */
  body: { ...type.message, lineHeight: 21 },
  /* §1: white on the red fill, not cream — 5.16:1 vs 4.39:1 (CLAUDE.md). */
  bodyOwn: { color: chat.bubbleOwnText },
  bodyTheirs: { color: chat.textPrimary },

  link: { textDecorationLine: 'underline' },
  /* On the gold bubble the body colour already contrasts; underline alone
     carries it. On a dark bubble the accent reads as a link. */
  linkOwn: { color: colors.accentFg },
  linkTheirs: { color: colors.accent },

  quote: {
    borderLeftWidth: 2,
    paddingLeft: space.sm,
    marginBottom: space.xs,
    opacity: 0.85,
  },
  quoteOwn: { borderLeftColor: colors.accentFg },
  quoteTheirs: { borderLeftColor: colors.accent },
  quoteAuthor: { ...type.meta },
  quoteBody: { ...type.small },

  reactions: {
    position: 'absolute',
    bottom: -11,
    flexDirection: 'row',
    gap: 2,
  },
  reactionsOwn: { right: space.sm },
  reactionsTheirs: { left: space.sm },
  reaction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.pill,
    /* A real border against the app ground, so the badge reads as sitting
       ON the bubble rather than being part of it. */
    borderWidth: 1,
    borderColor: colors.bg,
    backgroundColor: colors.surfaceRaised,
  },
  reactionMine: { borderColor: colors.accent, backgroundColor: 'rgba(201, 154, 91, 0.16)' },
  reactionGlyph: { fontSize: 13, lineHeight: 16 },
  reactionCount: { ...type.meta, color: colors.fgMuted },

  images: { flexDirection: 'row', flexWrap: 'wrap', gap: 2 },
  /* 2 tiles + the gap between them. Messages' own collage is 2-up. */
  imagesGrid: { width: 104 * 2 + 2 },
  imagesAfterText: { marginTop: space.xs },
  imageWrap: { borderRadius: radius.input, overflow: 'hidden', backgroundColor: colors.surfaceInset },
  imageSolo: { width: 220, height: 220 },
  imageTiled: { width: 104, height: 104 },
  /* A bare image carries the bubble's own radius, since it IS the bubble. */
  imageBare: { borderRadius: radius.bubble },
  image: { width: '100%', height: '100%' },

  attachmentNote: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: space.xs },
  attachmentLabel: { ...type.small },

  revealGutter: {
    position: 'absolute',
    /* `left: 100%` of the FULL-WIDTH row: the gutter begins where the
       screen ends, so nothing shows until the thread is dragged. */
    left: '100%',
    top: 0,
    bottom: 0,
    width: REVEAL_WIDTH,
    paddingLeft: space.sm,
    justifyContent: 'center',
  },
  revealTime: { ...type.label, fontSize: 10, color: chat.textMuted },

  meta: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: 3, paddingHorizontal: space.xs },
  metaOwn: { justifyContent: 'flex-end' },
  metaTheirs: { justifyContent: 'flex-start' },
  /* §1.2: delivery status is metadata — Jura 10 caps, muted. */
  metaText: { ...type.label, fontSize: 10, color: chat.textMuted },

  /*
   * §2.4 surface-anchored failure. The badge is absolutely positioned so
   * it hangs off the bubble's outer edge without widening the row, and it
   * sits on the espresso surface where alert-red is legible.
   */
  failBadge: { position: 'absolute', left: space.xs, top: 6, zIndex: 1 },
  failedRow: { marginTop: 3, paddingHorizontal: space.xs },
  failedRowOwn: { alignSelf: 'flex-end' },
  failedRowTheirs: { alignSelf: 'flex-start' },
  /* `alertText` (#e08272), not `alert` (#c2402f): the strong red only
     clears the 3:1 non-text floor, and this is text. */
  failedLabel: { ...type.label, fontSize: 10, color: chat.alertText },
  pressed: { opacity: 0.6 },
});
