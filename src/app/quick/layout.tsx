import type { Metadata, Viewport } from "next";

// This overrides the main app's icon and manifest when on the /quick route
export const metadata: Metadata = {
  title: "Quick Pad",
  description: "Fast flight and squawk logging.",
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