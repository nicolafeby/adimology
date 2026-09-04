import type { Metadata } from "next";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://market.nicolaboard.my.id";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Cocokologi — Dashboard Analisis Saham",
  description:
    "Analisis target harga, broker summary, watchlist, dan performa saham dalam satu dashboard.",
  applicationName: "Cocokologi",
  openGraph: {
    type: "website",
    locale: "id_ID",
    url: "/",
    siteName: "Cocokologi",
    title: "Cocokologi — Dashboard Analisis Saham",
    description:
      "Pantau target harga, pergerakan broker, watchlist, dan performa saham dengan lebih praktis.",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "Cocokologi — Dashboard Analisis Saham",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Cocokologi — Dashboard Analisis Saham",
    description:
      "Pantau target harga, pergerakan broker, watchlist, dan performa saham dengan lebih praktis.",
    images: ["/opengraph-image"],
  },
};

import Navbar from "./components/Navbar";
import PasswordGate from "./components/PasswordGate";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  const theme = localStorage.getItem('theme');
                  if (theme === 'light') {
                    document.body.classList.add('light-theme');
                  }
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>
      <body
        className={`antialiased`}
        suppressHydrationWarning
      >
        <PasswordGate>
          <Navbar />
          {children}
        </PasswordGate>
      </body>
    </html>
  );
}
