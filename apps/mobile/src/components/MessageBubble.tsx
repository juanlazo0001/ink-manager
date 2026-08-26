import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { isMessageEdited } from '@/lib/conversations';
import { linkify, truncateMiddle } from '@/lib/linkify';
import type { DisplayMessage } from '@/lib/threadRows';
import { colors, hairline, radius, space, type } from '@/theme';
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
  /** Continues a run from the same side — tighter gap above. */
  grouped: boolean;
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
      {showAuthor && !own && authorName ? <Text style={styles.author}>{authorName}</Text> : null}

      <Pressable
          onLongPress={onLongPress}
          delayLongPress={300}
          accessibilityRole={onLongPress ? 'button' : undefined}
          accessibilityHint={onLongPress ? 'Long press for message actions' : undefined}
          style={[
            bare ? styles.bare : styles.bubble,
            !bare && (own ? styles.bubbleOwn : styles.bubbleTheirs),
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

      {failed ? (
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          style={({ pressed }) => [styles.failedRow, pressed && styles.pressed]}
        >
          <Feather name="alert-circle" size={12} color={colors.danger} />
          <Text style={styles.failedLabel}>Not sent — tap to retry</Text>
        </Pressable>
      ) : pending && showMeta ? (
        /*
         * The only status line left in the default render. Channel, time
         * and "Edited" moved to the long-press detail (item 2); "Sending…"
         * stays because it is about THIS moment, not about the record —
         * a bubble in flight has to say so without being asked.
         */
        <View style={[styles.meta, own ? styles.metaOwn : styles.metaTheirs]}>
          <Text style={styles.metaText}>Sending…</Text>
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
  wrapGrouped: { marginTop: 2 },
  wrapNewRun: { marginTop: space.md },

  author: { ...type.label, color: colors.fgMuted, marginBottom: space.xs, marginLeft: space.sm },

  bubble: {
    maxWidth: '84%',
    /* Tighter than before (was 12 / 10) — Messages' bubbles hug their
       text, and the old padding read as a card. */
    paddingHorizontal: space.md,
    paddingVertical: 7,
    borderRadius: radius.bubble,
    borderWidth: hairline,
  },
  bubbleOwn: { backgroundColor: colors.accent, borderColor: colors.accent },
  bubbleTheirs: { backgroundColor: colors.surface, borderColor: colors.border },
  bubblePending: { opacity: 0.55 },
  bubbleFailed: { borderColor: colors.dangerStrong },

  /* An image bubble is the image: no fill, no padding, no border. */
  bare: { maxWidth: '84%' },
  bareFailed: { borderWidth: hairline, borderColor: colors.dangerStrong, borderRadius: radius.bubble },

  /* Line height down from 23 to 21 at the same 16px size: Messages sets
     its text tighter than a reading column, because a chat line is a
     sentence rather than a paragraph. */
  body: { ...type.message, lineHeight: 21 },
  bodyOwn: { color: colors.accentFg },
  bodyTheirs: { color: colors.fg },

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
  revealTime: { ...type.meta, color: colors.fgMuted },

  meta: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: 2, paddingHorizontal: space.xs },
  metaOwn: { justifyContent: 'flex-end' },
  metaTheirs: { justifyContent: 'flex-start' },
  metaText: { ...type.meta, color: colors.fgMuted },

  failedRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: 2 },
  failedLabel: { ...type.meta, color: colors.danger },
  pressed: { opacity: 0.6 },
});
