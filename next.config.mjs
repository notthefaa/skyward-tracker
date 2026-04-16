import { withSentryConfig } from '@sentry/nextjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep these on the server — don't bundle their deps into client chunks.
  serverExternalPackages: [
    "jspdf",
    "pdf-parse",
    "openai",
    "@anthropic-ai/sdk",
    "@tavily/core",
    "resend",
  ],
  // Per-import tree-shaking for large icon / util packages.
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "@dnd-kit/core",
      "@dnd-kit/sortable",
      "@dnd-kit/utilities",
    ],
  },
  env: {
    // Uses the Git commit hash, or defaults to a constantly increasing timestamp if deployed manually
    NEXT_PUBLIC_APP_VERSION: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || Date.now().toString(),
  },
};

// withSentryConfig wraps the config for source-map upload + SDK tree-
// shaking. It's safe to run without DSN / auth token — it just skips
// the upload step. Setting `silent: true` when there's no auth token
// keeps build output clean on dev / preview.
export default withSentryConfig(nextConfig, {
  silent: !process.env.SENTRY_AUTH_TOKEN,
  widenClientFileUpload: true,
  disableLogger: true,
  automaticVercelMonitors: false,
});
