'use client';
import { Button } from '@/components/ui';
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main id="main" className="standalone-state">
      <h1>Something interrupted this page.</h1>
      <p>Your saved projects and reports are still in your workspace.</p>
      <Button onClick={reset}>Try again</Button>
    </main>
  );
}
