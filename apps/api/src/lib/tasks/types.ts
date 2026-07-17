// Shared output shape for every system-task source. Sources are pure
// functions of current data state -- nothing here is ever persisted (see
// TaskDismissal for the one thing that IS persisted: a user's dismissal).
export interface SystemTask {
  type: string;
  title: string;
  entityType: string;
  // The underlying record's real id -- what the deep link and audit log use.
  entityId: string;
  // What actually gets looked up/stored against TaskDismissal.entityId.
  // Equal to entityId for most types; a few types fold an event timestamp
  // into this so a fresh business event (e.g. resending an estimate)
  // produces an undismissed key even though the underlying record is the
  // same. See estimateFollowup.ts.
  dismissalKey: string;
  deepLink: string;
  actionableAt: Date;
}

export interface TaskSource {
  type: string;
  label: string;
  fetch(studioId: string): Promise<SystemTask[]>;
}

export function truncate(text: string, max = 60): string {
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}
