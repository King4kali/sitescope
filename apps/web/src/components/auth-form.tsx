'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, ArrowRight, Check, ShieldCheck } from 'lucide-react';
import { post } from '@/lib/api';
import { Logo } from './shell';
import { Button, ButtonLink, ErrorMessage, Input, Label, Notice } from './ui';
type Mode = 'login' | 'register' | 'forgot' | 'reset' | 'verify';
type Fields = { email?: string; password?: string; name?: string };
const copy = {
  login: {
    title: 'Welcome back.',
    description: 'Your websites. Your insights. Right where you left them.',
    button: 'Sign in',
  },
  register: {
    title: 'A clearer picture starts here.',
    description: 'Create your workspace and get to know your website.',
    button: 'Create account',
  },
  forgot: {
    title: 'Let’s get you back in.',
    description: 'Enter your email and we’ll send you a password reset link.',
    button: 'Send reset link',
  },
  reset: {
    title: 'A fresh start.',
    description: 'Choose a new password for your SiteScope account.',
    button: 'Reset password',
  },
  verify: {
    title: 'Verify your email.',
    description: 'Confirm your email address to start running website audits.',
    button: 'Confirm email',
  },
};
export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const params = useSearchParams();
  const client = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  const [success, setSuccess] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const token = params.get('token');
  const schema = z
    .object({
      name: z.string().optional(),
      email: z.string().optional(),
      password: z.string().optional(),
    })
    .superRefine((data, ctx) => {
      if (
        ['login', 'register', 'forgot'].includes(mode) &&
        !z.email().safeParse(data.email).success
      )
        ctx.addIssue({ code: 'custom', message: 'Enter a valid email address.', path: ['email'] });
      if (
        ['login', 'register', 'reset'].includes(mode) &&
        (!data.password || data.password.length < (mode === 'login' ? 1 : 12))
      )
        ctx.addIssue({
          code: 'custom',
          message: mode === 'login' ? 'Enter your password.' : 'Use at least 12 characters.',
          path: ['password'],
        });
      if (mode === 'register' && (!data.name?.trim() || data.name.length > 80))
        ctx.addIssue({
          code: 'custom',
          message: 'Enter your name (up to 80 characters).',
          path: ['name'],
        });
    });
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Fields>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '', name: '' },
  });
  async function submit(data: Fields) {
    setError(null);
    try {
      if (mode === 'login' || mode === 'register') {
        await post(
          `/auth/${mode}`,
          mode === 'register' ? data : { email: data.email, password: data.password },
        );
        await client.invalidateQueries({ queryKey: ['me'] });
        router.push('/dashboard');
      } else if (mode === 'forgot') {
        await post('/auth/forgot-password', { email: data.email });
        setSuccess(true);
      } else if (mode === 'reset') {
        if (!token)
          throw new Error('This reset link is incomplete. Request a new password reset email.');
        await post('/auth/reset-password', { token, password: data.password });
        setSuccess(true);
      }
    } catch (e) {
      setError(e);
    }
  }
  async function verify() {
    setError(null);
    setVerifying(true);
    try {
      if (!token)
        throw new Error('This verification link is incomplete. Sign in to request a new email.');
      await post('/auth/verify', { token });
      await client.invalidateQueries({ queryKey: ['me'] });
      setSuccess(true);
    } catch (e) {
      setError(e);
    } finally {
      setVerifying(false);
    }
  }
  return (
    <div className="auth-layout">
      <aside className="auth-aside">
        <Logo light />
        <div className="auth-story">
          <div className="eyebrow">A LITTLE CLARITY GOES A LONG WAY</div>
          <h1>
            Better insights.
            <br />
            <em>Better websites.</em>
          </h1>
          <p>
            Get a thoughtful, complete view of your website. Turn real technical signals into
            meaningful improvements.
          </p>
          <div className="auth-feature">
            <ShieldCheck size={19} />
            <span>A private workspace for your next big improvement.</span>
          </div>
        </div>
        <div className="auth-aside-footer">Performance · Accessibility · SEO · Security</div>
      </aside>
      <main id="main" className="auth-main">
        <div className="auth-form">
          <Logo />
          <h1>{copy[mode].title}</h1>
          <p className="auth-description">{copy[mode].description}</p>
          <ErrorMessage error={error} />
          {success ? (
            <>
              <Notice>
                {mode === 'forgot'
                  ? 'If an account exists for this email, a password reset link is on its way. Check your inbox.'
                  : mode === 'reset'
                    ? 'Your password has been updated. You can now sign in.'
                    : 'Your email is verified. You’re ready to run your first audit.'}
              </Notice>
              <ButtonLink href={mode === 'verify' ? '/dashboard' : '/login'}>
                {mode === 'verify' ? 'Go to workspace' : 'Back to sign in'}
                <ArrowRight size={15} />
              </ButtonLink>
            </>
          ) : mode === 'verify' ? (
            <>
              <Button loading={verifying} onClick={verify}>
                Confirm email <ArrowRight size={15} />
              </Button>
              <p className="auth-footer">
                <Link href="/dashboard">Return to workspace</Link>
              </p>
            </>
          ) : (
            <form onSubmit={handleSubmit(submit)} noValidate>
              {mode === 'register' ? (
                <div className="form-field">
                  <Label htmlFor="name">Your name</Label>
                  <Input
                    id="name"
                    autoComplete="name"
                    placeholder="Alex Morgan"
                    {...register('name')}
                  />
                  {errors.name ? <span className="field-error">{errors.name.message}</span> : null}
                </div>
              ) : null}
              {['login', 'register', 'forgot'].includes(mode) ? (
                <div className="form-field">
                  <Label htmlFor="email">Email address</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@company.com"
                    {...register('email')}
                  />
                  {errors.email ? (
                    <span className="field-error">{errors.email.message}</span>
                  ) : null}
                </div>
              ) : null}
              {['login', 'register', 'reset'].includes(mode) ? (
                <div className="form-field">
                  <div className="auth-password-label">
                    <Label htmlFor="password">
                      {mode === 'reset' ? 'New password' : 'Password'}
                    </Label>
                    {mode === 'login' ? (
                      <Link href="/forgot-password">Forgot password?</Link>
                    ) : null}
                  </div>
                  <Input
                    id="password"
                    type="password"
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    placeholder={
                      mode === 'login' ? 'Enter your password' : 'At least 12 characters'
                    }
                    {...register('password')}
                  />
                  {errors.password ? (
                    <span className="field-error">{errors.password.message}</span>
                  ) : null}
                  {mode === 'register' ? (
                    <p className="form-hint">Use a unique password with at least 12 characters.</p>
                  ) : null}
                </div>
              ) : null}
              <Button type="submit" loading={isSubmitting}>
                {copy[mode].button}
                <ArrowRight size={15} />
              </Button>
            </form>
          )}
          {!success && mode === 'login' ? (
            <p className="auth-footer">
              New to SiteScope? <Link href="/register">Create an account</Link>
            </p>
          ) : null}
          {!success && mode === 'register' ? (
            <>
              <p className="auth-footer">
                Already have an account? <Link href="/login">Sign in</Link>
              </p>
              <p className="auth-fine-print">
                We’ll send a verification email to your address.
                <br />
                Only audit public websites you’re authorized to inspect.
              </p>
            </>
          ) : null}
          {!success && ['forgot', 'reset'].includes(mode) ? (
            <p className="auth-footer">
              <Link href="/login">Back to sign in</Link>
            </p>
          ) : null}
        </div>
      </main>
    </div>
  );
}
