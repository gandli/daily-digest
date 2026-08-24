// 描述正确性测试: zread wiki 提取器输出必须是"实质中文定义段"。
// 跑法: npx vitest run(无配置, 默认 node 环境)
import { describe, it, expect } from 'vitest';
import { extractDesc } from '../src/zread';

const CJK = (s: string) => (s.match(/[\u4e00-\u9fff]/g) ?? []).length;

// 构造仿 RSC payload: 30K 噪声头 + 正文 + Sources 尾
const payload = (body: string) => 'x'.repeat(30000) + body + '\nSources: foo.md, bar.ts';

describe('extractDesc: 输出必须为中文', () => {
  it('英文正文 → 拒绝(返回 null)', () => {
    const p = payload('\n## Overview\n\nCodex CLI is an open-source coding agent by OpenAI. It runs locally on your machine and translates natural language into file edits.\n');
    expect(extractDesc(p, 280)).toBeNull();
  });

  it('中文定义句 → 接受且以中文为主', () => {
    const p = payload('\n## 概览\n\nCodex CLI 是 OpenAI 的开源编码 Agent，可在你的计算机上本地运行。它是一个 Rust 原生系统，能将自然语言指令转化为具体的文件编辑。\n');
    const d = extractDesc(p, 280);
    expect(d).not.toBeNull();
    expect(d!).toContain('是 OpenAI 的开源编码');
    expect(CJK(d!)).toBeGreaterThan(d!.length * 0.3);
  });

  it('超长定义 → 截断到 maxLen 且带省略号', () => {
    const long = 'Omarchy 是一个开箱即用的 Linux 桌面发行版，' + '由 DHH 创建并维护，'.repeat(40);
    const d = extractDesc(payload(`\n## 概览\n\n${long}\n`), 280);
    expect(d!.length).toBeLessThanOrEqual(280);
    expect(d!.endsWith('…')).toBe(true);
  });
});

describe('extractDesc: 过滤杂讯', () => {
  it('编号目录行 → 跳过', () => {
    const p = payload('\n## 目录\n\n1. [快速开始](2-quick-start) — 在两分钟内完成安装。2. [架构概览](7-arch) — 详细的系统设计说明文档。\n\n## 定位\n\nECC 是一款开源的 Agent 支撑操作系统，它将 AI 编程 Agent 从单打独斗转变为协同工作的工程系统。\n');
    const d = extractDesc(p, 280);
    expect(d).not.toBeNull();
    expect(d!).not.toMatch(/^1\./);
    expect(d!).toContain('Agent 支撑操作系统');
  });

  it('RSC/JS chunk 杂讯 → 跳过', () => {
    const p = payload('\n## x\n\nstatic/chunks/f8ae55effcec.js","8217","static/chunks/8217dfd6.js 是一个包含构建产物的清单文件列表\n\n## 真正的描述\n\nApache Maka 是一个为真实工作场景构建的本地优先 Agent 工作区，默认将会话与设置保存在你的本地机器上。\n');
    const d = extractDesc(p, 280);
    expect(d).toContain('Maka');
    expect(d).not.toContain('.js');
  });

  it('无 Sources 尾 → 也工作(截断兜底)', () => {
    const p = 'x'.repeat(30000) + '\n## 简介\n\nFree Claude Code 是一个兼容 Anthropic 的即插即用代理服务器，位于客户端与任意 LLM 提供商之间。';
    const d = extractDesc(p, 280);
    expect(d).toContain('即插即用代理');
  });
});

describe('extractDesc: 无有效内容', () => {
  it('纯噪声 → null', () => {
    expect(extractDesc('y'.repeat(35000), 280)).toBeNull();
  });
});
