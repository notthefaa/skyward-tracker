/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["jspdf"],
  env: {
    // Uses the Git commit hash, or defaults to a constantly increasing timestamp if deployed manually
    NEXT_PUBLIC_APP_VERSION: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || Date.now().toString(),
  },
};

export default nextConfig;