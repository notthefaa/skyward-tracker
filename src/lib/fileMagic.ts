// =============================================================
// Shared magic-byte sniffer.
//
// Originally lived inside upload-attachment/route.ts. Extracted so
// the scan-logentry routes can validate uploads with the same
// hardened logic. The Content-Type header on a multipart File is
// client-controlled and trivial to spoof — every route that hands a
// user-supplied file to a downstream model / parser / image renderer
// should call this before doing anything expensive (Anthropic vision
// tokens are not cheap to waste on garbage).
// =============================================================

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'] as const;
export const ALLOWED_IMAGE_TYPE_SET: ReadonlySet<string> = new Set(ALLOWED_IMAGE_TYPES);

/**
 * Verify a file's leading bytes match the MIME type the client
 * claims. Returns true iff the content is consistent with the type.
 *
 * @param bytes - the leading bytes of the file (≥ 12 needed)
 * @param claimedType - the Content-Type the client asserted
 * @param fileName - used for the .docx ZIP-vs-archive disambiguation;
 *                   pass an empty string for routes that don't accept Word
 */
export function fileBytesMatchType(
  bytes: Uint8Array,
  claimedType: string,
  fileName: string = '',
): boolean {
  if (bytes.length < 12) return false;
  const startsWith = (...expected: number[]) => expected.every((b, i) => bytes[i] === b);
  const at = (offset: number, ...expected: number[]) => expected.every((b, i) => bytes[offset + i] === b);

  switch (claimedType) {
    case 'image/jpeg':
      return startsWith(0xFF, 0xD8, 0xFF);
    case 'image/png':
      return startsWith(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A);
    case 'image/webp':
      return startsWith(0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50);
    case 'image/heic': {
      if (!at(4, 0x66, 0x74, 0x79, 0x70)) return false;
      const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
      return ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1'].includes(brand);
    }
    case 'application/pdf':
      return startsWith(0x25, 0x50, 0x44, 0x46); // "%PDF"
    case 'application/msword':
      return startsWith(0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1);
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return startsWith(0x50, 0x4B, 0x03, 0x04) && /\.docx$/i.test(fileName);
    default:
      return false;
  }
}
