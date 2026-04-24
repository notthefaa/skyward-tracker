import { describe, it, expect } from 'vitest';
import { variants, findVariant, isPreviewEnabled } from '../fixtures';

describe('email preview fixtures', () => {
  it('renders all variants as non-empty HTML documents', () => {
    for (const v of variants) {
      expect(v.html.length).toBeGreaterThan(500);
      expect(v.html).toMatch(/^<!DOCTYPE html/);
      expect(v.html).toContain('</html>');
    }
  });

  it('gives every variant a unique slug', () => {
    const slugs = variants.map(v => v.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('every variant populates subject, from, to, description', () => {
    for (const v of variants) {
      expect(v.subject).toBeTruthy();
      expect(v.from).toBeTruthy();
      expect(v.to).toBeTruthy();
      expect(v.description).toBeTruthy();
    }
  });

  it('findVariant returns a match by slug, undefined otherwise', () => {
    expect(findVariant('note-new')).toBeDefined();
    expect(findVariant('nonsense')).toBeUndefined();
  });

  it('isPreviewEnabled returns true in test/dev env', () => {
    // Vitest sets NODE_ENV=test → the helper treats that as "not
    // production" and allows the surface.
    expect(isPreviewEnabled()).toBe(true);
  });

  it('every variant body includes the bulletproof button pattern', () => {
    for (const v of variants) {
      expect(v.html).toContain('<!--[if mso]>');
    }
  });

  it('every variant includes a preheader block', () => {
    for (const v of variants) {
      expect(v.html).toContain('display:none');
      expect(v.html).toContain('&zwnj;');
    }
  });
});
