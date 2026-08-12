import { LOGO_BLACK_512_DATA_URI } from "./emailLogo";

// Shared branded template for every platform email (invite, password
// reset, email-change confirmation) -- one layout, swappable heading/body/
// button per call site, rather than three near-duplicate one-off strings.
//
// This follows real HTML-email conventions, not normal web CSS practice,
// because the render targets a completely different (and far more
// hostile) set of engines than a browser:
//   - Inline styles only, no <style> block -- Gmail strips <style> tags in
//     some contexts (e.g. clipped/forwarded messages) and many other
//     clients drop them outright. Every rule that matters is inlined on
//     the element itself.
//   - Table-based layout, not flex/grid -- Outlook desktop renders with
//     Word's HTML engine, which has ~2000s-era CSS support: no flexbox, no
///    grid, unreliable max-width on divs. Nested <table> is still the only
//     layout primitive guaranteed to render consistently everywhere.
//   - Safe fonts only -- Georgia (a universally-installed serif) for the
//     heading, a system sans-serif stack for body copy. Fraunces/Jura
//     (the app's real fonts) are web fonts most email clients strip
//     entirely, so referencing them would silently fall back to an
//     unstyled default anyway; naming safe fonts directly is honest about
//     what will actually render instead of hoping a @font-face survives.
//   - The logo is a base64 data URI (see emailLogo.ts), not a
//     `${PUBLIC_APP_URL}/branding/...` link -- this API and the web app
//     deploy as separate services with separate filesystems/domains, so
//     there's no URL this API could build that's guaranteed reachable
//     from an inbox in every environment (least of all local dev, where
//     PUBLIC_APP_URL is just localhost). Embedding the bytes means the
//     logo renders regardless of whether the web app happens to be up.
//   - The button is a plain <a> styled to look like a button (padding,
//     background, border-radius, bold text), not a real <button> element
//     -- <button> support in email clients is inconsistent and it isn't
//     clickable in several of them. An anchor styled this way is the
//     standard "bulletproof button" approach and works everywhere.

const GOLD = "#c99a5b";
const INK = "#171208";
const BODY_TEXT = "#3a352c";
const MUTED_TEXT = "#8a8272";
const PANEL_BG = "#ffffff";
const PAGE_BG = "#f4f1ec";
const RULE = "#e7e0d2";

const SANS_STACK = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const SERIF_STACK = "Georgia, 'Times New Roman', Times, serif";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface PlatformEmailContent {
  heading: string;
  // Each entry becomes its own <p> -- plain text in, HTML-escaped here, so
  // call sites never have to think about escaping (or accidentally inject
  // raw HTML through a studio name/role/email interpolated into a string).
  bodyParagraphs: string[];
  buttonText: string;
  buttonUrl: string;
  // Small print under the button -- expiry notice, "if you didn't request
  // this" disclaimers, etc. Also escaped, also optional (ConfirmEmailChange
  // template has no button at all in one branch, see call sites).
  footnote?: string;
}

export function renderPlatformEmailHtml(content: PlatformEmailContent): string {
  const heading = escapeHtml(content.heading);
  const paragraphs = content.bodyParagraphs
    .map(
      (paragraph) =>
        `<p style="margin:0 0 16px 0; font-family:${SANS_STACK}; font-size:15px; line-height:1.6; color:${BODY_TEXT};">${escapeHtml(paragraph)}</p>`,
    )
    .join("\n");
  const buttonText = escapeHtml(content.buttonText);
  const buttonUrl = escapeHtml(content.buttonUrl);
  const footnote = content.footnote
    ? `<p style="margin:24px 0 0 0; font-family:${SANS_STACK}; font-size:13px; line-height:1.5; color:${MUTED_TEXT};">${escapeHtml(content.footnote)}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>${heading}</title>
</head>
<body style="margin:0; padding:0; background-color:${PAGE_BG};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${PAGE_BG};">
  <tr>
    <td align="center" style="padding:40px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:100%; background-color:${PANEL_BG};">
        <tr>
          <td align="center" style="padding:40px 40px 24px 40px;">
            <img src="${LOGO_BLACK_512_DATA_URI}" width="180" height="36" alt="Ink Manager" style="display:block; width:180px; height:36px;" />
          </td>
        </tr>
        <tr>
          <td style="padding:0 40px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="border-top:2px solid ${GOLD}; font-size:0; line-height:0;">&nbsp;</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:32px 40px 8px 40px;">
            <h1 style="margin:0; font-family:${SERIF_STACK}; font-size:22px; font-weight:normal; color:${INK}; text-align:center;">${heading}</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 40px 8px 40px;">
            ${paragraphs}
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:16px 40px 8px 40px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="center" bgcolor="${GOLD}" style="border-radius:4px;">
                  <!--[if mso]>
                  <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${buttonUrl}" style="height:48px;v-text-anchor:middle;width:260px;" arcsize="8%" fillcolor="${GOLD}" strokecolor="${GOLD}">
                  <w:anchorlock/>
                  <center style="color:${INK};font-family:${SANS_STACK};font-size:13px;font-weight:bold;letter-spacing:0.05em;">${buttonText.toUpperCase()}</center>
                  </v:roundrect>
                  <![endif]-->
                  <!--[if !mso]><!-->
                  <a href="${buttonUrl}" target="_blank" style="display:inline-block; padding:14px 32px; font-family:${SANS_STACK}; font-size:13px; font-weight:bold; letter-spacing:0.05em; text-transform:uppercase; color:${INK}; text-decoration:none; border-radius:4px;">${buttonText}</a>
                  <!--<![endif]-->
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:0 40px 8px 40px;">
            ${footnote}
          </td>
        </tr>
        <tr>
          <td style="padding:32px 40px 0 40px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="border-top:1px solid ${RULE}; font-size:0; line-height:0;">&nbsp;</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:20px 40px 40px 40px;">
            <p style="margin:0; font-family:${SANS_STACK}; font-size:12px; line-height:1.5; color:${MUTED_TEXT};">Ink Manager &middot; This is an automated message, please don't reply directly to this email.</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

// Send-channel picker + email as a client channel: same visual system as
// renderPlatformEmailHtml above (palette, fonts, escapeHtml, the
// bulletproof table-based button) but NOT that function -- its footer
// ("please don't reply directly to this email") is wrong here. This one
// names the studio as the actual sender and, when a reply-to address
// exists, tells the client replies really do reach the studio.
export interface ClientEmailContent {
  studioName: string;
  heading: string;
  bodyParagraphs: string[];
  buttonText: string;
  buttonUrl: string;
  footnote?: string;
}

export function renderClientEmailHtml(content: ClientEmailContent): string {
  const studioName = escapeHtml(content.studioName);
  const heading = escapeHtml(content.heading);
  const paragraphs = content.bodyParagraphs
    .map(
      (paragraph) =>
        `<p style="margin:0 0 16px 0; font-family:${SANS_STACK}; font-size:15px; line-height:1.6; color:${BODY_TEXT};">${escapeHtml(paragraph)}</p>`,
    )
    .join("\n");
  const buttonText = escapeHtml(content.buttonText);
  const buttonUrl = escapeHtml(content.buttonUrl);
  const footnote = content.footnote
    ? `<p style="margin:24px 0 0 0; font-family:${SANS_STACK}; font-size:13px; line-height:1.5; color:${MUTED_TEXT};">${escapeHtml(content.footnote)}</p>`
    : "";
  // Deliberately doesn't claim "reply and it reaches the studio" -- whether
  // a reply-to is actually attached is resolved deep inside
  // sendClientEmail/sendViaBirdOnBehalfOfStudio (lib/clientEmail.ts), not
  // known here at render time. Neutral wording that's true either way.
  const replyNote = `Sent on behalf of ${studioName} via Ink Manager.`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>${heading}</title>
</head>
<body style="margin:0; padding:0; background-color:${PAGE_BG};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${PAGE_BG};">
  <tr>
    <td align="center" style="padding:40px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:100%; background-color:${PANEL_BG};">
        <tr>
          <td align="center" style="padding:40px 40px 24px 40px;">
            <p style="margin:0; font-family:${SANS_STACK}; font-size:13px; letter-spacing:0.05em; text-transform:uppercase; color:${MUTED_TEXT};">${studioName}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:0 40px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="border-top:2px solid ${GOLD}; font-size:0; line-height:0;">&nbsp;</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:32px 40px 8px 40px;">
            <h1 style="margin:0; font-family:${SERIF_STACK}; font-size:22px; font-weight:normal; color:${INK}; text-align:center;">${heading}</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 40px 8px 40px;">
            ${paragraphs}
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:16px 40px 8px 40px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="center" bgcolor="${GOLD}" style="border-radius:4px;">
                  <!--[if mso]>
                  <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${buttonUrl}" style="height:48px;v-text-anchor:middle;width:260px;" arcsize="8%" fillcolor="${GOLD}" strokecolor="${GOLD}">
                  <w:anchorlock/>
                  <center style="color:${INK};font-family:${SANS_STACK};font-size:13px;font-weight:bold;letter-spacing:0.05em;">${buttonText.toUpperCase()}</center>
                  </v:roundrect>
                  <![endif]-->
                  <!--[if !mso]><!-->
                  <a href="${buttonUrl}" target="_blank" style="display:inline-block; padding:14px 32px; font-family:${SANS_STACK}; font-size:13px; font-weight:bold; letter-spacing:0.05em; text-transform:uppercase; color:${INK}; text-decoration:none; border-radius:4px;">${buttonText}</a>
                  <!--<![endif]-->
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:0 40px 8px 40px;">
            ${footnote}
          </td>
        </tr>
        <tr>
          <td style="padding:32px 40px 0 40px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="border-top:1px solid ${RULE}; font-size:0; line-height:0;">&nbsp;</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:20px 40px 40px 40px;">
            <p style="margin:0; font-family:${SANS_STACK}; font-size:12px; line-height:1.5; color:${MUTED_TEXT};">${replyNote}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}
