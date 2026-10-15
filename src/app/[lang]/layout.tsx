import type { Metadata } from "next";
import { loadLocale } from "@/i18n/server";
import "../globals.css";

export async function generateMetadata({ params }: LayoutProps<"/[lang]">): Promise<Metadata> {
  const { dict } = await loadLocale(params);
  return {
    title: { default: dict.app.name, template: `%s | ${dict.app.name}` },
    description: dict.app.tagline,
    robots: { index: false, follow: false },
  };
}

export default async function RootLayout({ children, params }: LayoutProps<"/[lang]">) {
  const { lang } = await loadLocale(params);
  return (
    <html lang={lang}>
      <body>{children}</body>
    </html>
  );
}
