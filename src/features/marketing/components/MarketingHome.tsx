import { Link } from '@tanstack/react-router';
import {
  ArrowRight,
  Bot,
  Camera,
  Eye,
  Monitor,
  Search,
  Settings,
  Shield,
  Sparkles,
  Trophy,
  Upload,
  Users,
  Vote,
  Zap,
} from 'lucide-react';
import { SiGithub } from 'react-icons/si';
import { Button } from '~/components/ui/button';

export function MarketingHome() {
  return (
    <div className="flex flex-col gap-16 py-16">
      <section className="text-center space-y-6">
        <span className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary">
          Find Events & Host Hackathons
        </span>
        <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
          Find your next hackathon or launch your own
        </h1>
        <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
          Discover exciting hackathons to join, or create your own competition with AI-powered
          insights, automatic screenshot capture, interactive code analysis, and spectacular winner
          reveals that make every hackathon unforgettable.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Button asChild size="lg">
            <Link to="/register" preload="intent" className="inline-flex items-center gap-2">
              Start Your Hackathon
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link to="/h" preload="intent" className="inline-flex items-center gap-2">
              Find Hackathons
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
        <div className="flex items-center justify-center gap-2 mt-4">
          <span className="text-xs text-muted-foreground">
            Join hackathons for free. 3 submissions free for organizers.
          </span>
        </div>
      </section>

      {/* How it Works Section */}
      <section className="rounded-3xl border border-border bg-linear-to-br from-green-500/5 to-emerald-500/5 p-10 shadow-sm">
        <div className="text-center space-y-3 mb-10">
          <span className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
            How it Works
          </span>
          <h2 className="text-3xl font-semibold text-foreground sm:text-4xl">
            Launch your hackathon in minutes
          </h2>
          <p className="text-base text-muted-foreground">
            From idea to spectacular winner announcement - we've automated everything in between.
          </p>
        </div>

        <div className="grid gap-8 lg:grid-cols-5">
          <div className="flex gap-4 lg:flex-col lg:text-center lg:items-center lg:space-y-4 lg:gap-0">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-500/10 lg:mx-auto flex-shrink-0">
              <Settings className="h-8 w-8 text-blue-600" />
            </div>
            <div className="space-y-2 lg:text-center">
              <h3 className="text-lg font-semibold text-foreground">Setup & Invite</h3>
              <p className="text-sm text-muted-foreground">
                Configure your hackathon details and invite judges to get started
              </p>
            </div>
          </div>

          <div className="flex gap-4 lg:flex-col lg:text-center lg:items-center lg:space-y-4 lg:gap-0">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10 lg:mx-auto flex-shrink-0">
              <Upload className="h-8 w-8 text-green-600" />
            </div>
            <div className="space-y-2 lg:text-center">
              <h3 className="text-lg font-semibold text-foreground">Collect Submissions</h3>
              <p className="text-sm text-muted-foreground">
                Participants submit their projects with GitHub links
              </p>
            </div>
          </div>

          <div className="flex gap-4 lg:flex-col lg:text-center lg:items-center lg:space-y-4 lg:gap-0">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-orange-500/10 lg:mx-auto flex-shrink-0">
              <Bot className="h-8 w-8 text-orange-600" />
            </div>
            <div className="space-y-2 lg:text-center">
              <h3 className="text-lg font-semibold text-foreground">AI Processes</h3>
              <p className="text-sm text-muted-foreground">
                Submissions auto-analyzed with summaries, screenshots & repo chat
              </p>
            </div>
          </div>

          <div className="flex gap-4 lg:flex-col lg:text-center lg:items-center lg:space-y-4 lg:gap-0">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-purple-500/10 lg:mx-auto flex-shrink-0">
              <Vote className="h-8 w-8 text-purple-600" />
            </div>
            <div className="space-y-2 lg:text-center">
              <h3 className="text-lg font-semibold text-foreground">Voting</h3>
              <p className="text-sm text-muted-foreground">
                Judges score projects and community voting adds engagement
              </p>
            </div>
          </div>

          <div className="flex gap-4 lg:flex-col lg:text-center lg:items-center lg:space-y-4 lg:gap-0">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-pink-500/10 lg:mx-auto flex-shrink-0">
              <Sparkles className="h-8 w-8 text-pink-600" />
            </div>
            <div className="space-y-2 lg:text-center">
              <h3 className="text-lg font-semibold text-foreground">Celebrate</h3>
              <p className="text-sm text-muted-foreground">
                Live judging, leaderboards, and winner reveals
              </p>
            </div>
          </div>
        </div>

        <div className="text-center mt-8">
          <Button asChild size="lg">
            <Link to="/register" preload="intent" className="inline-flex items-center gap-2">
              Start Your Hackathon Now
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </section>

      {/* New Discover Hackathons Section */}
      <section className="rounded-3xl border border-border bg-linear-to-br from-blue-500/5 to-purple-500/5 p-10 shadow-sm">
        <div className="text-center space-y-3 mb-10">
          <span className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
            Join the Community
          </span>
          <h2 className="text-3xl font-semibold text-foreground sm:text-4xl">
            Discover hackathons happening now
          </h2>
          <p className="text-base text-muted-foreground">
            Browse public hackathons, submit your projects, and compete with developers worldwide.
            No account required to explore events.
          </p>
        </div>

        <div className="grid gap-8 md:grid-cols-3">
          <div className="space-y-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-500/10">
              <Search className="h-6 w-6 text-blue-600" />
            </div>
            <h3 className="text-xl font-semibold text-foreground">Browse Events</h3>
            <p className="text-muted-foreground">
              Explore hackathons by category, deadline, or popularity. Find the perfect challenge
              for your skills and interests.
            </p>
          </div>

          <div className="space-y-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-purple-500/10">
              <Users className="h-6 w-6 text-purple-600" />
            </div>
            <h3 className="text-xl font-semibold text-foreground">Join Communities</h3>
            <p className="text-muted-foreground">
              Connect with organizers and fellow participants. Get insights into judging criteria
              and submission requirements before you start.
            </p>
          </div>

          <div className="space-y-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-500/10">
              <Trophy className="h-6 w-6 text-green-600" />
            </div>
            <h3 className="text-xl font-semibold text-foreground">Showcase Your Work</h3>
            <p className="text-muted-foreground">
              Submit your projects with automatic processing, screenshots, and AI-generated
              summaries that highlight your best work to judges.
            </p>
          </div>
        </div>

        <div className="text-center mt-8">
          <Button asChild size="lg" variant="outline">
            <Link to="/h" preload="intent" className="inline-flex items-center gap-2">
              Browse Hackathons
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </section>

      {/* AI-Powered Features Section */}
      <section className="rounded-3xl border border-border bg-linear-to-br from-purple-500/5 to-pink-500/5 p-10 shadow-sm">
        <div className="text-center space-y-3 mb-10">
          <span className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
            AI-Powered Intelligence
          </span>
          <h2 className="text-3xl font-semibold text-foreground sm:text-4xl">
            Smart automation for modern hackathons
          </h2>
          <p className="text-base text-muted-foreground">
            Our AI analyzes every submission automatically, giving judges deep insights and
            participants rich project understanding.
          </p>
        </div>

        <div className="grid gap-8 md:grid-cols-3">
          <div className="space-y-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-purple-500/10">
              <Bot className="h-6 w-6 text-purple-600" />
            </div>
            <h3 className="text-xl font-semibold text-foreground">AI Repository Chat</h3>
            <p className="text-muted-foreground">
              Ask questions about any codebase in natural language. Get instant answers about
              architecture, implementation details, and technical decisions from the full
              repository.
            </p>
          </div>

          <div className="space-y-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-500/10">
              <Eye className="h-6 w-6 text-blue-600" />
            </div>
            <h3 className="text-xl font-semibold text-foreground">Smart Project Summaries</h3>
            <p className="text-muted-foreground">
              AI analyzes README files and project structure to generate comprehensive summaries,
              highlighting key features, technologies, and what makes each project unique.
            </p>
          </div>

          <div className="space-y-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-500/10">
              <Camera className="h-6 w-6 text-green-600" />
            </div>
            <h3 className="text-xl font-semibold text-foreground">Automatic Screenshots</h3>
            <p className="text-muted-foreground">
              Live websites are automatically captured and displayed to judges, ensuring they see
              your application exactly as users experience it, without manual setup.
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-border bg-card p-10 shadow-sm">
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

        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">
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
              <Vote className="h-6 w-6 text-primary" />
            </div>
            <h3 className="text-xl font-semibold text-foreground">Community Voting</h3>
            <p className="text-muted-foreground">
              Enable public voting alongside judge scoring. Participants and attendees can vote for
              their favorite projects, creating engagement and additional recognition categories.
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
                    <div className="text-4xl font-bold text-foreground">$0.10</div>
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
    </div>
  );
}
