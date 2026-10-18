'use client';
import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import {
  Activity,
  ArrowUpRight,
  BookOpen,
  ChevronDown,
  Command,
  LayoutGrid,
  LogOut,
  Menu,
  Moon,
  Plus,
  ScanLine,
  Settings,
  ShieldCheck,
  Sun,
  X,
} from 'lucide-react';
import { api, ApiError, post, useUser } from '@/lib/api';
import { Button, ButtonLink, ErrorMessage, Loading, cn } from './ui';
export function Logo({ light = false }: { light?: boolean }) {
  return (
    <Link href="/" className={cn('logo', light && 'logo-light')} aria-label="SiteScope home">
      <span className="logo-icon">
        <ScanLine size={23} strokeWidth={2.3} />
      </span>
      <span>
        SiteScope<span className="logo-dot">.</span>
      </span>
    </Link>
  );
}
export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const initial = localStorage.getItem('sitescope-theme') === 'dark';
    setDark(initial);
    document.documentElement.dataset.theme = initial ? 'dark' : 'light';
  }, []);
  return (
    <button
      className="icon-button"
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      onClick={() => {
        setDark(!dark);
        localStorage.setItem('sitescope-theme', dark ? 'light' : 'dark');
        document.documentElement.dataset.theme = dark ? 'light' : 'dark';
      }}
    >
      {dark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
export function Shell({ children }: { children: ReactNode }) {
  const t = useTranslations('common');
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useUser();
  const [mobile, setMobile] = useState(false);
  const [logoutError, setLogoutError] = useState<unknown>(null);
  useEffect(() => {
    if (user.error instanceof ApiError && user.error.status === 401) router.replace('/login');
  }, [user.error, router]);
  useEffect(() => setMobile(false), [pathname]);
  const nav = [
    { href: '/dashboard', label: t('projects'), icon: LayoutGrid },
    { href: '/settings', label: t('settings'), icon: Settings },
    ...(user.data?.user.role === 'ADMIN'
      ? [{ href: '/admin', label: t('admin'), icon: ShieldCheck }]
      : []),
  ];
  async function logout() {
    try {
      await post('/auth/logout');
      queryClient.clear();
      router.push('/login');
    } catch (e) {
      setLogoutError(e);
    }
  }
  return (
    <div className="app-layout">
      <aside className={cn('sidebar', mobile && 'sidebar-open')}>
        <div className="sidebar-top">
          <Logo light />
          <button
            className="icon-button mobile-only"
            aria-label="Close navigation"
            onClick={() => setMobile(false)}
          >
            <X size={20} />
          </button>
        </div>
        <div className="workspace-switch">
          <span className="workspace-avatar">
            {(user.data?.user.name || user.data?.user.email || 'W').slice(0, 1).toUpperCase()}
          </span>
          <div>
            <strong>Personal workspace</strong>
            <small>Developer edition</small>
          </div>
          <ChevronDown size={15} />
        </div>
        <div className="sidebar-label">WORKSPACE</div>
        <nav className="sidebar-nav" aria-label="Workspace">
          {nav.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={cn(
                (pathname === n.href ||
                  (n.href === '/dashboard' && pathname.startsWith('/projects'))) &&
                  'active',
              )}
            >
              <n.icon size={19} />
              {n.label}
              {n.href === '/dashboard' ? <span className="nav-indicator" /> : null}
            </Link>
          ))}
        </nav>
        <div className="sidebar-promo">
          <span className="promo-icon">
            <Activity size={21} />
          </span>
          <h3>
            Small details.
            <br />
            Better websites.
          </h3>
          <p>Turn technical signals into your next improvement.</p>
          <Link href="/projects/new">
            Audit a website <ArrowUpRight size={16} />
          </Link>
        </div>
        <div className="sidebar-bottom">
          <a href="/#how-it-works">
            <BookOpen size={17} />
            How it works
            <ArrowUpRight size={14} />
          </a>
          <button onClick={logout}>
            <LogOut size={17} />
            {t('signOut')}
          </button>
          <div className="sidebar-version">
            <span className="status-dot" />
            SiteScope v1.0
          </div>
        </div>
      </aside>
      {mobile ? (
        <button
          className="mobile-backdrop"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      ) : null}
      <div className="main-wrapper">
        <header className="topbar">
          <div className="topbar-context">
            <button
              className="icon-button mobile-only"
              onClick={() => setMobile(true)}
              aria-label="Open navigation"
            >
              <Menu size={22} />
            </button>
            <span className="muted">Workspace</span>
            <span className="topbar-divider">/</span>
            <strong>
              {pathname === '/dashboard'
                ? 'Projects'
                : pathname === '/settings'
                  ? 'Settings'
                  : pathname === '/admin'
                    ? 'System overview'
                    : pathname.startsWith('/audits')
                      ? 'Audit report'
                      : 'Projects'}
            </strong>
          </div>
          <div className="topbar-actions">
            <span className="private-label">
              <ShieldCheck size={14} />
              Private workspace
            </span>
            <ThemeToggle />
            <Link href="/settings" className="profile-avatar" aria-label="Account settings">
              {(user.data?.user.name || user.data?.user.email || 'U').slice(0, 1).toUpperCase()}
            </Link>
          </div>
        </header>
        <main id="main" className="app-main">
          {logoutError ? <ErrorMessage error={logoutError} /> : null}
          {user.isPending ? (
            <Loading />
          ) : user.error ? (
            <ErrorMessage error={user.error} onRetry={() => void user.refetch()} />
          ) : (
            children
          )}
        </main>
        <footer className="app-footer">
          <span>© {new Date().getFullYear()} SiteScope</span>
          <span>
            <span className="status-dot" /> Built for a better web
          </span>
        </footer>
      </div>
    </div>
  );
}
