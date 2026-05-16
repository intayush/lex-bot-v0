# Legal Chatbot

An embeddable AI chatbot that handles client intake and lead qualification for law firms. Delivered as a JavaScript widget that integrates into a lawyer's existing website, backed by a Next.js API server and a SaaS dashboard.

**Live demo:** [Widget + Demo Site](https://legal-chatbot-demo.netlify.app) | [Dashboard](https://lex-bot-v0.netlify.app/login)

## How It Works

```
Visitor lands on             Widget sends              Agent searches firm's
lawyer's website  ──────>  message to API  ──────>  knowledge base (markdown)
                                 │
                                 ▼
                          Gemini LLM streams          Lead is classified
                          a grounded response  <──  (urgent / normal / unqualified)
                                 │
                                 ▼
                          Lead + transcript saved
                          to PostgreSQL (Neon)
                                 │
                                 ▼
                          Lawyer reviews leads
                          in the dashboard
```

1. A **crawler CLI** scrapes the firm's website into structured markdown files.
2. The **chat widget** (React) embeds on the firm's site and streams responses from the API.
3. The **API server** (Next.js) runs a Gemini-powered agent that searches the firm's knowledge base, answers questions, qualifies leads, and classifies urgency.
4. The **dashboard** lets the lawyer configure chatbot behavior, view captured leads, and preview conversations.

## Architecture

| Component | Package | Tech |
|-----------|---------|------|
| Chat Widget | `packages/widget` | React, Vite, Vercel AI SDK `useChat` |
| API Server + Dashboard | `packages/api` | Next.js 15, Vercel AI SDK, Drizzle ORM |
| Crawler CLI | `packages/crawler` | Cheerio, Playwright, unified/remark |
| Shared Types | `packages/shared` | Zod schemas, TypeScript types |

**Database:** Neon (serverless PostgreSQL)
**LLM:** Google Gemini 2.5 Flash via `@ai-sdk/google`
**Deployment:** Two Netlify sites (widget static + API serverless)

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+
- A [Neon](https://neon.tech) database (free tier works)
- A [Google AI Studio](https://aistudio.google.com/apikey) API key (for Gemini)

### Setup

```bash
git clone <repo>
cd legal-chatbot
pnpm install

# Configure environment
cp .env.example packages/api/.env.local
# Edit packages/api/.env.local:
#   DATABASE_URL=postgresql://...@neon.tech/neondb?sslmode=require
#   GOOGLE_GENERATIVE_AI_API_KEY=your_key
#   SESSION_SECRET=any-32-char-string

# Create tables and seed dev data
pnpm db:migrate
pnpm db:seed

# Start everything
pnpm dev
```

This starts:
- **Widget + demo site** at `http://localhost:5173`
- **API server + dashboard** at `http://localhost:3000`

### Test credentials

| | |
|---|---|
| **Dashboard login** | `dev@legalchatbot.com` / `password123` |
| **Widget API key** | `dev_test_key` |

Open `http://localhost:5173`, click the chat bubble, and ask a question.

## Project Structure

```
legal-chatbot/
├── packages/
│   ├── api/                  # Next.js API + Dashboard
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── api/chat/       # POST /api/chat (streaming)
│   │   │   │   ├── api/config/     # GET /api/config (widget config)
│   │   │   │   ├── api/dashboard/  # POST /api/dashboard/config
│   │   │   │   ├── dashboard/      # Dashboard pages (leads, config)
│   │   │   │   └── login/          # Login page
│   │   │   ├── db/                 # Schema, migrations, seed
│   │   │   └── lib/                # Auth, search, session, leads
│   │   ├── drizzle/                # PostgreSQL migrations
│   │   └── netlify.toml
│   ├── widget/               # Embeddable chat widget
│   │   ├── src/components/   # ChatWidget, ChatPanel, QuickReplies
│   │   └── netlify.toml
│   ├── crawler/              # CLI website crawler
│   │   ├── src/lib/          # Fetcher, extractor, markdown converter
│   │   └── test-site/        # Test HTML fixtures
│   └── shared/               # Zod schemas & TypeScript types
├── chatbot-context/          # Crawled markdown knowledge base
├── product-spec-legal-chatbot.md
├── turbo.json
└── pnpm-workspace.yaml
```

## Crawler

Crawl a website to generate the chatbot's knowledge base:

```bash
# Crawl a live website
npx legal-chatbot-crawl --url https://example-lawfirm.com --output ./chatbot-context/

# Crawl local HTML files (for testing)
npx legal-chatbot-crawl --input ./test-site/ --output ./chatbot-context/

# Deterministic output (same input = identical output)
npx legal-chatbot-crawl --input ./test-site/ --output ./chatbot-context/ --deterministic
```

Output: structured markdown files with YAML frontmatter + a `_manifest.json` index.

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/chat` | `x-api-key` header | Streaming chat (Vercel AI SDK protocol) |
| `GET` | `/api/config` | `x-api-key` header | Widget configuration (name, greeting, practice areas) |
| `POST` | `/api/auth/login` | Cookie | Dashboard login |
| `POST` | `/api/auth/logout` | Cookie | Dashboard logout |
| `POST` | `/api/dashboard/config` | Cookie | Save/publish chatbot configuration |

## Dashboard

The dashboard at `/dashboard` provides:

- **Leads page** — table of captured leads with classification badges (urgent/normal/unqualified), filtering, and detail views with full chat transcripts
- **Configuration page** — 7-tab form (Persona, Practice Areas, Questions, Boundaries, Escalation, Contact, Custom Instructions) with save/publish workflow and live preview chat

## Testing

```bash
# Run all tests (152 total)
pnpm test

# Run tests for a specific package
pnpm --filter @legal-chatbot/crawler test
pnpm --filter @legal-chatbot/api test
```

| Package | Tests | Coverage |
|---------|-------|----------|
| `crawler` | 56 | Section-type classification, markdown conversion, content extraction, keywords, hashing, filenames |
| `api` | 96 | Context search scoring, system prompt composition, rate limiting, session CRUD, lead capture, partial lead extraction/classification |

Tests use in-memory SQLite mocks (via `better-sqlite3` dev dependency) for database isolation.

## Deployment

Deployed as two Netlify sites from one monorepo:

### Widget + Demo Site (static)

- **Base directory:** `packages/widget`
- **Build:** `pnpm build && cp -r ../../chatbot-context dist/chatbot-context`
- **Env:** `VITE_API_URL=https://your-api-site.netlify.app/api/chat`

### API + Dashboard (Next.js serverless)

- **Base directory:** `packages/api`
- **Build:** Uses `@netlify/plugin-nextjs`
- **Env:** `DATABASE_URL`, `GOOGLE_GENERATIVE_AI_API_KEY`, `SESSION_SECRET`

See the full deployment guide in [docs/superpowers/specs/DEPLOYMENT.MD](docs/superpowers/specs/DEPLOYMENT.MD).

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Neon PostgreSQL connection string |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Yes | Google Gemini API key |
| `SESSION_SECRET` | Yes (prod) | Iron-session encryption key (min 32 chars) |
| `VITE_API_URL` | Widget only | API chat endpoint URL for production widget builds |
| `CONTEXT_STORE_URL` | No | Override context store URL in seed script |

## Tech Stack

| | |
|---|---|
| **Language** | TypeScript |
| **Frontend** | React, Next.js 15, Tailwind CSS |
| **AI** | Vercel AI SDK, Google Gemini 2.5 Flash |
| **Database** | Neon PostgreSQL, Drizzle ORM |
| **Crawler** | Cheerio, Playwright, unified/remark |
| **Auth** | bcryptjs, iron-session |
| **Testing** | Vitest |
| **Build** | Turborepo, pnpm workspaces |
| **Deployment** | Netlify |

## License

Private. All rights reserved.
