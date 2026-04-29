import { describe, it, expect } from 'vitest';
import { fileBytesMatchType, ALLOWED_IMAGE_TYPE_SET } from '../fileMagic';

// Helpers — leading bytes for each allowed type. Pad to ≥ 12 bytes so
// the length guard inside fileBytesMatchType doesn't reject the
// happy-path inputs.
const pad = (head: number[], len = 16): Uint8Array => {
  const out = new Uint8Array(len);
  out.set(head);
  return out;
};

const JPEG = pad([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46]);
const PNG = pad([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
const WEBP = pad([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
const HEIC = (() => {
  // ftyp box at offset 4, brand 'heic' at offset 8.
  const a = new Uint8Array(16);
  a.set([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]);
  return a;
})();
const PDF = pad([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x35]);
const DOC = pad([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]);
const ZIP = pad([0x50, 0x4B, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
const EXE = pad([0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);

describe('fileBytesMatchType — happy path', () => {
  it('accepts a JPEG with the correct signature', () => {
    expect(fileBytesMatchType(JPEG, 'image/jpeg')).toBe(true);
  });
  it('accepts a PNG with the correct signature', () => {
    expect(fileBytesMatchType(PNG, 'image/png')).toBe(true);
  });
  it('accepts a WebP with the RIFF + WEBP markers', () => {
    expect(fileBytesMatchType(WEBP, 'image/webp')).toBe(true);
  });
  it('accepts a HEIC with a recognised ftyp brand', () => {
    expect(fileBytesMatchType(HEIC, 'image/heic')).toBe(true);
  });
  it('accepts a PDF with %PDF marker', () => {
    expect(fileBytesMatchType(PDF, 'application/pdf')).toBe(true);
  });
  it('accepts a legacy .doc OLE compound document', () => {
    expect(fileBytesMatchType(DOC, 'application/msword')).toBe(true);
  });
  it('accepts a .docx ZIP only with the matching extension', () => {
    expect(fileBytesMatchType(ZIP, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'report.docx')).toBe(true);
  });
});

describe('fileBytesMatchType — spoofed types are rejected', () => {
  it('rejects an EXE renamed to .jpg', () => {
    expect(fileBytesMatchType(EXE, 'image/jpeg')).toBe(false);
  });
  it('rejects a PNG masquerading as a JPEG', () => {
    expect(fileBytesMatchType(PNG, 'image/jpeg')).toBe(false);
  });
  it('rejects a JPEG masquerading as a PDF', () => {
    expect(fileBytesMatchType(JPEG, 'application/pdf')).toBe(false);
  });
  it('rejects a ZIP without the .docx extension as a Word document', () => {
    expect(fileBytesMatchType(ZIP, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'archive.zip')).toBe(false);
  });
  it('rejects a HEIC with an unknown ftyp brand', () => {
    const a = new Uint8Array(16);
    a.set([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x77, 0x65, 0x69, 0x72]); // 'weir' not in brand list
    expect(fileBytesMatchType(a, 'image/heic')).toBe(false);
  });
  it('rejects buffers shorter than 12 bytes regardless of type', () => {
    expect(fileBytesMatchType(new Uint8Array([0xFF, 0xD8, 0xFF]), 'image/jpeg')).toBe(false);
  });
  it('rejects unknown claimed types', () => {
    expect(fileBytesMatchType(JPEG, 'image/svg+xml')).toBe(false);
    expect(fileBytesMatchType(JPEG, '')).toBe(false);
  });
});

describe('ALLOWED_IMAGE_TYPE_SET', () => {
  it('matches the documented allowlist', () => {
    expect(ALLOWED_IMAGE_TYPE_SET.has('image/jpeg')).toBe(true);
    expect(ALLOWED_IMAGE_TYPE_SET.has('image/png')).toBe(true);
    expect(ALLOWED_IMAGE_TYPE_SET.has('image/webp')).toBe(true);
    expect(ALLOWED_IMAGE_TYPE_SET.has('image/heic')).toBe(true);
    expect(ALLOWED_IMAGE_TYPE_SET.has('image/svg+xml')).toBe(false);
  });
});
