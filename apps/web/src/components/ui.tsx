'use client';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowRight,
  Check,
  ChevronRight,
  Globe2,
  Loader2,
  Plus,
  Search,
  X,
} from 'lucide-react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { ApiError } from '@/lib/api';
export const cn = (...inputs: Parameters<typeof clsx>) => twMerge(clsx(...inputs));
export function Button({
  className,
  variant = 'primary',
  loading = false,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  loading?: boolean;
}) {
  return (
    <button
      className={cn('button', `button-${variant}`, className)}
      {...props}
      disabled={loading || props.disabled}
    >
      {loading ? <Loader2 className="spin" size={17} /> : null}
      {children}
    </button>
  );
}
export function ButtonLink({
  href,
  children,
  variant = 'primary',
  className,
}: {
  href: string;
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost';
  className?: string;
}) {
  return (
    <Link href={href} className={cn('button', `button-${variant}`, className)}>
      {children}
    </Link>
  );
}
export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn('input', className)} {...props} />;
}
export function Label({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="label">
      {children}
    </label>
  );
}
export function ErrorMessage({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <div className="notice notice-error" role="alert">
      <AlertCircle size={19} />
      <div>
        <strong>
          {error instanceof Error ? error.message : 'Something went wrong. Please try again.'}
        </strong>
        {error instanceof ApiError && error.requestId ? (
          <small>Reference: {error.requestId}</small>
        ) : null}
        {onRetry ? (
          <button onClick={onRetry} className="text-link">
            Try again <ArrowRight size={14} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
export function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="notice" role="status">
      <Check size={18} />
      <div>{children}</div>
    </div>
  );
}
export function PageHeading({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="heading-actions">{actions}</div> : null}
    </div>
  );
}
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn('card', className)}>{children}</section>;
}
export function EmptyState({
  title,
  description,
  href,
  action = 'New project',
}: {
  title: string;
  description: string;
  href?: string;
  action?: string;
}) {
  return (
    <div className="empty-state">
      <div className="empty-orbit">
        <Globe2 size={32} />
        <i />
        <i />
      </div>
      <h2>{title}</h2>
      <p>{description}</p>
      {href ? (
        <ButtonLink href={href}>
          <Plus size={17} />
          {action}
        </ButtonLink>
      ) : null}
    </div>
  );
}
export function Loading({ count = 3 }: { count?: number }) {
  return (
    <div className="skeleton-grid" aria-label="Loading" role="status">
      {Array.from({ length: count }, (_, i) => (
        <div className="card skeleton-card" key={i}>
          <div className="skeleton" style={{ width: '45%', height: 20 }} />
          <div className="skeleton" style={{ width: '70%', height: 12, marginTop: 12 }} />
          <div className="skeleton" style={{ height: 90, marginTop: 30 }} />
        </div>
      ))}
    </div>
  );
}
export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn('badge', `badge-${status.toLowerCase()}`)}>
      <span />
      {status.toLowerCase().replaceAll('_', ' ')}
    </span>
  );
}
export function Score({
  value,
  label,
  small = false,
}: {
  value: number | null | undefined;
  label?: string;
  small?: boolean;
}) {
  const score = value == null ? null : Math.max(0, Math.min(100, Math.round(value)));
  const tone = score == null ? 'none' : score >= 90 ? 'good' : score >= 50 ? 'okay' : 'bad';
  return (
    <div className={cn('score-item', small && 'score-small')}>
      <div
        className={cn('score-ring', `score-${tone}`)}
        style={{ '--score': `${score ?? 0}%` } as React.CSSProperties}
      >
        <span>{score ?? '—'}</span>
      </div>
      {label ? <span className="score-label">{label}</span> : null}
    </div>
  );
}
export function Breadcrumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="breadcrumbs">
      {items.map((item, i) => (
        <span key={`${item.label}-${i}`}>
          {i > 0 ? <ChevronRight size={13} /> : null}
          {item.href ? (
            <Link href={item.href}>{item.label}</Link>
          ) : (
            <span aria-current="page">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dialog-overlay" />
        <DialogPrimitive.Content className="dialog">
          <DialogPrimitive.Title className="dialog-title">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="muted">{description}</DialogPrimitive.Description>
          <DialogPrimitive.Close className="dialog-close" aria-label="Close dialog">
            <X size={20} />
          </DialogPrimitive.Close>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
export function SearchBox({
  value,
  onChange,
  placeholder = 'Search projects…',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="search-box">
      <Search size={18} />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
    </div>
  );
}
