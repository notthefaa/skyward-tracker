// =============================================================
// Dev-only email preview index.
//
// Lists every email variant the app sends with a browsable preview
// link. Gated behind NODE_ENV !== 'production' OR an explicit
// ENABLE_EMAIL_PREVIEW flag in env. In production without that
// flag, the page 404s so a forgotten deploy can't expose the
// surface publicly.
//
// Usage:
//   Local dev:        http://localhost:3000/dev/email-preview
//   Staging preview:  ENABLE_EMAIL_PREVIEW=true in Vercel env
//                     → https://your-domain/dev/email-preview
//
// Each variant page serves the full rendered email as text/html.
// That means:
//   - Open in new tab  → see the email as it would look to a pilot
//   - View → Source    → copy the raw HTML
//   - File → Save As   → download .html to attach to a test email
//   - Forward via DevTools "Copy as cURL" / any mail test tool
// =============================================================

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { variants, isPreviewEnabled } from './fixtures';

export const dynamic = 'force-dynamic';

export default function EmailPreviewIndex() {
  if (!isPreviewEnabled()) notFound();

  // Group by category so the index reads as an operational map of
  // which emails fire when, not a flat alphabetized list.
  const byCategory = variants.reduce((acc, v) => {
    (acc[v.category] ||= []).push(v);
    return acc;
  }, {} as Record<string, typeof variants>);

  const categoryOrder: string[] = [
    'Note',
    'Squawk',
    'Scheduling',
    'Mechanic Portal',
    'Owner → Mechanic',
    'Reservation',
    'Auto-Cancel',
  ];

  return (
    <main style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', maxWidth: 960, margin: '0 auto', padding: '32px 24px' }}>
      <header style={{ borderBottom: '2px solid #091F3C', paddingBottom: 16, marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 28, color: '#091F3C', fontFamily: '"Oswald", "Arial Narrow", Arial, sans-serif', textTransform: 'uppercase', letterSpacing: 2 }}>
          Email Preview
        </h1>
        <p style={{ margin: '8px 0 0', color: '#6B7280', fontSize: 14 }}>
          {variants.length} template variants. Click any row to open the rendered email in a new tab — view source for the raw HTML, or save the page to forward to a test inbox.
        </p>
        <p style={{ margin: '8px 0 0', color: '#9CA3AF', fontSize: 12 }}>
          Dev surface. 404s in production unless <code>ENABLE_EMAIL_PREVIEW=true</code>.
        </p>
      </header>

      {categoryOrder.map(category => {
        const items = byCategory[category];
        if (!items || items.length === 0) return null;
        return (
          <section key={category} style={{ marginBottom: 28 }}>
            <h2 style={{ fontSize: 12, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: '#F08B46', margin: '0 0 10px' }}>
              {category}
            </h2>
            <div style={{ border: '1px solid #E5E7EB', borderRadius: 8, overflow: 'hidden' }}>
              {items.map((v, i) => (
                <Link
                  key={v.slug}
                  href={`/dev/email-preview/${v.slug}`}
                  target="_blank"
                  rel="noopener"
                  style={{
                    display: 'block',
                    padding: '14px 16px',
                    borderTop: i === 0 ? 'none' : '1px solid #F3F4F6',
                    textDecoration: 'none',
                    color: '#111827',
                    transition: 'background 0.1s',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 16 }}>
                    <div style={{ fontWeight: 700, color: '#091F3C', fontSize: 15 }}>{v.label}</div>
                    <div style={{ fontSize: 11, color: '#9CA3AF', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{v.slug}</div>
                  </div>
                  <div style={{ fontSize: 13, color: '#6B7280', marginTop: 4, lineHeight: 1.5 }}>{v.description}</div>
                  <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 6 }}>
                    <span style={{ fontWeight: 700, color: '#6B7280' }}>Subject:</span> {v.subject}
                    <span style={{ margin: '0 8px', color: '#E5E7EB' }}>·</span>
                    <span style={{ fontWeight: 700, color: '#6B7280' }}>To:</span> {v.to}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        );
      })}

      <footer style={{ marginTop: 40, padding: 16, background: '#F9FAFB', borderRadius: 8, fontSize: 13, color: '#6B7280', lineHeight: 1.6 }}>
        <strong style={{ color: '#091F3C' }}>Testing in real clients:</strong>
        <ol style={{ margin: '8px 0 0', paddingLeft: 20 }}>
          <li>Open the variant in a new tab.</li>
          <li>File → Save Page As → <code>sample.html</code>.</li>
          <li>Attach the HTML or paste the source into a dev Litmus / Email on Acid / Mailpit run, or forward to a test inbox with a self-hosted SMTP dev tool.</li>
          <li>Cover at minimum: Gmail web, Gmail iOS, Apple Mail iOS, Outlook 2019 (Windows desktop), Outlook.com web.</li>
        </ol>
      </footer>
    </main>
  );
}
