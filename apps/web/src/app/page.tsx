import Link from 'next/link';
import {
  Accessibility,
  Activity,
  ArrowDown,
  ArrowRight,
  Check,
  CheckCheck,
  ChevronRight,
  Code2,
  FileCheck2,
  Fingerprint,
  Globe2,
  Layers,
  Link2,
  LockKeyhole,
  Monitor,
  Search,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Zap,
} from 'lucide-react';
import { Logo } from '@/components/shell';
import { ButtonLink } from '@/components/ui';
const features = [
  {
    icon: Zap,
    title: 'Speed you can measure.',
    body: 'Real Lighthouse results for mobile and desktop. See LCP, CLS, TBT, and the details behind your performance.',
  },
  {
    icon: Search,
    title: 'Get the technical details right.',
    body: 'Check metadata, indexability, canonical URLs, headings, and internal links across your most important pages.',
  },
  {
    icon: Accessibility,
    title: 'A web that works for more people.',
    body: 'Find automatically detectable accessibility issues with Lighthouse and axe, with evidence and practical recommendations.',
  },
  {
    icon: ShieldCheck,
    title: 'Inspect your first line of defense.',
    body: 'Review HTTPS, TLS certificates, and security headers. Make informed improvements with transparent findings.',
  },
  {
    icon: Layers,
    title: 'Every check has a history.',
    body: 'Keep independent audit snapshots. Compare runs, follow changes, and see what your improvements actually changed.',
  },
  {
    icon: FileCheck2,
    title: 'Share something actionable.',
    body: 'Export a PDF with actual measurements, screenshots, and recommendations from a specific audit.',
  },
];
export default function Landing() {
  return (
    <div className="landing">
      <header className="landing-header">
        <Logo />
        <nav className="landing-nav" aria-label="Main navigation">
          <a href="#features">Capabilities</a>
          <a href="#how-it-works">How it works</a>
          <a href="#principles">Our approach</a>
        </nav>
        <div className="landing-actions">
          <Link href="/login">Sign in</Link>
          <ButtonLink href="/register">
            Get started <ArrowRight size={14} />
          </ButtonLink>
        </div>
      </header>
      <main id="main">
        <section className="hero">
          <div>
            <span className="hero-label">
              <span className="status-dot" />
              YOUR WEBSITE, WITH A CLEARER PICTURE
            </span>
            <h1>
              Know your website.
              <br />
              <em>
                Improve what
                <br />
                matters.
              </em>
            </h1>
            <p className="hero-description">
              Performance, accessibility, SEO, and security signals. One thoughtful workspace to
              understand your website and make your next move.
            </p>
            <div className="hero-actions">
              <ButtonLink href="/register">
                Start your first audit <ArrowRight size={16} />
              </ButtonLink>
              <ButtonLink href="#how-it-works" variant="secondary">
                See how it works <ArrowDown size={14} />
              </ButtonLink>
            </div>
            <div className="hero-notes">
              <span>
                <Check size={12} />
                No installation needed
              </span>
              <span>
                <Check size={12} />
                Real measurements
              </span>
              <span>
                <Check size={12} />
                Private reports
              </span>
            </div>
          </div>
          <div className="hero-visual" aria-label="Illustration of the SiteScope audit workflow">
            <div className="browser-illustration">
              <div className="browser-chrome">
                <i />
                <i />
                <i />
                <span>
                  <LockKeyhole size={9} />
                  Your private workspace
                </span>
              </div>
              <div className="illustration-content">
                <div className="illustration-top">
                  <div className="illustration-site">
                    <span>
                      <Globe2 size={18} />
                    </span>
                    <div>
                      <h3>Your next improvement</h3>
                      <small>A complete view of your website</small>
                    </div>
                  </div>
                  <span className="illustration-badge">Website health</span>
                </div>
                <div className="illustration-lines">
                  {[
                    { icon: Zap, label: 'Performance' },
                    { icon: Accessibility, label: 'Accessibility' },
                    { icon: Search, label: 'SEO' },
                    { icon: ShieldCheck, label: 'Security' },
                  ].map((m) => (
                    <div className="illustration-module" key={m.label}>
                      <m.icon size={23} />
                      <strong>{m.label}</strong>
                      <span />
                    </div>
                  ))}
                </div>
                <div className="illustration-chart">
                  <svg viewBox="0 0 400 100" aria-hidden="true" preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#9bb779" stopOpacity=".3" />
                        <stop offset="100%" stopColor="#9bb779" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <path
                      d="M0 82C30 80 40 70 65 70S100 76 130 57 166 60 195 45 229 49 257 31 290 38 320 22 360 24 400 7V100H0Z"
                      fill="url(#chartFill)"
                    />
                    <path
                      d="M0 82C30 80 40 70 65 70S100 76 130 57 166 60 195 45 229 49 257 31 290 38 320 22 360 24 400 7"
                      fill="none"
                      stroke="#85a660"
                      strokeWidth="2.5"
                    />
                  </svg>
                </div>
                <div className="illustration-footer">
                  <span>MEASURE</span>
                  <ChevronRight size={10} />
                  <span>UNDERSTAND</span>
                  <ChevronRight size={10} />
                  <span>IMPROVE</span>
                </div>
              </div>
            </div>
            <div className="floating-label">
              <span>
                <CheckCheck size={17} />
              </span>
              <div>
                <strong>Clarity comes first.</strong>
                <small>Every finding. Every next step.</small>
              </div>
            </div>
            <p className="illustration-caption">
              Illustrative product overview · Your reports use actual audit results
            </p>
          </div>
        </section>
        <div className="landing-strip">
          <div className="landing-strip-inner">
            <span>
              <Activity size={17} />
              Powered by real signals
            </span>
            <span>
              <Zap size={17} />
              Lighthouse
            </span>
            <span>
              <Accessibility size={17} />
              axe-core
            </span>
            <span>
              <Monitor size={17} />
              Desktop & mobile
            </span>
            <span>
              <Code2 size={17} />
              HTTP & TLS
            </span>
          </div>
        </div>
        <section id="features" className="landing-section">
          <div className="eyebrow">THE SIGNAL, WITHOUT THE NOISE</div>
          <h2>
            A little less guesswork.
            <br />A lot more understanding.
          </h2>
          <p>
            From the first response to the smallest technical detail, find the things that deserve
            your attention.
          </p>
          <div className="feature-grid">
            {features.map((f) => (
              <article className="feature-card" key={f.title}>
                <div className="feature-icon">
                  <f.icon size={21} />
                </div>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </article>
            ))}
          </div>
        </section>
        <section id="how-it-works" className="process-section">
          <div className="process-inner">
            <div className="process-intro">
              <div className="eyebrow">FROM URL TO UNDERSTANDING</div>
              <h2>
                Your next step,
                <br />
                made clearer.
              </h2>
              <p>
                No plugins to install. No code to paste. Just a public website and a few moments to
                look a little closer.
              </p>
            </div>
            <div className="process-steps">
              {[
                {
                  n: '01',
                  title: 'Give your website a home.',
                  text: 'Create a project with a public HTTP or HTTPS URL. Keep your sites and their audit histories neatly organized.',
                },
                {
                  n: '02',
                  title: 'Let the checks run.',
                  text: 'Follow the actual audit stages as we fetch your site, measure both devices, and inspect links, metadata, and headers.',
                },
                {
                  n: '03',
                  title: 'Make progress you can see.',
                  text: 'Review findings and evidence, take your next step, then run another audit to compare. Export a PDF when you need to share.',
                },
              ].map((s) => (
                <div className="process-step" key={s.n}>
                  <span>{s.n}</span>
                  <div>
                    <h3>{s.title}</h3>
                    <p>{s.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
        <section id="principles" className="landing-section">
          <div className="eyebrow">CLEAR ABOUT WHAT WE CHECK</div>
          <h2>
            Useful signals.
            <br />
            Honest boundaries.
          </h2>
          <p>
            SiteScope inspects public pages and reports actual results. Automated accessibility
            checks do not certify WCAG compliance. Technical SEO checks do not guarantee rankings,
            and header checks are not a penetration test.
          </p>
          <div className="hero-notes">
            <span>
              <Fingerprint size={14} />
              Your reports stay private
            </span>
            <span>
              <Link2 size={14} />
              Respectful, limited crawling
            </span>
          </div>
        </section>
        <section className="landing-cta">
          <div>
            <h2>A better website starts with a closer look.</h2>
            <p>Create your workspace and find your next improvement.</p>
          </div>
          <ButtonLink href="/register">
            Get started with SiteScope <ArrowRight size={17} />
          </ButtonLink>
        </section>
      </main>
      <footer className="landing-footer">
        <Logo />
        <div>
          <a href="#features">Capabilities</a>
          <a href="#how-it-works">How it works</a>
          <Link href="/login">Your workspace</Link>
        </div>
        <span>© {new Date().getFullYear()} SiteScope. Built for a better web.</span>
      </footer>
    </div>
  );
}
