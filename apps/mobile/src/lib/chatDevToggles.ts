import { useSyncExternalStore } from 'react';

/**
 * `__DEV__`-only switches for the two Part 3 behaviours that need a human
 * verdict rather than a guess.
 *
 * ─── WHY THESE EXIST ────────────────────────────────────────────────
 *
 * **Send-fly** (§10): the spec says the shipping default is chosen by the
 * operator at the device gate — "fly vs S1 pop, never a silent frame-rate
 * guess". A toggle is how a person compares the two on the actual phone
 * in the actual thread, back to back, which is the only way that verdict
 * can be taken honestly.
 *
 * **Typing** (§6): the indicator is built but wired to nothing, because
 * the investigation found no typing event anywhere on the socket layer.
 * A toggle lets it be seen and judged without ever pretending a client is
 * typing.
 *
 * ─── WHY A STORE AND NOT A CONTEXT ──────────────────────────────────
 *
 * Two unrelated screens read these (the thread renders them, a debug
 * control flips them) and neither owns the other. A module-level store
 * with `useSyncExternalStore` is the smallest thing that keeps them in
 * sync without threading a provider through a tree that only needs it in
 * development.
 *
 * Outside `__DEV__` every getter is a constant and nothing subscribes, so
 * this costs a production build nothing.
 */
export interface ChatDevToggles {
  /** Default ON so the gate sees the fly first, per §10. */
  sendFly: boolean;
  /** Default OFF — nothing real drives it (§6). */
  typing: boolean;
}

const DEFAULTS: ChatDevToggles = { sendFly: true, typing: false };

let state: ChatDevToggles = { ...DEFAULTS };
const listeners = new Set<() => void>();

function emit() {
  state = { ...state };
  for (const l of listeners) l();
}

export function setChatDevToggle<K extends keyof ChatDevToggles>(key: K, value: ChatDevToggles[K]) {
  if (!__DEV__) return;
  state[key] = value;
  emit();
}

export function toggleChatDev(key: keyof ChatDevToggles) {
  setChatDevToggle(key, !state[key]);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): ChatDevToggles {
  return state;
}

export function useChatDevToggles(): ChatDevToggles {
  const live = useSyncExternalStore(subscribe, snapshot, snapshot);
  // A production build takes the defaults and never subscribes to
  // anything — the toggles are a development affordance, not a feature.
  return __DEV__ ? live : DEFAULTS;
}
