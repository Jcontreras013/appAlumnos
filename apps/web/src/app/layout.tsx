import type { Metadata } from "next";
import type { ReactNode } from "react";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: APP_TAGLINE,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
