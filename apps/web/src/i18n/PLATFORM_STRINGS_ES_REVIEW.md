# Platform Spanish strings — review pass needed before merge

**Status: DRAFT, machine-generated from source.** Every Spanish string below (`apps/web/src/i18n/strings/es.ts`,
`apps/api/src/lib/pdfStrings.ts`'s `ES` dictionary, `apps/api/src/routes/deposits.ts`'s `TERMS_ES`,
`apps/api/src/lib/contentTranslation.ts`'s `SYSTEM_FIELD_DEFAULTS_ES`) was written as a professional first
draft, not machine-translated, but has **not** had a native-speaker review pass. This document is generated
directly from those four source files (`scripts/generate-es-review.ts`) rather than hand-copied, so it can
never drift out of sync the way a manually-maintained snapshot can. Once reviewed, corrections go back into
the four source files directly and this doc gets regenerated -- it is not itself a source of truth.

A `**MISSING**` cell means the key exists in the English dictionary but has no Spanish counterpart --
should never appear once the source files are consistent (the frontend dictionaries are compile-time
enforced via `es: typeof en`; the three backend dictionaries are not, so this doc doubles as their only
completeness check).

## Conventions used throughout (flag if any of these should change)

- **Register**: informal "tú," not formal "usted" — matches the casual, friendly tone of the English
  original (e.g. "Hi {{firstName}}," "Let's get you scheduled!").
- **Dialect**: neutral, broadly-understandable Spanish aimed at a US Hispanic audience (not Spain-specific
  vocabulary or "vosotros" conjugations) — consistent with this app's US-only scope (10-digit phone
  validation, North Carolina-specific legal text, `es-US` date formatting).
- **Punctuation**: inverted question/exclamation marks (¿...?, ¡...!) used per standard Spanish orthography,
  even though the English original doesn't have an opening mark.
- **Placeholders**: every `{{var}}` token must appear in the Spanish string in the same form, unchanged —
  these are substituted programmatically, not part of the reviewable prose itself.

## Frontend platform strings (`apps/web/src/i18n/strings/es.ts`)

### common

| Key | English | Spanish (draft) |
|---|---|---|
| loading | Loading… | Cargando… |
| somethingWentWrong | Something went wrong. Please try again. | Algo salió mal. Por favor, inténtalo de nuevo. |
| linkInvalidHeading | This link is invalid | Este enlace no es válido |
| linkExpiredHeading | This link has expired | Este enlace ha vencido |
| linkSupersededHeading | A newer link was sent | Se envió un enlace más reciente |
| pleaseCheckMessagesForNewestLink | Please check your messages for the newest link. | Por favor, revisa tus mensajes para encontrar el enlace más reciente. |
| privacyPolicy | Privacy Policy | Política de Privacidad |
| termsAndConditions | Terms & Conditions | Términos y Condiciones |
| terms | Terms | Términos |
| and | and | y |
| signBelow | Sign below | Firma aquí abajo |
| clear | Clear | Borrar |
| pleaseSignBeforeSubmitting | Please sign before submitting. | Por favor, firma antes de enviar. |

### deposit

| Key | English | Spanish (draft) |
|---|---|---|
| linkExpiredBody | Please contact the studio to request a new deposit form. | Por favor, contacta al estudio para solicitar un nuevo formulario de depósito. |
| paidHeadingStripe | Thank you! | ¡Gracias! |
| paidHeadingManual | The studio has recorded your payment. | El estudio ha registrado tu pago. |
| paidHeading | Thanks — your deposit is paid! | ¡Gracias — tu depósito está pagado! |
| shareReferralHeading | Know someone else who'd love this? | ¿Conoces a alguien más a quien le encantaría esto? |
| shareReferralBody | Share your referral code — when a friend you refer pays their own deposit, you'll earn a reward. | Comparte tu código de referido — cuando un amigo que refieras pague su propio depósito, ganarás una recompensa. |
| confirmingPayment | Confirming your payment… | Confirmando tu pago… |
| confirmingPaymentBody | This should only take a moment. | Esto solo tomará un momento. |
| agreementSignedHeading | Deposit Agreement Signed | Acuerdo de Depósito Firmado |
| agreementSignedBody | {{firstName}}, your agreement is on file. Pay your deposit below to confirm your appointment. | {{firstName}}, tu acuerdo está registrado. Paga tu depósito a continuación para confirmar tu cita. |
| depositLabel | Deposit | Depósito |
| feeLabel | Fee | Cargo |
| totalLabel | Total | Total |
| redirecting | Redirecting… | Redirigiendo… |
| payAmount | Pay {{amount}} | Pagar {{amount}} |
| receivedNoPaymentHeading | Thanks — you're all set! | ¡Gracias — ya está todo listo! |
| receivedNoPaymentBody | Your signed deposit form has been received. No payment has been collected yet — the studio will reach out to collect your deposit and confirm your appointment. | Hemos recibido tu formulario de depósito firmado. Aún no se ha cobrado ningún pago — el estudio se pondrá en contacto contigo para cobrar tu depósito y confirmar tu cita. |
| agreementHeading | Deposit Agreement | Acuerdo de Depósito |
| agreementIntro | {{firstName}}, please review and sign below to confirm your appointment{{withArtist}}. | {{firstName}}, por favor revisa y firma a continuación para confirmar tu cita{{withArtist}}. |
| withArtistSuffix | " with {{artistName}}" | " con {{artistName}}" |
| appointmentLabel | Appointment | Cita |
| tentativeTimeLabel | Tentative Time | Horario Tentativo |
| tentativeTimeBody | Your appointment will be tentatively scheduled for {{range}}, pending your deposit. We'll confirm exact scheduling once payment is received. | Tu cita se programará provisionalmente para el {{range}}, sujeto a tu depósito. Confirmaremos el horario exacto una vez recibido el pago. |
| sessionOf | Session {{n}} of {{total}} | Sesión {{n}} de {{total}} |
| estimatedHours | Estimated {{min}}-{{max}} hours | Estimado de {{min}}-{{max}} horas |
| pleaseReadAndAgree | Please read and agree to each term: | Por favor, lee y acepta cada término: |
| typeFullName | Type your full name | Escribe tu nombre completo |
| submitting | Submitting… | Enviando… |
| signAndConfirm | Sign and Confirm | Firmar y Confirmar |
| pleaseAgreeToEveryTerm | Please agree to every term before signing. | Por favor, acepta cada término antes de firmar. |
| pleaseTypeFullName | Please type your full name. | Por favor, escribe tu nombre completo. |
| terms.agreedNonRefundable | A deposit is required to set an appointment. Deposits are non-refundable and are applied to the final price of the tattoo. | Se requiere un depósito para fijar una cita. Los depósitos no son reembolsables y se aplican al precio final del tatuaje. |
| terms.agreedLatePolicy | Artists reserve the right to reschedule the appointment if the client is more than 15 minutes late without notification. | Los artistas se reservan el derecho de reprogramar la cita si el cliente llega con más de 15 minutos de retraso sin previo aviso. |
| terms.agreedNoShowForfeit | A no-call/no-show forfeits the deposit. A 48-hour notice is required to change a scheduled appointment. | La falta de asistencia sin aviso previo resulta en la pérdida del depósito. Se requiere un aviso de 48 horas para cambiar una cita programada. |
| terms.agreedNewDepositAfterNoShow | After a no-call/no-show, a new deposit is required to set up another appointment. | Después de una falta de asistencia sin aviso previo, se requiere un nuevo depósito para programar otra cita. |
| terms.agreedRescheduleLimit | Appointments may be rescheduled up to 3 times; the deposit is forfeited on the 3rd reschedule. | Las citas pueden reprogramarse hasta 3 veces; el depósito se pierde en la tercera reprogramación. |
| terms.agreedExpiration | Deposits expire one year after the date they were created. | Los depósitos vencen un año después de la fecha en que fueron creados. |
| terms.agreedIdAndVoucher | Client must bring a government-issued ID and the Deposit Voucher (issued after payment) on the day of the appointment. | El cliente debe traer una identificación oficial con fotografía y el comprobante de depósito (emitido después del pago) el día de la cita. |
| terms.agreedAge18 | Client reconfirms they are at least 18 years of age. | El cliente reconfirma que tiene al menos 18 años de edad. |
| appointmentCard.label | Your appointment | Tu cita |
| appointmentCard.notScheduledHeading | Not yet scheduled | Aún no programada |
| appointmentCard.notScheduledBody | {{studioName}} will reach out to lock in a time that works{{withArtist}}. You don't need to do anything else right now. | {{studioName}} se pondrá en contacto para coordinar un horario que te funcione{{withArtist}}. No necesitas hacer nada más por ahora. |
| appointmentCard.addToCalendar | Add to Calendar (.ics) | Agregar al calendario (.ics) |
| appointmentCard.googleCalendar | Google Calendar | Google Calendar |
| appointmentCard.eventTitle | Tattoo session{{withArtist}} — {{studioName}} | Sesión de tatuaje{{withArtist}} — {{studioName}} |
| appointmentCard.openInMaps | Open address in Maps | Abrir dirección en Maps |
| giftCardCard.label | Your deposit voucher | Tu comprobante de depósito |
| giftCardCard.showQrAtStudio | Show this QR code at the studio. | Muestra este código QR en el estudio. |
| giftCardCard.validUntil | Valid until {{date}} | Válido hasta {{date}} |

### estimate

| Key | English | Spanish (draft) |
|---|---|---|
| contactStudioForNewEstimate | Please contact the studio to request a new estimate. | Por favor, contacta al estudio para solicitar una nueva cotización. |
| alreadyBookedHeading | You're all set, {{firstName}}! | ¡Ya está todo listo, {{firstName}}! |
| alreadyBookedBody | You've already booked your appointment with {{studioName}}. They'll be in touch if anything changes. | Ya reservaste tu cita con {{studioName}}. Ellos se pondrán en contacto si algo cambia. |
| proceedHeading | Thanks — let's get you scheduled! | ¡Gracias — vamos a programar tu cita! |
| proceedBody | We've let the studio know you're ready to move forward. They'll be in touch to schedule your appointment. | Le hemos avisado al estudio que quieres continuar. Ellos se pondrán en contacto para programar tu cita. |
| budgetHeading | Thanks for letting us know | Gracias por avisarnos |
| budgetBody | We've passed your budget along to the studio — they'll follow up with revised options. | Hemos compartido tu presupuesto con el estudio — se pondrán en contacto contigo con opciones revisadas. |
| declineHeading | We're sorry to see you go | Lamentamos que no continúes |
| declineBody | Thanks for considering us. If anything changes, feel free to reach back out. | Gracias por considerarnos. Si algo cambia, no dudes en contactarnos de nuevo. |
| pageHeading | Your Tattoo Estimate | Tu Cotización de Tatuaje |
| intro | {{firstName}}, here's what {{artistName}} put together for you. | {{firstName}}, esto es lo que {{artistName}} preparó para ti. |
| defaultArtistName | your artist | tu artista |
| priceRangeLabel | Price range | Rango de precio |
| priceLabel | Price | Precio |
| estimatedTimeLabel | Estimated time | Tiempo estimado |
| hourSingular | hour | hora |
| hourPlural | hours | horas |
| toBeDiscussed | To be discussed | Por definir |
| sessionPlan | {{n}}-session plan | Plan de {{n}} sesiones |
| sessionLabel | Session {{n}} | Sesión {{n}} |
| termsHeading | Terms & Conditions | Términos y Condiciones |
| submitting | Submitting… | Enviando… |
| proceedButton | Proceed — I'm in! | ¡Continuar — cuenten conmigo! |
| budgetPrompt | What budget would work for you? | ¿Qué presupuesto funcionaría para ti? |
| budgetPlaceholder | e.g. $200-300 | ej. $200-300 |
| sendBudget | Send my budget | Enviar mi presupuesto |
| declinePrompt | This is a bit more than I expected | Esto es un poco más de lo que esperaba |
| notMovingForward | No thanks, I'm not moving forward | No, gracias, no voy a continuar |
| pleaseProvideBudget | Please let us know what budget would work for you. | Por favor, indícanos qué presupuesto funcionaría para ti. |
| collaborativeDesignPolicy | No design is drawn in advance — it is created together with the client on the day of the appointment. | Ningún diseño se dibuja con anticipación — se crea junto con el cliente el día de la cita. |

### estimateRevision

| Key | English | Spanish (draft) |
|---|---|---|
| invalidBody | Please contact the studio if you have questions. | Por favor, contacta al estudio si tienes preguntas. |
| confirmedHeading | Thanks for confirming! | ¡Gracias por confirmar! |
| confirmedBody | We've let the studio know you're good with the updated estimate. | Le hemos avisado al estudio que estás de acuerdo con la cotización actualizada. |
| concernHeading | Thanks for letting us know | Gracias por avisarnos |
| concernBody | We've flagged your concern for the studio -- they'll follow up with you directly. | Hemos notificado tu inquietud al estudio -- se pondrán en contacto contigo directamente. |
| pageHeading | Your Estimate Has Been Updated | Tu Cotización Ha Sido Actualizada |
| intro | {{firstName}}, here's the updated estimate for your project. | {{firstName}}, esta es la cotización actualizada de tu proyecto. |
| whyThisChanged | Why this changed | Por qué cambió esto |
| submitting | Submitting… | Enviando… |
| approveButton | I approve this change | Apruebo este cambio |
| concernButton | I have a concern about this | Tengo una inquietud sobre esto |

### waiver

| Key | English | Spanish (draft) |
|---|---|---|
| linkUnavailableHeading | This link isn't available | Este enlace no está disponible |
| linkUnavailableBody | Please ask the front desk for a new link. | Por favor, pide al mostrador un nuevo enlace. |
| receivedHeading | Thanks — you're all set! | ¡Gracias — ya está todo listo! |
| receivedBody | Your waiver has been received. Please have your government ID ready for the front desk to verify. | Hemos recibido tu exención de responsabilidad. Por favor, ten lista tu identificación oficial para que el mostrador la verifique. |
| pageHeading | Liability Waiver | Exención de Responsabilidad |
| appointmentRange | Appointment: {{start}} – {{end}} | Cita: {{start}} – {{end}} |
| personalDetails | Personal details | Datos personales |
| legalName | Legal name * | Nombre legal * |
| dateOfBirth | Date of birth * | Fecha de nacimiento * |
| ageRequirement | You must be 18 or older to be tattooed in North Carolina. | Debes tener 18 años o más para tatuarte en Carolina del Norte. |
| emergencyContactName | Emergency contact name * | Nombre del contacto de emergencia * |
| emergencyContactPhone | Emergency contact phone * | Teléfono del contacto de emergencia * |
| healthScreening | Health screening | Cuestionario de salud |
| explainPlaceholder | Please explain | Por favor, explica |
| photoId | Photo ID | Identificación con foto |
| photoIdHint | Take or upload a clear photo of your government-issued ID. | Toma o sube una foto clara de tu identificación oficial. |
| changePhoto | Change photo | Cambiar foto |
| uploadIdPhoto | Upload ID photo | Subir foto de identificación |
| uploading | Uploading… | Subiendo… |
| uploadFailed | Upload failed | Error al subir |
| readAndInitial | Please read and initial each clause | Por favor, lee e inicial cada cláusula |
| initials | Initials * | Iniciales * |
| acknowledgment | Acknowledgment | Reconocimiento |
| signatureLabel | Signature — type your full legal name * | Firma — escribe tu nombre legal completo * |
| signBelowRequired | Sign below * | Firma aquí abajo * |
| photoReleaseHeading | Photo/video release (optional) | Autorización de foto/video (opcional) |
| photoReleaseHint | Optional — you may decline without affecting your appointment. | Opcional — puedes rechazar sin que esto afecte tu cita. |
| photoReleaseAgree | I agree to the photo/video release above | Acepto la autorización de foto/video anterior |
| photoReleaseSignatureLabel | Signature for photo release * | Firma para la autorización de foto * |
| submitting | Submitting… | Enviando… |
| signWaiver | Sign Waiver | Firmar Exención |
| pleaseCompleteEveryField | Please complete every required field before signing. | Por favor, completa todos los campos requeridos antes de firmar. |
| pleaseSignPhotoRelease | Please sign the photo/video release before submitting. | Por favor, firma la autorización de foto/video antes de enviar. |

### selfSchedule

| Key | English | Spanish (draft) |
|---|---|---|
| invalidBodyByKind.invalid | Please check your messages for the newest link. | Por favor, revisa tus mensajes para encontrar el enlace más reciente. |
| invalidBodyByKind.expired | Please contact the studio to schedule your appointment. | Por favor, contacta al estudio para programar tu cita. |
| invalidBodyByKind.superseded | Please check your messages for the newest link. | Por favor, revisa tus mensajes para encontrar el enlace más reciente. |
| alreadyBookedHeading | You're all set, {{firstName}}! | ¡Ya está todo listo, {{firstName}}! |
| alreadyBookedBody | You've already booked your appointment with {{studioName}}. They'll be in touch if anything changes. | Ya reservaste tu cita con {{studioName}}. Ellos se pondrán en contacto si algo cambia. |
| requestSentHeading | Request sent! | ¡Solicitud enviada! |
| requestSentBody | You've requested {{range}}. The studio will confirm this time shortly -- it's not booked yet, so keep an eye out for a message from them. | Has solicitado el {{range}}. El estudio confirmará este horario en breve -- todavía no está reservado, así que espera un mensaje de su parte. |
| pageHeading | Pick a time | Elige un horario |
| intro | {{firstName}}, here's {{artistName}}'s real availability. | {{firstName}}, esta es la disponibilidad real de {{artistName}}. |
| noOpenTimes | No open times found right now -- please contact the studio directly to schedule. | No se encontraron horarios disponibles en este momento -- por favor, contacta al estudio directamente para programar tu cita. |
| chooseDate | Choose a date | Elige una fecha |
| availableTimesOn | Available times on {{date}} | Horarios disponibles el {{date}} |
| loadingTimes | Loading times… | Cargando horarios… |
| failedToLoadTimes | Failed to load times for this date | No se pudieron cargar los horarios para esta fecha |
| noOpenTimesOnDate | No open times left on this date -- please pick another. | No quedan horarios disponibles en esta fecha -- por favor, elige otra. |
| requestDisclaimer | Picking a time sends a request to {{studioName}} -- it's not a confirmed booking until they get back to you. | Al elegir un horario se envía una solicitud a {{studioName}} -- no es una reserva confirmada hasta que ellos te respondan. |
| requesting | Requesting… | Solicitando… |
| requestThisTime | Request this time | Solicitar este horario |

### flashGallery

| Key | English | Spanish (draft) |
|---|---|---|
| unavailableHeading | This gallery isn't available | Esta galería no está disponible |
| unavailableDefault | This gallery is unavailable. | Esta galería no está disponible. |
| requestSentHeading | Request sent! | ¡Solicitud enviada! |
| requestSentBody | {{studioName}} will review your placement and get back to you shortly to confirm and collect payment -- this isn't booked yet. | {{studioName}} revisará tu ubicación y se pondrá en contacto contigo pronto para confirmar y cobrar el pago -- esto todavía no está reservado. |
| pageHeading | Flash Gallery | Galería Flash |
| intro | {{artistName}}'s ready-to-book designs at {{studioName}}. | Diseños de {{artistName}} listos para reservar en {{studioName}}. |
| noPiecesAvailable | No flash pieces are available right now. | No hay piezas flash disponibles en este momento. |
| viewFullSize | View {{title}} full size | Ver {{title}} en tamaño completo |
| oneOfOne | One of one | Pieza única |
| backToGallery | ← Back to gallery | ← Volver a la galería |
| requestTitle | Request "{{title}}" | Solicitar "{{title}}" |
| durationApprox | ~{{duration}} | ~{{duration}} |
| oneOfOneFirstRequestWins | · One of one -- first request wins | · Pieza única -- la primera solicitud gana |
| phoneNumber | Your phone number * | Tu número de teléfono * |
| continueButton | Continue | Continuar |
| checking | Checking… | Verificando… |
| welcomeBack | Welcome back, {{firstName}}! | ¡Bienvenido/a de nuevo, {{firstName}}! |
| firstName | First name * | Nombre * |
| lastName | Last name * | Apellido * |
| email | Email * | Correo electrónico * |
| placementPrompt | Where would you like this placed? * | ¿Dónde te gustaría colocarlo? * |
| placementPlaceholder | e.g. outer left forearm | ej. antebrazo izquierdo exterior |
| placementPhotoLabel | Photo of the placement area * | Foto del área de colocación * |
| placementPhotoHint | A photo of the area so the artist can plan sizing/placement. | Una foto del área para que el artista pueda planear el tamaño y la ubicación. |
| sending | Sending… | Enviando… |
| sendRequest | Send request | Enviar solicitud |
| enterCompletePhoneNumber | Enter a complete 10-digit phone number. | Ingresa un número de teléfono completo de 10 dígitos. |
| pleaseDescribePlacement | Please describe where you'd like this placed. | Por favor, describe dónde te gustaría colocarlo. |
| pleaseAddPlacementPhoto | Please add a photo of the placement area. | Por favor, agrega una foto del área de colocación. |
| pleaseFillNameAndEmail | Please fill in your name and email. | Por favor, completa tu nombre y correo electrónico. |

### flashPayment

| Key | English | Spanish (draft) |
|---|---|---|
| linkExpiredBody | Please contact the studio to request a new payment link. | Por favor, contacta al estudio para solicitar un nuevo enlace de pago. |
| confirmingPayment | Confirming your payment… | Confirmando tu pago… |
| confirmingPaymentBody | This should only take a moment. | Esto solo tomará un momento. |
| paymentReceivedHeading | Payment received | Pago recibido |
| paymentReceivedBody | Your flash booking is locked in -- taking you to pick a time now. | Tu reserva flash está confirmada -- ahora te llevaremos a elegir un horario. |
| pageHeading | Complete your flash booking | Completa tu reserva flash |
| intro | Hi {{firstName}}, your request for "{{pieceTitle}}" was approved by {{studioName}}. Pay in full below to lock in your booking and pick a time. | Hola {{firstName}}, tu solicitud para "{{pieceTitle}}" fue aprobada por {{studioName}}. Paga el total a continuación para confirmar tu reserva y elegir un horario. |
| paymentUnavailable | Online payment isn't available for this studio right now -- please contact them directly to complete payment. | El pago en línea no está disponible para este estudio en este momento -- por favor, contáctalos directamente para completar el pago. |
| redirecting | Redirecting… | Redirigiendo… |
| payAmount | Pay {{amount}} | Pagar {{amount}} |
| payNow | Pay now | Pagar ahora |

### intake

| Key | English | Spanish (draft) |
|---|---|---|
| studioNotFoundHeading | We couldn't find this studio | No pudimos encontrar este estudio |
| studioNotFoundBody | Please double-check the link you were given, or contact the studio directly. | Por favor, verifica el enlace que recibiste o contacta al estudio directamente. |
| submittedHeading | Thanks — your inquiry is in! | ¡Gracias — tu solicitud fue enviada! |
| submittedBody | We've received your submission and someone from the studio will reach out soon. | Hemos recibido tu solicitud y alguien del estudio se pondrá en contacto pronto. |
| pageHeading | Tattoo Inquiry | Solicitud de Tatuaje |
| intro | Tell us about the tattoo you have in mind. | Cuéntanos sobre el tatuaje que tienes en mente. |
| ageDisclosure | You must be 18 years or older to receive a tattoo. Submitting this form does not confirm an appointment — it starts a conversation with the studio. | Debes tener 18 años o más para hacerte un tatuaje. Enviar este formulario no confirma una cita — inicia una conversación con el estudio. |
| firstName | First name | Nombre |
| lastName | Last name | Apellido |
| colorOption | Color | Color |
| blackAndGreyOption | Black & Grey | Negro y Gris |
| yesOption | Yes | Sí |
| noOption | No | No |
| selectOne | Select one | Selecciona una opción |
| referralSourceEmail | Email | Correo electrónico |
| referralSourceInstagram | Instagram | Instagram |
| referralSourceFacebook | Facebook | Facebook |
| referralSourceFriend | A friend referred me | Un amigo me refirió |
| friendReferralCode | Friend's referral code * | Código de referido de tu amigo * |
| friendReferralCodePlaceholder | e.g. AB23CDE | ej. AB23CDE |
| placementPlaceholder | e.g. forearm, left side | ej. antebrazo, lado izquierdo |
| sizePlaceholder | e.g. palm-sized | ej. tamaño de la palma de la mano |
| timingPlaceholder | e.g. within a month | ej. dentro de un mes |
| noPreference | No preference | Sin preferencia |
| referenceImagesHint | Photos or designs that show the style you are going for. | Fotos o diseños que muestren el estilo que buscas. |
| placementPhotoHint | A photo of the area where you want the tattoo. | Una foto del área donde quieres el tatuaje. |
| smsConsentDefault | By providing your phone number, you consent to receive SMS messages about your inquiry and appointment. Message and data rates may apply. Reply STOP to opt out. | Al proporcionar tu número de teléfono, aceptas recibir mensajes SMS sobre tu solicitud y cita. Pueden aplicar tarifas de mensajes y datos. Responde STOP para cancelar. |
| seeOurPrivacyAndTerms | See our | Consulta nuestra |
| smsOptInBody | I agree to receive text messages from {{studioName}} regarding my appointment, including reminders and updates. Message and data rates may apply. Reply STOP to opt out. | Acepto recibir mensajes de texto de {{studioName}} sobre mi cita, incluyendo recordatorios y actualizaciones. Pueden aplicar tarifas de mensajes y datos. Responde STOP para cancelar. |
| viewOurPrivacyAndTerms | View our | Consulta nuestra |
| smsOptInDefaultStudioName | the studio | el estudio |
| pleaseAgreeToSms | Please agree to receive text messages to submit this form. | Por favor, acepta recibir mensajes de texto para enviar este formulario. |
| submitting | Submitting… | Enviando… |
| submitInquiry | Submit inquiry | Enviar solicitud |
| pleaseFillRequiredFields | Please fill out all required fields. | Por favor, completa todos los campos requeridos. |
| enterCompletePhoneOrBlank | Enter a complete 10-digit phone number, or leave it blank. | Ingresa un número de teléfono completo de 10 dígitos, o déjalo en blanco. |
| pleaseWaitForPhotos | Please wait for your photos to finish uploading. | Por favor, espera a que tus fotos terminen de subirse. |
| pleaseAddReferenceImage | Please add at least one reference image. | Por favor, agrega al menos una imagen de referencia. |
| pleaseAddPlacementPhoto | Please add at least one placement photo. | Por favor, agrega al menos una foto de la ubicación. |
| pleaseAnswer | Please answer: {{fieldLabel}} | Por favor, responde: {{fieldLabel}} |


**deposit.terms.\*** above is a legacy leftover key space -- the actual deposit clauses shown to clients
come from the API's own `TERMS`/`TERMS_ES` (see the dedicated section below), snapshotted onto
`DepositForm.termsSnapshot` at sign time. **Legal text — recommend this specific block gets an actual
legal/native-speaker review, not just a fluency check** (this is the exact text a client legally agrees to).

## Backend platform strings

### Deposit agreement clauses -- platform copy (`apps/api/src/routes/deposits.ts` TERMS/TERMS_ES)

| Key | English | Spanish (draft) |
|---|---|---|
| agreedNonRefundable | A deposit is required to set an appointment. Deposits are non-refundable and are applied to the final price of the tattoo. | Se requiere un depósito para fijar una cita. Los depósitos no son reembolsables y se aplican al precio final del tatuaje. |
| agreedLatePolicy | Artists reserve the right to reschedule the appointment if the client is more than 15 minutes late without notification. | Los artistas se reservan el derecho de reprogramar la cita si el cliente llega con más de 15 minutos de retraso sin previo aviso. |
| agreedNoShowForfeit | A no-call/no-show forfeits the deposit. A 48-hour notice is required to change a scheduled appointment. | La falta de asistencia sin aviso previo resulta en la pérdida del depósito. Se requiere un aviso de 48 horas para cambiar una cita programada. |
| agreedNewDepositAfterNoShow | After a no-call/no-show, a new deposit is required to set up another appointment. | Después de una falta de asistencia sin aviso previo, se requiere un nuevo depósito para programar otra cita. |
| agreedRescheduleLimit | Appointments may be rescheduled up to 3 times; the deposit is forfeited on the 3rd reschedule. | Las citas pueden reprogramarse hasta 3 veces; el depósito se pierde en la tercera reprogramación. |
| agreedExpiration | Deposits expire one year after the date they were created. | Los depósitos vencen un año después de la fecha en que fueron creados. |
| agreedIdAndVoucher | Client must bring a government-issued ID and the Deposit Voucher (issued after payment) on the day of the appointment. | El cliente debe traer una identificación oficial con fotografía y el comprobante de depósito (emitido después del pago) el día de la cita. |
| agreedAge18 | Client reconfirms they are at least 18 years of age. | El cliente reconfirma que tiene al menos 18 años de edad. |

### SYSTEM intake field seed labels (`apps/api/src/lib/intakeFormFields.ts` / `contentTranslation.ts`)

| Key | English | Spanish (draft) |
|---|---|---|
| name | Name | Nombre |
| email | Email | Correo electrónico |
| phone | Phone | Teléfono |
| referralSource | How did you hear about us? | ¿Cómo te enteraste de nosotros? |
| description | Describe the tattoo you want | Describe el tatuaje que quieres |
| colorOrBlackGrey | Color or Black & Grey? | ¿Color o Negro y Gris? |
| placement | Placement | Ubicación |
| size | Estimated size | Tamaño estimado |
| hasBeenTattooedBefore | Have you been tattooed before? | ¿Te has tatuado antes? |
| preferredArtist | Preferred artist | Artista preferido |
| budget | Budget | Presupuesto |
| desiredTiming | Desired timing | Fecha deseada |
| referenceImages | Reference images | Imágenes de referencia |
| placementImages | Placement photos | Fotos de la ubicación |

### PDF chrome (`apps/api/src/lib/pdfStrings.ts`)

| Key | English | Spanish (draft) |
|---|---|---|
| generatedOn | Generated {{date}} | Generado el {{date}} |
| depositAgreementTitle | Deposit Agreement | Acuerdo de Depósito |
| client | Client: {{name}} | Cliente: {{name}} |
| project | Project: {{title}} | Proyecto: {{title}} |
| session | Session: #{{n}} | Sesión: #{{n}} |
| depositAmount | Deposit amount: {{amount}} | Monto del depósito: {{amount}} |
| processingFee | Processing fee: {{amount}} | Cargo por procesamiento: {{amount}} |
| totalCharged | Total charged: {{amount}} | Total cobrado: {{amount}} |
| termsAgreedTo | Terms agreed to | Términos aceptados |
| signature | Signature | Firma |
| signedBy | Signed by: {{name}} | Firmado por: {{name}} |
| dateTimeLabel | Date/time: {{value}} | Fecha/hora: {{value}} |
| signatureImageError | (signature image could not be rendered) | (no se pudo mostrar la imagen de la firma) |
| dash | — | — |
| waiverTitle | Liability Waiver & Consent | Exención de Responsabilidad y Consentimiento |
| legalNameOnFile | Legal name on file: {{name}} | Nombre legal registrado: {{name}} |
| dateOfBirthLabel | Date of birth: {{value}} | Fecha de nacimiento: {{value}} |
| appointmentDateLabel | Appointment date: {{value}} | Fecha de la cita: {{value}} |
| emergencyContactLabel | Emergency contact: {{name}} ({{phone}}) | Contacto de emergencia: {{name}} ({{phone}}) |
| healthScreening | Health screening | Cuestionario de salud |
| answerLabel | Answer: {{value}} | Respuesta: {{value}} |
| acknowledgedClauses | Acknowledged clauses | Cláusulas reconocidas |
| initialedLabel | Initialed: {{value}} | Iniciales: {{value}} |
| acknowledgment | Acknowledgment | Reconocimiento |
| clientSignature | Client signature | Firma del cliente |
| photoVideoRelease | Photo / video release | Autorización de foto / video |
| releaseSignature | Release signature | Firma de autorización |
| notAccepted | Not accepted. | No aceptado. |
| idVerification | ID verification | Verificación de identificación |
| idOnFile | A government ID photo is on file in the app (not embedded in this PDF -- see app for the image itself). | Hay una foto de identificación oficial registrada en la aplicación (no incluida en este PDF -- consulte la app para ver la imagen). |
| noIdOnFile | No ID image on file. | No hay imagen de identificación registrada. |
| staffVerifiedYes | Staff-verified: Yes, {{date}} by {{name}} | Verificado por el personal: Sí, el {{date}} por {{name}} |
| staffVerifiedNo | Staff-verified: Not yet verified | Verificado por el personal: Aún no verificado |


## Known gaps, not covered by this document

- **SMS bodies** (`StudioSettings.reminderTemplates`, ad-hoc conversation text) — explicitly out of v1
  scope (see the Part 1 investigation's own finding); stay English-only regardless of a client's locale
  preference until a dedicated future part.
- **Studio-authored content** (a studio's own `StudioSettingsTranslation`/`ServiceTranslation`/etc. rows,
  entered through the Settings locale tabs) — by definition not platform copy, not reviewable here; each
  studio owns the accuracy of their own translations.
- **Deposit confirmation enrichment** (appointment card, gift-card card) — folded into `en.ts`/`es.ts` as
  part of this same pre-merge closeout pass (see `deposit.appointmentCard.*`/`deposit.giftCardCard.*`
  above), so it IS covered, but flagged here since it shipped to `main` after this branch's original cut
  and is the newest content in this document.
