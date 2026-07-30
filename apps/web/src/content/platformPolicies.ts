// Ink Manager's own platform-level Privacy Policy / Terms & Conditions --
// distinct from the per-Studio policy fields PublicPolicyPage.tsx renders
// (StudioSettings.privacyPolicy/termsAndConditions, studio-authored, one
// per Studio). This is fixed, developer-authored copy describing Ink
// Manager itself, so it lives as a plain HTML-string constant here rather
// than a database field -- there's nothing for a Studio to author.
//
// Canonical source: ./privacy-policy-platform.md and ./terms-platform.md,
// in this same directory -- the actual markdown drafts this HTML is
// hand-converted from. Neither file is imported/parsed at build or
// render time (this HTML is what genuinely renders, both here and in
// scripts/generate-static-policies.mjs's static /privacy and /terms
// output -- see that script's own header comment) -- they exist so a
// canonical, diffable, checked-in draft actually exists at all. Previously
// there was no such file anywhere in the repo, only this hand-authored
// HTML with no reference to check it against; the live /privacy page
// drifted from the real canonical draft as a direct result (a carrier-
// compliance SMS-consent disclosure existed in the actual published
// policy but not here, undetected until an explicit audit). Any future
// change to either policy's wording: edit the .md file first, then
// hand-convert the change into the matching HTML constant below --
// keep them in sync, since nothing enforces that automatically.
//
// Still passed through sanitizeHtml() at render time (see
// PlatformPolicyPage.tsx) and restricted to sanitizeHtml's own allowed-tag
// list (p, br, strong, em, u, ul, ol, li, a, h2, h3) even though this
// content is trusted/hardcoded, not user input -- reusing the exact same
// render path as every other policy page on this site rather than a
// second one-off mechanism.
//
// Last updated 2026-07-28. Governing law (Terms) is North Carolina per
// Ink Manager's own instruction for this draft.

export const PLATFORM_PRIVACY_POLICY_HTML = `
<p><strong>Last updated: July 28, 2026</strong></p>

<h2>Who we are</h2>
<p>Ink Manager ("Ink Manager," "we," "us," or "our") is a software platform used by tattoo and permanent makeup studios ("Studios") to manage client inquiries, scheduling, deposits, waivers, and communications. If you're a client of a Studio using Ink Manager, this policy explains how we handle information collected through the platform on the Studio's behalf.</p>

<h2>Information we collect</h2>
<p>Depending on how you interact with a Studio through Ink Manager, we may collect:</p>
<ul>
<li><strong>Contact information</strong>: name, phone number, email address, mailing address.</li>
<li><strong>Project details</strong>: tattoo or permanent makeup descriptions, placement, size, reference images, budget, and related preferences you submit through an intake form.</li>
<li><strong>Scheduling and payment information</strong>: appointment times, deposit amounts, and payment records processed through our payment provider (Stripe). We do not store full payment card numbers ourselves.</li>
<li><strong>Health and identity information</strong>: where required by a Studio's liability waiver process, health screening answers, government-issued ID images, date of birth, and signature data.</li>
<li><strong>Communications</strong>: the content of messages you exchange with a Studio through the platform (SMS, email, or other supported channels), and metadata about those messages (timestamps, delivery status).</li>
</ul>

<h2>How we use this information</h2>
<p>We use the information above to:</p>
<ul>
<li>Operate the intake, estimate, scheduling, deposit, and waiver process on behalf of the Studio you're working with.</li>
<li>Send you appointment-related communications: confirmations, reminders, estimate and deposit requests, and responses to messages you send.</li>
<li>Process deposit and service payments through our payment provider.</li>
<li>Verify identity and collect health/consent information where a Studio's process requires it before a scheduled service.</li>
<li>Maintain records the Studio may need for its own business and legal purposes.</li>
</ul>
<p>We do not sell your personal information, and we do not use it for advertising unrelated to the Studio's own services.</p>

<h2>SMS and email communications</h2>
<p>If you provide a phone number or email address to a Studio through Ink Manager, you may receive transactional messages related to your inquiry or appointment &mdash; for example, estimate notifications, deposit requests, and appointment reminders.</p>
<ul>
<li><strong>Consent</strong>: these messages are sent only after you've provided your contact information through an intake form or a similar Studio-initiated process, and message frequency will vary based on your activity with the Studio.</li>
<li><strong>Message and data rates</strong> may apply based on your carrier plan.</li>
<li><strong>Opting out</strong>: reply <strong>STOP</strong> at any time to stop receiving SMS messages. Reply <strong>HELP</strong> for assistance. You can also ask the Studio directly to stop contacting you by a given channel.</li>
<li>Opting out of SMS does not opt you out of email, and vice versa &mdash; each channel is managed separately.</li>
</ul>
<p>No mobile information will be shared with third parties or affiliates for marketing or promotional purposes. Text messaging originator opt-in data and consent will not be shared with any third parties, excluding the messaging providers necessary to deliver messages on our behalf.</p>

<h2>Who we share information with</h2>
<ul>
<li><strong>The Studio you're interacting with</strong> &mdash; they are the primary party responsible for your service and will have access to the information you submit.</li>
<li><strong>Service providers</strong> who help us operate the platform, including our payment processor (Stripe) and messaging providers, solely to the extent necessary to provide those services.</li>
<li>We do not share your information with third parties for their own marketing purposes. No mobile information will be shared with third parties or affiliates for marketing or promotional purposes, and text messaging originator opt-in data and consent will not be shared with any third parties.</li>
</ul>

<h2>Data retention and security</h2>
<p>We retain information for as long as necessary to support the Studio's business, legal, and record-keeping needs, or as required by law. We use reasonable technical and organizational measures &mdash; including encryption of sensitive credentials and access controls &mdash; to protect the information we handle, though no system can guarantee absolute security.</p>

<h2>Your rights</h2>
<p>You can ask a Studio, or contact us directly, to access, correct, or request deletion of your information, subject to any legal or business record-keeping requirements that may limit deletion (for example, waiver and payment records a Studio is required to retain).</p>

<h2>Age requirement</h2>
<p>Our platform's intake and waiver processes are intended for individuals who are 18 years of age or older, consistent with the age requirements Studios themselves apply to their services.</p>

<h2>Changes to this policy</h2>
<p>We may update this policy from time to time. Material changes will be reflected by updating the "Last updated" date above.</p>

<h2>Contact us</h2>
<p>Questions about this policy can be directed to <a href="mailto:juan.lazo@inkmanager.app">juan.lazo@inkmanager.app</a>.</p>
`.trim()

export const PLATFORM_TERMS_HTML = `
<p><strong>Last updated: July 28, 2026</strong></p>

<h2>About Ink Manager</h2>
<p>Ink Manager ("Ink Manager," "we," "us," or "our") provides software used by tattoo and permanent makeup studios ("Studios") to manage inquiries, scheduling, deposits, waivers, and client communications. These Terms govern your use of the public-facing parts of our platform &mdash; intake forms, estimate responses, deposit and payment pages, and waiver signing &mdash; when interacting with a Studio that uses Ink Manager.</p>
<p><strong>Ink Manager is a software provider, not the Studio performing your tattoo or permanent makeup service.</strong> The Studio you're working with is solely responsible for the services they provide, their pricing, scheduling decisions, and the quality and safety of the work performed. These Terms don't replace or override any separate policies (such as deposit or refund terms) that a Studio communicates to you directly.</p>

<h2>Eligibility</h2>
<p>You must be at least 18 years old to submit an inquiry, sign a waiver, or otherwise use these public-facing pages, consistent with the age requirements Studios apply to tattoo and permanent makeup services generally.</p>

<h2>Acceptance of these terms</h2>
<p>By submitting an intake form, responding to an estimate, paying a deposit, or signing a waiver through the platform, you agree to these Terms and to our Privacy Policy.</p>

<h2>Payments and deposits</h2>
<p>Deposit and service payments made through the platform are processed by our payment provider, Stripe. Deposit amounts, refund conditions, and rescheduling policies are set by the individual Studio, not by Ink Manager &mdash; refer to the specific terms presented to you by the Studio at the time of payment for those details.</p>

<h2>SMS and email communications</h2>
<p>If you provide a phone number or email address through the platform, you may receive transactional messages related to your inquiry or appointment. Message frequency varies. Message and data rates may apply. Reply <strong>STOP</strong> to stop receiving SMS messages at any time, or <strong>HELP</strong> for assistance. See our Privacy Policy for more detail on how we handle your contact information.</p>

<h2>Waivers and health information</h2>
<p>Where a Studio requires a liability waiver, health screening, or identity verification before your appointment, the information you provide is collected on the Studio's behalf and is subject to the Studio's own waiver terms in addition to this policy.</p>

<h2>Limitation of liability</h2>
<p>Ink Manager provides the software platform used to facilitate communication and scheduling between you and a Studio. We are not responsible for the tattoo, permanent makeup, or other services performed by a Studio, for the accuracy of estimates or pricing a Studio provides, or for disputes between you and a Studio. To the fullest extent permitted by law, Ink Manager's liability arising from your use of the platform is limited to the extent required by applicable law.</p>

<h2>Changes to these terms</h2>
<p>We may update these Terms from time to time. Material changes will be reflected by updating the "Last updated" date above. Continued use of the platform after changes take effect constitutes acceptance of the updated Terms.</p>

<h2>Governing law</h2>
<p>These Terms are governed by the laws of the State of North Carolina, United States, without regard to its conflict-of-laws principles.</p>

<h2>Contact us</h2>
<p>Questions about these Terms can be directed to <a href="mailto:juan.lazo@inkmanager.app">juan.lazo@inkmanager.app</a>.</p>
`.trim()
