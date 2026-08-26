import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_ORIGIN ?? 'http://localhost:3000'),
  title: {
    default: 'A11yRelay — Accessibility remediation for humans and agents',
    template: '%s · A11yRelay',
  },
  description: 'Find accessibility barriers, fix what is safe, and ask humans when meaning matters with structured WebMCP tools.',
  openGraph: {
    title: 'A11yRelay',
    description: 'Accessibility remediation for humans and AI agents.',
    type: 'website',
    images: [{url:'/og.png',width:1792,height:1024,alt:'A11yRelay — Accessibility remediation for humans and AI agents.'}],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'A11yRelay',
    description: 'Accessibility remediation for humans and AI agents.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
