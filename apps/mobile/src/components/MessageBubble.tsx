import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useRef, useState } from 'react';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';

import { isMessageEdited } from '@/lib/conversations';
import { deliveryLabel, deliveryState, failedLineFor } from '@/lib/deliveryStatus';
import { linkify, truncateMiddle } from '@/lib/linkify';
import type { DisplayMessage } from '@/lib/threadRows';
import { BALLOON, ReactionBalloon, ReactionTail } from '@/components/ReactionBalloon';
import { traceReactionAnchor } from '@/lib/reactionProbe';

/*
 * ─── §7 rev H: A REACTED ROW RESERVES ITS OWN HEADROOM ──────────
 *
 * The balloon used to be absolutely positioned at `-BALLOON / 2 - 2` with
 * nothing reserving space for it, and the code said so in as many words:
 * "Absolute, so it costs the row no height and cannot push the next
 * bubble down." That was a deliberate choice, and this reverses it.
 *
 * It could not survive contact with an inverted list. A balloon hanging
 * above its row's bounds is drawn by a row that paints EARLIER than the
 * one above it, so the neighbour paints over it and the balloon is
 * chopped — `zIndex` cannot help across siblings that are laid out in
 * the opposite order to how they appear. The reference behaviour is that
 * neighbours SLIDE APART: the balloon gets real space rather than a
 * z-order gamble.
 *
 * So the row grows by exactly the part of the balloon that would have
 * overflowed, and the balloon keeps its overlap into the bubble's corner:
 *
 *     overlap  = 45% of the balloon, rounded    = 14
 *     headroom = BALLOON − overlap              = 16
 *
 * Rounded to whole points on purpose: a half point here lands the balloon
 * on a seam between two rows, which is the artefact this is fixing.
 */
const BALLOON_OVERLAP = Math.round(BALLOON * 0.45);
const REACTION_HEADROOM = BALLOON - BALLOON_OVERLAP;

/*
 * ─── HOW FAR THE BALLOON HANGS PAST THE BUBBLE'S EDGE ───────────────
 *
 * The gate's measurement of the iMessage reference: the balloon GRIPS
 * the corner rather than sitting inside it, so roughly half of it is
 * outboard of the bubble's edge. 11 of a 30pt balloon leaves 19 over the
 * bubble and 11 past it, which is the reference's proportion.
 *
 * It was `right: space.sm` — an INSET of 8, i.e. the balloon tucked
 * fully inside the bubble's width. The sign was the bug: a corner grip
 * is a negative offset, not a positive one.
 */
const BALLOON_OUTBOARD = 11;

/*
 * A balloon may hang off the bubble, never off the SCREEN. The row's own
 * horizontal inset is `space.lg`; anything the balloon would take beyond
 * that is given back, so the balloon can never come closer than this to
 * the edge. On a bubble that is nowhere near the edge the clamp is
 * inert — it only ever engages on a full-width own bubble.
 */
const BALLOON_SCREEN_CLAMP = 8;

/*
 * The clamp, resolved rather than checked at runtime.
 *
 * A bubble sits inside the row's `space.lg` inset, so the only balloon
 * that can reach the screen edge is one anchored to the side the bubble
 * is aligned to: an OWN bubble's right edge, or an INCOMING bubble's
 * left edge. On that side the balloon may take the inset minus the
 * floor; everywhere else the bubble's edge is mid-screen and the full
 * outboard is safe.
 *
 *     clamped = space.lg − 8 = 8        (measured: screenGap was 6 at 11)
 *
 * Expressed as a function of the two constants, so changing either the
 * inset or the floor moves this with them.
 */
const BALLOON_OUTBOARD_CLAMPED = Math.min(BALLOON_OUTBOARD, space.lg - BALLOON_SCREEN_CLAMP);
import { ImageBubble } from '@/components/ImageBubble';
import { AttachmentIcon } from '@/components/icons';
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

/**
 * ─── __DEV__ MOUNT LEDGER (session 10, Task A) ──────────────────
 *
 * A re-render cannot blank a loaded image; only an UNMOUNT can. So the
 * operator's "the image goes blank and the neighbours flash back as
 * fragments" is a claim about mount lifecycle, and this counts it rather
 * than arguing about it.
 *
 * Expected on a send: one mount (the new row), ZERO unmounts of rows that
 * were already on screen.
 */
export function useMountLedger(id: string, tag: string) {
  useEffect(() => {
    if (!__DEV__) return;
    const g = globalThis as { __mountLedger__?: { mounts: string[]; unmounts: string[] } };
    g.__mountLedger__ ??= { mounts: [], unmounts: [] };
    g.__mountLedger__.mounts.push(`${Math.round(performance.now())} ${tag}:${id}`);
    return () => {
      g.__mountLedger__!.unmounts.push(`${Math.round(performance.now())} ${tag}:${id}`);
    };
  }, [id, tag]);
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
   * Session 10 Task A: counts this bubble's mount lifecycle in __DEV__.
   *
   * Keyed on `rowKey`, NOT `id`, and that distinction is the instrument
   * being honest about itself. A sent message's `id` changes at ack, so a
   * ledger keyed on `id` fires its effect cleanup and re-runs — logging an
   * unmount and a mount for a row React never actually touched. The first
   * post-fix measurement showed exactly that phantom, and it was the probe
   * lying, not the list churning. `rowKey` is stable across the swap, so
   * what this counts now is real mounting.
   */
  useMountLedger(message.rowKey ?? message.id, 'bubble');

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
  /*
   * ONE headroom, however many balloons. A cluster grows sideways from
   * its corner, so a second reaction must not buy a second reservation —
   * the row's height is a function of "is there a balloon at all", never
   * of the count.
   */
  const hasReactions = reactionSummary.length > 0;

  /*
   * The anchor probe (`lib/reactionProbe.ts`). Both views measure
   * THEMSELVES in window coordinates, which is the only frame that
   * survives the inverted list's transform — session 20's DOM-side
   * attempt measured in the flipped frame and reported nonsense.
   */
  const bubbleRef = useRef<View | null>(null);
  const balloonRef = useRef<View | null>(null);
  const measureAnchor = useCallback(() => {
    if (!__DEV__ || !hasReactions) return;
    const bubble = bubbleRef.current;
    const balloon = balloonRef.current;
    if (!bubble || !balloon) return;
    bubble.measureInWindow((bx, by, bw, bh) => {
      balloon.measureInWindow((lx, ly, lw, lh) => {
        traceReactionAnchor({
          label: `${own ? 'own' : 'incoming'} · ${myReactions.length > 0 ? 'mine' : 'theirs'}`,
          bubble: { x: bx, y: by, width: bw, height: bh },
          balloon: { x: lx, y: ly, width: lw, height: lh },
          screenWidth: Dimensions.get('window').width,
        });
      });
    });
  }, [hasReactions, own, myReactions.length]);

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

      {/*
        The headroom rides on the BUBBLE LINE rather than the row, so an
        attributed message keeps its name tight to the run and opens the
        space between the name and the bubble — the balloon's actual
        neighbourhood. Grouped runs therefore open from 2 to 2 + 16 for
        the reacted message only; the tail, the grouping class and the
        attribution are untouched.
      */}
      <View
        style={[
          styles.bubbleLine,
          own ? styles.bubbleLineOwn : styles.bubbleLineTheirs,
          hasReactions ? styles.bubbleLineReacted : null,
        ]}
      >
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
          ref={bubbleRef}
          onLayout={measureAnchor}
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
              <AttachmentIcon size={12} color={own ? colors.accentFg : colors.fgMuted} />
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
            <View
              ref={balloonRef}
              onLayout={measureAnchor}
              style={[
                styles.reactionCluster,
                /* Their balloon hangs off the LEFT edge, which is the
                   screen-adjacent one on an incoming bubble. */
                { left: -(own ? BALLOON_OUTBOARD : BALLOON_OUTBOARD_CLAMPED) },
              ]}
              pointerEvents="none"
            >
              {/* Bubble-facing: a left-anchored balloon hangs off the
                  bubble's LEFT edge, so the bubble is to its right and
                  the dots descend on the balloon's lower-right. */}
              <ReactionTail side="right" mine={false} />
              {theirReactions.map((r) => (
                <ReactionBalloon key={r.emoji} emoji={r.emoji} count={r.count} mine={false} />
              ))}
            </View>
          ) : null}

          {myReactions.length > 0 ? (
            <View
              ref={balloonRef}
              onLayout={measureAnchor}
              style={[
                styles.reactionCluster,
                /* Mine hangs off the RIGHT edge, screen-adjacent on an
                   own bubble. */
                { right: -(own ? BALLOON_OUTBOARD_CLAMPED : BALLOON_OUTBOARD) },
              ]}
              pointerEvents="none"
            >
              {/* Bubble-facing: a right-anchored balloon hangs off the
                  bubble's RIGHT edge, so the bubble is to its left and
                  the dots descend on the balloon's lower-left. This was
                  `side="right"`, which put them on the outer edge
                  pointing away from the message they belong to. */}
              <ReactionTail side="left" mine />
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
          accessibilityLabel={`${failedLineFor(message)}. Tap to retry.`}
          hitSlop={8}
          style={({ pressed }) => [
            styles.failedRow,
            own ? styles.failedRowOwn : styles.failedRowTheirs,
            pressed && styles.pressed,
          ]}
        >
          {/* Surface-anchored, per CLAUDE.md: the line sits on the
              screen beside the bubble and never recolours the fill. */}
          <Text style={styles.failedLabel}>{failedLineFor(message)}</Text>
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
  bubbleLineReacted: { marginTop: REACTION_HEADROOM },
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
  /* Exactly the reserved band: the balloon's top edge lands on the space
     the row just opened, so `balloonRect` is inside `rowRect` by
     construction rather than by luck. zIndex still orders the balloon
     over its OWN bubble, which is a paint decision inside one row -- it
     is no longer asked to defeat another row, which it could not do. */
  /*
   * `top` states the contract directly: the balloon's BOTTOM lands
   * `BALLOON_OVERLAP` below the bubble's top edge, so
   *
   *     balloonBottom = bubbleTop + 14        (top = 14 − 30 = −16)
   *
   * which is the same 16 the row reserves above the bubble — the
   * headroom and the grip are two readings of one number, and writing it
   * as `overlap − BALLOON` keeps them that way if the balloon resizes.
   */
  reactionCluster: {
    position: 'absolute',
    top: BALLOON_OVERLAP - BALLOON,
    flexDirection: 'row',
    gap: 3,
    zIndex: 2,
  },
  /* The side offsets are applied inline, because the clamp depends on
     which edge the bubble is aligned to — see BALLOON_OUTBOARD_CLAMPED. */

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
    /*
     * §2.3 rev G: times RIGHT-ALIGN within the gutter, and that is what
     * creates the daylight the gate asked for. Left-aligned, every time
     * started hard against the bubble it belonged to, and a long bubble
     * with a short time looked crowded while a short bubble with a long
     * time looked fine -- the spacing depended on the message. Right
     * aligned they form a column, and the gap is bounded below by the
     * widest time rather than by the widest bubble.
     */
    alignItems: 'flex-end',
    paddingRight: space.sm,
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
