# Problem We're Solving

Running hackathons is surprisingly complex. Organizers juggle manual submission collection, coordinating judges, tracking deadlines, and creating exciting reveal ceremonies. Participants want a smooth way to showcase their work, and judges need fast, fair tools to evaluate projects. Most hackathon software only solves part of the workflow.

---

## What We Built

A full-stack hackathon platform that automates submissions, powers AI-assisted judging, and produces dramatic live reveal ceremonies. Organizers create events, contestants submit their GitHub repos, and the system processes everything automatically in the background.

When a submission arrives, the platform:

- Downloads the repo to **Cloudflare R2**
- Captures live screenshots via **Firecrawl**
- Generates AI-powered summaries using **Cloudflare Workers AI** + **AI Gateway**
- Indexes the codebase into **Cloudflare AI Search** for semantic search and Q&A
- Streams real-time status updates using **Convex** subscriptions

Judges receive instant invite notifications and rate entries through an interactive interface with live-updating results.

---

## Key Features

### 🛠 Hackathon Management

Create events, manage roles, invite judges, and track submissions with fine-grained access control.

### 🌐 Public Discovery

Developers explore and join hackathons directly from the platform.

### 🤖 Automated Submission Processing

Repos are auto-downloaded, screenshotted via Firecrawl, summarized by Workers AI, and indexed for semantic search.

### 🔍 AI-Powered Code Analysis

Judges can ask natural-language questions about any submission’s code using **Cloudflare AI Search**.

### ⚡ Real-Time Updates

Convex subscriptions power live-updating rankings, judge invites, and reveal animations.

### 🏆 Live Reveal Ceremony

A gamified podium reveal with step-by-step announcements and confetti effects.

### 💳 Usage Metering

**Autumn** provides credit-based submission limits (3 free submissions, then paid options).

### 🔥 Firecrawl + Vibe Apps Integration

Uses Firecrawl to scrape VibeApps.dev and automatically seed TanStack Start projects for the TanStack Hackathon.

### 🔔 Real-Time Notifications  

Judge invites and submission updates appear instantly without refresh.

---

## Why We Built It

We wanted to showcase the real-world power of **TanStack Start** as a full-stack framework while solving a genuine need: hackathons deserve better tooling. This project highlights parallel data loading, server streaming, real-time features, and deep integrations with modern developer infrastructure.

---

## Tech Stack

- **TanStack Start** — routing, server functions, SSG, parallel loaders  
- **Convex** — real-time database, type-safe queries/mutations  
- **Cloudflare**  
  - Workers AI — project summarization  
  - AI Gateway — routing + fallback model management  
  - AI Search (RAG) — semantic code search and Q&A  
  - R2 — blob storage for GitHub repos  
- **Firecrawl** — automated screenshots, scraping, VibeApps.dev ingestion  
- **Autumn** — usage metering and billing  
- **Sentry** — error and performance monitoring  
- **Netlify** — deployment with automatic Convex integration  
- **CodeRabbit** — AI-powered PR review workflow  

---

## Challenges

- Managing Cloudflare AI Gateway provider keys, fallback models, and truncated output handling.
- Implementing RAG with Cloudflare AI Search, using path-based filters for relevant context.

---

## Wins & Metrics

- Integrated **8+ sponsor technologies** into a cohesive real-time platform  
- Automated ~80% of typical hackathon management  
- Achieved **sub-second** live updates with Convex subscriptions  
- Implemented three Cloudflare AI components with robust error handling  
- Fully deployed on Netlify with SSL, CDN, and automatic Convex provisioning
