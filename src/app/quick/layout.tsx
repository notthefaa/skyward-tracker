import type { Metadata, Viewport } from "next";

// This aggressively overrides the main app's meta tags so iOS Safari doesn't get confused
export const metadata: Metadata = {
  title: "Log It",
  description: "Fast flight and squawk logging.",
  manifest: "/quick-manifest.json", // Hard-links to the static manifest
  appleWebApp: {
    capable: true,
    title: "Log It", // Forces iOS to use this name on the Home Screen
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: '/quick-icon.png',
    apple: '/quick-icon.png',
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function QuickLayout({
  children,
}: Readonly<{ children: React.ReactNode; }>) {
  return <>{children}</>;
}