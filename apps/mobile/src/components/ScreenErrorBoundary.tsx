import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { reportClientError } from '@/lib/reportClientError';
import { colors, radius, space, type } from '@/theme';

/**
 * Keeps one bad screen from taking the whole app down.
 *
 * This exists because a single conversation row with an unexpected shape
 * crashed the app AT LAUNCH -- not the chat tab, the app. React unmounts the
 * whole tree when nothing catches, so a list that renders every row makes one
 * malformed record fatal for everything, including the screens that were
 * perfectly fine.
 *
 * Wrapped per tab root rather than once around the router, deliberately: the
 * point is that the other four tabs keep working. A single boundary at the
 * top would catch the error and still leave the person looking at an empty
 * app.
 *
 * It also REPORTS, for the same reason the web boundary does (Package BK): a
 * crash on someone else's phone that produces only a screenshot costs a
 * session to diagnose, and one that arrives with a component stack costs
 * minutes.
 */
interface Props {
  /** Which screen this guards -- goes into the report. */
  label: string;
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
  componentStack: string;
  showDetails: boolean;
}

const EMPTY: State = { hasError: false, message: '', componentStack: '', showDetails: false };

export class ScreenErrorBoundary extends Component<Props, State> {
  state: State = EMPTY;

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, message: error?.message ?? String(error) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const componentStack = info.componentStack ?? '';
    console.error(`[ScreenErrorBoundary:${this.props.label}]`, error, componentStack);
    this.setState({ componentStack });
    reportClientError({
      message: error?.message ?? String(error),
      stack: error?.stack ?? null,
      componentStack,
      boundary: this.props.label,
    });
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    const { message, componentStack, showDetails } = this.state;
    return (
      <View style={styles.wrap}>
        <Text style={styles.title}>This screen hit a problem</Text>
        <Text style={styles.body}>
          The rest of the app still works — switch tabs and come back. We&rsquo;ve been sent the details.
        </Text>

        <Pressable
          onPress={() => this.setState({ ...EMPTY, hasError: true, message, componentStack, showDetails: false })}
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
          accessibilityRole="button"
        >
          <Text style={styles.buttonLabel}>Try again</Text>
        </Pressable>

        <Pressable
          onPress={() => this.setState((s) => ({ ...s, showDetails: !s.showDetails }))}
          accessibilityRole="button"
          style={styles.detailsToggle}
        >
          <Text style={styles.detailsLabel}>{showDetails ? 'Hide details' : 'Details'}</Text>
        </Pressable>

        {showDetails ? (
          // Left-aligned and scrollable: this exists to be screenshotted or
          // read out, so it has to be legible on a phone.
          <ScrollView style={styles.details} contentContainerStyle={styles.detailsInner}>
            <Text style={styles.mono}>{message || '(no message)'}</Text>
            {componentStack ? <Text style={styles.monoDim}>{componentStack.trim()}</Text> : null}
          </ScrollView>
        ) : null}
      </View>
    );
  }
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.lg, gap: space.sm },
  title: { ...type.heading, color: colors.fg, textAlign: 'center' },
  body: { ...type.body, color: colors.fgSecondary, textAlign: 'center' },
  button: {
    marginTop: space.sm,
    backgroundColor: colors.accentButton,
    borderRadius: radius.pill,
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
  },
  pressed: { opacity: 0.85 },
  buttonLabel: { ...type.button, color: colors.accentFg },
  detailsToggle: { marginTop: space.xs, padding: space.xs },
  detailsLabel: { ...type.small, color: colors.fgMuted, textDecorationLine: 'underline' },
  details: {
    maxHeight: 220,
    alignSelf: 'stretch',
    marginTop: space.xs,
    backgroundColor: colors.surfaceInset,
    borderRadius: radius.input,
  },
  detailsInner: { padding: space.sm, gap: space.xs },
  mono: { ...type.meta, color: colors.fg },
  monoDim: { ...type.meta, color: colors.fgSecondary },
});
