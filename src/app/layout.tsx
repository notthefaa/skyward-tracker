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

// THIS TELLS ALL BROWSERS AND APPLE DEVICES TO USE YOUR ONE ICON
export const metadata: Metadata = {
  title: "Aviation Fleet Tracker",
  description: "Pilot log and maintenance tracker for the fleet",
  icons: {
    icon: '/icon.png',
    apple: '/icon.png',
  },
};

// THIS STRICTLY PREVENTS THE MOBILE AUTO-ZOOM BUG
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode; }>) {
  return (
    <html lang="en">
      <body className={`${oswald.variable} ${roboto.variable} font-roboto bg-neutral-100 text-navy`}>
        {children}
      </body>
    </html>
  );
}