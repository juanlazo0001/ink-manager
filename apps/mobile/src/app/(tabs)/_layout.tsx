import Feather from '@expo/vector-icons/Feather';
import { Tabs } from 'expo-router';

import { colors, hairline, space, type } from '@/theme';

/**
 * Tab ORDER is the order these <Tabs.Screen> children are declared, which
 * is why Conversations lives in `index.tsx` but appears second: `index` is
 * the route the app opens on, and opening on the one screen that does real
 * work beats opening on a placeholder.
 */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.bg },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.fgMuted,
        tabBarStyle: {
          backgroundColor: colors.surfaceInset,
          borderTopWidth: hairline,
          borderTopColor: colors.border,
          paddingTop: space.xs,
        },
        tabBarLabelStyle: { ...type.label, marginTop: 2 },
      }}
    >
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
