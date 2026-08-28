import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_ORIGIN ?? 'https://forgetwin.ingdesir.chatgpt.site'),
  title: 'ForgeTwin — Don’t generate it. Engineer it.',
  description: 'A world-first AI engineering sandbox where humans and agents compose, simulate, diagnose, and redesign physical systems together.',
  openGraph: {
    title: 'ForgeTwin — Don’t generate it. Engineer it.',
    description: 'AI agents compose new machines from reusable primitives, watch physics fail, inspect telemetry, and redesign the causal parts.',
    type: 'website',
    images: [{ url: '/og.png', width: 1672, height: 941, alt: 'ForgeTwin AI engineering lab with a live 3D machine and engineering telemetry.' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ForgeTwin — Don’t generate it. Engineer it.',
    description: 'A browser-based AI engineering lab powered by WebMCP and Rapier physics.',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>;
}
