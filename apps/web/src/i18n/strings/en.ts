// Multi-language public forms, Part 3: the platform's own English
// strings for the six public flows (deposit, estimate + estimate
// revision, waiver, self-schedule, flash gallery + flash payment,
// intake). This is the canonical source of truth for both content AND
// shape -- es.ts (and any future locale) is typed against this file's
// own inferred type, so a missing/extra key is a compile error, not a
// silent runtime fallback nobody notices.
//
// Deliberately NOT `as const` -- that would narrow every leaf to its
// literal English value, which would then force es.ts to have the exact
// same (English) text to satisfy the type. Leaving leaves typed as
// plain `string` means es.ts only has to match the KEY structure, not
// the VALUES, which is the whole point.
//
// Interpolation: `{{var}}` placeholders, filled in by t()'s own vars
// argument (see useTranslations.ts). No general pluralization machinery
// exists in t() itself (deliberately -- see estimate.hourSingular/
// hourPlural, the one real word-form-selection case found so far): a
// caller that needs to pick between word forms does so explicitly with
// two separate keys and its own count check, not a library.
export const en = {
  // Artist public page v2: platform chrome for /artist/:publicSlug. This
  // page predated the multi-language public forms epic and was out of
  // scope then -- folded in now per its own restyle task. The artist's
  // own authored content (name, bio, specialties, studio names) is never
  // translated here, same as every other public page's studio-authored
  // content -- only this page's own fixed copy.
  artistPublic: {
    notFoundHeading: "This page isn't available",
    notFoundBody: 'The artist may not have published a page here, or the link is out of date.',
    eyebrow: 'Artist Profile',
    whereToFindMe: 'Where to find me',
    homeStudio: 'Home studio',
    guestResidency: 'Guest residency',
    openInMaps: 'Open address in Maps',
    bookButton: 'Book',
    flashButton: 'Flash',
    letsConnect: "Let's connect",
    bookPickerPrompt: 'Where would you like to book?',
    homeStudioSuffix: '(home studio)',
  },

  common: {
    loading: 'Loading…',
    somethingWentWrong: 'Something went wrong. Please try again.',
    linkInvalidHeading: 'This link is invalid',
    linkExpiredHeading: 'This link has expired',
    linkSupersededHeading: 'A newer link was sent',
    pleaseCheckMessagesForNewestLink: 'Please check your messages for the newest link.',
    privacyPolicy: 'Privacy Policy',
    termsAndConditions: 'Terms & Conditions',
    terms: 'Terms',
    and: 'and',
    signBelow: 'Sign below',
    clear: 'Clear',
    pleaseSignBeforeSubmitting: 'Please sign before submitting.',
  },

  deposit: {
    linkExpiredBody: 'Please contact the studio to request a new deposit form.',
    // Deposit confirmation enrichment (main, post-branch-cut): state-aware
    // now that the appointment card right below carries the real state --
    // paying a deposit doesn't always produce a real appointment (a
    // scheduling conflict re-checked at payment time can leave it
    // unbooked), so this line only claims what's universally true.
    paidHeadingStripe: 'Thank you!',
    paidHeadingManual: 'The studio has recorded your payment.',
    paidHeading: 'Thanks — your deposit is paid!',
    shareReferralHeading: "Know someone else who'd love this?",
    shareReferralBody: "Share your referral code — when a friend you refer pays their own deposit, you'll earn a reward.",
    confirmingPayment: 'Confirming your payment…',
    confirmingPaymentBody: 'This should only take a moment.',
    agreementSignedHeading: 'Deposit Agreement Signed',
    agreementSignedBody: '{{firstName}}, your agreement is on file. Pay your deposit below to confirm your appointment.',
    depositLabel: 'Deposit',
    feeLabel: 'Fee',
    totalLabel: 'Total',
    redirecting: 'Redirecting…',
    payAmount: 'Pay {{amount}}',
    receivedNoPaymentHeading: "Thanks — you're all set!",
    receivedNoPaymentBody:
      'Your signed deposit form has been received. No payment has been collected yet — the studio will reach out to collect your deposit and confirm your appointment.',
    agreementHeading: 'Deposit Agreement',
    agreementIntro: '{{firstName}}, please review and sign below to confirm your appointment{{withArtist}}.',
    withArtistSuffix: ' with {{artistName}}',
    appointmentLabel: 'Appointment',
    tentativeTimeLabel: 'Tentative Time',
    tentativeTimeBody:
      "Your appointment will be tentatively scheduled for {{range}}, pending your deposit. We'll confirm exact scheduling once payment is received.",
    sessionOf: 'Session {{n}} of {{total}}',
    estimatedHours: 'Estimated {{min}}-{{max}} hours',
    pleaseReadAndAgree: 'Please read and agree to each term:',
    typeFullName: 'Type your full name',
    submitting: 'Submitting…',
    signAndConfirm: 'Sign and Confirm',
    pleaseAgreeToEveryTerm: 'Please agree to every term before signing.',
    pleaseTypeFullName: 'Please type your full name.',
    // Finding 1 (Part 1 review decision): these are platform-owned copy
    // shipped over the API as if it were studio content -- see
    // routes/deposits.ts's own TERMS array comment. Keyed here by the
    // exact same `key` field the API's terms[] entries carry, so the
    // frontend looks up display text by key instead of trusting the
    // API's (English-only) label field. Order matches TERMS exactly.
    terms: {
      agreedNonRefundable:
        'A deposit is required to set an appointment. Deposits are non-refundable and are applied to the final price of the tattoo.',
      agreedLatePolicy:
        'Artists reserve the right to reschedule the appointment if the client is more than 15 minutes late without notification.',
      agreedNoShowForfeit: 'A no-call/no-show forfeits the deposit. A 48-hour notice is required to change a scheduled appointment.',
      agreedNewDepositAfterNoShow: 'After a no-call/no-show, a new deposit is required to set up another appointment.',
      agreedRescheduleLimit: 'Appointments may be rescheduled up to 3 times; the deposit is forfeited on the 3rd reschedule.',
      agreedExpiration: 'Deposits expire one year after the date they were created.',
      agreedIdAndVoucher: 'Client must bring a government-issued ID and the Deposit Voucher (issued after payment) on the day of the appointment.',
      agreedAge18: 'Client reconfirms they are at least 18 years of age.',
    },
    // Deposit confirmation enrichment (main, post-branch-cut): shipped in
    // English only -- see components/payments/DepositAppointmentCard.tsx
    // and DepositGiftCardCard.tsx for where these are consumed.
    appointmentCard: {
      label: 'Your appointment',
      notScheduledHeading: 'Not yet scheduled',
      notScheduledBody:
        "{{studioName}} will reach out to lock in a time that works{{withArtist}}. You don't need to do anything else right now.",
      addToCalendar: 'Add to Calendar (.ics)',
      googleCalendar: 'Google Calendar',
      // Embedded into the downloaded .ics file / Google Calendar link, not
      // rendered as page UI -- still user-facing (lands in the client's
      // own calendar app), so translated the same as everything else here.
      eventTitle: 'Tattoo session{{withArtist}} — {{studioName}}',
      // Payment Received refinements: the address link's own accessible
      // name -- the visible text is the address itself (not translatable
      // content), so screen readers need this instead to know what tapping
      // it does.
      openInMaps: 'Open address in Maps',
    },
    giftCardCard: {
      label: 'Your deposit voucher',
      showQrAtStudio: 'Show this QR code at the studio.',
      validUntil: 'Valid until {{date}}',
    },
  },

  // Prepay + On-Hold epic, Part 2: a deliberately PARTIAL mirror of
  // `deposit` above, not a full duplicate -- only the keys whose text
  // actually says "deposit" get an override here (see DepositResponse.tsx's
  // own pt() helper, which falls back to the `deposit` namespace for
  // every key without one). agreedLatePolicy/agreedAge18 never mention
  // "deposit" at all, so they're absent from `terms` below on purpose.
  prepay: {
    linkExpiredBody: 'Please contact the studio to request a new prepayment form.',
    paidHeading: 'Thanks — your prepayment is paid!',
    agreementSignedHeading: 'Prepayment Agreement Signed',
    agreementSignedBody: '{{firstName}}, your agreement is on file. Complete your prepayment below to confirm your appointment.',
    amountLabel: 'Prepayment',
    receivedNoPaymentBody:
      'Your signed prepayment form has been received. No payment has been collected yet — the studio will reach out to collect your prepayment and confirm your appointment.',
    agreementHeading: 'Prepayment Agreement',
    tentativeTimeBody:
      "Your appointment will be tentatively scheduled for {{range}}, pending your prepayment. We'll confirm exact scheduling once payment is received.",
    voucherLabel: 'Your prepayment voucher',
    terms: {
      agreedNonRefundable:
        'Full prepayment is required to set an appointment. Prepayments are non-refundable and are applied to the final price of the tattoo.',
      agreedNoShowForfeit: 'A no-call/no-show forfeits the prepayment. A 48-hour notice is required to change a scheduled appointment.',
      agreedNewDepositAfterNoShow: 'After a no-call/no-show, a new prepayment is required to set up another appointment.',
      agreedRescheduleLimit: 'Appointments may be rescheduled up to 3 times; the prepayment is forfeited on the 3rd reschedule.',
      agreedExpiration: 'Prepayments expire one year after the date they were created.',
      agreedIdAndVoucher:
        'Client must bring a government-issued ID and the Prepayment Voucher (issued after payment) on the day of the appointment.',
    },
  },

  estimate: {
    contactStudioForNewEstimate: 'Please contact the studio to request a new estimate.',
    alreadyBookedHeading: "You're all set, {{firstName}}!",
    alreadyBookedBody: "You've already booked your appointment with {{studioName}}. They'll be in touch if anything changes.",
    proceedHeading: "Thanks — let's get you scheduled!",
    proceedBody: "We've let the studio know you're ready to move forward. They'll be in touch to schedule your appointment.",
    budgetHeading: 'Thanks for letting us know',
    budgetBody: "We've passed your budget along to the studio — they'll follow up with revised options.",
    declineHeading: "We're sorry to see you go",
    declineBody: 'Thanks for considering us. If anything changes, feel free to reach back out.',
    pageHeading: 'Your Tattoo Estimate',
    intro: "{{firstName}}, here's what {{artistName}} put together for you.",
    defaultArtistName: 'your artist',
    priceRangeLabel: 'Price range',
    priceLabel: 'Price',
    estimatedTimeLabel: 'Estimated time',
    // First real word-form-selection case in this dictionary (see en.ts's
    // own module comment) -- an hour RANGE ("2–3 hours") is always plural
    // in both languages regardless of the numbers involved, so only the
    // single-number case (min === max) needs to pick between these two.
    hourSingular: 'hour',
    hourPlural: 'hours',
    toBeDiscussed: 'To be discussed',
    sessionPlan: '{{n}}-session plan',
    sessionLabel: 'Session {{n}}',
    termsHeading: 'Terms & Conditions',
    submitting: 'Submitting…',
    proceedButton: "Proceed — I'm in!",
    budgetPrompt: 'What budget would work for you?',
    budgetPlaceholder: 'e.g. $200-300',
    sendBudget: 'Send my budget',
    declinePrompt: 'This is a bit more than I expected',
    notMovingForward: "No thanks, I'm not moving forward",
    pleaseProvideBudget: 'Please let us know what budget would work for you.',
    // Finding 1 (Part 1 review decision): platform-owned, hardcoded in
    // routes/estimates.ts as COLLABORATIVE_DESIGN_POLICY -- same
    // treatment as deposit.terms above, not studio content.
    collaborativeDesignPolicy:
      'No design is drawn in advance — it is created together with the client on the day of the appointment.',
  },

  estimateRevision: {
    invalidBody: 'Please contact the studio if you have questions.',
    confirmedHeading: 'Thanks for confirming!',
    confirmedBody: "We've let the studio know you're good with the updated estimate.",
    concernHeading: 'Thanks for letting us know',
    concernBody: "We've flagged your concern for the studio -- they'll follow up with you directly.",
    pageHeading: 'Your Estimate Has Been Updated',
    intro: "{{firstName}}, here's the updated estimate for your project.",
    whyThisChanged: 'Why this changed',
    submitting: 'Submitting…',
    approveButton: 'I approve this change',
    concernButton: 'I have a concern about this',
  },

  waiver: {
    linkUnavailableHeading: "This link isn't available",
    linkUnavailableBody: 'Please ask the front desk for a new link.',
    receivedHeading: "Thanks — you're all set!",
    receivedBody: 'Your waiver has been received. Please have your government ID ready for the front desk to verify.',
    pageHeading: 'Liability Waiver',
    appointmentRange: 'Appointment: {{start}} – {{end}}',
    personalDetails: 'Personal details',
    legalName: 'Legal name *',
    dateOfBirth: 'Date of birth *',
    ageRequirement: 'You must be 18 or older to be tattooed in North Carolina.',
    emergencyContactName: 'Emergency contact name *',
    emergencyContactPhone: 'Emergency contact phone *',
    healthScreening: 'Health screening',
    explainPlaceholder: 'Please explain',
    photoId: 'Photo ID',
    photoIdHint: 'Take or upload a clear photo of your government-issued ID.',
    changePhoto: 'Change photo',
    uploadIdPhoto: 'Upload ID photo',
    uploading: 'Uploading…',
    uploadFailed: 'Upload failed',
    readAndInitial: 'Please read and initial each clause',
    initials: 'Initials *',
    acknowledgment: 'Acknowledgment',
    signatureLabel: 'Signature — type your full legal name *',
    signBelowRequired: 'Sign below *',
    photoReleaseHeading: 'Photo/video release (optional)',
    photoReleaseHint: 'Optional — you may decline without affecting your appointment.',
    photoReleaseAgree: 'I agree to the photo/video release above',
    photoReleaseSignatureLabel: 'Signature for photo release *',
    submitting: 'Submitting…',
    signWaiver: 'Sign Waiver',
    pleaseCompleteEveryField: 'Please complete every required field before signing.',
    pleaseSignPhotoRelease: 'Please sign the photo/video release before submitting.',
  },

  selfSchedule: {
    invalidBodyByKind: {
      invalid: 'Please check your messages for the newest link.',
      expired: 'Please contact the studio to schedule your appointment.',
      superseded: 'Please check your messages for the newest link.',
    },
    alreadyBookedHeading: "You're all set, {{firstName}}!",
    alreadyBookedBody: "You've already booked your appointment with {{studioName}}. They'll be in touch if anything changes.",
    requestSentHeading: 'Request sent!',
    requestSentBody: "You've requested {{range}}. The studio will confirm this time shortly -- it's not booked yet, so keep an eye out for a message from them.",
    pageHeading: 'Pick a time',
    intro: "{{firstName}}, here's {{artistName}}'s real availability.",
    noOpenTimes: 'No open times found right now -- please contact the studio directly to schedule.',
    chooseDate: 'Choose a date',
    availableTimesOn: 'Available times on {{date}}',
    loadingTimes: 'Loading times…',
    failedToLoadTimes: 'Failed to load times for this date',
    noOpenTimesOnDate: 'No open times left on this date -- please pick another.',
    requestDisclaimer: "Picking a time sends a request to {{studioName}} -- it's not a confirmed booking until they get back to you.",
    requesting: 'Requesting…',
    requestThisTime: 'Request this time',
  },

  flashGallery: {
    unavailableHeading: "This gallery isn't available",
    unavailableDefault: 'This gallery is unavailable.',
    requestSentHeading: 'Request sent!',
    requestSentBody: "{{studioName}} will review your placement and get back to you shortly to confirm and collect payment -- this isn't booked yet.",
    requestSentBodyInstant: "Your payment link is on its way -- pay to lock in your booking and pick a time.",
    titleFirst: 'Flash',
    titleSecond: 'Gallery',
    currentlyAt: 'Currently at {{studioName}}',
    openInMaps: 'Open address in Maps',
    introStudioWide: 'Ready-to-book designs at {{studioName}}.',
    noPiecesAvailable: 'No flash pieces are available right now.',
    bookThisDesign: 'Book This Design',
    viewFullSize: 'View {{title}} full size',
    oneOfOne: 'One of one',
    backToGallery: '← Back to gallery',
    requestTitle: 'Request "{{title}}"',
    durationApprox: '~{{duration}}',
    oneOfOneFirstRequestWins: '· One of one -- first request wins',
    phoneNumber: 'Your phone number *',
    continueButton: 'Continue',
    checking: 'Checking…',
    welcomeBack: 'Welcome back, {{firstName}}!',
    firstName: 'First name *',
    lastName: 'Last name *',
    email: 'Email *',
    placementPrompt: 'Where would you like this placed? *',
    placementPlaceholder: 'e.g. outer left forearm',
    placementPhotoLabel: 'Photo of the placement area *',
    placementPhotoHint: 'A photo of the area so the artist can plan sizing/placement.',
    sending: 'Sending…',
    sendRequest: 'Send request',
    enterCompletePhoneNumber: 'Enter a complete 10-digit phone number.',
    pleaseDescribePlacement: "Please describe where you'd like this placed.",
    pleaseAddPlacementPhoto: 'Please add a photo of the placement area.',
    pleaseFillNameAndEmail: 'Please fill in your name and email.',
  },

  flashPayment: {
    linkExpiredBody: 'Please contact the studio to request a new payment link.',
    confirmingPayment: 'Confirming your payment…',
    confirmingPaymentBody: 'This should only take a moment.',
    paymentReceivedHeading: 'Payment received',
    paymentReceivedBody: "Your flash booking is locked in -- taking you to pick a time now.",
    pageHeading: 'Complete your flash booking',
    intro: 'Hi {{firstName}}, your request for "{{pieceTitle}}" was approved by {{studioName}}. Pay in full below to lock in your booking and pick a time.',
    paymentUnavailable: "Online payment isn't available for this studio right now -- please contact them directly to complete payment.",
    redirecting: 'Redirecting…',
    payAmount: 'Pay {{amount}}',
    payNow: 'Pay now',
  },

  intake: {
    studioNotFoundHeading: "We couldn't find this studio",
    studioNotFoundBody: 'Please double-check the link you were given, or contact the studio directly.',
    submittedHeading: 'Thanks — your inquiry is in!',
    submittedBody: "We've received your submission and someone from the studio will reach out soon.",
    pageHeading: 'Tattoo Inquiry',
    intro: 'Tell us about the tattoo you have in mind.',
    ageDisclosure:
      'You must be 18 years or older to receive a tattoo. Submitting this form does not confirm an appointment — it starts a conversation with the studio.',
    firstName: 'First name',
    lastName: 'Last name',
    colorOption: 'Color',
    blackAndGreyOption: 'Black & Grey',
    yesOption: 'Yes',
    noOption: 'No',
    selectOne: 'Select one',
    referralSourceEmail: 'Email',
    referralSourceInstagram: 'Instagram',
    referralSourceFacebook: 'Facebook',
    referralSourceFriend: 'A friend referred me',
    friendReferralCode: "Friend's referral code *",
    friendReferralCodePlaceholder: 'e.g. AB23CDE',
    placementPlaceholder: 'e.g. forearm, left side',
    sizePlaceholder: 'e.g. palm-sized',
    timingPlaceholder: 'e.g. within a month',
    noPreference: 'No preference',
    referenceImagesHint: 'Photos or designs that show the style you are going for.',
    placementPhotoHint: 'A photo of the area where you want the tattoo.',
    smsConsentDefault:
      'By providing your phone number, you consent to receive SMS messages about your inquiry and appointment. Message frequency varies. Message and data rates may apply. Reply STOP to opt out.',
    seeOurPrivacyAndTerms: 'See our',
    smsOptInBody:
      'I agree to receive text messages from {{studioName}} regarding my appointment, including reminders, estimate follow-ups, and updates. Message frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP for help.',
    viewOurPrivacyAndTerms: 'View our',
    smsOptInDefaultStudioName: 'the studio',
    pleaseAgreeToSms: 'Please agree to receive text messages to submit this form.',
    submitting: 'Submitting…',
    submitInquiry: 'Submit inquiry',
    pleaseFillRequiredFields: 'Please fill out all required fields.',
    enterCompletePhoneOrBlank: 'Enter a complete 10-digit phone number, or leave it blank.',
    pleaseWaitForPhotos: 'Please wait for your photos to finish uploading.',
    pleaseAddReferenceImage: 'Please add at least one reference image.',
    pleaseAddPlacementPhoto: 'Please add at least one placement photo.',
    pleaseAnswer: 'Please answer: {{fieldLabel}}',
  },
};
