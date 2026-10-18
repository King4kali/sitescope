import { ButtonLink } from '@/components/ui';
export default function NotFound() {
  return (
    <main id="main" className="standalone-state">
      <div className="eyebrow">404 · OFF THE MAP</div>
      <h1>This page is out of scope.</h1>
      <p>Let’s get you back to your websites.</p>
      <ButtonLink href="/dashboard">Go to workspace</ButtonLink>
    </main>
  );
}
