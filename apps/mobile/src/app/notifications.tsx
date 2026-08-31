import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Appear } from '@/components/Appear';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ScreenShell } from '@/components/ScreenShell';
import { SkeletonList } from '@/components/Skeleton';
import { StateMessage } from '@/components/ui';
import { useAuth } from '@/context/auth';
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notificationRoute,
  type NotificationItem,
} from '@/lib/notifications';
import { screenErrorMessage } from '@/lib/screenError';
import { relativeStamp } from '@/lib/time';
import { colors, hairline, radius, space, type } from '@/theme';

/**
 * Notifications — the bell's destination, and a real feed.
 *
 * This screen used to be a hardcoded "No mentions yet" sentence, on a
 * recorded belief that no endpoint existed to back one. `apps/api` has
 * had `routes/notifications.ts` for some time and `apps/web`'s
 * `NotificationBell` consumes all four of its routes; the screen was
 * describing a version of web that no longer exists. See
 * `lib/notifications.ts`.
 *
 * Mirrors the bell's behaviour rather than its shape — a popover is not a
 * screen — so the parts that carry meaning are kept and the chrome is
 * not: the unread-only toggle, mark-all-read, the unread dot, and
 * open-navigates-then-marks-read.
 */
export default function NotificationsScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const token = session?.token ?? null;
  const role = session?.profile.role;

  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [marking, setMarking] = useState(false);

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (!token) return;
      if (mode === 'refresh') setRefreshing(true);
      setError(null);
      try {
        const feed = await fetchNotifications(token, { unreadOnly });
        setItems(feed.items);
        setUnreadCount(feed.unreadCount);
      } catch (err) {
        setError(screenErrorMessage(err, 'your notifications'));
      } finally {
        setRefreshing(false);
      }
    },
    [token, unreadOnly],
  );

  useEffect(() => {
    void load();
  }, [load]);

  /*
   * Navigate FIRST, mark read second, and do not await — web's own note,
   * and its reasoning holds harder on a phone: opening a notification IS
   * the read receipt, and making the navigation wait on a POST puts a
   * stall in the one interaction that has to feel instant. A failed mark
   * leaves the row unread, which is recoverable.
   */
  const open = (item: NotificationItem) => {
    const route = notificationRoute(item, role);
    router.push(route as never);
    if (!item.readAt && token) {
      setItems((current) =>
        (current ?? []).map((n) => (n.id === item.id ? { ...n, readAt: new Date().toISOString() } : n)),
      );
      setUnreadCount((c) => Math.max(0, c - 1));
      void markNotificationRead(token, item.id).catch(() => {
        /* Left unread on failure; the next load re-reads the truth. */
      });
    }
  };

  const markAll = async () => {
    if (!token || marking) return;
    setMarking(true);
    try {
      await markAllNotificationsRead(token);
      await load();
    } catch (err) {
      setError(screenErrorMessage(err, 'your notifications'));
    } finally {
      setMarking(false);
    }
  };

  return (
    <ScreenShell edges={['top']}>
      <ScreenHeader title="Notifications" onBack={() => router.back()} right={<View style={styles.spacer} />} />

      <View style={styles.controls}>
        <Pressable
          onPress={() => setUnreadOnly((v) => !v)}
          accessibilityRole="button"
          accessibilityState={{ selected: unreadOnly }}
          hitSlop={8}
        >
          <Text style={[styles.control, unreadOnly && styles.controlOn]}>
            {unreadOnly ? 'SHOW ALL' : 'UNREAD ONLY'}
          </Text>
        </Pressable>
        {unreadCount > 0 ? (
          <Pressable onPress={() => void markAll()} accessibilityRole="button" hitSlop={8} disabled={marking}>
            <Text style={[styles.control, styles.markAll, marking && styles.disabled]}>
              {marking ? 'MARKING…' : 'MARK ALL READ'}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {error ? (
        <StateMessage
          eyebrow="Not loaded"
          title="Notifications didn't load"
          body={error}
          action={{ label: 'Try again', onPress: () => void load() }}
        />
      ) : items === null ? (
        <SkeletonList rows={5} />
      ) : items.length === 0 ? (
        /* Web's own two sentences, which say different things: nothing
           has ever arrived, versus nothing is waiting on you. */
        <StateMessage
          eyebrow="Nothing here"
          title={unreadOnly ? "You're all caught up" : 'Nothing here yet'}
          body={
            unreadOnly
              ? 'Every notification has been read.'
              : 'Mentions, assignments and new messages will show up here.'
          }
          action={unreadOnly ? { label: 'Show all', onPress: () => setUnreadOnly(false) } : undefined}
        />
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void load('refresh')} tintColor={colors.fgMuted} />
          }
        >
          {items.map((item, i) => (
            <Appear key={item.id} index={i}>
              <Pressable
                onPress={() => open(item)}
                accessibilityRole="button"
                accessibilityLabel={item.title}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              >
                {/* The dot occupies its space whether or not it is lit, so
                    a read row does not shift its text left. */}
                <View style={[styles.dot, !item.readAt && styles.dotUnread]} />
                <View style={styles.rowText}>
                  <Text style={[styles.title, !item.readAt && styles.titleUnread]} numberOfLines={2}>
                    {item.title}
                  </Text>
                  <Text style={styles.body} numberOfLines={2}>
                    {item.body}
                  </Text>
                  <Text style={styles.when}>{relativeStamp(item.createdAt)}</Text>
                </View>
              </Pressable>
            </Appear>
          ))}
        </ScrollView>
      )}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  spacer: { width: 36 },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: space.xl,
    paddingBottom: space.md,
  },
  control: { ...type.label, fontSize: 11, letterSpacing: 1.1, color: colors.fgMuted },
  controlOn: { color: colors.accent },
  markAll: { color: colors.accent },
  disabled: { opacity: 0.5 },

  content: { paddingHorizontal: space.xl, paddingBottom: space.xxl, gap: space.sm },
  row: {
    flexDirection: 'row',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.card,
    borderWidth: hairline,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  rowPressed: { opacity: 0.7 },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6, backgroundColor: 'transparent' },
  dotUnread: { backgroundColor: colors.accent },
  rowText: { flex: 1, gap: 2 },
  title: { ...type.body, color: colors.fgMuted },
  titleUnread: { color: colors.fg },
  body: { ...type.small, color: colors.fgMuted },
  when: { ...type.meta, color: colors.fgMuted, paddingTop: 2 },
});
