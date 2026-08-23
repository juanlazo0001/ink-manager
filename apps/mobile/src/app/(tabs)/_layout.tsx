import Feather from '@expo/vector-icons/Feather';
import { Tabs } from 'expo-router';

import { colors, hairline, space, type } from '@/theme';

/**
 * Tab ORDER is the order these <Tabs.Screen> children are declared, which
 * is why Conversations lives in `index.tsx` but is not first: `index` is
 * the route the app OPENS on, and landing on live messages beats landing
 * on a set of aggregates.
 *
 * Five is the ceiling. iOS collapses a sixth into a "More" list and
 * Android crams them, so Flash — which web treats as a peer destination —
 * is reached from Account instead. Nothing about it is less capable for
 * living there; it is the tab bar that ran out of room, not the feature.
 */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // Transparent for the same reason the root Stack is — see there.
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
          title: 'MESSAGES',
          tabBarIcon: ({ color, size }) => <Feather name="message-square" size={size - 3} color={color} />,
        }}
      />
      <Tabs.Screen
        name="tasks"
        options={{
          title: 'TASKS',
          tabBarIcon: ({ color, size }) => <Feather name="check-square" size={size - 3} color={color} />,
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
