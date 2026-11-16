import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Devcrew | Your work, in good company",
  description: "A focused workspace for teams that build things.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0 }}>
        {children}
      </body>
    </html>
  );
}
