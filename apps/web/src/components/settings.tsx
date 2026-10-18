'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Check, Mail, ShieldCheck, Trash2 } from 'lucide-react';
import { api, date, post, useUser } from '@/lib/api';
import type { Usage } from './dashboard';
import { VerificationNotice } from './dashboard';
import { ThemeToggle } from './shell';
import {
  Button,
  Card,
  ErrorMessage,
  Input,
  Label,
  Modal,
  Notice,
  PageHeading,
  StatusBadge,
} from './ui';
const schema = z.object({
  name: z.string().trim().min(1, 'Enter your name.').max(80, 'Use 80 characters or fewer.'),
});
export function SettingsPage() {
  const user = useUser();
  const router = useRouter();
  const client = useQueryClient();
  const [saved, setSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState('');
  const [resetSent, setResetSent] = useState(false);
  const usage = useQuery({ queryKey: ['usage'], queryFn: () => api<Usage>('/users/me/usage') });
  const {
    register,
    reset,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  useEffect(() => {
    if (user.data) reset({ name: user.data.user.name });
  }, [user.data, reset]);
  const update = useMutation({
    mutationFn: (data: z.infer<typeof schema>) =>
      api('/users/me', { method: 'PATCH', body: JSON.stringify(data) }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['me'] });
      setSaved(true);
    },
  });
  const remove = useMutation({
    mutationFn: () => api('/users/me', { method: 'DELETE', body: JSON.stringify({ password }) }),
    onSuccess: () => {
      client.clear();
      router.push('/');
    },
  });
  const resetPassword = useMutation({
    mutationFn: () => post('/auth/forgot-password', { email: user.data?.user.email }),
    onSuccess: () => setResetSent(true),
  });
  return (
    <>
      <PageHeading
        eyebrow="YOUR WORKSPACE, YOUR WAY"
        title="Account settings."
        description="A few personal details, and the things that keep your workspace yours."
      />
      <VerificationNotice />
      <div className="settings-stack">
        <Card className="settings-card">
          <h2>Personal details</h2>
          <p>How you appear in your personal workspace.</p>
          {saved ? <Notice>Your profile has been updated.</Notice> : null}
          <ErrorMessage error={update.error} />
          <form
            noValidate
            onSubmit={handleSubmit(async (data) => {
              setSaved(false);
              await update.mutateAsync(data).catch(() => {});
            })}
          >
            <div className="form-field">
              <Label htmlFor="profile-name">Your name</Label>
              <Input id="profile-name" autoComplete="name" {...register('name')} />
              {errors.name ? <span className="field-error">{errors.name.message}</span> : null}
            </div>
            <div className="form-field">
              <Label htmlFor="profile-email">Email address</Label>
              <Input id="profile-email" type="email" value={user.data?.user.email ?? ''} disabled />
              <p className="form-hint">
                {user.data?.user.emailVerifiedAt
                  ? 'Verified email address.'
                  : 'Verification is required before running audits.'}
              </p>
            </div>
            <div className="form-actions">
              <Button type="submit" loading={isSubmitting || update.isPending}>
                Save changes
              </Button>
            </div>
          </form>
        </Card>
        <Card className="settings-card">
          <h2>Security</h2>
          <p>
            Your sessions use secure, private cookies. Your password is stored as a protected hash.
          </p>
          <ErrorMessage error={resetPassword.error} />
          {resetSent ? (
            <Notice>A password reset link is on its way to your email address.</Notice>
          ) : (
            <Button
              variant="secondary"
              loading={resetPassword.isPending}
              onClick={() => resetPassword.mutate()}
            >
              <Mail size={15} />
              Send password reset email
            </Button>
          )}
        </Card>
        <Card className="settings-card">
          <h2>Workspace usage</h2>
          <p>Current limits for this developer edition.</p>
          {usage.data ? (
            <>
              <div className="service-row">
                <span>Projects</span>
                <strong>
                  {usage.data.projects} / {usage.data.maxProjects}
                </strong>
              </div>
              <div className="service-row">
                <span>Audits today</span>
                <strong>
                  {usage.data.auditsToday} / {usage.data.auditsPerDay}
                </strong>
              </div>
              <div className="service-row">
                <span>Active audits</span>
                <strong>{usage.data.activeAudits} / 1</strong>
              </div>
              <p className="form-hint">
                Daily usage resets {date(usage.data.resetsAt)} (shown in your local time).
              </p>
            </>
          ) : (
            <ErrorMessage error={usage.error} />
          )}
        </Card>
        <Card className="settings-card">
          <h2>Appearance</h2>
          <p>Choose a lighter or darker perspective. Your choice is saved on this device.</p>
          <div className="service-row">
            <span>Color theme</span>
            <ThemeToggle />
          </div>
        </Card>
        <Card className="settings-card danger-zone">
          <h2>Delete account</h2>
          <p>
            Permanently delete your account, projects, saved audits, screenshots, and PDF reports.
            Wait for active audits and exports to finish first.
          </p>
          <Button variant="secondary" onClick={() => setDeleting(true)}>
            <Trash2 size={15} />
            Delete my account
          </Button>
        </Card>
      </div>
      <Modal
        open={deleting}
        onOpenChange={setDeleting}
        title="Close your workspace?"
        description="All of your account data and reports will be permanently removed. Enter your password to confirm. This action cannot be undone."
      >
        <ErrorMessage error={remove.error} />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            remove.mutate();
          }}
        >
          <Label htmlFor="delete-password">Current password</Label>
          <Input
            id="delete-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <div className="form-actions">
            <Button type="button" variant="secondary" onClick={() => setDeleting(false)}>
              Keep account
            </Button>
            <Button type="submit" variant="danger" loading={remove.isPending}>
              Delete permanently
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
