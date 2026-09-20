import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AppProvider } from '@/lib/state';
import { Shell } from '@/components/Shell';

export const metadata: Metadata = {
  title: 'Sabaq · AI Learning Experience Engine',
  description:
    'Turns any document or topic into an adaptive, voice-enabled learning mission, and infers mastery from what the learner does instead of testing them.',
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: '#070f1c',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Nastaliq+Urdu:wght@400;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-ink-900 text-slate-100 antialiased">
        <AppProvider>
          <Shell>{children}</Shell>
        </AppProvider>
      </body>
    </html>
  );
}
