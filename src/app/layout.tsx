import type { Metadata, Viewport } from "next";
import { Oswald, Roboto } from "next/font/google";
import { Providers } from "@/components/Providers";
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
  title: "Skyward Aircraft Manager",
  description: "Aircraft fleet management, maintenance tracking, mechanic coordination, and flight logging by Skyward Society.",
  icons: {
    icon: "/icon.png",
    shortcut: "/icon.png",
    apple: "/icon.png",
  },
  appleWebApp: {
    capable: true,
    title: "Aircraft Manager",
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
      <body className={`${oswald.variable} ${roboto.variable} font-roboto bg-white antialiased`}>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
