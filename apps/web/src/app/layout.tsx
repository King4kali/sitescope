import type { Metadata, Viewport } from 'next';
import { Providers } from '@/components/providers';
import './globals.css';
export const metadata: Metadata = {
  title: {
    default: 'SiteScope — Know your website. Improve what matters.',
    template: '%s · SiteScope',
  },
  description:
    'Real website audits. Measure performance, uncover technical SEO and accessibility issues, inspect security headers, and track improvements in one workspace.',
  applicationName: 'SiteScope',
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#112827' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
