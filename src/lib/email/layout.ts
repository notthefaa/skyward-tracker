// =============================================================
// Shared email layout + components.
//
// Every outbound email — reservation notifications, maintenance
// reminders, mechanic-portal back-and-forth — goes through this
// module. The goals:
//
//   1. Cross-client reliability. Outlook (Word engine), Gmail
//      (desktop + mobile app), Apple Mail (macOS + iOS), Yahoo,
//      Spark, ProtonMail all render the same structure. No div-
//      only layouts, no flexbox/grid, no floated elements, no
//      web fonts without fallback.
//
//   2. Consistent brand voice. One header band, one footer,
//      one button style, one color palette. Pilot sees an email
//      and knows at a glance "this is Skyward."
//
//   3. Dark-mode safe. `color-scheme` + `supported-color-schemes`
//      meta tags opt into Apple Mail / Gmail dark-mode treatment.
//      Body colors use CSS custom properties where supported,
//      fall back to explicit hex.
//
//   4. Mobile-first. 600px max content width, full-width on narrow
//      viewports via a `<style>` media query. Tap targets sized
//      for phones (44px+ button height).
//
//   5. Preheader text on every email. The gray "preview" snippet
//      in the inbox list — without it, clients show the first line
//      of body HTML, which on our templates was often "Hello
//      [mechanic name]," — wasted real estate.
//
// Call site usage:
//
//   import { emailShell, button, callout, heading, paragraph } from '@/lib/email/layout';
//
//   const html = emailShell({
//     title: 'New Note',
//     preheader: `${author} posted a note on ${tail}.`,
//     body: `
//       ${heading('New Note')}
//       ${paragraph(`<strong>${author}</strong> posted a note on ${tail}.`)}
//       ${callout(noteContent, { variant: 'info' })}
//       ${button(appUrl, 'Open Skyward')}
//     `,
//     preferencesUrl: `${appUrl}#settings`,
//   });
//
//   await resend.emails.send({ from, to, subject, html });
//
// Pass only pre-escaped content into `paragraph` / `callout` /
// `heading` / `button` — the shell itself doesn't sanitize. Use
// `escapeHtml()` from @/lib/sanitize on any user-supplied value
// before composing the body.
// =============================================================

export type Variant = 'info' | 'success' | 'warning' | 'danger' | 'note' | 'neutral';

interface VariantStyle {
  /** Left-border accent color for callouts; heading color */
  accent: string;
  /** Soft background tint for callouts */
  bg: string;
}

const VARIANTS: Record<Variant, VariantStyle> = {
  info:    { accent: '#091F3C', bg: '#F8FAFC' },  // navy — default brand
  success: { accent: '#56B94A', bg: '#F0FDF4' },  // green
  warning: { accent: '#F08B46', bg: '#FFF7ED' },  // orange
  danger:  { accent: '#CE3732', bg: '#FEF2F2' },  // red
  note:    { accent: '#3AB0FF', bg: '#F0F9FF' },  // blue (mechanic-portal comms)
  neutral: { accent: '#525659', bg: '#F9FAFB' },  // gray
};

// --- Shell ---------------------------------------------------

export interface ShellOpts {
  /** <title> tag — some clients show this in the subject area.
   *  Usually matches the email's subject line minus the dynamic bits. */
  title: string;
  /** Hidden preview text shown next to the subject in the inbox list.
   *  1 sentence, <= ~90 chars. No HTML — plain text only. */
  preheader: string;
  /** The rendered body HTML — compose with heading/paragraph/
   *  callout/button/bulletList helpers below. */
  body: string;
  /** URL to the user's notification-preferences page. Optional;
   *  without it the footer omits the "Manage preferences" link. */
  preferencesUrl?: string;
}

/**
 * Bulletproof email document. Uses table-based centering for
 * Outlook, a media query for mobile, and color-scheme meta for
 * dark-mode clients.
 *
 * Why table-based outer layout: Outlook's Word renderer ignores
 * max-width on <div> and many flexbox/grid primitives. Tables
 * are the only reliable way to get a 600px-max centered column
 * that also collapses to full width on mobile.
 */
export function emailShell(opts: ShellOpts): string {
  const preheader = opts.preheader.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const title = opts.title.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const preferencesLink = opts.preferencesUrl
    ? ` · <a href="${opts.preferencesUrl}" style="color:#6B7280;text-decoration:underline;">Manage preferences</a>`
    : '';

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="light dark" />
<meta name="supported-color-schemes" content="light dark" />
<title>${title}</title>
<!--[if mso]>
<xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml>
<![endif]-->
<style type="text/css">
  /* Reset — Outlook and some mobile clients add default spacing. */
  body, table, td, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
  img { -ms-interpolation-mode:bicubic; border:0; outline:none; text-decoration:none; display:block; }
  a { text-decoration:none; }
  /* Mobile: collapse the 600px column to full width and bump padding
     down so the card doesn't feel crammed on a phone. */
  @media screen and (max-width:600px) {
    .sw-container { width:100% !important; }
    .sw-card { padding:20px 16px !important; }
    .sw-header-band { padding:16px 20px !important; }
    .sw-button a { padding:14px 24px !important; font-size:14px !important; }
    .sw-hide-mobile { display:none !important; }
  }
  /* Dark-mode overrides — Apple Mail + Gmail honor this, Outlook
     ignores it (so light-mode palette remains the safe default). */
  @media (prefers-color-scheme: dark) {
    .sw-body { background-color:#0b1a2e !important; }
    .sw-card { background-color:#0f2340 !important; color:#e5e7eb !important; }
    .sw-heading { color:#ffffff !important; }
    .sw-paragraph { color:#d1d5db !important; }
    .sw-label { color:#9ca3af !important; }
    .sw-footer { color:#9ca3af !important; }
    .sw-footer a { color:#9ca3af !important; }
  }
</style>
</head>
<body class="sw-body" style="margin:0;padding:0;background-color:#F5F5F0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">

<!-- Preheader: hidden preview text shown in the inbox list.
     Trailing zero-width chars push any visible body content out of
     the preview pane so the pilot sees only what we wrote here. -->
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;visibility:hidden;">
  ${preheader}
  &#847; &zwnj; &nbsp; &#847; &zwnj; &nbsp; &#847; &zwnj; &nbsp; &#847; &zwnj; &nbsp; &#847; &zwnj; &nbsp; &#847; &zwnj; &nbsp; &#847; &zwnj; &nbsp;
</div>

<!-- Outer table for Outlook centering. max-width on a <div> does not
     work in Word-engine Outlook; a centered table does. -->
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F5F5F0;">
  <tr>
    <td align="center" style="padding:24px 12px;">

      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" class="sw-container" style="max-width:600px;width:100%;">

        <!-- Header band — navy bar with brand wordmark. Short, no images
             so we don't depend on clients loading remote assets. -->
        <tr>
          <td class="sw-header-band" style="background-color:#091F3C;padding:18px 24px;border-radius:8px 8px 0 0;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td align="left" style="font-family:'Oswald','Arial Narrow',Arial,sans-serif;color:#ffffff;font-size:18px;font-weight:700;letter-spacing:3px;text-transform:uppercase;">
                  Skyward
                </td>
                <td align="right" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#F5B05B;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">
                  Aircraft Manager
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Card body — white background, content rendered here -->
        <tr>
          <td class="sw-card" style="background-color:#ffffff;padding:32px;border-radius:0 0 8px 8px;border:1px solid #E5E7EB;border-top:0;">
            ${opts.body}
          </td>
        </tr>

        <!-- Footer — why you got this + preferences link -->
        <tr>
          <td class="sw-footer" align="center" style="padding:20px 12px 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:11px;line-height:1.6;color:#6B7280;">
            You're getting this because you have access to this aircraft on Skyward${preferencesLink}.
            <br />
            <span style="color:#9CA3AF;">Skyward Society · <a href="https://track.skywardsociety.com" style="color:#9CA3AF;text-decoration:underline;">track.skywardsociety.com</a></span>
          </td>
        </tr>
      </table>

    </td>
  </tr>
</table>

</body>
</html>`;
}

// --- Components ---------------------------------------------

/**
 * Brand-consistent heading. Use at the top of each email body.
 * `variant` tints the color — default navy; use `success` for
 * positive (ready for pickup), `warning` for due/heads-up,
 * `danger` for cancellations.
 */
export function heading(text: string, variant: Variant = 'info'): string {
  const color = VARIANTS[variant].accent;
  return `<h1 class="sw-heading" style="margin:0 0 16px;font-family:'Oswald','Arial Narrow',Arial,sans-serif;font-size:24px;line-height:1.2;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:${color};">${text}</h1>`;
}

/** Body paragraph. Pass pre-escaped HTML. */
export function paragraph(html: string): string {
  return `<p class="sw-paragraph" style="margin:0 0 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:15px;line-height:1.6;color:#374151;">${html}</p>`;
}

/**
 * Colored left-border callout — used for quote-like callouts
 * (mechanic messages), key details (due date, hours remaining),
 * and summary blocks. `label` renders as a small uppercase
 * caption above the content.
 */
export function callout(
  innerHtml: string,
  opts: { variant?: Variant; label?: string } = {},
): string {
  const v = VARIANTS[opts.variant ?? 'info'];
  const labelHtml = opts.label
    ? `<div class="sw-label" style="margin:0 0 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${v.accent};">${opts.label}</div>`
    : '';
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:16px 0;">
  <tr>
    <td style="background-color:${v.bg};border-left:4px solid ${v.accent};padding:16px 18px;border-radius:4px;">
      ${labelHtml}
      <div class="sw-paragraph" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:14px;line-height:1.6;color:#374151;">${innerHtml}</div>
    </td>
  </tr>
</table>`;
}

/**
 * Key/value grid for structured details (reservation times,
 * squawk metadata, MX item due). Renders as a two-column table
 * that collapses gracefully on mobile.
 */
export function keyValueBlock(pairs: Array<{ label: string; value: string }>): string {
  const rows = pairs
    .map(p => `<tr>
      <td style="padding:4px 12px 4px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:13px;font-weight:700;color:#6B7280;white-space:nowrap;vertical-align:top;">${p.label}</td>
      <td style="padding:4px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:14px;color:#111827;line-height:1.5;">${p.value}</td>
    </tr>`)
    .join('\n');
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:12px 0;">${rows}</table>`;
}

/**
 * Bullet list — used for item lists, reservation dates, file
 * uploads, etc. Plain disc bullets; pass pre-escaped HTML strings.
 */
export function bulletList(items: string[]): string {
  const lis = items
    .map(i => `<li style="margin:4px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:14px;line-height:1.6;color:#374151;">${i}</li>`)
    .join('\n');
  return `<ul style="margin:12px 0;padding-left:20px;color:#374151;">${lis}</ul>`;
}

/**
 * Bulletproof CTA button — survives Outlook's Word renderer,
 * Gmail's link-color override, iOS Mail's blue-underline default,
 * and dark-mode inversion.
 *
 * Pattern combines:
 *   - Outer <table> (Outlook respects <table align="center">)
 *   - Inner <a> with display:inline-block + padding (modern clients)
 *   - MSO conditional <i> spacers for Outlook padding (Word engine
 *     ignores CSS padding on <a>, the spacers fake it)
 *   - Explicit color + no-underline to override client defaults
 */
export function button(
  url: string,
  label: string,
  opts: { variant?: Variant } = {},
): string {
  const v = VARIANTS[opts.variant ?? 'info'];
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" class="sw-button" style="margin:24px auto;">
  <tr>
    <td align="center" style="background-color:${v.accent};border-radius:6px;">
      <a href="${url}" target="_blank" style="display:inline-block;padding:14px 36px;font-family:'Oswald','Arial Narrow',Arial,sans-serif;font-size:14px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#ffffff;text-decoration:none;border-radius:6px;mso-padding-alt:0;">
        <!--[if mso]><i style="mso-font-width:150%;mso-text-raise:22pt;" hidden>&emsp;</i><![endif]-->
        <span style="mso-text-raise:11pt;color:#ffffff;">${label}</span>
        <!--[if mso]><i style="mso-font-width:150%;" hidden>&emsp;&#8203;</i><![endif]-->
      </a>
    </td>
  </tr>
</table>`;
}

/**
 * Horizontal divider. Used sparingly between major content sections
 * (e.g., between the work package's MX section and the Squawks section).
 */
export function divider(): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:20px 0;">
  <tr><td style="border-top:1px solid #E5E7EB;line-height:1px;font-size:1px;">&nbsp;</td></tr>
</table>`;
}

/**
 * Section header within the card — smaller than the page heading,
 * used to label sub-sections of longer emails (e.g., the work
 * package's "Maintenance Items Due" / "Squawks" / "Additional
 * Services Requested" bands).
 */
export function sectionHeading(text: string, variant: Variant = 'info'): string {
  const color = VARIANTS[variant].accent;
  return `<h2 style="margin:24px 0 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${color};">${text}</h2>`;
}
