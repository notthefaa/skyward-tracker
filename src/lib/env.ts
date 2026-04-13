// =============================================================
// SERVER-SIDE ENVIRONMENT CONFIGURATION
// Validates required env vars at import time so misconfigured
// deployments fail fast with a clear message.
// =============================================================

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
      `Check your .env.local file or Vercel environment settings.`
    );
  }
  return value;
}

// These are validated once when the module is first imported
export const env = {
  SUPABASE_URL: requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
  SUPABASE_SERVICE_ROLE_KEY: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  RESEND_API_KEY: requireEnv('RESEND_API_KEY'),
  CRON_SECRET: requireEnv('CRON_SECRET'),
  ANTHROPIC_API_KEY: requireEnv('ANTHROPIC_API_KEY'),
} as const;
