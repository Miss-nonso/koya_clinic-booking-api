import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Koya Clinic | Appointments",
  description: "Find an appointment and book a time that works for you.",
  robots: {index: false, follow: false}
};
export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
  return <html lang="en"><body>{children}</body></html>;
}
