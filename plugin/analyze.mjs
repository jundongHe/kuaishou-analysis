/**
 * 快手作品数据分析：把采集到的原始接口数据归一化，并给出「哪里有问题、怎么改」。
 *
 * 只做纯计算，不碰网络和文件，方便 Host 侧和测试脚本共用。
 */

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const TZ_OFFSET = 8 * HOUR; // 快手后台按北京时间出数

/** 数值兜底：非数字一律当 0，避免 UI 出现 NaN。 */
function num(value) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function median(list) {
  const arr = list.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!arr.length) return 0;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

/** 北京时间下的「小时 / 星期 / 日期串」。 */
export function beijingDate(ms) {
  const d = new Date(num(ms) + TZ_OFFSET);
  return {
    y: d.getUTCFullYear(),
    m: d.getUTCMonth() + 1,
    d: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    weekday: d.getUTCDay(), // 0=周日
    text: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`,
  };
}

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** 从标题里抽 #话题，去掉空标签并去重。 */
export function parseTags(title) {
  const text = String(title || '');
  const tags = [];
  const re = /#([^\s#]+)/g;
  let match;
  while ((match = re.exec(text))) {
    const tag = match[1].trim().replace(/[，。,.!！?？、;；:：]+$/, '');
    if (tag && !tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

/** 标题去掉话题标签后的正文长度，用来判断「正文是否过短」。 */
export function bodyLength(title) {
  return String(title || '').replace(/#[^\s#]+/g, '').replace(/\s+/g, '').length;
}

function findMetric(metrics, enName) {
  if (!Array.isArray(metrics)) return null;
  const hit = metrics.find((item) => item && item.enName === enName);
  return hit || null;
}

/** 采集器存的是 {result, data} 信封，这里统一拆开。 */
function unwrap(payload) {
  if (!payload || typeof payload !== 'object') return null;
  return payload.data && typeof payload.data === 'object' ? payload.data : payload;
}

/** 单条作品详情里的「流量来源」：播放/完成播放/涨粉/评论/点赞 各自按渠道拆。 */
function normalizeTraffic(traffic) {
  const list = traffic && traffic.trafficDataList;
  if (!Array.isArray(list)) return [];
  const play = list.find((item) => item && item.tab === 'PLAY');
  if (!play || !Array.isArray(play.trendData)) return [];
  // 新发布的作品，渠道数据可能整排是 null，先过滤再取字段。
  return play.trendData
    .filter(Boolean)
    .map((item) => ({ name: String(item.name || ''), count: num(item.count) }));
}

/** 流量来源的全量版本：五个 tab 都留着，面板里可以切换看。 */
function normalizeTrafficFull(traffic) {
  const list = traffic && traffic.trafficDataList;
  if (!Array.isArray(list)) return null;
  const out = {};
  const map = {
    PLAY: 'play',
    COMPLETE_PLAY: 'complete',
    INCREASE_FAN: 'follow',
    COMMENT: 'comment',
    LIKE: 'like',
  };
  for (const item of list) {
    if (!item || !item.tab) continue;
    const key = map[item.tab];
    if (!key) continue;
    out[key] = {
      label: String(item.name || ''),
      total: num(item.sumCount),
      channels: (Array.isArray(item.trendData) ? item.trendData : [])
        .filter(Boolean)
        .map((point) => ({ name: String(point.name || ''), count: num(point.count) })),
    };
  }
  return Object.keys(out).length ? out : null;
}

/** 核心数据：后台「核心数据」那一排（播放量、平均播放时长、封面点击率、2 秒跳出、5 秒完播、完播率）。 */
const CORE_METRICS = [
  { en: 'PLAY_CNT', key: 'play', label: '播放量', unit: 'count' },
  { en: 'AVG_PLAY_DURATION', key: 'avgDuration', label: '平均播放时长', unit: 'ms' },
  { en: 'OUTSIDE_CTR', key: 'ctr', label: '封面点击率', unit: 'percent' },
  { en: 'TWO_SECONDS_EXIT', key: 'twoSecExit', label: '2 秒跳出率', unit: 'percent' },
  { en: 'FIVE_SECONDS_FPR', key: 'fiveSec', label: '5 秒完播率', unit: 'percent' },
  { en: 'FPR', key: 'complete', label: '完播率', unit: 'percent' },
];

function normalizeCoreMetrics(metrics) {
  if (!Array.isArray(metrics)) return [];
  return CORE_METRICS.map((def) => {
    const hit = findMetric(metrics, def.en);
    return {
      key: def.key,
      label: def.label,
      unit: def.unit,
      value: hit ? num(hit.sumCount) : null,
      available: Boolean(hit) && num(hit.sumCount) > 0,
    };
  });
}

/** 单条作品详情的留存曲线：time（秒）→ 留存百分比。 */
function normalizeRetention(trending) {
  const list = trending && trending.trendData;
  if (!Array.isArray(list) || !list.length) return [];
  const curve = list[0] && list[0].hotDetailList;
  if (!Array.isArray(curve)) return [];
  return curve.filter(Boolean).map((item) => ({ time: num(item.time), ratio: num(item.ratio) }));
}

/** 诊断标签：违规/内容/喜爱度等，取 tagId → {title, tag}。 */
function normalizeDiagnose(diagnose) {
  const out = {};
  const overview = diagnose && diagnose.overview;
  if (Array.isArray(overview)) {
    for (const item of overview) {
      if (!item || !item.tagId) continue;
      out[item.tagId] = {
        title: String(item.title || ''),
        tag: String(item.tag || ''),
        status: num(item.tagStatus),
      };
    }
  }
  const detail = diagnose && diagnose.detail;
  if (detail && typeof detail === 'object') {
    for (const key of Object.keys(detail)) {
      const entry = detail[key] || {};
      if (typeof entry.diagnoseResult === 'string' && entry.diagnoseResult.trim()) {
        if (!out[key]) out[key] = { title: key, tag: '', status: num(entry.status) };
        out[key].result = entry.diagnoseResult.trim();
      }
    }
  }
  return out;
}

/** 内容诊断里的分项评分（画面清晰度 / 标题质量…），连同平台给的参考作品一起留下。 */
function normalizeContentScores(diagnose) {
  const detail = diagnose && diagnose.detail;
  const content = (detail && detail.content) || (diagnose && diagnose.content);
  if (!content || !Array.isArray(content.diagnoseList)) return [];
  return content.diagnoseList
    .filter((item) => item && typeof item.score === 'number')
    .map((item) => ({
      title: String(item.title || ''),
      score: num(item.score),
      desc: String(item.diagnoseDesc || ''),
      // 平台在「诊断助手」下面给的优秀作品参考，标题写法是整改方向的最直接依据。
      reference: (Array.isArray(item.recommendPhotoList) ? item.recommendPhotoList : []).slice(0, 3).map((ref) => ({
        photoId: String(ref.photoId || ''),
        title: String(ref.title || ''),
        cover: String(ref.cover || ''),
        userName: String(ref.userName || ''),
        viewCount: num(ref.viewCount),
        likeCount: num(ref.likeCount),
        official: Boolean(ref.officialCourse),
      })),
    }));
}

/* ------------------------------------------------------------------ */
/* 健康基准：低于/高于这些线就提示，红黄绿三档                           */
/* ------------------------------------------------------------------ */

const BENCHMARKS = {
  twoSecExit: { label: '2 秒跳出率', good: 0.4, warn: 0.55, lowerIsBetter: true, unit: 'percent' },
  fiveSecRate: { label: '5 秒完播率', good: 0.5, warn: 0.3, lowerIsBetter: false, unit: 'percent' },
  completeRate: { label: '完播率', good: 0.25, warn: 0.15, lowerIsBetter: false, unit: 'percent' },
  engagement: { label: '互动率', good: 0.03, warn: 0.01, lowerIsBetter: false, unit: 'percent' },
  followRate: { label: '涨粉率', good: 0.01, warn: 0.003, lowerIsBetter: false, unit: 'percent' },
  playVsMedian: { label: '播放 / 账号中位', good: 1, warn: 0.5, lowerIsBetter: false, unit: 'ratio' },
};

const FIXES = {
  twoSecExit: '把最抓人的画面或结论提到第 0.5 秒；删掉 1–2 秒的空镜、片头字幕和缓慢推镜。',
  fiveSecRate: '前 5 秒交代清楚「谁 + 遇到什么 + 结果如何」，别把钩子留到结尾。',
  completeRate: '总时长压到 15–25 秒，中间重复的镜头直接剪掉，结尾不要拖。',
  engagement: '结尾抛一个只有看过才答得出的问题；文案里点一个具体的人或场景，方便接话。',
  followRate: '结尾加一句「关注我，下一条讲…」；同类作品做成系列，置顶一条。',
  playVsMedian: '这条不建议再投流量，改开头和标题后重发一次。',
};

/**
 * 图片轮播（图片 + BGM）没有「口播开头」，能控的是首图、图片顺序、每张停留和 BGM，
 * 所以按图片作品的逻辑给改法，而不是视频那套。
 */
const ATLAS_FIXES = {
  twoSecExit: '首图就是封面：把最有冲击力、信息最满的那张放第一张，别用纯文字卡或留白图开场；后面按情绪递进排。',
  fiveSecRate: '前 2–3 张就要让人知道「这是拍什么、值不值得看完」；每张停留 1.5–2 秒，别把重点压到第 4 张以后。',
  completeRate: '图片压到 5–7 张、删掉重复构图；最后一张给情绪落点，人才愿意滑到底。',
  engagement: '最后一张放一句提问（「你会选哪张？」），标题里点一个具体场景，评论区才有话接。',
  followRate: '最后一张放关注引导（「下期拍同款」），同类图片做成系列并置顶一条。',
  playVsMedian: '这条不建议再投流量，换首图和标题后重发一次。',
};

function fixFor(key, work) {
  const table = work && work.format === 'atlas' ? ATLAS_FIXES : FIXES;
  return table[key] || FIXES[key] || '';
}

/** 单条作品的指标体检：每个指标都带基准、状态和具体改法。 */
function evaluateChecks(work, context) {
  const checks = [];
  const push = (key, value, extra = {}) => {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return;
    const bench = BENCHMARKS[key];
    if (!bench) return;
    const v = Number(value);
    let status;
    if (bench.lowerIsBetter) {
      status = v <= bench.good ? 'good' : v <= bench.warn ? 'warn' : 'bad';
    } else {
      status = v >= bench.good ? 'good' : v >= bench.warn ? 'warn' : 'bad';
    }
    checks.push({
      key,
      label: bench.label,
      value: v,
      benchmark: bench.lowerIsBetter ? bench.good : bench.good,
      benchmarkText: bench.unit === 'percent' ? `${Math.round(bench.good * 100)}%` : `${bench.good}x`,
      lowerIsBetter: bench.lowerIsBetter,
      unit: bench.unit,
      status,
      fix: fixFor(key, work),
      ...extra,
    });
  };

  push('twoSecExit', work.twoSecExit);
  push('fiveSecRate', work.fiveSecRate);
  push('completeRate', work.completeRate);
  push('engagement', work.engagement);
  push('followRate', work.play > 0 ? work.follow / work.play : null);
  if (context.medianPlay > 0) push('playVsMedian', work.play / context.medianPlay);

  // 平台自己的内容评分也当体检项（标题质量 32 分这种）。
  for (const score of work.contentScores || []) {
    checks.push({
      key: `official:${score.title}`,
      label: score.title.replace('评估', ''),
      value: score.score / 100,
      display: `${score.score}`,
      benchmarkText: '60 分',
      lowerIsBetter: false,
      unit: 'score',
      status: score.score >= 75 ? 'good' : score.score >= 60 ? 'warn' : 'bad',
      fix: score.title.includes('标题')
        ? '标题写清「对象 + 事件 + 结果」，前 12 个字就把冲突摆出来，别只写情绪。'
        : score.desc || '',
      official: true,
    });
  }

  return checks;
}

function worstCheck(checks) {
  const order = { bad: 0, warn: 1, good: 2 };
  return [...checks]
    .filter((check) => check.status !== 'good')
    .sort((a, b) => order[a.status] - order[b.status])[0] || null;
}

/** 观看分析：留存曲线 + 平台给的跳出点提示；影集/图片作品常常拿不到。 */
function buildWatch(trending) {
  const list = trending && trending.trendData;
  const item = Array.isArray(list) && list.length ? list[0] : null;
  const retention = normalizeRetention(trending);
  return {
    retention,
    supported: retention.length >= 2,
    note: item && item.interpretDesc ? String(item.interpretDesc) : '',
    limited: Boolean(trending && (trending.likeCntTooLess || trending.playCntTooLess)),
  };
}

/** 喜爱度诊断：快手按账号阶段给「喜爱分」，新号常常是未开放状态。 */
function buildFavor(diagnoseData) {
  const detail = diagnoseData && diagnoseData.detail;
  const raw = detail && detail.favorV2;
  const overview = diagnoseData && diagnoseData.overview;
  const tagEntry = Array.isArray(overview)
    ? overview.find((item) => item && (item.tagId === 'favorV2' || item.tagId === 'pcFavorV2'))
    : null;
  const total = raw ? num(raw.totalFavorCount) : 0;
  return {
    available: Boolean(raw) && total > 0,
    total,
    degrade: raw ? num(raw.degrade) : 0,
    tag: tagEntry ? String(tagEntry.tag || '') : '',
    desc: (raw && raw.barJump && raw.barJump.desc) || '',
    items: raw && Array.isArray(raw.diagnoseList)
      ? raw.diagnoseList.map((item) => ({
        title: String((item && item.title) || ''),
        desc: String((item && item.diagnoseDesc) || ''),
        score: item && typeof item.score === 'number' ? num(item.score) : null,
      }))
      : [],
  };
}

/** 诊断标签：违规 / 内容 / 喜爱度 / 助推，后台给的是短标签。 */
function normalizeTags(diagnose) {
  const overview = diagnose && diagnose.overview;
  if (!Array.isArray(overview)) return [];
  return overview
    .filter((item) => item && item.tagId)
    .map((item) => ({ id: String(item.tagId), title: String(item.title || ''), tag: String(item.tag || '') }));
}

/** 按播放量加权的留存指标：各条作品播放量差很多，直接平均会被小样本带偏。 */
function weightedByPlay(works, pick) {
  let sum = 0;
  let weight = 0;
  for (const work of works) {
    const value = pick(work);
    if (value === null || value === undefined || !Number.isFinite(value)) continue;
    sum += value * Math.max(1, work.play);
    weight += Math.max(1, work.play);
  }
  return weight ? sum / weight : null;
}

/**
 * 账号级漏斗：100 个播放 → 撑过 2 秒 → 到 5 秒 → 看完 → 互动 → 涨粉。
 * 哪一段掉得最狠，就是这条账号现在最该修的地方。
 */
function buildFunnel(works, totals) {
  const totalPlay = totals.play || 0;
  if (!totalPlay) return null;
  const twoSec = weightedByPlay(works, (work) => (work.twoSecExit === null ? null : 1 - work.twoSecExit));
  const fiveSec = weightedByPlay(works, (work) => work.fiveSecRate);
  const complete = weightedByPlay(works, (work) => work.completeRate);
  const engagement = totals.engagement || 0;
  const followRate = totalPlay ? totals.follow / totalPlay : 0;

  const stages = [
    { key: 'play', label: '播放', value: 1 },
    { key: 'twoSec', label: '撑过 2 秒', value: twoSec },
    { key: 'fiveSec', label: '到 5 秒', value: fiveSec },
    { key: 'complete', label: '看完', value: complete },
    { key: 'engagement', label: '产生互动', value: engagement },
    { key: 'follow', label: '关注', value: followRate },
  ];

  // 每一段的流失率，用上一段做分母，才看得出「哪一段最漏」。
  const drops = [];
  for (let i = 1; i < stages.length; i += 1) {
    const prev = stages[i - 1].value;
    const cur = stages[i].value;
    if (prev === null || cur === null || !prev) continue;
    const loss = Math.max(0, 1 - cur / prev);
    drops.push({
      from: stages[i - 1].label,
      to: stages[i].label,
      loss,
      // 绝对流失：占全部播放的比例。分母太小的阶段（比如互动 0.1% → 关注 0%）不靠它排序。
      absoluteLoss: loss * prev,
      fromRate: prev,
      toRate: cur,
    });
  }
  const worst = drops.length ? [...drops].sort((a, b) => b.absoluteLoss - a.absoluteLoss)[0] : null;

  return {
    stages: stages.map((stage) => ({ ...stage, value: stage.value === null ? null : Number(stage.value.toFixed(4)) })),
    drops: drops.map((drop) => ({
      ...drop,
      loss: Number(drop.loss.toFixed(4)),
      absoluteLoss: Number(drop.absoluteLoss.toFixed(4)),
    })),
    worst: worst
      ? { ...worst, loss: Number(worst.loss.toFixed(4)), absoluteLoss: Number(worst.absoluteLoss.toFixed(4)) }
      : null,
    play: totalPlay,
  };
}

/** 内容方向关键词：用来判断一个活动「像不像我们能做的」。 */
const CONTENT_KEYWORDS = ['摄影', '拍照', '生活', '情感', '秋天', '晚秋', '秋', '银杏', '叶', '落叶', '树', '影', '氛围', '随拍', '图文', '治愈', '风景', '街拍', '旅行', '记录'];

/** 明显不属于这个账号赛道的关键词：命中就扣分，避免「亲子/萌宠」排到前面。 */
const OFF_TOPIC = ['亲子', '萌宠', '宠物', '美食', '游戏', '影视', '明星', '舞蹈', '音乐', '戏曲', '三农', '汽车'];

/** 从活动规则里抽出「能不能做、要满足什么」的硬条件。 */
function extractRules(ruleText) {
  const text = String(ruleText || '');
  if (!text) return null;
  const points = [];
  const minImages = (text.match(/图片\s*[≥>=]+\s*(\d+)\s*张/) || text.match(/(?:不少于|至少)\s*(\d+)\s*张/) || [])[1];
  if (minImages) points.push(`图集 ≥ ${minImages} 张`);
  if (/3\s*[：:]\s*4/.test(text)) points.push('首图 3:4');
  if (/图集/.test(text)) points.push('必须图集（单图/长图不算）');
  if (/真人出镜/.test(text)) points.push(/挡脸/.test(text) ? '真人出镜不挡脸' : '真人出镜更优');
  if (/首发/.test(text)) points.push('首发有额外奖');
  const thresholds = [...text.matchAll(/播放量?\s*[≥>=]+\s*(\d+)/g)].map((match) => Number(match[1]));
  if (thresholds.length) points.push(`播放 ≥ ${Math.min(...thresholds)} 有奖`);
  if (/元/.test(text)) points.push('有现金奖励');
  return {
    points: [...new Set(points)].slice(0, 6),
    minImages: minImages ? Number(minImages) : null,
    needsAtlas: /图集/.test(text),
    text: text.slice(0, 1200),
  };
}

/**
 * 活动中心：算出每个活动的匹配度、剩余天数，并按「该不该做」排序。
 * 平台每个活动都给了必须带的话题（tagConditionList），那是最直接的执行抓手。
 */
function buildActivities(list, works) {
  const accountTags = [...new Set(works.flatMap((work) => work.tags || []))];
  const now = Date.now();
  const items = (Array.isArray(list) ? list : []).filter(Boolean).map((item) => {
    const topics = item.topics || [];
    const tags = item.tags || [];
    const text = `${item.title} ${item.brief} ${tags.join(' ')} ${topics.join(' ')}`;

    // 和已发作品的话题完全一致，是最强信号（说明这条内容方向已经验证过）。
    const exactTopic = topics.find((topic) => accountTags.includes(topic)) || '';
    const accountHits = accountTags.filter((tag) => tag && text.includes(tag) && tag !== exactTopic);
    const contentHits = CONTENT_KEYWORDS.filter((word) => text.includes(word));
    const offTopic = OFF_TOPIC.filter((word) => tags.join(' ').includes(word) || item.title.includes(word));

    let score = 0;
    if (exactTopic) score += 40;
    score += Math.min(30, accountHits.length * 15);
    score += Math.min(24, contentHits.length * 8);
    if (/摄影|图文/.test(tags.join(' '))) score += 15;
    if (offTopic.length) score -= 25;
    if ((item.rewardType || []).includes(1)) score += 10; // 有现金奖励
    if (item.participated) score += 5; // 已经参加过的，顺手延续
    const endTime = num(item.endTime);
    const daysLeft = endTime > now ? Math.ceil((endTime - now) / DAY) : 0;
    if (daysLeft > 0 && daysLeft <= 3) score += 10; // 快截止，优先做

    return {
      ...item,
      daysLeft,
      endText: endTime ? beijingDate(endTime).text.slice(0, 10) : '',
      matched: [...new Set([...(exactTopic ? [exactTopic] : []), ...accountHits, ...contentHits])].slice(0, 4),
      offTopic,
      rules: extractRules(item.ruleText),
      matchScore: Math.max(0, Math.min(100, score)),
    };
  });
  items.sort((a, b) => b.matchScore - a.matchScore || a.daysLeft - b.daysLeft);
  return items;
}

/** 把采集到的内容诊断分项（标题质量 32 / 画面清晰度 88）排成固定顺序。 */
function orderContentScores(scores) {
  const order = ['画面清晰度评估', '标题质量评估'];
  return [...scores].sort((a, b) => {
    const ai = order.indexOf(a.title);
    const bi = order.indexOf(b.title);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });
}

/** 把 collect.mjs 的输出整理成 UI 直接可用的一份快照。 */
export function buildSnapshot(raw, options = {}) {
  const capturedAt = new Date().toISOString();
  const accountRaw = (raw && raw.account) || {};
  const listRaw = (raw && raw.list) || {};
  const items = Array.isArray(listRaw.items) ? listRaw.items : [];
  const details = (raw && raw.details) || {};

  const works = items.map((item) => {
    const photoId = String(item.photoId || '');
    const detail = details[photoId] || {};
    const overviewData = unwrap(detail.overview);
    const metrics = overviewData && overviewData.trendList;
    const info = unwrap(detail.info);
    const diagnoseData = unwrap(detail.diagnose);
    const complete = findMetric(metrics, 'FPR') || findMetric(metrics, 'COMPLETE_RATIO');
    const avgDuration = findMetric(metrics, 'AVG_PLAY_DURATION');
    const twoSec = findMetric(metrics, 'TWO_SECONDS_EXIT');
    const fiveSec = findMetric(metrics, 'FIVE_SECONDS_FPR');
    const play = num(item.playCount);
    const like = num(item.likeCount);
    const comment = num(item.commentCount);
    const collect = num(item.collectCount);
    const follow = num(item.followCount);
    const engagement = play > 0 ? (like + comment + collect + follow) / play : 0;
    const tags = parseTags(item.title);
    const when = beijingDate(item.publishTime);
    let completeRate = complete ? num(complete.sumCount) : num(item.fpr);
    if (completeRate > 1) completeRate = completeRate / 100; // 有的接口给百分数
    if (!Number.isFinite(completeRate) || completeRate <= 0) completeRate = null;

    return {
      photoId,
      title: String(item.title || ''),
      cover: String(item.cover || ''),
      publishTime: num(item.publishTime),
      publishText: when.text,
      hour: when.hour,
      weekday: when.weekday,
      weekdayLabel: WEEKDAY_LABELS[when.weekday],
      isVideo: Boolean(info ? info.video : item.video),
      format: (info ? info.video : item.video) ? 'video' : 'atlas',
      formatLabel: (info ? info.video : item.video) ? '视频' : '图片轮播',
      play,
      like,
      comment,
      collect,
      follow,
      engagement,
      followRate: play > 0 ? follow / play : 0,
      completeRate,
      fiveSecRate: fiveSec && num(fiveSec.sumCount) > 0 ? num(fiveSec.sumCount) / 100 : null,
      twoSecExit: twoSec && num(twoSec.sumCount) > 0 ? num(twoSec.sumCount) / 100 : null,
      avgPlayDuration: avgDuration ? num(avgDuration.sumCount) : null,
      traffic: normalizeTraffic(unwrap(detail.traffic)),
      trafficFull: normalizeTrafficFull(unwrap(detail.traffic)),
      retention: normalizeRetention(unwrap(detail.trending)),
      watch: buildWatch(unwrap(detail.trending)),
      coreMetrics: normalizeCoreMetrics(metrics),
      favor: buildFavor(diagnoseData),
      diagnoseTags: normalizeTags(diagnoseData),
      diagnose: normalizeDiagnose(diagnoseData),
      contentScores: orderContentScores(normalizeContentScores(diagnoseData)),
      tags,
      bodyLength: bodyLength(item.title),
    };
  });

  works.sort((a, b) => b.publishTime - a.publishTime);

  const plays = works.map((w) => w.play);
  const totalPlay = plays.reduce((sum, n) => sum + n, 0);
  const totalLike = works.reduce((sum, w) => sum + w.like, 0);
  const totalComment = works.reduce((sum, w) => sum + w.comment, 0);
  const totalCollect = works.reduce((sum, w) => sum + w.collect, 0);
  const totalFollow = works.reduce((sum, w) => sum + w.follow, 0);
  const medianPlay = median(plays);

  const sortedPlay = [...plays].sort((a, b) => a - b);
  const percentile = (value, arr) => {
    if (!arr.length) return 0.5;
    if (arr.length === 1) return 0.5;
    let below = 0;
    for (const n of arr) if (n < value) below += 1;
    return below / (arr.length - 1);
  };
  void percentile;

  for (const work of works) {
    const checks = evaluateChecks(work, { medianPlay });
    work.checks = checks;
    work.topCheck = worstCheck(checks);
    work.fixList = checks
      .filter((check) => check.status !== 'good' && check.fix)
      .sort((a, b) => (a.status === 'bad' ? 0 : 1) - (b.status === 'bad' ? 0 : 1))
      .slice(0, 3)
      .map((check) => ({ key: check.key, label: check.label, status: check.status, fix: check.fix }));
    work.vsMedianPlay = medianPlay > 0 ? work.play / medianPlay : 0;
    work.headline = buildHeadline(work);
    work.funnel = {
      twoSec: work.twoSecExit === null ? null : 1 - work.twoSecExit,
      fiveSec: work.fiveSecRate,
      complete: work.completeRate,
      engagement: work.engagement,
      follow: work.followRate,
    };
    work.score = scoreWork(work);
    work.grade = work.score >= 70 ? 'A' : work.score >= 45 ? 'B' : 'C';
  }

  const topics = summarizeTopics(works);
  const schedule = summarizeSchedule(works);
  const series = normalizeSeries(raw && raw.overview);
  const priorityFixes = buildPriorityFixes({ works, series, schedule, topics });
  const advice = priorityFixes.map((item) => ({ level: item.level, title: item.title, detail: item.detail, evidence: item.evidence }));
  const formatSummary = {
    atlas: works.filter((work) => work.format === 'atlas').length,
    video: works.filter((work) => work.format === 'video').length,
  };
  const totals = {
    works: works.length,
    play: totalPlay,
    like: totalLike,
    comment: totalComment,
    collect: totalCollect,
    follow: totalFollow,
    engagement: totalPlay > 0 ? (totalLike + totalComment + totalCollect + totalFollow) / totalPlay : 0,
    medianPlay,
  };
  const funnel = buildFunnel(works, totals);
  const activities = buildActivities(raw && raw.activities, works);
  const tasks = Array.isArray(raw && raw.tasks) ? raw.tasks : [];
  const now = Date.now();

  // 目标只有两个：曝光、涨粉。这里给出这两个目标的现状，后面的建议都挂到目标上。
  const playLine = series.lines.find((line) => line.tab === 'PLAY');
  const recent = playLine ? playLine.data.slice(-7) : [];
  const goals = {
    exposure: {
      totalPlay,
      recent7: recent.reduce((sum, n) => sum + n, 0),
      lastDaily: recent.length ? recent[recent.length - 1] : 0,
      peakDaily: recent.length ? Math.max(...recent) : 0,
    },
    fans: {
      total: num(accountRaw.fans),
      newFans: totalFollow,
    },
  };
  const activitySummary = {
    total: activities.length,
    joined: activities.filter((item) => item.participated).length,
    endingSoon: activities.filter((item) => item.daysLeft > 0 && item.daysLeft <= 3).length,
    recommended: activities.filter((item) => item.matchScore >= 50).length,
    fetchedAt: new Date(now).toISOString(),
  };

  return {
    schemaVersion: 2,
    capturedAt,
    account: {
      userId: String(accountRaw.userId || ''),
      userIdStr: String(accountRaw.userIdStr || ''),
      name: String(accountRaw.name || ''),
      avatar: String(accountRaw.avatar || ''),
      fans: num(accountRaw.fans),
    },
    totals,
    funnel,
    goals,
    activities,
    tasks,
    activitySummary,
    works,
    series,
    schedule,
    topics,
    priorityFixes,
    advice,
    formatSummary,
    limits: {
      detailWorks: Object.keys(details).length,
      listTotal: num(listRaw.total),
      sampleSmall: works.length < 5,
    },
    note: options.note || '',
  };
}

/** 综合分：按健康基准的连续比值加权，而不是账号内互比，避免「都不及格时比烂」。 */
const SCORE_WEIGHTS = {
  twoSecExit: 0.25,
  fiveSecRate: 0.15,
  completeRate: 0.05,
  engagement: 0.15,
  followRate: 0.1,
  playVsMedian: 0.25,
};
const OFFICIAL_WEIGHT = 0.05;

function ratioOf(check) {
  if (!check || !Number.isFinite(check.value)) return null;
  if (check.unit === 'score') return clamp(check.value / 0.6, 0, 1);
  const bench = BENCHMARKS[check.key];
  if (!bench) return null;
  if (bench.lowerIsBetter) return clamp(bench.good / Math.max(check.value, 0.0001), 0, 1);
  return clamp(check.value / bench.good, 0, 1);
}

function scoreWork(work) {
  let sum = 0;
  let weight = 0;
  for (const check of work.checks || []) {
    const w = check.official ? OFFICIAL_WEIGHT : (SCORE_WEIGHTS[check.key] || 0);
    if (!w) continue;
    const ratio = ratioOf(check);
    if (ratio === null) continue;
    sum += ratio * w;
    weight += w;
  }
  return weight ? Math.round(clamp((sum / weight) * 100, 0, 100)) : 0;
}

/** 一句话说清这条作品最大的问题，带数字。 */
function buildHeadline(work) {
  const check = work.topCheck;
  if (!check) return { level: 'good', text: '各项指标都在健康线以上，可以复用这条的结构。' };
  const valueText = check.unit === 'percent'
    ? `${(check.value * 100).toFixed(check.value < 0.1 ? 1 : 0)}%`
    : `${check.value.toFixed(2)}x`;
  if (check.key === 'playVsMedian') {
    return { level: check.status, text: `播放只有账号中位数的 ${Math.round(check.value * 100)}%（基准 100%）` };
  }
  const dir = check.lowerIsBetter ? '高于健康线' : '低于健康线';
  return {
    level: check.status,
    text: `${check.label} ${valueText}，${dir} ${check.benchmarkText}`,
  };
}

/** 话题聚合：每个标签的出现次数与平均表现。 */
function summarizeTopics(works) {
  const map = new Map();
  for (const work of works) {
    for (const tag of work.tags) {
      if (!map.has(tag)) map.set(tag, { tag, count: 0, play: 0, like: 0, follow: 0, works: [] });
      const entry = map.get(tag);
      entry.count += 1;
      entry.play += work.play;
      entry.like += work.like;
      entry.follow += work.follow;
      entry.works.push(work.photoId);
    }
  }
  return [...map.values()]
    .map((entry) => ({
      tag: entry.tag,
      count: entry.count,
      avgPlay: Math.round(entry.play / entry.count),
      avgLike: Number((entry.like / entry.count).toFixed(1)),
      avgFollow: Number((entry.follow / entry.count).toFixed(2)),
    }))
    .sort((a, b) => b.avgPlay - a.avgPlay);
}

/** 发布时段/星期聚合，并给出「最好的一组」。 */
function summarizeSchedule(works) {
  const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0, play: 0 }));
  const byWeekday = Array.from({ length: 7 }, (_, weekday) => ({ weekday, label: WEEKDAY_LABELS[weekday], count: 0, play: 0 }));
  for (const work of works) {
    byHour[work.hour].count += 1;
    byHour[work.hour].play += work.play;
    byWeekday[work.weekday].count += 1;
    byWeekday[work.weekday].play += work.play;
  }
  const slots = byHour.map((slot) => ({ ...slot, avgPlay: slot.count ? Math.round(slot.play / slot.count) : 0 }));
  const bestHour = slots.filter((slot) => slot.count > 0).sort((a, b) => b.avgPlay - a.avgPlay)[0] || null;
  const weekdays = byWeekday.map((slot) => ({ ...slot, avgPlay: slot.count ? Math.round(slot.play / slot.count) : 0 }));
  const bestWeekday = weekdays.filter((slot) => slot.count > 0).sort((a, b) => b.avgPlay - a.avgPlay)[0] || null;

  let gapDays = null;
  const times = works.map((work) => work.publishTime).sort((a, b) => a - b);
  if (times.length >= 2) gapDays = (times[times.length - 1] - times[0]) / DAY / (times.length - 1);

  return {
    byHour: slots,
    byWeekday: weekdays,
    bestHour,
    bestWeekday,
    gapDays: gapDays === null ? null : Number(gapDays.toFixed(1)),
  };
}

/** 账号趋势：接口里的 trendData 有的是 '20261106'，有的是毫秒时间戳。 */
function normalizeSeries(overview) {
  const rawBasic = overview && overview.basicData;
  if (!Array.isArray(rawBasic) || !rawBasic.length) return { dates: [], lines: [] };
  const basic = rawBasic.filter(Boolean);
  if (!basic.length) return { dates: [], lines: [] };
  const toKey = (value) => {
    if (typeof value === 'string' && /^\d{8}$/.test(value)) return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
    const ms = num(value);
    if (!ms) return '';
    return beijingDate(ms).text.slice(0, 10);
  };
  const first = basic[0];
  const dates = (Array.isArray(first.trendData) ? first.trendData : [])
    .filter(Boolean)
    .map((point) => toKey(point.date))
    .filter(Boolean);
  const lines = basic.map((metric) => ({
    name: String(metric.name || ''),
    tab: String(metric.tab || ''),
    total: num(metric.sumCount),
    data: (Array.isArray(metric.trendData) ? metric.trendData : []).filter(Boolean).map((point) => num(point.count)),
  }));
  return { dates, lines, updatedAt: overview && overview.dataUpdateTime ? String(overview.dataUpdateTime) : '' };
}

/**
 * 账号级「先修哪几件事」：把同一种失败聚合成一条，附上具体数字和涉及的作品。
 * 这是面板最上面那块，也是给 Agent 看的摘要。
 */
const GOAL_BY_METRIC = {
  twoSecExit: '曝光',
  fiveSecRate: '曝光',
  completeRate: '曝光',
  playVsMedian: '曝光',
  engagement: '曝光·涨粉',
  followRate: '涨粉',
};

function buildPriorityFixes({ works, series, schedule, topics }) {
  const fixes = [];
  if (!works.length) {
    return [{
      level: 'high',
      title: '先发第一条作品',
      detail: '没有采集到公开作品，先发一条再回来看数据。',
      evidence: '',
      metric: '',
    }];
  }

  const groupBy = (key) => {
    const map = new Map();
    for (const work of works) {
      for (const check of work.checks || []) {
        if (check.key !== key || check.status === 'good') continue;
        if (!map.has(key)) map.set(key, { check, works: [] });
        map.get(key).works.push(work);
      }
    }
    return map.get(key) || null;
  };

  const ranked = ['twoSecExit', 'fiveSecRate', 'completeRate', 'engagement', 'followRate', 'playVsMedian']
    .map((key, index) => {
      const group = groupBy(key);
      return group ? { ...group, index } : null;
    })
    .filter(Boolean)
    .map((group) => ({
      ...group,
      // 没到健康线就算「没过线」，warn 也计入，否则一个黄两个红会被排到后面。
      badCount: group.works.filter((w) => (w.checks || []).some((c) => c.key === group.check.key && c.status !== 'good')).length,
    }))
    // 同时没过线的，按「先改哪个更有效」的固定顺序排：内容留存类在前，结果类在后。
    .sort((a, b) => b.badCount - a.badCount || a.index - b.index);

  for (const group of ranked.slice(0, 3)) {
    const { check } = group;
    const numbers = group.works
      .map((work) => (work.checks || []).find((item) => item.key === check.key))
      .filter(Boolean)
      .map((item) => item.value)
      .sort((a, b) => a - b);
    const fmt = (value) => (check.unit === 'percent'
      ? `${(value * 100).toFixed(Math.abs(value * 100) < 10 ? 1 : 0)}%`
      : `${value.toFixed(2)}x`);
    const spread = numbers.length > 1 ? `${fmt(numbers[0])}–${fmt(numbers[numbers.length - 1])}` : fmt(numbers[0]);
    const hasBad = group.works.some((work) => (work.checks || []).some((item) => item.key === check.key && item.status === 'bad'));
    fixes.push({
      level: hasBad ? 'high' : 'mid',
      title: `${group.works.length} 条作品的「${check.label}」没过线`,
      detail: check.fix,
      evidence: `${spread}（基准 ${check.benchmarkText}）· ${group.works.length} 条作品`,
      metric: check.label,
      goal: (GOAL_BY_METRIC[check.key] || '曝光'),
      workIds: group.works.map((work) => work.photoId),
    });
  }

  const titleCheck = works
    .flatMap((work) => (work.checks || []).filter((check) => check.key === 'official:标题质量评估'))
    .filter((check) => check.status !== 'good');
  if (titleCheck.length) {
    const worst = titleCheck.sort((a, b) => a.value - b.value)[0];
    fixes.push({
      level: 'high',
      title: '平台给标题只打了 ' + Math.round(worst.value * 100) + ' 分',
      detail: '标题只写了情绪，没写「发生了什么」。改成「对象 + 事件 + 结果」，前 12 个字给冲突。',
      evidence: `${titleCheck.length} 条作品的标题评分低于 60`,
      metric: '标题质量',
      goal: '曝光',
    });
  }

  const noFollow = works.filter((work) => work.play >= 100 && work.follow === 0);
  if (noFollow.length && !ranked.some((group) => group.check.key === 'followRate')) {
    fixes.push({
      level: 'mid',
      title: `${noFollow.length} 条作品有播放但零涨粉`,
      detail: '结尾缺一句「关注我，下一条讲…」，也没有系列感；同类作品做成合集，置顶一条。',
      evidence: `总播放 ${works.reduce((sum, w) => sum + w.play, 0)}，总涨粉 0`,
      metric: '涨粉',
      goal: '涨粉',
    });
  }

  if (schedule.gapDays !== null && schedule.gapDays > 3) {
    fixes.push({
      level: 'high',
      title: `平均 ${schedule.gapDays} 天才发一条`,
      detail: '新号阶段建议 1–2 天一条，先把「稳定更新」的信号打出来，再谈单条质量。',
      evidence: `${works.length} 条作品的平均发布间隔`,
      metric: '更新频率',
      goal: '曝光',
    });
  } else if (schedule.bestHour && works.length >= 3) {
    fixes.push({
      level: 'low',
      title: `目前 ${String(schedule.bestHour.hour).padStart(2, '0')}:00 发布的数据最好`,
      detail: `这个时段平均播放 ${schedule.bestHour.avgPlay}。样本还小，先按这个时段发两周再校正。`,
      evidence: `${schedule.bestHour.count} 条作品 · 平均播放 ${schedule.bestHour.avgPlay}`,
      metric: '发布时段',
      goal: '曝光',
    });
  }

  const playLine = series.lines.find((line) => line.tab === 'PLAY');
  if (playLine && playLine.data.length >= 2) {
    const last = playLine.data[playLine.data.length - 1];
    const prev = playLine.data[playLine.data.length - 2];
    if (last > prev * 1.5 && last > 0) {
      fixes.push({
        level: 'low',
        title: '今天这波流量在涨',
        detail: `最近一天播放 ${last}，比前一天 ${prev} 明显抬头。趁热度补一条同题材作品，接住这波推荐。`,
        evidence: `${prev} → ${last}`,
        metric: '播放趋势',
        goal: '曝光',
      });
    }
  }

  if (works.length < 5) {
    fixes.push({
      level: 'low',
      title: '样本还小，以上先当假设',
      detail: `目前只有 ${works.length} 条公开作品，规律可能是巧合。发到 8–10 条后，这份体检才真正有参考价值。`,
      evidence: `${works.length} 条作品`,
      metric: '样本量',
      goal: '',
    });
  }

  const atlasCount = works.filter((work) => work.format === 'atlas').length;
  if (atlasCount === works.length && works.length >= 2) {
    fixes.push({
      level: 'mid',
      title: '现在发的是图片轮播（图片 + BGM），不是带文字的图文',
      detail: '这类作品没有口播开头，留存全靠首图和图片节奏：首图放最抓人的一张，控制在 5–7 张，每张停留 1.5–2 秒，BGM 用有卡点、前 3 秒就有变化的热门曲子。',
      evidence: `${atlasCount} 条图片作品`,
      metric: '作品形态',
      goal: '曝光',
    });
  }

  void topics;
  return fixes.slice(0, 8);
}
