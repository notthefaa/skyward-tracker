import { describe, it, expect } from 'vitest';
import {
  emailShell,
  heading,
  paragraph,
  callout,
  bulletList,
  keyValueBlock,
  button,
  sectionHeading,
  divider,
} from '../layout';

// =============================================================
// Structural assertions on the email shell. These lock the
// cross-client-safe bits — DOCTYPE, viewport meta, color-scheme,
// mso conditionals, preheader, bulletproof button — so a future
// refactor can't silently regress them without failing a test.
// Rendering fidelity across actual clients still has to be
// validated by hand (Litmus / Email on Acid / forwarding to a
// few real inboxes), but this guards the structural fundamentals.
// =============================================================

describe('emailShell', () => {
  const sample = emailShell({
    title: 'Test Subject',
    preheader: 'Preview line shown in the inbox.',
    body: '<p>Body content here.</p>',
    preferencesUrl: 'https://example.com#settings',
  });

  it('emits a full HTML document — DOCTYPE, html, head, body', () => {
    expect(sample).toMatch(/^<!DOCTYPE html/);
    expect(sample).toContain('<html ');
    expect(sample).toContain('<head>');
    expect(sample).toContain('<body');
    expect(sample).toContain('</html>');
  });

  it('includes the viewport meta tag for mobile rendering', () => {
    expect(sample).toContain('name="viewport"');
    expect(sample).toContain('width=device-width');
  });

  it('declares color-scheme light dark for dark-mode-aware clients', () => {
    expect(sample).toContain('name="color-scheme"');
    expect(sample).toContain('content="light dark"');
    expect(sample).toContain('name="supported-color-schemes"');
  });

  it('includes MSO office settings block for Outlook', () => {
    expect(sample).toContain('<!--[if mso]>');
    expect(sample).toContain('o:OfficeDocumentSettings');
    expect(sample).toContain('PixelsPerInch');
  });

  it('has the @media query for mobile + dark-mode overrides', () => {
    expect(sample).toMatch(/@media screen and \(max-width:600px\)/);
    expect(sample).toMatch(/@media \(prefers-color-scheme: dark\)/);
  });

  it('renders the preheader with zero-width spacers that push body copy out of the preview', () => {
    expect(sample).toContain('Preview line shown in the inbox.');
    expect(sample).toContain('display:none');
    expect(sample).toContain('&zwnj;');
  });

  it('HTML-escapes preheader + title so nothing renders as actual markup', () => {
    const malicious = emailShell({
      title: '<script>alert(1)</script>',
      preheader: '<img src=x onerror=alert(1) />',
      body: 'body',
    });
    // The safety property is that no live <script> or <img> tag
    // reaches the rendered output — the angle brackets must be
    // entity-escaped, which turns the content into inert text.
    // Asserting substrings like "onerror=" would fail because the
    // escaped text still contains the literal chars; what matters
    // is that those chars are NOT preceded by an unescaped `<`.
    expect(malicious).not.toContain('<script>');
    expect(malicious).not.toContain('<img ');
    expect(malicious).toContain('&lt;script&gt;');
    expect(malicious).toContain('&lt;img ');
  });

  it('wraps the content in a centered 600px max-width table for Outlook', () => {
    expect(sample).toContain('width="600"');
    expect(sample).toContain('max-width:600px');
  });

  it('includes the Skyward brand header band with Oswald wordmark', () => {
    expect(sample).toContain('Skyward');
    expect(sample).toContain('Aircraft Manager');
    expect(sample).toContain('Oswald');
  });

  it('renders the preferences footer link when preferencesUrl is supplied', () => {
    expect(sample).toContain('Manage preferences');
    expect(sample).toContain('https://example.com#settings');
  });

  it('omits the preferences link when preferencesUrl is not supplied', () => {
    const noPrefs = emailShell({
      title: 'x', preheader: 'y', body: 'z',
    });
    expect(noPrefs).not.toContain('Manage preferences');
  });

  it('includes the body content verbatim inside the card', () => {
    expect(sample).toContain('<p>Body content here.</p>');
  });
});

describe('heading', () => {
  it('renders an h1 with inline color and Oswald font', () => {
    const h = heading('Test Heading');
    expect(h).toMatch(/^<h1/);
    expect(h).toContain('Oswald');
    expect(h).toContain('color:#091F3C');
    expect(h).toContain('Test Heading');
  });

  it('honors variant color — success, warning, danger, note', () => {
    expect(heading('ok', 'success')).toContain('#56B94A');
    expect(heading('warn', 'warning')).toContain('#F08B46');
    expect(heading('bad', 'danger')).toContain('#CE3732');
    expect(heading('n', 'note')).toContain('#3AB0FF');
  });
});

describe('paragraph', () => {
  it('wraps content in a <p> with reading-friendly size + line-height', () => {
    const p = paragraph('Hello');
    expect(p).toMatch(/^<p/);
    expect(p).toContain('Hello');
    expect(p).toContain('font-size:15px');
    expect(p).toContain('line-height:1.6');
  });
});

describe('callout', () => {
  it('uses a table with left-border accent for Outlook compatibility', () => {
    const c = callout('Inner', { variant: 'warning' });
    expect(c).toContain('<table');
    expect(c).toContain('border-left:4px solid #F08B46');
    expect(c).toContain('Inner');
  });

  it('emits the optional label as uppercase caption above content', () => {
    const c = callout('Inner', { variant: 'danger', label: 'Cancelled' });
    expect(c).toContain('Cancelled');
    expect(c).toContain('text-transform:uppercase');
  });
});

describe('button', () => {
  const btn = button('https://example.com', 'Open Skyward');

  it('is a table + anchor pattern (bulletproof for Outlook)', () => {
    expect(btn).toContain('<table');
    expect(btn).toContain('role="presentation"');
    expect(btn).toContain('<a href="https://example.com"');
  });

  it('includes MSO conditional spacers for Outlook padding', () => {
    expect(btn).toContain('<!--[if mso]>');
    expect(btn).toContain('mso-font-width:150%');
    expect(btn).toContain('mso-text-raise');
  });

  it('explicitly sets white text + removes underline for link-color overrides', () => {
    expect(btn).toContain('color:#ffffff');
    expect(btn).toContain('text-decoration:none');
  });

  it('uses target="_blank" so the pilot isn\'t pulled out of their inbox', () => {
    expect(btn).toContain('target="_blank"');
  });

  it('honors variant color', () => {
    expect(button('#', 'x', { variant: 'success' })).toContain('#56B94A');
    expect(button('#', 'x', { variant: 'danger' })).toContain('#CE3732');
  });
});

describe('bulletList', () => {
  it('renders items in a <ul>', () => {
    const out = bulletList(['one', 'two', 'three']);
    expect(out).toContain('<ul');
    expect(out).toContain('one');
    expect(out).toContain('two');
    expect(out).toContain('three');
  });
});

describe('keyValueBlock', () => {
  it('renders a two-column table with label/value rows', () => {
    const out = keyValueBlock([
      { label: 'Location', value: 'KSQL' },
      { label: 'Status', value: 'AOG' },
    ]);
    expect(out).toContain('<table');
    expect(out).toContain('Location');
    expect(out).toContain('KSQL');
    expect(out).toContain('Status');
    expect(out).toContain('AOG');
  });
});

describe('sectionHeading and divider', () => {
  it('sectionHeading is a lowercase-kerned h2 in the variant color', () => {
    const h = sectionHeading('Maintenance Items Due', 'warning');
    expect(h).toMatch(/^<h2/);
    expect(h).toContain('Maintenance Items Due');
    expect(h).toContain('#F08B46');
  });

  it('divider renders a thin horizontal rule', () => {
    const d = divider();
    expect(d).toContain('border-top:1px solid');
  });
});
