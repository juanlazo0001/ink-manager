import * as Haptics from 'expo-haptics';

/**
 * §10's haptic map, in one place, with the one rule that is easy to get
 * wrong made structural.
 *
 * ─── THE LATCH ──────────────────────────────────────────────────────
 *
 * `failed()` is TRANSITION-only. A thread polls every 30 seconds, and a
 * message that failed once stays failed for as long as it is on screen --
 * so a naive "buzz when this row is FAILED" fires on every poll, every
 * re-render, and again for every already-failed message in history the
 * moment someone scrolls up. That is a phone buzzing in someone's hand
 * about news from last Tuesday.
 *
 * The latch is a module-level set of message ids that have already
 * buzzed. It answers "is this the first time this message has been seen
 * to fail", which is the only question worth a haptic. History loads are
 * silent for free: `prime()` records ids without buzzing, so messages
 * that arrive already-failed are known before anything can fire.
 *
 * ─── WHY MODULE-LEVEL AND NOT A REF ─────────────────────────────────
 *
 * Leaving and re-entering a thread remounts the screen. A ref would
 * forget, and every already-failed message would buzz again on the way
 * back in -- the exact thing the latch exists to stop.
 */
const buzzed = new Set<string>();

/** Record ids as already-known, without buzzing. Use for history. */
export function primeFailureLatch(ids: Iterable<string>) {
  for (const id of ids) buzzed.add(id);
}

/**
 * A message just transitioned into FAILED. Fires at most once per id,
 * ever, for the life of the process.
 */
export function hapticFailed(messageId: string) {
  if (buzzed.has(messageId)) return;
  buzzed.add(messageId);
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
}

/** §10: send, pin, pill -- the light confirmations. */
export function hapticAction() {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

/** §10: the long-press lift into the actions overlay. */
export function hapticLift() {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
}

/** §10: moving between items in a sheet. */
export function hapticSelect() {
  void Haptics.selectionAsync();
}
