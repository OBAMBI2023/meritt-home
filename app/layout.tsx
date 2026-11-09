import './globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { SITE } from '@/lib/site';
import { APPLE_STARTUP_IMAGES } from '@/lib/pwa-splash';
import { SplashScreen } from '@/components/shop/splash-screen';
import { SPLASH_SESSION_KEY } from '@/components/shop/splash-config';

const sans = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-sans' });

// Exécuté avant le premier affichage : masque l'écran de lancement s'il a déjà été vu pendant cette session.
const splashGuard = `try{if(sessionStorage.getItem('${SPLASH_SESSION_KEY}'))document.documentElement.classList.add('splash-seen')}catch(e){}`;

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
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: `Logo ${SITE.name}` }],
  },
  manifest: '/manifest.webmanifest',
  themeColor: '#F8F6F1',
  appleWebApp: {
    capable: true,
    title: SITE.name,
    statusBarStyle: 'default',
    startupImage: APPLE_STARTUP_IMAGES,
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description: SITE.description,
    images: ['/og-image.png'],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr" className={sans.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: splashGuard }} />
      </head>
      <body className="font-sans">
        <SplashScreen />
        {children}
      </body>
    </html>
  );
}
