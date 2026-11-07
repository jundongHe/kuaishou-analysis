/**
 * 快手创作者平台数据采集器。
 *
 * 思路：不伪造接口签名，也不自己调 REST —— 用一个持久化的浏览器 profile
 * 打开后台页面，让页面自己发请求，我们只截获返回的 JSON。
 * 这样登录态、__NS_sig3 签名、加密都由快手自己的前端完成。
 *
 * 用法（由 Host 插件调用，也可以手动跑）：
 *   node collect.mjs --profile <dir> --playwright <playwright-core 目录> --out <json> [--max-works 12] [--headless]
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function parseArgs(argv) {
  const args = { maxWorks: 12, headless: false, loginTimeout: 180, channel: 'msedge' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (key === 'headless') {
      args.headless = true;
      continue;
    }
    if (next && !next.startsWith('--')) {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const profileDir = path.resolve(args.profile || path.join(process.cwd(), 'kuaishou-analysis', '.profile'));
const maxWorks = Math.max(1, Number(args.maxWorks) || 12);
const loginTimeoutMs = Math.max(0, Number(args.loginTimeout) || 180) * 1000;

function emit(payload) {
  const text = JSON.stringify(payload);
  if (args.out) {
    fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
    fs.writeFileSync(path.resolve(args.out), text, 'utf8');
  }
  process.stdout.write(`${text}\n`);
}

async function loadPlaywright() {
  const candidates = [];
  if (args.playwright) candidates.push(args.playwright);
  candidates.push('playwright-core');
  for (const candidate of candidates) {
    try {
      const imported = candidate === 'playwright-core'
        ? await import('playwright-core')
        : await import(pathToFileURL(entryOf(candidate)).href);
      // playwright-core 是 CJS，命名导出靠静态分析识别不到 chromium，得走 default。
      const mod = imported && imported.chromium ? imported : (imported.default || imported);
      if (!mod || !mod.chromium) throw new Error('playwright-core 里没有 chromium');
      return mod;
    } catch (error) {
      if (candidate === candidates[candidates.length - 1]) throw error;
    }
  }
  throw new Error('找不到 playwright-core');
}

function entryOf(candidate) {
  const resolved = path.resolve(candidate);
  return fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()
    ? path.join(resolved, 'index.js')
    : resolved;
}

const WANT = [
  '/rest/cp/creator/pc/home/userInfo',
  '/rest/cp/creator/analysis/pc/home/author/overview',
  '/rest/cp/creator/analysis/pc/photo/list',
  '/rest/cp/creator/analysis/pc/photo/single/overview',
  '/rest/cp/creator/analysis/pc/photo/single/info',
  '/rest/cp/creator/analysis/pc/photo/single/traffic/source',
  '/rest/cp/creator/pc/analysis/photo/single/trending',
  '/rest/cp/creator/analysis/pc/photo/single/diagnose',
  '/rest/v2/creator/activity/pc/list',
  '/rest/cp/creator/pc/home/all/taskCardV2',
];

function wants(url) {
  return WANT.some((suffix) => url.includes(suffix));
}

/** 活动中心列表：每个活动都带「必须带的话题」tagConditionList，这是每天发稿最直接的抓手。 */
function normalizeActivities(hit) {
  const data = hit && hit.json && hit.json.data;
  const items = Array.isArray(data && data.list) ? data.list : [];
  return items.filter(Boolean).map((item) => ({
    id: String(item.id || ''),
    activityId: String(item.activityId || ''),
    title: String(item.title || ''),
    cover: String(item.headUrl || ''),
    brief: String(item.brief || ''),
    gain: String(item.topGain || ''),
    rewardType: Array.isArray(item.rewardType) ? item.rewardType.map(Number) : [],
    tags: Array.isArray(item.tagLabels) ? item.tagLabels.map(String) : [],
    topics: Array.isArray(item.tagConditionList) ? item.tagConditionList.map(String) : [],
    beginTime: item.beginTime || 0,
    endTime: item.endTime || 0,
    participants: item.number || 0,
    participated: Boolean(item.participated),
    overSoon: Boolean(item.overSoon),
    detailUrl: String(item.detailUrl || item.inApp || ''),
  }));
}

/** 活动规则是富文本，去掉标签留纯文本，面板才放得下。 */
function stripHtml(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** 首页的「我的成长任务」：发几条作品、每天访问成长中心这类日常任务。 */
function normalizeTasks(hit) {
  const data = hit && hit.json && hit.json.data;
  const list = Array.isArray(data && data.taskList) ? data.taskList : [];
  return list.map((task) => ({
    id: String(task.taskId || ''),
    title: String(task.mainCaption || ''),
    progress: String(task.subCaption || ''),
    reward: String(task.rewardTag || ''),
    jumpUrl: String(task.jumpUrl || ''),
  }));
}

async function main() {
  const { chromium } = await loadPlaywright();
  const launchOptions = {
    headless: args.headless,
    viewport: null,
    channel: args.channel,
    args: ['--start-maximized', '--no-first-run', '--no-default-browser-check'],
  };

  let context;
  try {
    context = await chromium.launchPersistentContext(profileDir, launchOptions);
  } catch (error) {
    if (args.channel === 'msedge') {
      context = await chromium.launchPersistentContext(profileDir, { ...launchOptions, channel: 'chrome' });
    } else {
      throw error;
    }
  }

  const bucket = [];
  context.on('response', async (response) => {
    try {
      const request = response.request();
      const url = response.url();
      if (!/kuaishou\.com/i.test(url) || !wants(url)) return;
      if (!['xhr', 'fetch'].includes(request.resourceType())) return;
      const contentType = String(response.headers()['content-type'] || '').toLowerCase();
      if (!contentType.includes('json')) return;
      const body = await response.text();
      bucket.push({
        url: url.replace(/\?.*$/, ''),
        postData: request.postData() || '',
        status: response.status(),
        json: JSON.parse(body),
        at: Date.now(),
      });
    } catch {
      /* 单条响应读失败不影响整体 */
    }
  });

  // 作品列表接口默认一页 10 条，改成 50 条，少翻页。
  await context.route('**/rest/cp/creator/analysis/pc/photo/list*', async (route) => {
    try {
      const request = route.request();
      const payload = JSON.parse(request.postData() || '{}');
      payload.count = 50;
      payload.page = 0;
      await route.continue({ postData: JSON.stringify(payload) });
    } catch {
      await route.continue();
    }
  });

  // 首页趋势默认只看 7 天，改成 30 天窗口，趋势才有意义。
  await context.route('**/rest/cp/creator/analysis/pc/home/author/overview*', async (route) => {
    try {
      const request = route.request();
      const payload = JSON.parse(request.postData() || '{}');
      if (payload && typeof payload === 'object') payload.timeType = 2;
      await route.continue({ postData: JSON.stringify(payload) });
    } catch {
      await route.continue();
    }
  });

  const page = context.pages()[0] || (await context.newPage());
  page.setDefaultTimeout(45000);

  const take = (suffix, since = 0) => {
    const hits = bucket.filter((entry) => entry.url.includes(suffix) && entry.at >= since);
    return hits.length ? hits[hits.length - 1] : null;
  };

  const go = async (url) => {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  };

  const waitFor = async (suffix, timeout = 15000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const hit = take(suffix, Date.now() - timeout);
      if (hit) return hit;
      await page.waitForTimeout(300);
    }
    return null;
  };

  // 1) 首页：账号信息 + 账号趋势
  await go('https://cp.kuaishou.com/profile');
  await page.waitForTimeout(1500);

  const loggedIn = async () => {
    const cookies = await context.cookies('https://cp.kuaishou.com');
    return cookies.some((cookie) => cookie.name === 'userId' && cookie.value);
  };

  if (!(await loggedIn())) {
    if (args.headless) {
      emit({ ok: false, code: 'need-login-headless', message: '未登录，且当前是无界面模式；请关闭 headless 后重试并扫码登录。' });
      await context.close();
      return;
    }
    const deadline = Date.now() + loginTimeoutMs;
    let informed = false;
    while (Date.now() < deadline) {
      if (await loggedIn()) break;
      if (!informed) {
        process.stderr.write('等待登录：请在打开的浏览器窗口里扫码登录快手创作者服务平台…\n');
        informed = true;
      }
      await page.waitForTimeout(1500);
    }
    if (!(await loggedIn())) {
      emit({ ok: false, code: 'need-login', message: '等待登录超时，请重新同步并在弹出的窗口里完成登录。' });
      await context.close();
      return;
    }
    await go('https://cp.kuaishou.com/profile');
    await page.waitForTimeout(2500);
  }

  await waitFor('/home/userInfo', 12000);
  await waitFor('/home/author/overview', 12000);

  const userInfo = take('/home/userInfo');
  const overviewHit = take('/home/author/overview');
  const core = (userInfo && userInfo.json && userInfo.json.data && userInfo.json.data.coreUserInfo) || {};

  // 2) 作品分析列表
  const listStart = Date.now();
  await go('https://cp.kuaishou.com/statistics/article');
  const listHit = await waitFor('/analysis/pc/photo/list', 20000);
  const photoItems = (listHit && listHit.json && listHit.json.data && listHit.json.data.photoList && listHit.json.data.photoList.photoItems) || [];
  const listTotal = (listHit && listHit.json && listHit.json.data && listHit.json.data.photoList && listHit.json.data.photoList.total) || photoItems.length;

  // 3) 每条作品详情
  const details = {};
  const targets = photoItems.slice(0, maxWorks);
  for (let index = 0; index < targets.length; index += 1) {
    const item = targets[index];
    const photoId = String(item.photoId || '');
    if (!photoId) continue;
    const since = Date.now();
    await go(`https://cp.kuaishou.com/statistics/article/detail/${photoId}`);
    await waitFor('/photo/single/overview', 12000);
    await page.waitForTimeout(1200);
    details[photoId] = {
      overview: (take('/photo/single/overview', since) || {}).json || null,
      info: (take('/photo/single/info', since) || {}).json || null,
      traffic: (take('/photo/single/traffic/source', since) || {}).json || null,
      trending: (take('/photo/single/trending', since) || {}).json || null,
      diagnose: (take('/photo/single/diagnose', since) || {}).json || null,
    };
  }

  // 4) 活动中心：创作服务 → 活动中心，拿「今天能参加哪些活动、要带什么话题」
  const activitySince = Date.now();
  await go('https://cp.kuaishou.com/creative/activity-calendar');
  await waitFor('/activity/pc/list', 20000);
  await page.waitForTimeout(800);
  const activityHit = take('/activity/pc/list', activitySince) || take('/activity/pc/list');
  const taskHit = take('/home/all/taskCardV2');

  // 活动规则在详情接口里（列表只给标题和话题），逐个取一次；数量不大，全取。
  let activities = normalizeActivities(activityHit);
  if (activities.length) {
    const ids = activities.map((item) => Number(item.id)).filter(Boolean);
    const rules = await page.evaluate(async (list) => {
      const out = {};
      for (const id of list) {
        try {
          const res = await fetch('/rest/v2/creator/activity/pc/detail', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id }),
            credentials: 'include',
          });
          const json = await res.json();
          out[id] = (json && json.data && json.data.activityRule) || '';
        } catch {
          out[id] = '';
        }
      }
      return out;
    }, ids).catch(() => ({}));
    activities = activities.map((item) => ({ ...item, ruleText: stripHtml(rules[item.id] || '').slice(0, 3000) }));
  }

  emit({
    ok: true,
    capturedAt: new Date().toISOString(),
    listStart,
    account: {
      userId: core.userId || 0,
      userIdStr: core.userIdStr || '',
      name: core.userName || '',
      avatar: core.headUrl || '',
      fans: core.fansNum || 0,
    },
    overview: (overviewHit && overviewHit.json && overviewHit.json.data) || null,
    activities: activities,
    tasks: normalizeTasks(taskHit),
    list: {
      total: listTotal,
      items: photoItems.map((item) => ({
        photoId: String(item.photoId || ''),
        title: String(item.title || ''),
        cover: String(item.cover || ''),
        publishTime: item.publishTime || 0,
        playCount: item.playCount || 0,
        likeCount: item.likeCount || 0,
        commentCount: item.commentCount || 0,
        collectCount: item.collectCount || 0,
        followCount: item.followCount || 0,
        fpr: item.fpr || 0,
        video: Boolean(item.video),
        duration: item.duration || 0,
      })),
    },
    details,
  });

  await context.close();
}

main().catch(async (error) => {
  emit({ ok: false, code: 'collect-failed', message: String((error && error.message) || error) });
  process.exitCode = 1;
});
