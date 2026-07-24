// Deterministic, idempotent dev seed -- safe to re-run against the same
// database (`npx prisma db seed`). Every entity is looked up by a stable
// key first and only created if missing, so re-running never duplicates
// rows or fails on unique-constraint violations.
//
// All data here is obviously fake: @dev-studio.test emails, 555 phone
// numbers, placeholder policy text. Never point this at production --
// see DEVELOPMENT.md.

import "dotenv/config";
import bcrypt from "bcrypt";
import crypto from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { generateUniqueReferralCode } from "../src/lib/referrals";
import {
  Role,
  Channel,
  InquiryStatus,
  AppointmentStatus,
  GiftCardStatus,
  ConversationType,
  MessageChannel,
  MessageDirection,
} from "../generated/prisma/enums";

const DEV_PASSWORD = "password123"; // obviously fake, dev-only

// Exact wording from the studio's real waiver template (Phase 4), reused
// here so the seeded studio exercises the same content shape as production.
const waiverHealthQuestions = [
  { question: "Have you ever been tattooed before?", type: "yes_no" },
  { question: "Have you ever been pierced before?", type: "yes_no" },
  { question: "Are you pregnant?", type: "yes_no" },
  { question: "Did you eat before visiting us?", type: "yes_no" },
  {
    question: "Do you have a heart condition, epilepsy, or diabetes?",
    type: "yes_no_explain",
    explainPrompt: "If yes, please explain",
  },
  {
    question:
      "Are you a hemophiliac (bleeder) or on any medications that may cause bleeding or may hinder blood clotting?",
    type: "yes_no",
  },
  {
    question: "Do you have any communicable diseases? (H.I.V., A.I.D.S., Hepatitis)",
    type: "yes_no",
  },
  {
    question: "Do you have any allergies? (Medicines or topical solutions)",
    type: "yes_no_explain",
    explainPrompt: "If yes, please explain",
  },
  {
    question: "Have you been exposed to COVID or have shown COVID like symptoms?",
    type: "yes_no_explain",
    explainPrompt: "If so, when",
  },
];

const waiverClauses = [
  "To my knowledge, I do not have any mental or medical impairment or disability which might affect my well-being as a direct or indirect result of my decision to have any tattoo and/or piercing procedure done at this time.",
  "I agree to follow all instructions concerning the care of my tattoo and/or piercing while it's healing. I agree that any touch up work, due to my negligence, will be done at my own expense.",
  "I understand that if my skin color is dark, the colors will not appear as bright as they do on lighter skin. Additionally, I understand that the finished tattoo may vary somewhat in appearance, color and/or design from the paper or other drawing or photographic image which the tattoo design is based.",
  "Being of sound mind and body, I hereby release all employees, agents or persons representing Black Hive Ink & Arts from all responsibility. I agree not to sue Black Hive Ink & Arts or its heirs or assigns in connection with all damages, claims, demands, rights and causes of action of whatever kind or nature based upon injuries or property damages to or death of myself or any other persons arising from my decisions to have any tattoo and/or piercing related work at this time, whether or not caused by any negligence of Black Hive Ink & Arts employees.",
  "I agree for myself, my heirs, assigns and legal representatives to hold harmless from all damages, actions, causes of action, claim judgments, costs of litigations, attorney's fees and all other costs and expenses which might arise from my decision to have any tattoo and/or piercing work done by Black Hive Ink & Arts.",
  "I have been advised that the tattoo will be permanent and that it can only be removed with a surgical procedure, and that any effective removal will leave permanent scarring and disfigurement. This cautionary notice is required to be provided to me by the health department and I hereby acknowledge receipt of this formal notice.",
  "I agree to pay for all damages and injuries to any persons and property belonging to Black Hive Ink & Arts or any other person to whom they may become liable contractually or by operation of law, caused by or resulting from my decision to have any tattoo and/or piercing work by Black Hive Ink & Arts.",
  "I hereby grant irrevocable consent to and authorize the use of any reproduction by Black Hive Ink & Arts, all photographs which are taken this day of me, negative or positive proof which will be hereby attached for any purposes whatsoever, without further compensation to me. All negatives, together with the prints, video, or live internet stream shall become and remain the property of Black Hive Ink & Arts, solely and completely.",
  "I swear or affirm and agree that the above information is true and correct.",
  "I have approved of the design and take responsibility for any misspellings and errors in the design after the tattooing process.",
];

const waiverAcknowledgment =
  "I have been provided with information describing the tattoo and/or piercing procedure to be performed and instructions on after care. I have been made aware that if I have any signs or symptoms of infection, such as swelling, pain, redness, warmth, fever, unusual discharge or odor to contact my physician. It is also my responsibility to take care of my new tattoo and/or piercing site per the instructions provided both verbally and/or in writing.";

const waiverPhotoRelease =
  "I hereby grant Black Hive Ink and Arts the irrevocable right and permission to use photographs and/or video recordings of me at Black Hive Ink and Arts and other websites and in publications, promotional flyers, educational materials, derivative works, or for any other similar purpose without compensation to me. I understand and agree that such photographs and/or video recordings of me may be placed on the Internet. I also understand and agree that I may be identified by name and/or title in printed, Internet or broadcast information that might accompany the photographs and/or video recordings of me. I waive the right to approve the final product. I agree that all such portraits, pictures, photographs, video and audio recordings, and any reproductions thereof, and all plates, negatives, recording tape and digital files are and shall remain the property of Black Hive Ink and Arts. I hereby release, acquit and forever discharge Black Hive Ink and Arts, its current and former trustees, agents, officers and employees of the above-named entities from any and all claims, demands, rights, promises, damages and liabilities arising out of or in connection with the use or distribution of said photographs and/or video recordings, including but not limited to any claims for invasion of privacy, appropriation of likeness or defamation.";

// No canonical wording exists yet for these (never seeded anywhere in the
// codebase) -- placeholder dev copy, clearly not legal text.
const estimateTerms =
  "[DEV SEED] Estimates are non-binding and subject to change based on final design complexity. A deposit is required to convert an estimate into a scheduled appointment.";
const refundPolicy = "[DEV SEED] Deposits are non-refundable but transferable to a future appointment.";
const depositPolicy = "[DEV SEED] A deposit is required to hold any appointment slot.";
const reschedulePolicy = "[DEV SEED] Please give at least 48 hours notice to reschedule.";
const communicationPolicy = "[DEV SEED] We respond to inquiries within one business day.";
const calendarInviteTemplate = "[DEV SEED] Your appointment at {{studioName}} is confirmed for {{startTime}}.";

// A2P 10DLC compliance: public, unauthenticated /privacy and /terms pages
// render these. NOT LEGAL ADVICE -- a reasonable starting point covering the
// disclosures required for SMS opt-in (no sharing/selling mobile numbers,
// a message-frequency estimate matching the actual 7B reminder cadence,
// and the exact phrase "Message and data rates may apply."), flagged for a
// lawyer's review before relying on it, same caveat as every other policy
// field in this app. No {{placeholder}} tokens -- unlike
// calendarInviteTemplate, nothing substitutes them at render time here; the
// studio's name is already shown prominently above the body on the page
// itself, so the text stays generic ("we"/"our studio") instead.
const privacyPolicy = `[DEV SEED] This studio respects your privacy. This policy explains what information we collect, how we use it, and how we protect it.

Information We Collect
When you submit an inquiry or book an appointment, we collect your name, email address, phone number, and details about the tattoo you're interested in, including any reference or placement photos you choose to share.

How We Use Your Information
We use this information to communicate with you about your inquiry and appointment -- confirmations, reminders, and updates from your artist -- and to provide the services you request.

Text Messaging
If you opt in to receive text messages, message frequency varies based on your appointments -- typically a few messages around each scheduled session (booking confirmations, reminders in the days and hours before your appointment, and occasional follow-ups). Message and data rates may apply. Reply STOP at any time to opt out, or START to opt back in.

We do not share or sell your mobile phone number to third parties.

Data Retention and Security
We retain your information for as long as needed to provide our services and comply with legal obligations, and take reasonable measures to protect it from unauthorized access.

Contact Us
If you have questions about this policy or your information, please contact us directly.`;

const termsAndConditions = `[DEV SEED] By submitting an inquiry or booking an appointment, you agree to the following terms.

Appointments and Deposits
A deposit may be required to secure your appointment. Our deposit, refund, and reschedule policies are provided separately at the time a deposit is requested.

Communications
By providing your phone number and opting in, you agree to receive text messages regarding your appointment, including reminders and updates. Message frequency varies based on your appointments -- typically a few messages around each scheduled session. Message and data rates may apply. Reply STOP to opt out at any time, or START to opt back in. We do not share or sell your mobile phone number to third parties.

Eligibility
You must be at least 18 years of age to receive tattoo services.

Changes to These Terms
We may update these terms from time to time; continued use of our services after a change means you accept the updated terms.

Contact Us
If you have questions about these terms, please contact us directly.`;

// Phase 7B-2: plain-text SMS reminder templates, editable afterward from
// Settings -> Integrations' reminder-cadence section. artistDayBefore has
// no {{appointmentTime}}/{{waiverLink}} placeholders -- it's a single
// consolidated digest per artist per day, so the job appends the actual
// appointment list as plain lines after this templated header.
const reminderTemplates = {
  clientWeekBefore:
    "Hi {{clientFirstName}}, this is a reminder that your appointment with {{artistName}} at {{studioName}} is coming up on {{appointmentDate}} at {{appointmentTime}}. Please complete your waiver here: {{waiverLink}}",
  clientNightBefore:
    "Hi {{clientFirstName}}, see you tomorrow at {{appointmentTime}} for your appointment with {{artistName}} at {{studioName}}! Waiver: {{waiverLink}}",
  clientMorningOf:
    "Hi {{clientFirstName}}, today's the day! Your appointment with {{artistName}} at {{studioName}} is at {{appointmentTime}}. Waiver: {{waiverLink}}",
  artistDayBefore: "Hi {{artistName}}, here's your schedule for tomorrow at {{studioName}}:",
  estimateFollowUp:
    "Hi {{clientFirstName}}, just following up on the estimate we sent for your tattoo -- you can view and respond here: {{estimateLink}}. Let us know if you have any questions! - {{studioName}}",
  // Twilio inbound-keyword auto-replies, sent from routes/webhooks.ts on a
  // matched START/YES/UNSTOP or HELP message -- exact wording is what's
  // actually submitted to Twilio for this A2P campaign, not placeholder text.
  optInConfirmation:
    "{{studioName}}: You are now opted-in to receive text messages. Msg frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to opt out.",
  helpResponse: "{{studioName}}: For help, contact us at {{studioPhone}}. Reply STOP to opt out.",
};

const reminderSendTimes = {
  weekBeforeTime: "10:00",
  nightBeforeTime: "18:00",
  morningOfTime: "08:00",
  artistDayBeforeTime: "07:00",
};

async function generateUniqueGiftCardCode(): Promise<string> {
  let code = crypto.randomBytes(16).toString("base64url");
  while (await prisma.giftCard.findUnique({ where: { code } })) {
    code = crypto.randomBytes(16).toString("base64url");
  }
  return code;
}

async function main() {
  const passwordHash = await bcrypt.hash(DEV_PASSWORD, 10);

  const studio = await prisma.studio.upsert({
    where: { slug: "dev-studio" },
    update: {},
    create: { name: "Dev Studio", slug: "dev-studio", website: "https://dev-studio.test" },
  });

  // No natural unique key on Location besides id, so find-then-create
  // rather than upsert -- gives the HELP auto-reply template's
  // {{studioPhone}}/{{studioEmail}} placeholders something real to render
  // in dev instead of coming out blank.
  const existingLocation = await prisma.location.findFirst({ where: { studioId: studio.id } });
  if (!existingLocation) {
    await prisma.location.create({
      data: {
        studioId: studio.id,
        name: "Main Location",
        address: "123 Main St, Suite 2, Portland, OR 97201",
        phone: "555-0100",
        email: "hello@dev-studio.test",
      },
    });
  }

  await prisma.studioSettings.upsert({
    where: { studioId: studio.id },
    update: {},
    create: {
      studioId: studio.id,
      refundPolicy,
      depositPolicy,
      reschedulePolicy,
      communicationPolicy,
      estimateTerms,
      calendarInviteTemplate,
      estimateFollowUpHours: 24,
      giftCardDefaultExpirationDays: 365,
      waiverHealthQuestions,
      waiverClauses,
      waiverAcknowledgment,
      waiverPhotoRelease,
      privacyPolicy,
      termsAndConditions,
      reminderTemplates,
      reminderSendTimes,
    },
  });

  const owner = await prisma.user.upsert({
    where: { email: "owner@dev-studio.test" },
    update: {},
    create: {
      email: "owner@dev-studio.test",
      password: passwordHash,
      name: "Dev Owner",
      phone: "555-0100",
      role: Role.OWNER,
      studioId: studio.id,
    },
  });

  await prisma.user.upsert({
    where: { email: "frontdesk@dev-studio.test" },
    update: {},
    create: {
      email: "frontdesk@dev-studio.test",
      password: passwordHash,
      name: "Dev Front Desk",
      phone: "555-0101",
      role: Role.FRONT_DESK,
      studioId: studio.id,
    },
  });

  const artistUser1 = await prisma.user.upsert({
    where: { email: "artist1@dev-studio.test" },
    update: {},
    create: {
      email: "artist1@dev-studio.test",
      password: passwordHash,
      name: "Dev Artist One",
      phone: "555-0102",
      role: Role.ARTIST,
      studioId: studio.id,
    },
  });

  const artistUser2 = await prisma.user.upsert({
    where: { email: "artist2@dev-studio.test" },
    update: {},
    create: {
      email: "artist2@dev-studio.test",
      password: passwordHash,
      name: "Dev Artist Two",
      phone: "555-0103",
      role: Role.ARTIST,
      studioId: studio.id,
    },
  });

  const artist1 = await prisma.artist.upsert({
    where: { userId: artistUser1.id },
    update: {},
    create: {
      userId: artistUser1.id,
      bio: "[DEV SEED] Traditional and black & grey specialist.",
      specialties: ["Traditional", "Black & Grey"],
      portfolioImages: [],
    },
  });

  await prisma.artist.upsert({
    where: { userId: artistUser2.id },
    update: {},
    create: {
      userId: artistUser2.id,
      bio: "[DEV SEED] Fine line and color realism specialist.",
      specialties: ["Fine Line", "Color Realism"],
      portfolioImages: [],
    },
  });

  async function upsertClient(email: string, firstName: string, lastName: string, phone: string) {
    const existing = await prisma.client.findFirst({ where: { studioId: studio.id, email } });
    if (existing) return existing;
    const referralCode = await generateUniqueReferralCode();
    return prisma.client.create({ data: { studioId: studio.id, firstName, lastName, email, phone, referralCode } });
  }

  const client1 = await upsertClient("client1@dev-studio.test", "Alex", "Testperson", "555-0201");
  const client2 = await upsertClient("client2@dev-studio.test", "Bailey", "Testperson", "555-0202");
  const client3 = await upsertClient("client3@dev-studio.test", "Casey", "Testperson", "555-0203");
  await upsertClient("client4@dev-studio.test", "Drew", "Testperson", "555-0204");

  async function findOrCreateInquiry(clientId: string, description: string, data: Record<string, unknown>) {
    const existing = await prisma.inquiry.findFirst({ where: { studioId: studio.id, clientId, description } });
    if (existing) return existing;
    return prisma.inquiry.create({
      data: {
        studioId: studio.id,
        clientId,
        description,
        channel: Channel.EMAIL,
        colorOrBlackGrey: "Color",
        placement: "Forearm",
        estimatedSize: "Palm-sized",
        hasBeenTattooedBefore: false,
        ...data,
      },
    });
  }

  // Stage 1: freshly submitted, unassigned.
  await findOrCreateInquiry(client1.id, "[DEV SEED] Small floral piece on forearm", {
    status: InquiryStatus.NEW,
  });

  // Stage 2: deposit paid, gift card issued, not yet scheduled.
  const inquiry2 = await findOrCreateInquiry(client2.id, "[DEV SEED] Full sleeve consultation", {
    status: InquiryStatus.SCHEDULING,
    assignedArtistId: artist1.id,
    priceEstimateLow: 400,
    priceEstimateHigh: 600,
  });

  const existingDeposit2 = await prisma.depositForm.findUnique({ where: { inquiryId: inquiry2.id } });
  if (!existingDeposit2) {
    const code2 = await generateUniqueGiftCardCode();
    const giftCard2 = await prisma.giftCard.create({
      data: {
        studioId: studio.id,
        clientId: client2.id,
        code: code2,
        amountCents: 15000,
        status: GiftCardStatus.ACTIVE,
        issuedById: owner.id,
      },
    });
    await prisma.depositForm.create({
      data: {
        inquiryId: inquiry2.id,
        token: crypto.randomBytes(16).toString("hex"),
        tokenExpiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        agreedNonRefundable: true,
        agreedLatePolicy: true,
        agreedNoShowForfeit: true,
        agreedNewDepositAfterNoShow: true,
        agreedRescheduleLimit: true,
        agreedExpiration: true,
        agreedIdAndVoucher: true,
        agreedAge18: true,
        signatureName: "Bailey Testperson",
        signedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        depositAmount: 150,
        feeAmount: 10,
        totalCharged: 160,
        paidManually: true,
        paidAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        giftCardId: giftCard2.id,
      },
    });
  }

  // Stage 3: deposit paid, gift card issued and attached to a scheduled appointment.
  const inquiry3 = await findOrCreateInquiry(client3.id, "[DEV SEED] Back piece, session 1 of 3", {
    status: InquiryStatus.CONFIRMED,
    assignedArtistId: artist1.id,
    priceEstimateLow: 800,
    priceEstimateHigh: 1200,
  });

  const existingAppointment3 = await prisma.appointment.findFirst({ where: { inquiryId: inquiry3.id } });
  if (!existingAppointment3) {
    const code3 = await generateUniqueGiftCardCode();
    const giftCard3 = await prisma.giftCard.create({
      data: {
        studioId: studio.id,
        clientId: client3.id,
        code: code3,
        amountCents: 20000,
        status: GiftCardStatus.ACTIVE,
        issuedById: owner.id,
      },
    });

    await prisma.depositForm.create({
      data: {
        inquiryId: inquiry3.id,
        token: crypto.randomBytes(16).toString("hex"),
        tokenExpiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        agreedNonRefundable: true,
        agreedLatePolicy: true,
        agreedNoShowForfeit: true,
        agreedNewDepositAfterNoShow: true,
        agreedRescheduleLimit: true,
        agreedExpiration: true,
        agreedIdAndVoucher: true,
        agreedAge18: true,
        signatureName: "Casey Testperson",
        signedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
        depositAmount: 200,
        feeAmount: 10,
        totalCharged: 210,
        paidManually: true,
        paidAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        giftCardId: giftCard3.id,
      },
    });

    const start = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 3 * 60 * 60 * 1000);

    await prisma.$transaction(async (tx) => {
      const appointment = await tx.appointment.create({
        data: {
          studioId: studio.id,
          clientId: client3.id,
          artistId: artist1.id,
          inquiryId: inquiry3.id,
          startTime: start,
          endTime: end,
          status: AppointmentStatus.CONFIRMED,
        },
      });
      await tx.giftCard.update({ where: { id: giftCard3.id }, data: { appointmentId: appointment.id } });
    });
  }

  // A client conversation (IG DM logged by front desk, with a reply) and a
  // staff conversation (artist1's in-app thread), for Phase 6A testing.
  const existingClientConversation = await prisma.conversation.findUnique({ where: { clientId: client1.id } });
  if (!existingClientConversation) {
    const conversation = await prisma.conversation.create({
      data: { studioId: studio.id, type: ConversationType.CLIENT, clientId: client1.id },
    });

    const inboundAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const outboundAt = new Date(Date.now() - 1 * 60 * 60 * 1000);

    await prisma.message.create({
      data: {
        studioId: studio.id,
        conversationId: conversation.id,
        channel: MessageChannel.INSTAGRAM,
        direction: MessageDirection.INBOUND,
        body: "[DEV SEED] Hi! Just checking on the status of my forearm piece inquiry.",
        authorUserId: owner.id,
        createdAt: inboundAt,
      },
    });
    await prisma.message.create({
      data: {
        studioId: studio.id,
        conversationId: conversation.id,
        channel: MessageChannel.INSTAGRAM,
        direction: MessageDirection.OUTBOUND,
        body: "[DEV SEED] Hi Alex! We're reviewing it now and will have an estimate to you shortly.",
        authorUserId: owner.id,
        createdAt: outboundAt,
      },
    });
    await prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: outboundAt } });
  }

  const existingStaffConversation = await prisma.conversation.findUnique({ where: { staffUserId: artistUser1.id } });
  if (!existingStaffConversation) {
    const conversation = await prisma.conversation.create({
      data: { studioId: studio.id, type: ConversationType.STAFF, staffUserId: artistUser1.id },
    });

    const messageAt = new Date(Date.now() - 30 * 60 * 1000);

    await prisma.message.create({
      data: {
        studioId: studio.id,
        conversationId: conversation.id,
        channel: MessageChannel.IN_APP,
        direction: MessageDirection.OUTBOUND,
        body: "[DEV SEED] Heads up, your 3pm on Friday moved the buffer slightly -- check the schedule.",
        authorUserId: owner.id,
        createdAt: messageAt,
      },
    });
    await prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: messageAt } });
  }

  console.log("Seed complete:");
  console.log(`  Studio: ${studio.name} (${studio.slug})`);
  console.log(`  Login (any seeded user): password "${DEV_PASSWORD}"`);
  console.log("    owner@dev-studio.test / frontdesk@dev-studio.test / artist1@dev-studio.test / artist2@dev-studio.test");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
