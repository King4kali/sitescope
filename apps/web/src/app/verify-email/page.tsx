import { Suspense } from 'react';
import { AuthForm } from '@/components/auth-form';
export const metadata = { title: 'Verify email' };
export default function Page() {
  return (
    <Suspense>
      <AuthForm mode="verify" />
    </Suspense>
  );
}
