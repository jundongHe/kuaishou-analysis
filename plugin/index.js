/**
 * 快手作品分析 —— Host 半区。
 *
 * 职责：
 * 1. 保存上一次采集到的快照（内存 + 磁盘缓存）；
 * 2. 需要时调用 collect.mjs（持久化浏览器的 Playwright 采集器）拉一次最新数据；
 * 3. 通过 /kuaishou/api/* 给面板提供数据与触发同步；
 * 4. 通过 kuaishou_analysis 工具把同一份快照交给 Agent，让对话里也能分析。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildSnapshot } from './analyze.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.dirname(here); // kuaishou-analysis/
const PLUGIN_DIR = here;

const DEFAULT_DATA_DIR = path.join(pluginRoot, 'data');
const DEFAULT_PROFILE_DIR = path.join(pluginRoot, '.profile');

const PLAYWRIGHT_CANDIDATES = [
  path.join(PLUGIN_DIR, 'node_modules', 'playwright-core'),
  'C:\\Users\\jundo\\project\\模板\\插件\\mcp-playwright\\node_modules\\playwright-core',
];

function pickPlaywright(configured) {
  const list = configured ? [configured, ...PLAYWRIGHT_CANDIDATES] : PLAYWRIGHT_CANDIDATES;
  for (const candidate of list) {
    try {
      if (fs.existsSync(path.join(candidate, 'index.js'))) return candidate;
    } catch {
      /* 忽略不可读路径 */
    }
  }
  return configured || '';
}

export const Config = {
  '~standard': {
    version: 1,
    vendor: 'kuaishou-analysis',
    validate(value) {
      const input = value && typeof value === 'object' ? value : {};
      const profileDir = String(input.profileDir || '').trim() || DEFAULT_PROFILE_DIR;
      const dataDir = String(input.dataDir || '').trim() || DEFAULT_DATA_DIR;
      const maxWorks = Number(input.maxWorks);
      return {
        value: {
          ...input,
          profileDir,
          dataDir,
          maxWorks: Number.isFinite(maxWorks) && maxWorks > 0 ? Math.min(50, Math.floor(maxWorks)) : 12,
          headless: input.headless === true,
          nodePath: String(input.nodePath || '').trim() || 'node',
        },
      };
    },
    types: {},
  },
};

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(filePath, value) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(value), 'utf8');
  } catch {
    /* 缓存写不进去不影响本次结果 */
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

/** 一句人话总结，给工具返回值用。 */
function summarize(snapshot) {
  if (!snapshot) return '还没有采集到数据。';
  const account = snapshot.account || {};
  const totals = snapshot.totals || {};
  const lines = [
    `账号：${account.name || '未知'}（粉丝 ${account.fans}）`,
    `公开作品 ${totals.works} 条，总播放 ${totals.play}，总点赞 ${totals.like}，总涨粉 ${totals.follow}`,
  ];
  const works = snapshot.works || [];
  if (works.length) {
    const best = [...works].sort((a, b) => b.play - a.play)[0];
    const worst = [...works].sort((a, b) => a.play - b.play)[0];
    lines.push(`最好：${shortTitle(best.title)} — 播放 ${best.play}，综合分 ${best.score}`);
    if (worst && worst.photoId !== best.photoId) {
      lines.push(`最差：${shortTitle(worst.title)} — 播放 ${worst.play}，综合分 ${worst.score}`);
    }
    lines.push('每条作品的核心问题：');
    for (const work of works.slice(0, 6)) {
      const issue = work.headline ? work.headline.text : '';
      const fix = (work.fixList && work.fixList[0]) ? work.fixList[0].fix : '';
      lines.push(`- ${shortTitle(work.title)}（播放 ${work.play}，分 ${work.score}）：${issue}${fix ? ` → ${fix}` : ''}`);
    }
  }
  const advice = snapshot.priorityFixes || snapshot.advice || [];
  if (advice.length) {
    lines.push('优先修复：');
    for (const item of advice.slice(0, 4)) {
      lines.push(`- ${item.title}${item.evidence ? `（${item.evidence}）` : ''}：${item.detail}`);
    }
  }
  return lines.join('\n');
}

function shortTitle(title) {
  const text = String(title || '').replace(/#[^\s#]+/g, '').replace(/\s+/g, ' ').trim();
  return text.length > 12 ? `${text.slice(0, 12)}…` : text || '无标题';
}

export const inject = ['webServer', 'tools'];

export function apply(ctx, config) {
  const cfg = {
    profileDir: config.profileDir,
    dataDir: config.dataDir,
    maxWorks: config.maxWorks,
    headless: config.headless,
    nodePath: config.nodePath,
    playwrightPath: pickPlaywright(config.playwrightPath),
  };
  const cacheFile = path.join(cfg.dataDir, 'snapshot.json');
  const lockFile = path.join(cfg.dataDir, 'sync.lock');

  let snapshot = readJson(cacheFile);
  let running = null;
  let lastError = '';
  let lastAttempt = 0;

  const status = () => ({
    hasData: Boolean(snapshot),
    capturedAt: snapshot ? snapshot.capturedAt : '',
    running: Boolean(running),
    error: lastError,
    lastAttempt,
    profileDir: cfg.profileDir,
    headless: cfg.headless,
    maxWorks: cfg.maxWorks,
    playwright: cfg.playwrightPath ? 'ok' : 'missing',
  });

  function runCollector() {
    return new Promise((resolve, reject) => {
      const collectPath = path.join(PLUGIN_DIR, 'collect.mjs');
      const args = [
        collectPath,
        '--profile', cfg.profileDir,
        '--max-works', String(cfg.maxWorks),
        '--out', path.join(cfg.dataDir, 'raw.json'),
      ];
      if (cfg.playwrightPath) args.push('--playwright', cfg.playwrightPath);
      if (cfg.headless) args.push('--headless');

      const child = spawn(cfg.nodePath, args, {
        cwd: PLUGIN_DIR,
        windowsHide: true,
        env: { ...process.env, KS_PLUGIN_ROOT: pluginRoot },
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += String(chunk); });
      child.stderr.on('data', (chunk) => { stderr += String(chunk); });
      child.on('error', (error) => reject(new Error(`启动采集器失败：${error.message}`)));
      const timer = setTimeout(() => {
        try { child.kill(); } catch { /* ignore */ }
        reject(new Error('采集超时（超过 8 分钟）'));
      }, 8 * 60 * 1000);
      child.on('close', (code) => {
        clearTimeout(timer);
        const line = stdout.trim().split(/\r?\n/).filter(Boolean).pop() || '';
        if (!line) {
          reject(new Error(stderr.trim() || `采集器退出码 ${code}，没有输出`));
          return;
        }
        try {
          resolve(JSON.parse(line));
        } catch {
          reject(new Error(`采集器输出不是 JSON：${line.slice(0, 300)}`));
        }
      });
    });
  }

  async function sync() {
    if (running) return running;
    lastAttempt = Date.now();
    lastError = '';
    if (!cfg.playwrightPath) {
      lastError = '找不到 playwright-core，请检查插件配置 playwrightPath。';
      throw new Error(lastError);
    }
    running = (async () => {
      try {
        const raw = await runCollector();
        if (!raw || raw.ok === false) {
          const message = (raw && raw.message) || '采集失败';
          lastError = message;
          throw Object.assign(new Error(message), { code: (raw && raw.code) || 'collect-failed' });
        }
        const next = buildSnapshot(raw);
        next.capturedAt = new Date().toISOString();
        snapshot = next;
        writeJson(cacheFile, snapshot);
        writeJson(lockFile, { at: snapshot.capturedAt });
        return snapshot;
      } catch (error) {
        lastError = String((error && error.message) || error);
        throw error;
      } finally {
        running = null;
      }
    })();
    return running;
  }

  ctx.effect(() => {
    const off = ctx.webServer.register({
      kind: 'exact',
      path: '/kuaishou/api/data',
      handler: (req, res) => {
        if (req.method !== 'GET') {
          sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
          return;
        }
        sendJson(res, 200, { ok: true, status: status(), snapshot });
      },
    });
    return () => off();
  }, 'kuaishou:data-route');

  ctx.effect(() => {
    const off = ctx.webServer.register({
      kind: 'exact',
      path: '/kuaishou/api/sync',
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
          return;
        }
        await readBody(req).catch(() => '');
        try {
          const next = await sync();
          sendJson(res, 200, { ok: true, status: status(), snapshot: next });
        } catch (error) {
          sendJson(res, 200, {
            ok: false,
            code: (error && error.code) || 'sync-failed',
            message: String((error && error.message) || error),
            status: status(),
            snapshot,
          });
        }
      },
    });
    return () => off();
  }, 'kuaishou:sync-route');

  ctx.effect(() => {
    const off = ctx.tools.register({
      name: 'kuaishou_analysis',
      description: '读写快手账号的作品数据分析：status 看状态，sync 用持久化浏览器采集最新数据，read 取完整快照，brief 取一段可直接分析的文字摘要。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['status', 'sync', 'read', 'brief'],
            description: 'status=状态；sync=采集最新数据；read=完整快照 JSON；brief=文字摘要。',
          },
        },
        required: ['action'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
          additionalProperties: true,
        },
        render: (args, value) => [{ type: 'text', text: String((value && value.text) || '') }],
      },
      async execute(args) {
        const action = (args && args.action) || 'brief';
        if (action === 'status') {
          return { text: JSON.stringify(status(), null, 2) };
        }
        if (action === 'sync') {
          try {
            const next = await sync();
            return { text: `已采集 ${next.totals.works} 条作品（${next.capturedAt}）。\n\n${summarize(next)}` };
          } catch (error) {
            return { text: `采集失败：${String((error && error.message) || error)}` };
          }
        }
        if (action === 'read') {
          return { text: JSON.stringify(snapshot || { empty: true }) };
        }
        return { text: summarize(snapshot) };
      },
    });
    return () => off();
  }, 'kuaishou:tool');
}
