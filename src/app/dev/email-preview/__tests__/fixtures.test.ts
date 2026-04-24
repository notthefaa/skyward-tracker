import { describe, it, expect, vi, afterEach } from 'vitest';
import { variants, findVariant, isPreviewEnabled } from '../fixtures';

describe('email preview fixtures', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

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

  it('isPreviewEnabled returns true outside production', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(isPreviewEnabled()).toBe(true);
  });

  it('isPreviewEnabled returns false in production unless flag is set', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ENABLE_EMAIL_PREVIEW', '');
    expect(isPreviewEnabled()).toBe(false);
    vi.stubEnv('ENABLE_EMAIL_PREVIEW', 'true');
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
