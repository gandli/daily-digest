<h1 align="center">daily-digest</h1>

<p align="center">
  <a href="README.en.md">English</a> · <a href="README.md">简体中文</a>
</p>

<p align="center">
  <a href="#-commands"><img src="https://img.shields.io/badge/commands-6-2b5278" alt="commands"></a>
  <a href="#-description-chain"><img src="https://img.shields.io/badge/Chinese%20guard-100%25-2b5278" alt="Chinese guard"></a>
  <a href="https://github.com/gandli/daily-digest/actions/workflows/deploy.yml"><img src="https://github.com/gandli/daily-digest/actions/workflows/deploy.yml/badge.svg" alt="CI"></a>
</p>

<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="daily-digest — daily GitHub Trending Chinese digest bot, pipeline on the left, Telegram message card on the right">
</p>

GitHub Trending → **Telegram daily Chinese digest bot**. Single project on the Cloudflare Workers free tier.

Every day at **08:30 (UTC+8)** it pushes the top 10 repos — one message per repo: OG card image + stars/language/**Chinese description**/deepwiki·zread links/topic tags; data is batch-committed to this repo's [archive branch](https://github.com/gandli/daily-digest/tree/archive) (merged into **a single commit** by the daily cron or when the buffer reaches 20 entries — see [Archive triple-link](#archive-triple-link)).

📖 **[User manual](docs/guide/README.md)** — step-by-step guides for 10 core transactions (annotated chat screenshots), auto-generated from e2e scenarios and kept in sync by CI (pipeline in [scripts/manual/](scripts/manual/) + `.github/workflows/manual.yml`).

## 📱 Commands

| Input | Behavior |
|---|---|
| `/gt` `/trending` | Today's chart (already fetched by cron; served instantly from the `digest:<date>` cache; trending is fixed for the day, never re-fetched) |
| `/hn` `/product` | Today's HN cool products: reads `product/<date>.json` from the archive branch for an instant card; if missing, auto-triggers GitHub Actions and pushes when done |
| `/ph` | **Product Hunt daily popular**: key-free official feed, top 10 with Chinese summaries as product cards (ogUrl preview); same-day cache; digest archived as `ph-<date>.md` |
| `/search <keyword>` | Full-index search across 6000+ entries (stars/bookmarks/archives); on-page English descriptions translated in batch; paginated with inline-keyboard paging/jump |
| `/archive [page]` | Paginated history list; each entry shows the **archive triple-link** (Telegraph → Internet Archive web.archive.org → GitHub md) |
| `/start` `/help` anything else | Usage hints + command-menu registration |
| Message containing a GitHub repo link | Single-repo lookup + Chinese description → OG card (no counter on single cards); already seen today → archive triple-link card |
| Message containing an X/Twitter post link | FxEmbed fetch → **Chinese summary + triple archive** (Telegraph / Internet Archive / GitHub md); X article posts use the embedded title directly; multiple repos in one post fan out as numbered cards (`N/M`) |
| Message containing any other web link | Three-tier markdown chain → **Chinese summary (summarizeZh)** → triple archive; re-send of a done URL returns the archive link, not "already processed" |

The `N/M` counter only appears for multi-item batches (trending/product pushes, multi-repo fan-out); single cards carry no counter.

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
1. **Telegraph** — long-form backup page (one per daily digest and per X post, effective immediately)
2. **Internet Archive** `web.archive.org` — fallback snapshot (`web/2/<url>` auto-locates the latest version, effective immediately)
3. **GitHub md** — the original markdown on the archive branch (**batched**: entries first land in a KV buffer, then the daily cron — or a 20-entry threshold — merges and pushes them as **one commit** via the Git Data API, so this link may lag until the next flush)

## 🏗️ Architecture

- `src/sources/` source registry (an array is the registry; new source = new file + one line)
- `src/zread.ts` / `src/deepwiki.ts` RSC payload overview extraction
- `src/translate.ts` four-level translation fallback + isChinese guard + CF Summarization digests
- `src/render.ts` three renderers: Telegram HTML / GitHub markdown / Telegraph nodes
- `src/archive.ts` batched archiving: KV pending buffer (`pend:arc:*`) → Git Data API merges and pushes as one commit (daily cron + ≥20 threshold; falls back to direct Contents API PUT if KV fails) + Telegraph createPage + chunked base64
- `src/lookup.ts` single-repo pipeline (URL archiving / four-level image chain / repo fan-out / dedup)
- `src/urlmd.ts` any URL→markdown via three-tier free chain (Markdown for Agents → AI.toMarkdown → Browser Rendering)
- `src/fxtweet.ts` X/Twitter post archiving (FxEmbed public API, article posts use the embedded title)
- `scripts/manual/` user-manual pipeline: e2e scenarios drive the real worker → annotated chat screenshots → AI-written step-by-step docs → `.github/workflows/manual.yml` regenerates [docs/guide/](docs/guide/) on code changes
- KV caches today's cron result; webhook signature timingSafeEqual + chat allowlist; /search backed by a single-key compressed index

See [`docs/GOAL.md`](docs/GOAL.md) (acceptance criteria A1–A14), [`docs/INTERFACES.md`](docs/INTERFACES.md) (commands / HTTP endpoints / KV keys), [`docs/ROADMAP.md`](docs/ROADMAP.md) (progress), and [`docs/diagrams/`](docs/diagrams/) (architecture / sequence / data-flow diagrams).

## 💻 Development

```bash
npm install
npm run dev        # wrangler dev --test-scheduled
curl http://localhost:8787/__scheduled   # trigger cron pipeline manually
npx tsc --noEmit   # type check
npm test           # vitest, 550+ tests (44 files)
npm test -- --coverage   # coverage report
npm run manual     # user-manual full pipeline: e2e scenarios → annotated screenshots → AI docs (template fallback without a key)
```

## 🔑 Secrets (wrangler secret put)

BOT_TOKEN · CHAT_ID · WEBHOOK_SECRET · GH_TOKEN · TELEGRAPH_TOKEN (optional)

Optional: OPENROUTER_API_KEY (/product deep summaries + manual AI docs; free model pool/template without it) · JINA_API_KEY / GENEDAI_API_KEY (URL→markdown fallbacks) · CF_ACCOUNT_ID / CF_API_TOKEN (Browser Rendering)

## 🚀 Deploy

Merging a PR to main triggers GitHub Actions `wrangler deploy` (needs repo secrets CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID). After deploy, the `search:index` is seeded automatically (generated from `library.jsonl`).

Pushing to main also triggers a changelog workflow that auto-updates [CHANGELOG.md](CHANGELOG.md) (conventional-changelog groups by squash PR title).

## 📚 Docs

- [`docs/GOAL.md`](docs/GOAL.md) — acceptance contract (A1–A14, FR/AC/Milestones)
- [`docs/INTERFACES.md`](docs/INTERFACES.md) — commands / HTTP endpoints / KV key table
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — development plan and progress
- [`docs/guide/`](docs/guide/README.md) — user manual (auto-generated)
- [`docs/diagrams/`](docs/diagrams/) — architecture / sequence / data-flow diagrams (mmd+png+svg)

## 🗺️ Roadmap

- Short term: description-cache refresh tuning, caching /search translation results back into the index, adding a `url` field to `archive:idx` (more precise web.archive link for repo re-sends)
- Longer term: web-page / X-post sources — each just a fetch function plugged into `src/sources/index.ts`, zero pipeline changes

---

<p align="center">
  <sub>Cloudflare Workers free tier · no DB · KV only · 550+ tests · CI auto-deploy · auto changelog · auto-generated user manual</sub>
</p>