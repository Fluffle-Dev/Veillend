import type { Metadata } from 'next';
import { headers } from 'next/headers';
import VeilLendLandingPage from '@/components/VeilLendLandingPage';
import {
  getAbsoluteUrl,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TITLE,
} from '@/lib/site';

export const revalidate = 3600;
export const dynamic = 'auto';

export const metadata: Metadata = {
  title: { absolute: SITE_TITLE },
  description: SITE_DESCRIPTION,
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: '/',
    siteName: SITE_NAME,
    images: [{ url: '/favicon.ico', alt: `${SITE_NAME} logo` }],
  },
  twitter: {
    card: 'summary_large_image',
    site: '@VeilLend',
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: ['/favicon.ico'],
  },
};

const structuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      '@id': `${getAbsoluteUrl('/')}#website`,
      url: getAbsoluteUrl('/'),
      name: SITE_NAME,
      description: SITE_DESCRIPTION,
      publisher: { '@id': `${getAbsoluteUrl('/')}#organization` },
    },
    {
      '@type': 'Organization',
      '@id': `${getAbsoluteUrl('/')}#organization`,
      name: SITE_NAME,
      url: getAbsoluteUrl('/'),
      logo: getAbsoluteUrl('/favicon.ico'),
    },
  ],
};

export default async function MarketingPage() {
  // Set by proxy.ts on every request; required so this inline script is
  // allowed under the nonce-based CSP script-src.
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  return (
    <>
      <script
        type="application/ld+json"
        nonce={nonce}
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, '\\u003c'),
        }}
      />
      <VeilLendLandingPage />
    </>
  );
}
