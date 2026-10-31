import './globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { SITE } from '@/lib/site';

const sans = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-sans' });

const title = `${SITE.name} — ${SITE.tagline}`;

export const metadata: Metadata = {
  // URL publique du site (à définir au déploiement) ; repli local pour le développement.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  title,
  description: SITE.description,
  openGraph: {
    type: 'website',
    locale: 'fr_FR',
    siteName: SITE.name,
    title,
    description: SITE.description,
    images: [{ url: SITE.heroImage, alt: `Salon aménagé avec du mobilier ${SITE.name}` }],
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description: SITE.description,
    images: [SITE.heroImage],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr" className={sans.variable}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
