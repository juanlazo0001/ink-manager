// One entry per system-task source. To add a new type (e.g. a
// conversation-related task in a later phase): write a module next to
// these exporting a TaskSource, then add it here -- nothing else in the
// /tasks route needs to change.
import { inquiryUnansweredSource } from "./inquiryUnanswered";
import { estimateFollowupSource } from "./estimateFollowup";
import { depositUnpaidSource } from "./depositUnpaid";
import { readyToScheduleSource } from "./readyToSchedule";
import { waiverToVerifySource } from "./waiverToVerify";
import { newConversationSource } from "./newConversation";
import { remindersNotSentSource } from "./remindersNotSent";
import type { TaskSource } from "./types";

export const TASK_SOURCE_REGISTRY: TaskSource[] = [
  inquiryUnansweredSource,
  estimateFollowupSource,
  depositUnpaidSource,
  readyToScheduleSource,
  waiverToVerifySource,
  newConversationSource,
  remindersNotSentSource,
];

export type { SystemTask, TaskSource } from "./types";
