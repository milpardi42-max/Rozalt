# Rosie Atelier

Premium bilingual (فارسی RTL / English LTR) platform for **patterns · creators · portfolios · products · education**.

Built with Next.js 15 (App Router), React 19, Tailwind v4 and a token-driven design system.
Repository: [`milanorezaee2/Rozadi`](https://github.com/milanorezaee2/Rozadi) · Production host: **Netlify / Vercel** (SSR).

## Run

```bash
npm install
npm run dev      # http://localhost:3000 → redirects to /fa (or /en)
npm run check    # typecheck + lint
npm run build && npm start

# production launcher (installs/builds only when needed, generates .env.local if missing)
npm run launch   # → next start -H 0.0.0.0 -p 3000
npm run smoke    # pre-launch smoke test: health, routing, admin login round-trip
```

📘 **Launching / deploying / operating the site:** see [`LAUNCH.md`](./LAUNCH.md) —
current status, admin & owner URLs, credentials location, env-var checklist,
systemd unit, and a troubleshooting table.

## Live / Deploy

**GitHub repo:** https://github.com/milanorezaee2/Rozadi  

### One-click deploy

| Platform | Button |
| --- | --- |
| **Netlify** | [![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/milanorezaee2/Rozadi) |
| **Vercel** | [![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/milanorezaee2/Rozadi) |

After import, set environment variables (see `.env.example`):

- `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `AUTH_SECRET`
- `NEXT_PUBLIC_SITE_URL` = your public URL (no trailing slash)
- Optional: `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` for persistent admin content

Then open `https://<your-site>/api/health` — expect `"ok": true`.

### Local production

```bash
npm ci && npm run build && npm start
# → http://localhost:3000/fa
```

## Structure

```
src/
  app/[locale]/            # all routes, locale-prefixed (fa | en)
    page.tsx               # homepage — sections driven by admin config
    patterns/ shop/ artists/ portfolio/ academy/ styles/ spaces/ collections/
    stories/ projects/ custom/ about/ contact/ faq/ returns/ legal/[doc]/
    login/ signup/ account/ favorites/ checkout/ search/ creators/join/ admin/
  app/api/                 # newsletter, contact, admin content, auth, search-index, health
  app/sitemap.ts robots.ts # generated SEO files (use NEXT_PUBLIC_SITE_URL)
  components/
    ui/                    # Button, Badge/Sku, Tabs/Chips, Modal, Reveal, SpotlightCard,
                           # BentoGrid, GlassPanel, SectionHeader, PageHero, Carousel, States
    layout/                # Header, MegaMenu, StoreDropdown, SearchPalette, CartDrawer, Footer
    cards/                 # PatternCard, ProductCard, ArtistCard, PortfolioCard, EducationCard, StyleCard
    product/               # ColorSwatches, Actions, QuickView, Gallery, FilterBar, BuyBoxes
    portfolio/ profile/ home/ admin/ providers/
  lib/
    i18n/                  # locale types + dictionary
    data/seed.ts           # seed content (patterns, products, artists, portfolios, education…)
    data/store.ts          # content store (Upstash Redis → Vercel Blob → data/content.json)
    data/queries.ts        # enrich/join helpers
    types.ts               # data model
  app/globals.css          # single source of truth: tokens, typography, motion, primitives
public/
  fonts/iransanse-web/     # Persian font family (see README inside), inter/, instrument-serif/
  images/{hero,patterns,products,portfolios,education,collections,artists}
```

## Design system

- **Tokens** in `globals.css`: `--background` (white), `--surface`, `--foreground`, `--primary` (slate),
  `--accent` (copper), `--blue`, shadows (soft/medium/elevated/glow), radii, motion.
- **Dark mode**: `html[data-theme="dark"]` — a real deep/cinematic theme, toggled in header/footer.
- **Typography**: `font-display` (Instrument Serif) for Latin editorial headlines; **all Persian text
  resolves to `iransanse-web`** via `html[lang=fa]` rules; scale utilities `text-display … text-label`.
- **Motion**: `anim-blur-in`, `anim-fade-up`, `anim-scale-fade`, `[data-reveal]` scroll reveal,
  `img-zoom`, `arrow-shift`, `.spotlight` — all respect `prefers-reduced-motion`.
- **RTL/LTR**: logical properties only (`ms/me/ps/pe/start/end/inset-inline`), `rtl-flip` for icons.

## Admin

Sign in at `/{locale}/login` with the admin account → `/{locale}/admin`.
Manage: homepage sections (order/visibility), hero, categories/styles, pattern/product/artist/
portfolio/education flags & ordering, banners, SEO. Every save is live immediately (all pages are dynamic).

- **Auth**: server-side, HMAC-signed HttpOnly cookie (`src/lib/auth.ts`, `/api/auth/*`), with a small
  per-IP+email login throttle (`src/lib/rate-limit.ts`) to blunt brute-force attempts.
  - Production: set `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `AUTH_SECRET`.
  - Local dev without env vars: any `admin@…` email + ≥4-char password.
  - **Never cached**: `/api/auth/*` and `/api/admin/content` answer with `cache-control: private,
    no-store` + `netlify-cdn-cache-control: no-store` (`src/lib/http.ts`), and the browser sends them
    with `credentials: "same-origin"`. A replayed stale `/api/auth/me` would report "logged out"
    right after login and bounce the admin back to `/login`. `AppProviders` additionally guards the
    session with a version counter (`sessionVersionRef`): a `/me` answer that is older than the
    `login()`/`logout()` that raced it is dropped instead of overwriting the fresh session.
- **Storage** (`src/lib/data/store.ts`, first configured wins):
  1. Upstash Redis — `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`  ← **required on Netlify**
  2. Vercel Blob — `BLOB_READ_WRITE_TOKEN` (practical on Vercel only)
  3. Local file — `data/content.json` (dev / VPS / Docker volume; **read-only on serverless**)

  If a save fails on a read-only filesystem the API answers `502 storage_write_failed` with the
  reason in the log — check `GET /api/health`, which reports the active backend.

## Deploy (Netlify — recommended)

This app is **server-rendered**: it uses middleware, route handlers (`/api/*`), a signed-cookie admin
session and admin-managed runtime content. Every page is `force-dynamic`.

1. **app.netlify.com → Add new site → Import an existing project → GitHub** → `milanopardi13/artikel` (branch `main`).
2. The `netlify.toml` in this repo configures everything (build command, `.next` publish,
   `@netlify/plugin-nextjs`, Node 20, security headers). Leave build settings as-is.
3. **Site configuration → Environment variables** — add:
   | Variable | Required? | Purpose |
   | --- | --- | --- |
   | `ADMIN_EMAIL` | yes (prod) | admin login user |
   | `ADMIN_PASSWORD` | yes (prod) | admin login password |
   | `AUTH_SECRET` | strongly recommended | cookie signing key (long random string) |
   | `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` | yes | persistent admin content (serverless FS is read-only) |
   | `NEXT_PUBLIC_SITE_URL` | yes | canonical URL for `sitemap.xml`, `robots.txt`, OG tags |
   See `.env.example` for details. **Redeploy after adding env vars** (env changes alone do not rebuild).
4. Verify: open `https://<site>/api/health` — expect `"persistent": true` and `"configured": true`.
5. Optional: **Domains** → connect your own domain.

Every push to the production branch rebuilds and redeploys automatically (~2–3 min). Preview deploys
are created for pushes on other branches.

### ⚠️ Not deployable to GitHub Pages / static hosting

The app **cannot** run as a static export: `output: "export"` fails the build because
`/api/*` route handlers use `force-dynamic` and middleware isn't supported in export mode.
Do not add a "Deploy to GitHub Pages" workflow to this repo — it will always fail.
Host it on a Node-capable platform (Netlify, Vercel, VPS, Docker, Liara…).

### Deploy (Vercel)

Import the same repo at **vercel.com/new** (framework auto-detected), set the same env vars, and
for persistent admin content attach **Storage → Upstash Redis** (or Vercel **Blob** — the code talks
to both over plain REST) → **Redeploy**. `vercel.json` pins the region to `fra1`; change it if your
audience is elsewhere.

### Other hosts (VPS / Docker / Liara / etc.)

`npm ci && npm run build && npm start` on Node 20+. Set the same env vars; without Redis/Blob, content persists
to `data/content.json` — keep that directory on a persistent volume.

## Performance notes

- All page payloads render on demand; images use `next/image` with explicit `sizes`.
- The global search palette does **not** receive the full catalog via props anymore — it lazily
  fetches `/api/search-index` (public, cacheable 5 min, locale-agnostic) on first use and warms it
  during browser idle time. This keeps the catalog listing out of every page's RSC payload.
- `sitemap.xml` / `robots.txt` are generated and revalidated hourly so new admin slugs appear
  without a redeploy.
