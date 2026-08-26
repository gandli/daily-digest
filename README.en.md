<h1 align="center">daily-digest</h1>

<p align="center">
  <a href="README.en.md">English</a> · <a href="README.md">简体中文</a>
</p>

<p align="center">
  <a href="#-commands"><img src="https://img.shields.io/badge/commands-5-2b5278" alt="commands"></a>
  <a href="#-description-chain"><img src="https://img.shields.io/badge/Chinese%20guard-100%25-2b5278" alt="Chinese guard"></a>
  <a href="https://github.com/gandli/daily-digest/actions/workflows/deploy.yml"><img src="https://github.com/gandli/daily-digest/actions/workflows/deploy.yml/badge.svg" alt="CI"></a>
</p>

<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="daily-digest — daily GitHub Trending Chinese digest bot, pipeline on the left, Telegram message card on the right">
</p>

GitHub Trending → **Telegram daily Chinese digest bot**. Single project on the Cloudflare Workers free tier.

Every day at **08:30 (UTC+8)** it pushes the top 10 repos — one message per repo: OG card image + stars/language/**Chinese description**/deepwiki·zread links/topic tags; data is also committed to this repo's [archive branch](https://github.com/gandli/daily-digest/tree/archive).

## 📱 Commands

| Input | Behavior |
|---|---|
| `/trending` | Today's chart (already fetched by cron; served instantly from the `digest:<date>` cache; trending is fixed for the day, never re-fetched) |
| `/search <keyword>` | Full-index search across 6000+ entries (stars/bookmarks/archives); on-page English descriptions translated in batch; paginated with inline-keyboard paging/jump |
| `/archive [page]` | Paginated history list; each entry shows the **archive triple-link** (Telegraph → Internet Archive web.archive.org → GitHub md) |
| `/start` `/help` anything else | Usage hints + command-menu registration |
| Message containing a GitHub repo link | Single-repo lookup + Chinese description → OG card; already seen today → archive triple-link card; archived to archive branch |
| Message containing an X/Twitter post link | FxEmbed fetch → **Chinese summary + triple archive** (Telegraph / Internet Archive / GitHub md) |
| Message containing any other web link | Three-tier markdown chain → **Chinese summary (summarizeZh)** → triple archive; re-send of a done URL returns the archive link, not "already processed" |

## 🔗 Description chain

```text
deepwiki overview (template boilerplate stripped)
  → zread wiki Chinese
    → translation fallback chain (Workers AI m2m100 → TranSmart → Google → MyMemory)
      → GitHub repo description (Chinese as-is / English translated)
```

**100% Chinese guard**: any non-Chinese result is never rendered.

## 📦 Archive triple-link

Every archived link (web page / X post / repo) returns a **three-tier archive**, shown by priority:
1. **Telegraph** — long-form backup page (one per daily digest and per X post)
2. **Internet Archive** `web.archive.org` — fallback snapshot (`web/2/<url>` auto-locates the latest version)
3. **GitHub md** — the original markdown on the archive branch

## 🏗️ Architecture

- `src/sources/` source registry (an array is the registry; new source = new file + one line)
- `src/zread.ts` / `src/deepwiki.ts` RSC payload overview extraction
- `src/translate.ts` four-level translation fallback + isChinese guard + CF Summarization digests
- `src/render.ts` three renderers: Telegram HTML / GitHub markdown / Telegraph nodes
- `src/archive.ts` idempotent archiving via GitHub Contents API (archive branch) + Telegraph createPage + chunked base64
- `src/lookup.ts` single-repo pipeline (URL archiving / four-level image chain / repo fan-out / dedup)
- `src/urlmd.ts` any URL→markdown via three-tier free chain (Markdown for Agents → AI.toMarkdown → Browser Rendering)
- `src/fxtweet.ts` X/Twitter post archiving (FxEmbed public API)
- KV caches today's cron result; webhook signature timingSafeEqual + chat allowlist; /search backed by a single-key compressed index

See [`docs/GOAL.md`](docs/GOAL.md) (acceptance criteria A1–A14), [`docs/INTERFACES.md`](docs/INTERFACES.md) (commands / HTTP endpoints / KV keys), [`docs/ROADMAP.md`](docs/ROADMAP.md) (progress), and [`docs/diagrams/`](docs/diagrams/) (architecture / sequence / data-flow diagrams).

## 💻 Development

```bash
npm install
npm run dev        # wrangler dev --test-scheduled
curl http://localhost:8787/__scheduled   # trigger cron pipeline manually
npx tsc --noEmit   # type check
npm test           # vitest, 139 tests (coverage ≥45%)
npm test -- --coverage   # coverage report
```

## 🔑 Secrets (wrangler secret put)

BOT_TOKEN · CHAT_ID · WEBHOOK_SECRET · GH_TOKEN · TELEGRAPH_TOKEN (optional)

## 🚀 Deploy

Merging a PR to main triggers GitHub Actions `wrangler deploy` (needs repo secrets CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID). After deploy, the `search:index` is seeded automatically (generated from `library.jsonl`).

Pushing to main also triggers a changelog workflow that auto-updates [CHANGELOG.md](CHANGELOG.md) (conventional-changelog groups by squash PR title).

## 📚 Docs

- [`docs/GOAL.md`](docs/GOAL.md) — acceptance contract (A1–A14, FR/AC/Milestones)
- [`docs/INTERFACES.md`](docs/INTERFACES.md) — commands / HTTP endpoints / KV key table
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — development plan and progress
- [`docs/diagrams/`](docs/diagrams/) — architecture / sequence / data-flow diagrams (mmd+png+svg)

## 🗺️ Roadmap

- Short term: description-cache refresh tuning, caching /search translation results back into the index, adding a `url` field to `archive:idx` (more precise web.archive link for repo re-sends)
- Longer term: web-page / X-post sources — each just a fetch function plugged into `src/sources/index.ts`, zero pipeline changes

---

<p align="center">
  <sub>Cloudflare Workers free tier · no DB · KV only · 139 tests · CI auto-deploy · auto changelog</sub>
</p>