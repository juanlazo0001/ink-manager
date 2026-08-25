import { Tabs } from 'expo-router';

import { AppointmentsIcon, DashboardIcon, DocumentIcon, PhotoIcon } from '@/components/icons';
import { CHAT_BUTTON_LIFT, ChatTabButton } from '@/components/ChatTabButton';
import { useBadgeCounts } from '@/hooks/useBadgeCounts';
import { colors, hairline, space, type } from '@/theme';

/**
 * Five tabs, with CHAT raised in the centre.
 *
 * Order is Home, Inquiries, CHAT, Schedule, FLASH -- the owner's, with
 * the chat button third of five so it is genuinely centred.
 *
 * Tasks used to hold the fifth slot and now lives in the top bar with its
 * badge, which is where apps/web has always kept it (`TopBar.tsx`, a
 * `TasksIcon` link left of the bell). Flash Gallery took the slot and left
 * the drawer, so nothing is reachable from two places at once.
 *
 * The glyphs are apps/web's own, path-for-path (see components/icons.tsx):
 * Home uses its sidebar Dashboard icon, Inquiries its My Inquiries
 * document, Schedule its Calendar, Tasks the tick-in-a-square from its top
 * bar. Feather look-alikes were what mobile had, and a look-alike in the
 * one place the two clients sit side by side reads as two products.
 *
 * `index.tsx` is still Conversations, and still the route the app opens
 * on; it simply now sits in the middle and is titled Chat, matching web,
 * where the same surface is reached from a button labelled "Chat".
 *
 * The chat badge is web's own definition -- see `useBadgeCounts`. It does
 * not gate on the studio's `showSidebarBadges` toggle, because web's own
 * FAB badge does not either; that toggle governs its sidebar alone.
 */
export default function TabsLayout() {
  const { conversations } = useBadgeCounts();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // Transparent so the shared background photo shows through --
        // see the root layout.
        sceneStyle: { backgroundColor: 'transparent' },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.fgMuted,
        tabBarStyle: {
          // The one chrome that stays opaque: a translucent tab bar over a
          // photo makes its labels unreadable as content scrolls beneath.
          backgroundColor: colors.surfaceInset,
          borderTopWidth: hairline,
          borderTopColor: colors.border,
          paddingTop: space.xs,
          // Room for the raised button to overhang without being clipped.
          overflow: 'visible',
        },
        tabBarLabelStyle: { ...type.label, marginTop: 2 },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: 'HOME',
          tabBarIcon: ({ color, size }) => <DashboardIcon size={size - 2} color={color} />,
        }}
      />
      <Tabs.Screen
        name="inquiries"
        options={{
          title: 'INQUIRIES',
          tabBarIcon: ({ color, size }) => <DocumentIcon size={size - 2} color={color} />,
        }}
      />
      <Tabs.Screen
        name="index"
        options={{
          title: 'CHAT',
          // The whole item is replaced, not just its icon: the raised
          // circle IS the control, and a label underneath it would sit
          // below the bar's own baseline.
          tabBarButton: (props) => (
            <ChatTabButton
              focused={props.accessibilityState?.selected ?? false}
              unread={conversations}
              onPress={() => props.onPress?.({} as never)}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="schedule"
        options={{
          title: 'SCHEDULE',
          tabBarIcon: ({ color, size }) => <AppointmentsIcon size={size - 2} color={color} />,
        }}
      />
      <Tabs.Screen
        name="flash"
        options={{
          title: 'FLASH',
          tabBarIcon: ({ color, size }) => <PhotoIcon size={size - 2} color={color} />,
        }}
      />

      {/*
        ITEM 2: Clients lives INSIDE this navigator but has no tab button.
        `href: null` is expo-router's own way to say that — the screen gets
        the navigator's chrome (the footer bar stays visible, the shared
        photo ground shows through) while the bar still shows five tabs.
        A route outside this group cannot render the tab bar at all, which
        is why it moved rather than being restyled in place. It is still
        reached from the drawer.
      */}
      <Tabs.Screen name="clients" options={{ href: null }} />
    </Tabs>
  );
}

/** Re-exported so a screen can pad its scroll content past the overhang. */
export { CHAT_BUTTON_LIFT };
