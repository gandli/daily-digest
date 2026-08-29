// 手册截图渲染: 读 docs/guide/scenarios.json → 每场景按「轮」累积渲染 Telegram 风格聊天 HTML → Playwright 截图。
// 标注(箭头/框选/文字)作为页内 SVG 覆盖层, 截图前由页内脚本按元素实际位置绘制:
//   - 每轮的用户输入 → 琥珀框 + 箭头(默认标「用户操作」, 场景可用 annotate.label 覆盖)
//   - 按钮点击 → 红框圈选被点的 inline 按钮
//   - bot 步骤的显式 annotate → 黄框 + 箭头 + 标签
// 输出 docs/guide/assets/<id>-r<k>.png(k = 轮次, 与 generate.mts 的引用一一对应)。
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { chromium } from 'playwright';

type Step = { actor: 'user' | 'bot'; text?: string; photo?: string; ogUrl?: string; buttons?: { inline_keyboard?: { text: string; callback_data: string }[][] } | null; note?: string; annotate?: { target: string; label: string } };
type Scenario = { id: string; title: string; outline: string; steps: Step[] };

const host = (u: string) => { try { return new URL(u).host; } catch { return u; } };
const br = (s = '') => s.replace(/\n/g, '<br>');

// —— 每轮 = 一次用户操作 + 该操作引发的全部 bot 动作(原地编辑轮没有新 bot 步, 但要点出图) ——
function rounds(steps: Step[]): { user: Step; bots: Step[] }[] {
  const out: { user: Step; bots: Step[] }[] = [];
  for (const s of steps) {
    if (s.actor === 'user') out.push({ user: s, bots: [] });
    else if (out.length) out[out.length - 1].bots.push(s);
  }
  return out.filter((r) => r.bots.length > 0 || r.user.text?.startsWith('[按钮] '));
}

// Telegram HTML 子集(b/i/code/pre/a/blockquote)直接可信(来自自家 worker), 仅换行转 <br>。
function bubbleInner(s: Step, clickData: string | null): string {
  const parts: string[] = [];
  const img = (src: string, alt: string, cls: string) =>
    `<img class="${cls}" src="${src}" alt="${alt}" onerror="var p=document.createElement('div');p.className='imgph';p.textContent='🖼 '+this.alt;this.replaceWith(p);">`;
  if (s.photo) parts.push(img(s.photo, host(s.photo), 'photo'));
  else if (s.ogUrl) {
    parts.push(`<div class="preview">`);
    parts.push(img(s.ogUrl, host(s.ogUrl), 'preview-img'));
    parts.push(`<div class="preview-host">🔗 ${host(s.ogUrl)}</div></div>`);
  }
  if (s.text) parts.push(`<div class="txt">${br(s.text)}</div>`);
  const kb = s.buttons?.inline_keyboard;
  if (kb?.length) {
    parts.push('<div class="kb">');
    for (const row of kb) {
      parts.push('<div class="kbrow">');
      for (const b of row) {
        const clicked = clickData && b.callback_data === clickData;
        parts.push(`<span class="kbtn${clicked ? ' kbtn-hit' : ''}" data-cb="${b.callback_data}">${b.text}</span>`);
      }
      parts.push('</div>');
    }
    parts.push('</div>');
  }
  if (s.note) parts.push(`<div class="note">⚙ ${s.note}</div>`);
  return parts.join('');
}

function buildHtml(scn: Scenario, uptoStep: number, round: { user: Step; bots: Step[] }): string {
  const msgs: string[] = [];
  let clickData: string | null = null;
  const m = round.user.text?.match(/^\[按钮\] (.+)$/);
  if (m) clickData = m[1];
  // 原地编辑替换表: 编辑步(edits 指向下标)不单独成泡, 内容替换到目标行(链式编辑解析到最初行)
  const skip = new Set<number>();
  const repl = new Map<number, Step>();
  const resolve = (t: number): number => {
    while (scn.steps[t]?.edits !== undefined) t = scn.steps[t].edits as number;
    return t;
  };
  for (let i = 0; i <= uptoStep; i++) {
    const s = scn.steps[i];
    if (s.edits === undefined) continue;
    skip.add(i);
    repl.set(resolve(s.edits), s);
  }
  // 按钮点击轮: 标注落在被编辑的那一行(用户步之后第一个编辑步的目标行)
  const userStepIdx0 = scn.steps.indexOf(round.user);
  let editAnnoRow = -1;
  if (clickData) {
    for (let i = userStepIdx0 + 1; i <= uptoStep; i++) {
      if (scn.steps[i]?.edits !== undefined) { editAnnoRow = resolve(scn.steps[i].edits as number); break; }
    }
  }
  const editAnnoLabel = round.user.annotate?.label ?? '原地编辑(翻页)';
  for (let i = 0; i <= uptoStep; i++) {
    if (skip.has(i)) continue;
    const s = repl.get(i) ?? scn.steps[i];
    if (s.actor === 'user') {
      if (s.sys) {
        msgs.push(`<div class="sysline">— ${s.text ?? ''} —</div>`);
        continue;
      }
      if (s.text?.startsWith('[按钮] ')) continue; // 按钮点击不出用户气泡 —— 由被点按钮上的高亮表达
      msgs.push(`<div class="row own" id="s${i}"><div class="bubble own">${br(s.text ?? '')}</div></div>`);
    } else {
      const anno = s.annotate ?? (i === editAnnoRow ? { label: editAnnoLabel } : undefined);
      msgs.push(`<div class="row" id="s${i}"${anno ? ' data-anno="' + anno.label.replace(/"/g, '&quot;') + '"' : ''}><div class="bubble">${bubbleInner(s, clickData)}</div></div>`);
    }
  }
  // 输入轮: 标注用户气泡(sys 触发轮无用户操作, 不标注)
  const userStepIdx = uptoStep - round.bots.length;
  if (!clickData && !round.user.sys) {
    const userAnno = round.user.annotate?.label ?? '用户操作';
    msgs.push(`<input type="hidden" id="user-anno" data-step="s${userStepIdx}" value="${userAnno.replace(/"/g, '&quot;')}">`);
  }

  return `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0b1420; font-family: system-ui, -apple-system, 'PingFang SC', 'Noto Sans CJK SC', 'Microsoft YaHei', sans-serif; }
  #wrap { position: relative; width: 700px; background: #0e1621; padding-bottom: 20px; }
  .hdr { display: flex; align-items: center; gap: 10px; padding: 10px 16px; background: #17212b; border-bottom: 1px solid #0b1420; }
  .hdr .avatar { width: 34px; height: 34px; border-radius: 50%; background: linear-gradient(135deg, #5288c1, #2b5278); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px; }
  .hdr .name { color: #fff; font-weight: 600; font-size: 14px; }
  .hdr .sub { color: #708499; font-size: 12px; }
  .hdr .badge { margin-left: auto; color: #708499; font-size: 12px; }
  .chat { padding: 16px 14px 6px; display: flex; flex-direction: column; gap: 10px; min-height: 120px; }
  .row { display: flex; }
  .row.own { justify-content: flex-end; }
  .bubble { max-width: 420px; background: #182533; border-radius: 12px 12px 12px 4px; padding: 8px 12px; color: #e8edf2; font-size: 13.5px; line-height: 1.55; overflow-wrap: anywhere; }
  .bubble.own { background: #7b61c4; border-radius: 12px 12px 4px 12px; }
  .bubble .txt a { color: #6ab3f3; text-decoration: none; }
  .bubble .txt b { font-weight: 600; }
  .bubble .txt code { background: rgba(0,0,0,.35); padding: 1px 5px; border-radius: 4px; font-family: ui-monospace, Menlo, monospace; font-size: 12.5px; }
  .photo { display: block; width: 100%; max-width: 380px; border-radius: 8px; margin-bottom: 6px; }
  .imgph { background: #22303e; border: 1px dashed #3b4d5f; color: #708499; border-radius: 8px; padding: 26px 12px; text-align: center; font-size: 12px; margin-bottom: 6px; }
  .preview { border: 1px solid #2b3b4c; border-radius: 8px; overflow: hidden; margin-bottom: 6px; background: #16212d; }
  .preview-img { display: block; width: 100%; max-height: 190px; object-fit: cover; }
  .preview-host { padding: 4px 10px; color: #708499; font-size: 11.5px; }
  .kb { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; }
  .kbrow { display: flex; gap: 4px; }
  .kbtn { flex: 1; text-align: center; background: #2b5278; color: #fff; border-radius: 6px; padding: 7px 6px; font-size: 13px; cursor: pointer; }
  .kbtn-hit { outline: 3px solid #ff5c5c; outline-offset: -1px; background: #3a6791; }
  .note { margin-top: 6px; color: #8fa6ba; font-size: 11.5px; font-style: italic; }
  .sysline { text-align: center; color: #708499; font-size: 12px; padding: 2px 0; }
  .inputbar { display: flex; align-items: center; gap: 8px; margin: 12px 14px 0; background: #17212b; border-radius: 22px; padding: 10px 16px; color: #708499; font-size: 13px; }
  .inputbar .send { margin-left: auto; color: #5288c1; font-weight: 700; }
  svg.anno { position: absolute; left: 0; top: 0; pointer-events: none; }
  .anno-label { position: absolute; background: rgba(10,16,24,.92); border: 1px solid #3b4d5f; color: #fff; font-size: 12px; line-height: 1.4; padding: 5px 9px; border-radius: 7px; max-width: 210px; }
  </style></head><body><div id="wrap">
  <div class="hdr"><div class="avatar">DD</div><div><div class="name">daily-digest</div><div class="sub">bot</div></div><div class="badge">${scn.title}</div></div>
  <div class="chat">${msgs.join('')}</div>
  <div class="inputbar" id="inputbar">消息…<span class="send">发送 ➤</span></div>
  <script>
  function drawAnno() {
    const wrap = document.getElementById('wrap');
    const W = wrap.offsetWidth, H = wrap.offsetHeight;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'anno'); svg.setAttribute('width', W); svg.setAttribute('height', H);
    wrap.appendChild(svg);
    const GUTTER = 445; // 标签放置的横向起点(聊天气泡区右侧)
    const mk = (el, color, label) => {
      const r = el.getBoundingClientRect(), w = wrap.getBoundingClientRect();
      const x = r.left - w.left, y = r.top - w.top;
      const box = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      box.setAttribute('x', x - 3); box.setAttribute('y', y - 3);
      box.setAttribute('width', r.width + 6); box.setAttribute('height', r.height + 6);
      box.setAttribute('rx', 9); box.setAttribute('fill', 'none');
      box.setAttribute('stroke', color); box.setAttribute('stroke-width', 2.5);
      svg.appendChild(box);
      const lb = document.createElement('div');
      lb.className = 'anno-label'; lb.textContent = label;
      if (x + r.width > GUTTER - 8) {
        // 右侧目标(用户气泡): 标签置于上方, 竖直箭头下指
        const cx = x + r.width / 2;
        lb.style.left = Math.max(8, Math.min(W - 220, cx - 60)) + 'px';
        lb.style.top = Math.max(70, y - 44) + 'px'; // 70 = 聊天头部之下, 防压标题
        wrap.appendChild(lb);
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', cx); line.setAttribute('y1', y - 12);
        line.setAttribute('x2', cx); line.setAttribute('y2', y - 5);
        line.setAttribute('stroke', color); line.setAttribute('stroke-width', 2);
        svg.appendChild(line);
        const head = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        head.setAttribute('points', cx + ',' + (y - 2) + ' ' + (cx - 4.5) + ',' + (y - 12) + ' ' + (cx + 4.5) + ',' + (y - 12));
        head.setAttribute('fill', color);
        svg.appendChild(head);
      } else {
        // 左侧目标(bot 气泡/按钮): 标签放右侧 gutter, 箭头从标签左缘指向目标右缘
        const lx = GUTTER, ly = Math.max(14, Math.min(H - 30, y + r.height / 2 - 10));
        lb.style.left = lx + 'px'; lb.style.top = ly + 'px';
        wrap.appendChild(lb);
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', lx - 6); line.setAttribute('y1', ly + 14);
        line.setAttribute('x2', x + r.width + 6); line.setAttribute('y2', y + r.height / 2);
        line.setAttribute('stroke', color); line.setAttribute('stroke-width', 2);
        svg.appendChild(line);
        const head = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        const tx = x + r.width + 6, tyy = y + r.height / 2, ax = lx - 6, ayy = ly + 14;
        const ang = Math.atan2(tyy - ayy, tx - ax);
        const p = (a, d) => (ax + a * Math.cos(ang) - d * Math.sin(ang)) + ',' + (ayy + a * Math.sin(ang) + d * Math.cos(ang));
        head.setAttribute('points', tx + ',' + tyy + ' ' + p(11, 4.5) + ' ' + p(11, -4.5));
        head.setAttribute('fill', color);
        svg.appendChild(head);
      }
    };
    const ua = document.getElementById('user-anno');
    if (ua) { const el = document.getElementById(ua.dataset.step); if (el) mk(el.firstChild, '#ffb02e', ua.value); }
    document.querySelectorAll('[data-anno]').forEach((el) => mk(el.firstChild, '#ffd60a', el.dataset.anno));
  }
  window.__ready = Promise.all([...document.images].map((im) => im.complete ? 1 : new Promise((res) => { im.onload = im.onerror = res; })));
  </script></div></body></html>`;
}

async function main() {
  const scenarios: Scenario[] = JSON.parse(readFileSync('docs/guide/scenarios.json', 'utf8'));
  rmSync('docs/guide/assets', { recursive: true, force: true });
  mkdirSync('docs/guide/assets', { recursive: true });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 720, height: 1200 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);

  const manifest: { id: string; title: string; rounds: { k: number; file: string; user: string; bots: string[] }[] }[] = [];
  for (const scn of scenarios) {
    const rs = rounds(scn.steps);
    const entry: (typeof manifest)[number] = { id: scn.id, title: scn.title, rounds: [] };
    for (let k = 0; k < rs.length; k++) {
      const r = rs[k];
      const userStepIdx = scn.steps.indexOf(r.user);
      const upto = userStepIdx + r.bots.length;
      const html = buildHtml(scn, upto, r);
      await page.setContent(html, { waitUntil: 'load' });
      await page.evaluate(() => (window as any).__ready).catch(() => null);
      await page.waitForTimeout(120);
      await page.evaluate(() => (window as any).drawAnno());
      const file = `${scn.id}-r${k + 1}.png`;
      await page.locator('#wrap').screenshot({ path: `docs/guide/assets/${file}` });
      entry.rounds.push({ k: k + 1, file, user: r.user.text ?? '', bots: r.bots.map((b) => (b.text ?? '').slice(0, 160)) });
    }
    manifest.push(entry);
    console.log(`${scn.id}: ${rs.length} 张截图`);
  }
  await browser.close();
  writeFileSync('docs/guide/assets/manifest.json', JSON.stringify(manifest, null, 2));
  console.log(`render done: ${manifest.reduce((a, m) => a + m.rounds.length, 0)} 张 → docs/guide/assets/`);
}

main().catch((e) => { console.error(e); process.exit(1); });
