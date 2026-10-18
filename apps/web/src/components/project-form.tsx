'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, Check, Globe2, ShieldCheck } from 'lucide-react';
import { post } from '@/lib/api';
import type { Project } from '@/lib/types';
import {
  Breadcrumbs,
  Button,
  ButtonLink,
  Card,
  ErrorMessage,
  Input,
  Label,
  PageHeading,
} from './ui';
const schema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Give your project a name.')
    .max(80, 'Use 80 characters or fewer.'),
  url: z
    .url('Enter a complete website address, including https://.')
    .max(2048)
    .refine((v) => {
      try {
        return ['http:', 'https:'].includes(new URL(v).protocol);
      } catch {
        return false;
      }
    }, 'Use an HTTP or HTTPS address.'),
});
export function NewProject() {
  const router = useRouter();
  const client = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', url: '' },
  });
  return (
    <>
      <Breadcrumbs items={[{ label: 'Projects', href: '/dashboard' }, { label: 'New project' }]} />
      <PageHeading
        eyebrow="A NEW PERSPECTIVE"
        title="Give your website a home."
        description="Create a project to keep its audits, findings, and progress in one place."
      />
      <div className="content-two-col">
        <Card className="form-card">
          <h2>Project details</h2>
          <p>You can rename your project anytime. Each audit checks this website’s public URL.</p>
          <ErrorMessage error={error} />
          <form
            noValidate
            onSubmit={handleSubmit(async (data) => {
              setError(null);
              try {
                const project = await post<Project>('/projects', data);
                await Promise.all([
                  client.invalidateQueries({ queryKey: ['projects'] }),
                  client.invalidateQueries({ queryKey: ['usage'] }),
                ]);
                router.push(`/projects/${project.id}`);
              } catch (e) {
                setError(e);
              }
            })}
          >
            <div className="form-field">
              <Label htmlFor="project-name">Project name</Label>
              <Input id="project-name" placeholder="My portfolio" {...register('name')} />
              {errors.name ? <span className="field-error">{errors.name.message}</span> : null}
            </div>
            <div className="form-field">
              <Label htmlFor="project-url">Website URL</Label>
              <Input
                id="project-url"
                type="url"
                placeholder="https://example.com"
                {...register('url')}
              />
              {errors.url ? <span className="field-error">{errors.url.message}</span> : null}
              <p className="form-hint">
                A publicly accessible HTTP or HTTPS page. Local networks and websites requiring
                sign-in are not supported.
              </p>
            </div>
            <div className="divider" />
            <div className="form-actions">
              <ButtonLink href="/dashboard" variant="ghost">
                Cancel
              </ButtonLink>
              <Button loading={isSubmitting} type="submit">
                Create project
                <ArrowRight size={15} />
              </Button>
            </div>
          </form>
        </Card>
        <Card className="side-note">
          <span className="feature-icon">
            <Globe2 size={21} />
          </span>
          <h3>A closer look, from every angle.</h3>
          <ul className="check-list">
            {[
              'Mobile and desktop performance',
              'Technical SEO and accessibility',
              'Links, HTTPS, and security headers',
              'Screenshots and a shareable PDF',
            ].map((s) => (
              <li key={s}>
                <Check size={14} />
                {s}
              </li>
            ))}
          </ul>
          <div className="divider" />
          <p className="form-hint">
            <ShieldCheck
              size={15}
              style={{ display: 'inline', verticalAlign: 'middle', marginRight: 5 }}
            />
            Your reports are private. Audit only websites you’re authorized to inspect.
          </p>
        </Card>
      </div>
    </>
  );
}
