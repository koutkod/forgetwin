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
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_ORIGIN ?? 'https://a11yrelay.ingdesir.chatgpt.site'),
  title: {
    default: 'RealityOS — The AI Firewall for a Fake Internet',
    template: '%s · RealityOS',
  },
  description: 'Investigate suspicious digital content through evidence, claim verification, and agent-native WebMCP tools.',
  openGraph: {
    title: 'RealityOS',
    description: 'The AI firewall for a fake internet.',
    type: 'website',
    images: [{url:'/og.png',width:1672,height:941,alt:'RealityOS — The AI firewall for a fake internet.'}],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'RealityOS',
    description: 'The AI firewall for a fake internet.',
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
