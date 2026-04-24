// =============================================================
// Per-variant preview endpoint.
//
// Serves the rendered HTML of one email variant as text/html so
// the browser paints it exactly as a mail client would. From the
// opened tab:
//   - View Source → copy the raw HTML
//   - Save As     → download .html for forwarding to a test inbox
//
// 404s unless the preview surface is enabled (see fixtures.ts).
// =============================================================

import { NextResponse } from 'next/server';
import { findVariant, isPreviewEnabled } from '../fixtures';

// Env-gated surface — must re-run per request so runtime env changes
// (ENABLE_EMAIL_PREVIEW) take effect. Without this, Next.js statically
// caches the 404 body at build time and never re-evaluates the gate.
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ variant: string }> },
) {
  if (!isPreviewEnabled()) {
    const diag = `Not found (gate closed: NODE_ENV=${JSON.stringify(process.env.NODE_ENV)}, ENABLE_EMAIL_PREVIEW=${JSON.stringify(process.env.ENABLE_EMAIL_PREVIEW)})`;
    return new NextResponse(diag, { status: 404 });
  }

  const { variant } = await params;
  const match = findVariant(variant);
  if (!match) {
    return new NextResponse(`Unknown variant: ${variant}`, { status: 404 });
  }

  return new NextResponse(match.html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Prevent indexing + caching — these are live previews, not
      // long-lived content.
      'X-Robots-Tag': 'noindex, nofollow',
      'Cache-Control': 'no-store, must-revalidate',
    },
  });
}
