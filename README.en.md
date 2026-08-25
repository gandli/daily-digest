<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="daily-digest — daily GitHub Trending Chinese digest bot, pipeline on the left, Telegram message card on the right">
</p>

<h1 align="center">daily-digest</h1>

<p align="center">
  <a href="README.md">简体中文</a> · <a href="README.en.md">English</a>
</p>

<p align="center">
  <a href="#-commands"><img src="https://img.shields.io/badge/commands-5-2b5278" alt="commands"></a>
  <a href="#-description-chain"><img src="https://img.shields.io/badge/Chinese%20guard-100%25-2b5278" alt="Chinese guard"></a>
  <a href="https://github.com/gandli/daily-digest/actions/workflows/deploy.yml"><img src="https://github.com/gandli/daily-digest/actions/workflows/deploy.yml/badge.svg" alt="CI"></a>
</p>

GitHub Trending → **Telegram daily Chinese digest bot**. Single project on the Cloudflare Workers free tier.

Every day at **08:30 (UTC+8)** it pushes the top 10 repos — one message per repo: OG card image + stars/language/**Chinese description**/deepwiki·zread links/topic tags; data is also committed to this repo's [archive branch](https://github.com/gandli/daily-digest/tree/archive).

## 📱 Commands

| Input | Behavior |
|---|---|
| `/trending` | Today's chart (full pipeline, with OG images; cron result cached in KV) |
| `/search <keyword>` | Search past archives (KV index, by repo name or Chinese description, results include descriptions) |
| `/archive` | Archive links (GitHub archive branch) |
| `/start` `/help` any message without a link | Usage hints |
| Message containing a GitHub repo link / `owner/repo` | Single-repo lookup: GitHub API + deepwiki/zread Chinese description → OG card reply, archived (deduped per day) |
| Message containing an X/Twitter post link | FxEmbed API → card reply + **dual archive** (archive branch + Telegraph page), media shown via direct links |
| Message containing any other web link | Three-tier free chain converts to markdown archive; reply includes **OG image + Chinese summary + archive link**; repo links found in content trigger auto lookups (≤3) |

## 🔗 Description chain

```text
deepwiki overview (template boilerplate stripped)
  → zread wiki Chinese
    → translation fallback chain (Workers AI m2m100 → TranSmart → Google → MyMemory)
      → GitHub repo description (Chinese as-is / English translated)
```

**100% Chinese guard**: any non-Chinese result is never rendered.

## 🏗️ Architecture

- `src/sources/` source registry (an array is the registry; new source = new file + one line)
- `src/zread.ts` / `src/deepwiki.ts` RSC payload overview extraction
- `src/translate.ts` four-level translation fallback + isChinese guard + CF Summarization digests
- `src/render.ts` three renderers: Telegram HTML / GitHub markdown / Telegraph nodes
- `src/archive.ts` idempotent archiving via GitHub Contents API (archive branch) + Telegraph createPage + chunked base64
- `src/lookup.ts` single-repo pipeline (URL archiving / four-level image chain / repo fan-out / dedup)
- `src/urlmd.ts` any URL→markdown via three-tier free chain (Markdown for Agents → AI.toMarkdown → Browser Rendering)
- `src/fxtweet.ts` X/Twitter post archiving (FxEmbed public API)
- KV caches today's cron result; webhook signature timingSafeEqual + chat allowlist; /search backed by a KV index

See [`docs/GOAL.md`](docs/GOAL.md) (acceptance criteria A1–A14, in Chinese).

## 💻 Development

```bash
npm install
npm run dev        # wrangler dev --test-scheduled
curl http://localhost:8787/__scheduled   # trigger cron pipeline manually
npx tsc --noEmit   # type check
npm test           # vitest, 82 tests
```

## 🔑 Secrets (wrangler secret put)

BOT_TOKEN · CHAT_ID · WEBHOOK_SECRET · GH_TOKEN · TELEGRAPH_TOKEN (optional)

## 🚀 Deploy

Merging a PR to main triggers GitHub Actions `wrangler deploy` (needs repo secrets CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID).

## 🗺️ v2 roadmap

Web-page and X-post sources — each is just a fetch function plugged into `src/sources/index.ts`, zero pipeline changes.

---

<p align="center">
  <sub>Cloudflare Workers free tier · no DB · KV only · 95/95 tests · CI auto-deploy</sub>
</p>
