/**
 * Which faces a thread's avatar shows.
 *
 * This is a separate module from ThreadAvatar.tsx on purpose, and the reason
 * is the bug it exists to prevent. The component imports react-native, so
 * nothing in it can be reached by `tsx --test` -- which means the ONE piece
 * of real logic in it (how many participants make a group) had no test and
 * shipped wrong: the duo-stack renders participants[0] AND participants[1]
 * while the group test only required `length > 0`, so a one-participant
 * thread read `.avatarUrl` off undefined and took the whole conversation
 * list down at launch.
 *
 * The API builds `participants` as everyone EXCEPT the viewer, so any
 * two-person group produces exactly that one-element array. Nothing exotic
 * was required to hit it.
 *
 * Rules, in one place, testable:
 *   0 (or absent) → the thread's own name/avatar   ("Just you", CLIENT, STAFF)
 *   1             → that one person
 *   2             → the duo-stack
 *   3+            → first person, then a +N count
 */
export interface ThreadAvatarPerson {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export type ThreadAvatarLayout =
  /** `person` null means "use the thread's own name/avatarUrl". */
  | { kind: 'single'; person: ThreadAvatarPerson | null }
  | { kind: 'duo'; back: ThreadAvatarPerson; front: ThreadAvatarPerson }
  | { kind: 'overflow'; back: ThreadAvatarPerson; count: number };

export function threadAvatarLayout(participants?: ThreadAvatarPerson[] | null): ThreadAvatarLayout {
  const people = participants ?? [];

  if (people.length >= 3) {
    // The count is "everyone but the face already shown", which is what the
    // spec's +N means -- not "everyone hidden behind the front circle".
    return { kind: 'overflow', back: people[0], count: people.length - 1 };
  }
  if (people.length === 2) {
    return { kind: 'duo', back: people[0], front: people[1] };
  }
  if (people.length === 1) {
    // Render the one other person rather than the thread. Safe AND better:
    // a GROUP counterpart's own avatarUrl is always null from the API, so
    // falling back to the thread would discard a real picture.
    return { kind: 'single', person: people[0] };
  }
  return { kind: 'single', person: null };
}
