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
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#091F3C",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <meta name="theme-color" content="#091F3C" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body className={`${oswald.variable} ${roboto.variable} font-roboto antialiased`}>
        {children}
      </body>
    </html>
  );
}
