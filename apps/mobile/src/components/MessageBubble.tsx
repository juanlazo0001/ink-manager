import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { isMessageEdited } from '@/lib/conversations';
import { deliveryLabel, deliveryState } from '@/lib/deliveryStatus';
import { linkify, truncateMiddle } from '@/lib/linkify';
import type { DisplayMessage } from '@/lib/threadRows';
import { BALLOON, ReactionBalloon, ReactionTail } from '@/components/ReactionBalloon';
import { ImageBubble } from '@/components/ImageBubble';
import { chat, colors, fonts, hairline, radius, space, type } from '@/theme';
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

/**
 * §2.3: how far the thread slides to reveal timestamps. Also the gutter
 * width, so the time lands exactly in the space the bubbles vacate.
 *
 * AE shipped 68; the spec ratified 84 and that is the number here.
 *
 * Not because 68 clipped anything -- measured in this exact type, the
 * widest time this format produces (`12:04 AM`) is 48.6pt against 68's
 * 60pt of usable width, so it fit. The extra travel buys the GESTURE,
 * not the text: with 0.55 resistance, 84 costs ~153pt of drag, which is
 * a deliberate pull rather than something a thumb does by accident on
 * the way to scrolling.
 */
/**
 * §2.5: a solo image's measure. Wider than a tile and narrower than the
 * bubble's own 78%, so a landscape photo still reads as a message rather
 * than as the screen.
 */
const SOLO_IMAGE_WIDTH = 240;

export const REVEAL_WIDTH = 84;

/** §7: more than 8pt of travel is a scroll, not a long press. */
const LONG_PRESS_SLOP = { top: 8, bottom: 8, left: 8, right: 8 } as const;

/**
 * §2.3: the times fade in over the first 24pt of travel, so a small
 * accidental drag shows nothing and a deliberate one has already
 * committed to showing them by the time the bubbles have really moved.
 */
export const REVEAL_FADE_IN = 24;

/**
 * Message text, with URLs turned into links.
 *
 * Opened in the in-app browser rather than handed to Safari: it keeps the
 * person in the thread they were reading, which matters when the link is
 * something a client just sent and the reply is half-typed.
 */
function Body({
  body,
  own,
  numberOfLines,
}: {
  body: string;
  own: boolean;
  /** Set by the email collapse (§2.6); undefined everywhere else. */
  numberOfLines?: number;
}) {
  const parts = linkify(body);
  const bodyStyle = [styles.body, own ? styles.bodyOwn : styles.bodyTheirs];

  if (parts.length === 1 && parts[0].kind === 'text') {
    return (
      <Text style={bodyStyle} numberOfLines={numberOfLines}>
        {body}
      </Text>
    );
  }

  return (
    <Text style={bodyStyle} numberOfLines={numberOfLines}>
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

/** Spec §2.6: an email longer than this collapses. */
const EMAIL_COLLAPSE_LINES = 6;
/** `styles.body`'s own line height — the two must not drift apart. */
const EMAIL_LINE_HEIGHT = 21;

/**
 * An email body, collapsed to six lines with a fade and a READ MORE
 * (spec §2.6).
 *
 * ─── HOW THE OVERFLOW IS KNOWN ──────────────────────────────────────
 *
 * A hidden, unclamped twin at the same width is measured once and its
 * HEIGHT compared against six lines' worth; the visible copy then clamps
 * with `numberOfLines`. Asking the visible copy is useless — once clamped
 * it reports the clamped size, which is a yes-shaped non-answer.
 *
 * Height, not `onTextLayout`'s line array, and that is not a style
 * preference: `onTextLayout` never fires under react-native-web, so the
 * line-count version measured nothing in the preview and shipped an email
 * that silently refused to collapse. `onLayout` fires on both. Found by
 * rendering it.
 *
 * The mask is a gradient fading to the bubble's own fill rather than a
 * flat scrim, so the last visible line dissolves instead of being cut.
 */
function EmailBody({ body, own }: { body: string; own: boolean }) {
  const [fullHeight, setFullHeight] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);

  // A line of tolerance, so a body that lands exactly on six does not
  // collapse to show one clipped word.
  const collapsedHeight = EMAIL_COLLAPSE_LINES * EMAIL_LINE_HEIGHT;
  const overflows = fullHeight !== null && fullHeight > collapsedHeight + EMAIL_LINE_HEIGHT * 0.5;
  const collapsed = overflows && !expanded;

  return (
    <View>
      {/* The measuring twin: laid out, never seen, never read aloud. */}
      {fullHeight === null ? (
        <Text
          style={[styles.body, styles.measure]}
          onLayout={(e) => setFullHeight(e.nativeEvent.layout.height)}
          accessible={false}
          importantForAccessibility="no-hide-descendants"
        >
          {body}
        </Text>
      ) : null}

      <View>
        <Body body={body} own={own} numberOfLines={collapsed ? EMAIL_COLLAPSE_LINES : undefined} />
        {collapsed ? (
          <LinearGradient
            colors={[`${chat.bubbleInBg}00`, chat.bubbleInBg]}
            style={styles.emailMask}
            pointerEvents="none"
          />
        ) : null}
      </View>

      {overflows ? (
        <Pressable
          onPress={() => setExpanded((v) => !v)}
          accessibilityRole="button"
          hitSlop={6}
          style={({ pressed }) => [styles.readMore, pressed && styles.pressed]}
        >
          <Text style={styles.readMoreLabel}>{expanded ? 'SHOW LESS' : 'READ MORE'}</Text>
        </Pressable>
      ) : null}
    </View>
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
  /*
   * §2.4 rev D.1. The state is derived, not read off `status`: a message
   * the API stored can still be reported DELIVERED or FAILED by the
   * carrier afterwards, and `status` only ever knows about the local
   * send. `deliveryState` owns the precedence.
   */
  const state = deliveryState(message);
  const failed = state === 'FAILED';
  const pending = state === 'QUEUED';
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

  // §7 rev G: split by whose corner each balloon belongs on. The summary
  // above is unchanged -- this only decides where each entry is drawn.
  const myReactions = reactionSummary.filter((r) => r.mine);
  const theirReactions = reactionSummary.filter((r) => !r.mine);

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

  /*
   * §2.6: email is the one channel with its own body treatment. The
   * subject rides in `metadata`, which the API already returns.
   */
  const isEmail = message.channel === 'EMAIL';
  const subject = isEmail ? (message.metadata?.subject as string | undefined) : undefined;

  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: revealX.value }] }));

  /*
   * §2.3: the time fades in over the first REVEAL_FADE_IN points of
   * travel. Derived from the same shared value that moves the bubbles, so
   * the two can never disagree -- and it costs no re-render: the whole
   * thread's timestamps track the finger on the UI thread.
   */
  const revealFade = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.max(0, -revealX.value / REVEAL_FADE_IN)),
  }));

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

      <View style={[styles.bubbleLine, own ? styles.bubbleLineOwn : styles.bubbleLineTheirs]}>
      {/*
        The badge is a SIBLING of the bubble, on the surface, and sits in
        the same row so it hugs the bubble's OUTER-LEFT edge rather than
        the screen's. Anchored absolutely to the full-width wrapper first,
        it landed ~250pt away from a right-aligned bubble.
      */}
      {failed ? (
        <View style={styles.failBadge}>
          <Feather name="alert-circle" size={18} color={chat.alert} />
        </View>
      ) : null}

      <Pressable
          onLongPress={onLongPress}
          /*
           * §7: 350ms, and a movement of more than 8pt cancels it.
           *
           * The cancel is the important half, and it is NOT hand-rolled:
           * a Pressable already cancels its long-press when the touch
           * moves outside the pressable plus `pressRetentionOffset`, so
           * setting that to 8 IS the 8pt rule, enforced by the same
           * machinery that decides every other press. Rolling our own
           * distance check would mean two answers to "is this still a
           * press", which is exactly how a long-press starts firing in
           * the middle of a scroll.
           */
          delayLongPress={350}
          pressRetentionOffset={LONG_PRESS_SLOP}
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

          {/*
            §2.6 EMAIL. The subject sits above the body in Outfit 14/600,
            read from `metadata.subject` — the same field apps/web reads
            for its own email composer, so nothing new is fetched or
            invented. Only EMAIL messages take this path; every other
            channel renders the plain body it always did.
          */}
          {subject ? (
            <Text style={[styles.subject, own ? styles.bodyOwn : styles.bodyTheirs]} numberOfLines={2}>
              {subject}
            </Text>
          ) : null}

          {message.body ? (
            isEmail ? (
              <EmailBody body={message.body} own={own} />
            ) : (
              <Body body={message.body} own={own} />
            )
          ) : null}

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
                    // A tile keeps its own frame; a solo image brings its
                    // own, because it has to size itself to the photo.
                    images.length > 1 && styles.imageTiled,
                    pressed && styles.pressed,
                  ]}
                >
                  {images.length === 1 ? (
                    /*
                      §2.5. One image keeps the photo's own proportions
                      under a 280 ceiling -- see ImageBubble on why a
                      square crop is the wrong default for this app.
                    */
                    <ImageBubble url={url} bare={bare} maxWidth={SOLO_IMAGE_WIDTH} />
                  ) : (
                    /*
                      Several images are a COLLAGE, and a collage wants
                      equal tiles -- Messages does the same. Cropping is
                      correct here: the grid is an index, and any one of
                      them opens full-screen.
                    */
                    <View style={styles.tileFrame}>
                      <Image source={{ uri: url }} style={styles.image} contentFit="cover" transition={140} />
                    </View>
                  )}
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
          {/*
            §7 rev G. Two clusters, because the corner is the REACTOR's
            side: mine go top-right, theirs top-left. An emoji used by
            both of us counts as mine -- it is still a reaction I made, and
            splitting one chip across two corners would be worse than
            picking the side I am on.
          */}
          {theirReactions.length > 0 ? (
            <View style={[styles.reactionCluster, styles.reactionsLeft]} pointerEvents="none">
              <ReactionTail side="left" mine={false} />
              {theirReactions.map((r) => (
                <ReactionBalloon key={r.emoji} emoji={r.emoji} count={r.count} mine={false} />
              ))}
            </View>
          ) : null}

          {myReactions.length > 0 ? (
            <View style={[styles.reactionCluster, styles.reactionsRight]} pointerEvents="none">
              <ReactionTail side="right" mine />
              {myReactions.map((r) => (
                <ReactionBalloon key={r.emoji} emoji={r.emoji} count={r.count} mine />
              ))}
            </View>
          ) : null}
        </Pressable>
      </View>

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
      <Animated.View style={[styles.revealGutter, revealFade]} pointerEvents="none">
        <Text style={styles.revealTime} numberOfLines={1}>
          {timeOfDay(message.createdAt)}
        </Text>
      </Animated.View>

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

        Truth constraint (rev D.1): QUEUED / SENT / DELIVERED / FAILED.
        There is still no status COLUMN — DELIVERED comes from the
        provider's own DLR, which the backend persists into
        `Message.metadata.deliveryStatus`. Absent or unrecognised metadata
        falls back to SENT, so nothing here ever claims a delivery the
        carrier did not report. READ stays dormant: no live channel
        reports it.
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
          <Text style={styles.metaText}>{deliveryLabel(state)}</Text>
        </View>
      ) : own && isLastOutgoing && showMeta ? (
        /*
         * §2.2: under the last outgoing message only. The label is now
         * SENT *or* DELIVERED — whichever the provider has actually
         * reported. Same Jura treatment either way, per §2.4.
         */
        <View style={[styles.meta, styles.metaOwn]}>
          <Text style={styles.metaText}>{deliveryLabel(state)}</Text>
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

  /* §2.6: subject in Outfit 14/600 above the body. */
  subject: { ...type.small, fontFamily: fonts.bodyMedium, fontSize: 14, marginBottom: 3 },
  /* Laid out for measurement, never painted and never announced. */
  measure: { position: 'absolute', opacity: 0, zIndex: -1 },
  /* The last two lines dissolve into the bubble's own fill. */
  emailMask: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 34 },
  readMore: { marginTop: 4, alignSelf: 'flex-start' },
  readMoreLabel: { ...type.label, fontSize: 10, color: chat.accent },

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

  /*
   * §7 rev G: ON the bubble's top corner, overlapping it, above it in z.
   * The old chips sat UNDER the bubble's bottom edge, which read as part
   * of the bubble rather than as a response to it.
   */
  reactionCluster: {
    position: 'absolute',
    top: -BALLOON / 2 - 2,
    flexDirection: 'row',
    gap: 3,
    zIndex: 2,
  },
  reactionsRight: { right: space.sm },
  reactionsLeft: { left: space.sm },

  images: { flexDirection: 'row', flexWrap: 'wrap', gap: 2 },
  /* 2 tiles + the gap between them. Messages' own collage is 2-up. */
  imagesGrid: { width: 104 * 2 + 2 },
  imagesAfterText: { marginTop: space.xs },
  imageTiled: { width: 104, height: 104 },
  tileFrame: {
    width: '100%',
    height: '100%',
    borderRadius: radius.input,
    overflow: 'hidden',
    backgroundColor: chat.surfaceInset,
  },
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
  /* In-row, so it tracks the bubble's own edge at any bubble width. */
  /*
     `alignSelf: stretch`, not a shrink-to-fit row: the bubble's own
     `maxWidth: 78%` (2.1) resolves against ITS PARENT, so a row that
     hugged its content made 78% mean 78%-of-the-text and every bubble
     wrapped a word early. Stretching the row puts the percentage back on
     the screen where the spec measures it. Caught by comparing renders.
  */
  bubbleLine: { flexDirection: 'row', alignItems: 'center', gap: space.xs, alignSelf: 'stretch' },
  bubbleLineOwn: { justifyContent: 'flex-end' },
  bubbleLineTheirs: { justifyContent: 'flex-start' },
  failBadge: { flexShrink: 0 },
  failedRow: { marginTop: 3, paddingHorizontal: space.xs },
  failedRowOwn: { alignSelf: 'flex-end' },
  failedRowTheirs: { alignSelf: 'flex-start' },
  /* `alertText` (#e08272), not `alert` (#c2402f): the strong red only
     clears the 3:1 non-text floor, and this is text. */
  failedLabel: { ...type.label, fontSize: 10, color: chat.alertText },
  pressed: { opacity: 0.6 },
});
