// 手册正文生成: 读 docs/guide/scenarios.json + OUTLINE.md + assets/manifest.json,
// 每章调用 OpenRouter(与 src/translate.ts 同款免费模型池)生成逐步操作说明 → docs/guide/<NN>-*.md + README.md 索引。
// OPENROUTER_API_KEY 缺失或模型全败 → 确定性模板兜底, 管线永不因 LLM 故障而红。
import { readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';

type Round = { k: number; file: string; user: string; bots: string[] };
type Entry = { id: string; title: string; rounds: Round[] };

// 与 src/translate.ts 同池(scripts 保持解耦, 不 import src 内部)
const MODELS = ['minimax/minimax-m3:free', 'stealth/ox-alpha', 'dots-studio/dots-3-note-preview:free'];

const stripHtml = (s: string) =>
  s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

// OUTLINE.md → 章节 map: '01' → { title, body(事务/验证 两行) }
function parseOutline(): Map<string, { title: string; body: string }> {
  const map = new Map<string, { title: string; body: string }>();
  const md = readFileSync('docs/guide/OUTLINE.md', 'utf8');
  const re = /^## (\d+)\. (.+)\n([\s\S]*?)(?=\n## \d+\.|$)/gm;
  for (const [, n, title, body] of md.matchAll(re)) {
    map.set(n.padStart(2, '0'), { title: title.trim(), body: body.trim() });
  }
  return map;
}

function transcript(entry: Entry): string {
  return entry.rounds
    .map((r) => {
      const bots = r.bots.map((b) => '  Bot: ' + stripHtml(b).replace(/\s+/g, ' ').slice(0, 300)).join('\n');
      return `第${r.k}轮 — 用户: ${r.user.replace('[按钮] ', '点击按钮 ')}\n  截图: assets/${r.file}\n${bots}`;
    })
    .join('\n');
}

async function chat(key: string, model: string, messages: { role: string; content: string }[]): Promise<string> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', 'HTTP-Referer': 'https://github.com/gandli/daily-digest', 'X-Title': 'daily-digest-manual' },
    body: JSON.stringify({ model, messages, temperature: 0.3 }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`${model} HTTP ${res.status}`);
  const j = (await res.json()) as any;
  const c = j?.choices?.[0]?.message?.content;
  if (typeof c !== 'string' || stripHtml(c).trim().length < 50) throw new Error(`${model} 空回复`);
  return c;
}

async function genAi(key: string, messages: { role: string; content: string }[]): Promise<string | null> {
  for (const m of MODELS) {
    try {
      const out = await chat(key, m, messages);
      console.log(`  AI OK (${m})`);
      return out;
    } catch (e) {
      console.log(`  AI 模型失败: ${String(e).slice(0, 80)}`);
    }
  }
  return null;
}

// 后处理: 脱围栏、只保留真实存在的截图引用
function sanitize(md: string, files: Set<string>): string {
  let out = md.trim().replace(/^```(?:markdown)?\n/, '').replace(/\n```$/, '');
  out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (all, alt: string, p: string) =>
    files.has(p.replace(/^\.\//, '')) ? all : `<!-- 截图引用已清理: ${p} -->`);
  return out + '\n';
}

// 模板兜底: 确定性拼装, 不依赖任何外部服务
function template(entry: Entry, outline?: { title: string; body: string }): string {
  const parts: string[] = [`# ${entry.title}`, ''];
  if (outline) parts.push('> ' + outline.body.split('\n').join('\n> '), '');
  parts.push('## 操作步骤', '');
  for (const r of entry.rounds) {
    parts.push(`### 第 ${r.k} 步 — ${r.user.replace('[按钮] ', '点击按钮 ')}`, '', `![第 ${r.k} 步界面](assets/${r.file})`, '');
    for (const b of r.bots) {
      const t = stripHtml(b).replace(/\s+/g, ' ').trim();
      if (t) parts.push(`- Bot 回复: ${t.slice(0, 200)}${t.length > 200 ? '…' : ''}`);
    }
    parts.push('');
  }
  parts.push('> 本章由 e2e 场景自动生成, 与 Bot 当前行为一致。');
  return parts.join('\n');
}

async function main() {
  const entries: Entry[] = JSON.parse(readFileSync('docs/guide/assets/manifest.json', 'utf8'));
  const outline = parseOutline();
  const key = process.env.OPENROUTER_API_KEY || '';
  const index: string[] = ['# daily-digest 用户手册', '', '> 本手册由 e2e 场景自动驱动生成(scripts/manual/), 随 CI 与 Bot 功能保持同步, 请勿手改章节文件。', `> 生成时间: ${new Date().toISOString()}`, ''];
  let aiCount = 0;

  // 清理旧的生成章节(场景改名/删除后的残留); OUTLINE.md 手写保留
  for (const f of readdirSync('docs/guide')) {
    if (/^\d{2}-.*\.md$/.test(f)) rmSync(`docs/guide/${f}`);
  }

  for (const entry of entries) {
    const n = entry.id.slice(0, 2);
    const ch = outline.get(n);
    const files = new Set(entry.rounds.map((r) => 'assets/' + r.file));
    let md: string | null = null;
    if (key) {
      console.log(`${entry.id}: AI 生成中…`);
      md = await genAi(key, [
        { role: 'system', content: '你是 Telegram Bot 用户手册的技术文档作者。只输出 Markdown 正文(不要代码围栏包裹), 全文中文。' },
        { role: 'user', content: [
          `为 Bot 功能章节《${ch?.title ?? entry.title}》撰写逐步操作说明。`,
          `章节背景(事务与验证点):\n${ch?.body ?? entry.title}`,
          `\n真实对话记录(由 e2e 测试驱动真实 Bot 产生, 权威事实, 不要编造对话外的功能):\n${transcript(entry)}`,
          `\n可用截图(必须穿插引用, 路径原样使用):\n${entry.rounds.map((r) => `- assets/${r.file}`).join('\n')}`,
          '\n要求:\n1. 用编号步骤组织(### 步骤 N: 动作), 每步说明用户做什么、Bot 会回什么(与对话记录一致);\n2. 关键步骤后插入对应截图: ![简短说明](assets/xxx.png);\n3. 结尾加「小贴士」小节(1-3 条实用提示);\n4. 全文 300-700 字, 面向 Bot 使用者。',
        ].join('\n') }]);
    }
    if (!md) md = template(entry, ch);
    else aiCount++;
    writeFileSync(`docs/guide/${entry.id}.md`, sanitize(md, files));
    index.push(`| [${n}. ${ch?.title ?? entry.title}](${entry.id}.md) | ${entry.title} |`);
    console.log(`${entry.id}.md 写出${md === null ? ' (模板兜底)' : ''}`);
  }

  index.push('', `---`, '', `章节来源: [OUTLINE.md](OUTLINE.md) · 场景数据: scenarios.json · 截图: assets/ · AI 生成章节: ${aiCount}/${entries.length}`);
  writeFileSync('docs/guide/README.md', index.join('\n') + '\n');
  console.log(`generate done: ${entries.length} 章 (AI ${aiCount} + 模板 ${entries.length - aiCount})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
