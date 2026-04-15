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

export default nextConfig;
