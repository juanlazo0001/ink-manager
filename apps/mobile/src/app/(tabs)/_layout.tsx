import Feather from '@expo/vector-icons/Feather';
import { Tabs } from 'expo-router';
import { View } from 'react-native';

import { Badge } from '@/components/TopBar';
import { CHAT_BUTTON_LIFT, ChatTabButton } from '@/components/ChatTabButton';
import { useBadgeCounts } from '@/hooks/useBadgeCounts';
import { colors, hairline, space, type } from '@/theme';

/**
 * Five tabs, with CHAT raised in the centre.
 *
 * Order is Home, Schedule, CHAT, Tasks, Inquiries -- the chat button has
 * to be the third of five to actually be centred, so the order is a
 * consequence of the decision to raise it, not a separate choice.
 *
 * `index.tsx` is still Conversations, and still the route the app opens
 * on; it simply now sits in the middle and is titled Chat, matching web,
 * where the same surface is reached from a button labelled "Chat".
 *
 * Both badge counts are web's own definitions -- see `useBadgeCounts`.
 * Neither gates on the studio's `showSidebarBadges` toggle, because web's
 * own top-bar and FAB badges do not either; that toggle governs its
 * sidebar alone.
 */
export default function TabsLayout() {
  const { conversations, tasks } = useBadgeCounts();

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
          tabBarIcon: ({ color, size }) => <Feather name="bar-chart-2" size={size - 3} color={color} />,
        }}
      />
      <Tabs.Screen
        name="schedule"
        options={{
          title: 'SCHEDULE',
          tabBarIcon: ({ color, size }) => <Feather name="calendar" size={size - 3} color={color} />,
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
        name="tasks"
        options={{
          title: 'TASKS',
          tabBarIcon: ({ color, size }) => (
            <View>
              <Feather name="check-square" size={size - 3} color={color} />
              {/* Web puts this count on a top-bar tasks icon. There is no
                  tasks icon in mobile's bar by decision, so the badge
                  rides the tab that navigates there -- same count, same
                  treatment. */}
              {tasks > 0 ? <Badge count={tasks} /> : null}
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="inquiries"
        options={{
          title: 'INQUIRIES',
          tabBarIcon: ({ color, size }) => <Feather name="inbox" size={size - 3} color={color} />,
        }}
      />
    </Tabs>
  );
}

/** Re-exported so a screen can pad its scroll content past the overhang. */
export { CHAT_BUTTON_LIFT };
