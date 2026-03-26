import type { Metadata, Viewport } from "next";
import { Oswald, Roboto } from "next/font/google";
import "./globals.css";

const oswald = Oswald({ 
  subsets: ["latin"], 
  variable: "--font-oswald", 
  weight: ["400", "700"] 
});

const roboto = Roboto({ 
  subsets: ["latin"], 
  variable: "--font-roboto", 
  weight: ["400", "500", "700"] 
});

export const metadata: Metadata = {
  title: "Aviation Fleet Tracker",
  description: "Aircraft fleet management, maintenance tracking, and flight logging.",
  appleWebApp: {
    capable: true,
    title: "Fleet Tracker",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#091F3C",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${oswald.variable} ${roboto.variable} font-roboto bg-navy antialiased`}>
        {children}
      </body>
    </html>
  );
}
