import { Link } from '@tanstack/react-router';
import { ArrowRight, Monitor, Shield, Zap } from 'lucide-react';
import type { ComponentProps } from 'react';
import React from 'react';
import type { IconType } from 'react-icons';
import { SiGithub } from 'react-icons/si';
import { Button } from '~/components/ui/button';
import { cn } from '~/lib/utils';

type GenericIconProps = ComponentProps<'img'> & ComponentProps<'svg'>;

const TanStackIcon: React.FC<GenericIconProps> = ({ className }) => (
  <img src="/android-chrome-192x192.png" alt="TanStack" className={className} />
);

const ConvexIcon: React.FC<GenericIconProps> = ({ className }) => (
  <img src="/convex.png" alt="Convex" className={className} />
);

const BetterAuthIcon: React.FC<GenericIconProps> = ({ className }) => (
  <img src="/better-auth.png" alt="BetterAuth" className={className} />
);

type MarketingIcon = IconType | React.FC<{ className?: string; color?: string }>;

type TechItem = {
  name: string;
  description: string;
  Icon: MarketingIcon;
  iconColor?: string;
  iconClassName?: string;
  url: string;
};

// Create lazy-loaded icon components to avoid bundling issues
const createLazyIcon = (iconName: string) => {
  const LazyIcon = React.lazy(() =>
    import('react-icons/si').then((module) => ({
      default: module[iconName as keyof typeof module] as React.ComponentType<
        React.SVGProps<SVGSVGElement>
      >,
    })),
  );
  return LazyIcon;
};

const coreTechnologies: TechItem[] = [
  {
    name: 'TanStack Start',
    description: 'File-based routing, SSR, and progressive enhancement.',
    Icon: TanStackIcon,
    iconColor: '#f97316',
    url: 'https://tanstack.com/start',
  },
  {
    name: 'Convex',
    description: 'Realtime database operations with zero client boilerplate.',
    Icon: ConvexIcon,
    iconColor: '#0f172a',
    url: 'https://www.convex.dev/',
  },
  {
    name: 'Netlify',
    description: 'Serverless hosting and edge delivery tuned for TanStack Start.',
    Icon: createLazyIcon('SiNetlify'),
    iconClassName: 'text-emerald-500',
    url: 'https://www.netlify.com/',
  },
  {
    name: 'BetterAuth',
    description: 'Email-first authentication with session management baked in.',
    Icon: BetterAuthIcon,
    iconColor: '#be123c',
    url: 'https://www.better-auth.com/',
  },
  {
    name: 'Resend',
    description: 'Transactional emails for auth flows and lifecycle messaging.',
    Icon: createLazyIcon('SiResend'),
    iconClassName: 'text-slate-900',
    url: 'https://resend.com/',
  },
  {
    name: 'Biome',
    description: 'Fast linting and formatting to keep the codebase consistent.',
    Icon: createLazyIcon('SiBiome'),
    iconClassName: 'text-blue-600',
    url: 'https://biomejs.dev/',
  },
  {
    name: 'React 19',
    description: 'Modern UI library powering server and client rendering.',
    Icon: createLazyIcon('SiReact'),
    iconClassName: 'text-sky-400',
    url: 'https://react.dev/',
  },
  {
    name: 'Shadcn/UI',
    description: 'Accessible component primitives ready for rapid iteration.',
    Icon: createLazyIcon('SiShadcnui'),
    iconClassName: 'text-slate-900',
    url: 'https://ui.shadcn.com/',
  },
  {
    name: 'Tailwind',
    description: 'Utility-first styling with design tokens configured for the platform.',
    Icon: createLazyIcon('SiTailwindcss'),
    iconClassName: 'text-sky-500',
    url: 'https://tailwindcss.com/',
  },
  {
    name: 'TypeScript',
    description: 'Type-safe foundations from server to client with strict typing.',
    Icon: createLazyIcon('SiTypescript'),
    iconClassName: 'text-blue-600',
    url: 'https://www.typescriptlang.org/',
  },
  {
    name: 'Vite',
    description: 'Lightning-fast dev server and build pipeline optimized for React.',
    Icon: createLazyIcon('SiVite'),
    iconClassName: 'text-purple-600',
    url: 'https://vitejs.dev/',
  },
  {
    name: 'Zod',
    description: 'Type-safe validation for data schemas.',
    Icon: createLazyIcon('SiZod'),
    iconClassName: 'text-blue-500',
    url: 'https://zod.dev/',
  },
];

export function MarketingHome() {
  return (
    <div className="flex flex-col gap-16 py-16">
      <section className="text-center space-y-6">
        <span className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary">
          Open Source Hackathon Platform
        </span>
        <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
          Hackathons made simple
        </h1>
        <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
          Launch your hackathon, invite your judges, and gather submissions as AI indexes the
          codebases for interactive Q&A, crawls and captures screenshots of sites, generates
          detailed summaries, and powers live judging with spectacular winner announcements
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Button asChild size="lg">
            <Link to="/register" preload="intent" className="inline-flex items-center gap-2">
              Start Your Hackathon
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <a
              href="https://github.com/dyeoman2/hackathon"
              className="inline-flex items-center gap-2"
              target="_blank"
              rel="noopener noreferrer"
            >
              <SiGithub className="h-4 w-4" />
              View on GitHub
            </a>
          </Button>
        </div>
        <div className="flex items-center justify-center gap-2 mt-4">
          <span className="text-xs text-muted-foreground">
            3 free submissions. No credit card required.
          </span>
        </div>
      </section>

      <section className="rounded-3xl border border-border bg-linear-to-br from-primary/5 to-secondary/5 p-10 shadow-sm">
        <div className="text-center space-y-3 mb-10">
          <span className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
            Competition-Ready Features
          </span>
          <h2 className="text-3xl font-semibold text-foreground sm:text-4xl">
            Built for the intensity of hackathon management
          </h2>
          <p className="text-base text-muted-foreground">
            Designed specifically for high-stakes competitions with real-time collaboration,
            automated workflows, and spectacular presentation features.
          </p>
        </div>

        <div className="grid gap-8 md:grid-cols-3">
          <div className="space-y-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Zap className="h-6 w-6 text-primary" />
            </div>
            <h3 className="text-xl font-semibold text-foreground">Automated Processing</h3>
            <p className="text-muted-foreground">
              Submissions are automatically processed—repositories downloaded, screenshots captured,
              and AI summaries generated. Judges get rich project insights instantly without manual
              work.
            </p>
          </div>

          <div className="space-y-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Monitor className="h-6 w-6 text-primary" />
            </div>
            <h3 className="text-xl font-semibold text-foreground">Live Judging & Results</h3>
            <p className="text-muted-foreground">
              Real-time rating updates, live leaderboard changes, and synchronized judging
              workflows. Everyone sees results update instantly as votes come in during intense
              judging sessions.
            </p>
          </div>

          <div className="space-y-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Shield className="h-6 w-6 text-primary" />
            </div>
            <h3 className="text-xl font-semibold text-foreground">Spectacular Reveals</h3>
            <p className="text-muted-foreground">
              Professional podium ceremonies with confetti animations, step-by-step winner reveals,
              and presenter controls. Create unforgettable moments for your hackathon participants.
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-border bg-card p-10 shadow-sm">
        <div className="text-center space-y-3 mb-10">
          <span className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
            Choose Your Deployment
          </span>
          <h2 className="text-3xl font-semibold text-foreground sm:text-4xl">
            Hosted or self-hosted options
          </h2>
          <p className="text-base text-muted-foreground">
            Run your hackathon with full control, or let us handle everything.
          </p>
        </div>

        <div className="grid gap-8 md:grid-cols-2 max-w-6xl mx-auto">
          {/* Self-Hosted Option */}
          <div className="relative rounded-2xl border border-border bg-background p-8 shadow-lg">
            <div className="text-center space-y-6">
              <div>
                <h3 className="text-2xl font-semibold text-foreground mb-2">Self-Hosted</h3>
                <p className="text-muted-foreground">
                  Deploy on your own infrastructure with full control
                </p>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-center">
                  <div className="text-center">
                    <div className="text-4xl font-bold text-foreground">$0</div>
                    <div className="text-sm text-muted-foreground">forever free</div>
                  </div>
                </div>

                <div className="bg-muted/50 rounded-lg p-4 text-sm text-muted-foreground">
                  <strong>Completely free:</strong> Host it yourself with no usage fees or
                  restrictions.
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="text-lg font-semibold text-foreground">Perfect for:</h4>
                <ul className="space-y-3 text-left">
                  <li className="flex items-center gap-3">
                    <div className="h-1.5 w-1.5 rounded-full bg-green-500"></div>
                    Organizations with dev teams
                  </li>
                  <li className="flex items-center gap-3">
                    <div className="h-1.5 w-1.5 rounded-full bg-green-500"></div>
                    Custom deployments and integrations
                  </li>
                  <li className="flex items-center gap-3">
                    <div className="h-1.5 w-1.5 rounded-full bg-green-500"></div>
                    Data sovereignty requirements
                  </li>
                  <li className="flex items-center gap-3">
                    <div className="h-1.5 w-1.5 rounded-full bg-green-500"></div>
                    Community and open source events
                  </li>
                </ul>
              </div>

              <Button asChild variant="outline" size="lg">
                <a
                  href="https://github.com/dyeoman2/hackathon"
                  className="inline-flex items-center gap-2"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <SiGithub className="h-4 w-4" />
                  Get the Code
                </a>
              </Button>
            </div>
          </div>
          {/* Hosted Option */}
          <div className="relative rounded-2xl border-2 border-primary bg-primary/5 p-8 shadow-lg">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2">
              <span className="rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">
                Recommended
              </span>
            </div>
            <div className="absolute -top-3 right-4">
              <span className="rounded-full bg-green-500 px-3 py-1 text-xs font-medium text-white">
                No Credit Card Required
              </span>
            </div>
            <div className="text-center space-y-6">
              <div>
                <h3 className="text-2xl font-semibold text-foreground mb-2">Pay as you go</h3>
                <p className="text-muted-foreground">
                  We manage everything - just focus on your hackathon
                </p>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-center gap-4">
                  <div className="text-center">
                    <div className="text-4xl font-bold text-foreground">$0</div>
                    <div className="text-sm text-muted-foreground">first 3 submissions</div>
                  </div>
                  <div className="text-2xl text-muted-foreground">+</div>
                  <div className="text-center">
                    <div className="text-4xl font-bold text-foreground">$1</div>
                    <div className="text-sm text-muted-foreground">per additional submission</div>
                  </div>
                </div>

                <div className="bg-primary/10 border border-primary/20 rounded-lg p-4 text-sm">
                  <strong>Includes:</strong> Hosting, maintenance, backups, and premium support
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="text-lg font-semibold text-foreground">Perfect for:</h4>
                <ul className="space-y-3 text-left">
                  <li className="flex items-center gap-3">
                    <div className="h-1.5 w-1.5 rounded-full bg-green-500"></div>
                    Organizations without dev resources
                  </li>
                  <li className="flex items-center gap-3">
                    <div className="h-1.5 w-1.5 rounded-full bg-green-500"></div>
                    Quick setup for one-off events
                  </li>
                  <li className="flex items-center gap-3">
                    <div className="h-1.5 w-1.5 rounded-full bg-green-500"></div>
                    Enterprise compliance requirements
                  </li>
                  <li className="flex items-center gap-3">
                    <div className="h-1.5 w-1.5 rounded-full bg-green-500"></div>
                    24/7 monitoring and support
                  </li>
                </ul>
              </div>

              <Button asChild className="w-full" size="lg">
                <Link to="/register" preload="intent">
                  Start your Hackathon
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-border bg-muted/40 p-10 shadow-sm">
        <div className="text-center space-y-3">
          <span className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
            Built for Scale
          </span>
          <h2 className="text-3xl font-semibold text-foreground sm:text-4xl">
            Enterprise-grade technology powering hackathon success
          </h2>
          <p className="text-base text-muted-foreground">
            Professional tooling that handles thousands of submissions, real-time judging, and live
            ceremonies with zero downtime or performance issues.
          </p>
        </div>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {coreTechnologies.map((tech) => {
            const Icon = tech.Icon;
            return (
              <a
                key={tech.name}
                href={tech.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-4 rounded-2xl border border-border/60 bg-background px-4 py-4 shadow-sm transition-colors hover:bg-muted/50"
              >
                <div
                  className="flex h-12 w-12 items-center justify-center rounded-full"
                  aria-hidden
                >
                  <Icon className={cn('h-6 w-6', tech.iconClassName)} color={tech.iconColor} />
                </div>
                <div className="space-y-1">
                  <p className="text-base font-semibold text-foreground">{tech.name}</p>
                  <p className="text-sm text-muted-foreground">{tech.description}</p>
                </div>
              </a>
            );
          })}
        </div>
      </section>
    </div>
  );
}
