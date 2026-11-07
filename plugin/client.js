/**
 * 快手作品分析 —— Client 半区。
 *
 * 在左侧栏注册一个入口（sidebar.panellist），点开后是 main 面板
 * `kuaishou-analysis`：先给「最该先修的几件事」，再逐条作品做体检
 * （指标 vs 健康基准 + 具体改法），最后是趋势、时段、话题。
 * 数据来自 Host 的 /kuaishou/api/data，同步按钮走 /kuaishou/api/sync。
 */
window.__ModuleLoader__.load({
  id: '@local/kuaishou-analysis',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useCallback, useEffect, useRef, useState } = React;

    const NS = 'kuaishou-analysis';
    const PANEL_ID = 'kuaishou-analysis';

    const ZH = {
      panel: '快手作品分析',
      panelHint: '哪条不行 · 差多少 · 怎么改',
      sync: '同步数据',
      syncing: '同步中…',
      emptyTitle: '还没有采集过数据',
      emptyBody: '点右上角「同步数据」，会弹出一个浏览器窗口。第一次需要在里面扫码登录快手创作者服务平台，之后同步会复用这次登录。',
      emptyStep1: '打开创作者平台并保持登录',
      emptyStep2: '采集作品列表与每条作品的详情数据',
      emptyStep3: '按健康基准逐条体检，给出改法',
      loading: '正在读取…',
      syncRunning: '正在采集，浏览器窗口里别关页面…',
      fans: '粉丝',
      works: '公开作品',
      capturedAt: '数据时间',
      totalPlay: '总播放',
      totalLike: '总点赞',
      totalFollow: '总涨粉',
      engagement: '互动率',
      overview: '账号概览',
      trend: '近 30 天趋势',
      priority: '最该先修的几件事',
      priorityHint: '按「没过线的作品数」排序，点进去看具体哪条',
      worksSection: '作品体检',
      worksHint: '每条作品的关键指标 vs 健康基准，红=没过线，黄=刚够，绿=健康',
      noWorks: '还没有采集到公开作品',
      schedule: '发布节奏',
      scheduleHint: '按发布时段与星期统计；样本少时只当参考',
      bestHour: '最好时段',
      bestWeekday: '最好星期',
      gap: '平均间隔',
      days: '天',
      topics: '选题与标签',
      topicsHint: '按话题标签聚合，看哪类题材更容易起量',
      topic: '话题',
      topicCount: '作品数',
      topicPlay: '平均播放',
      topicLike: '平均点赞',
      noTopics: '作品里还没有话题标签',
      moreAdvice: '其他提示',
      play: '播放',
      like: '点赞',
      comment: '评论',
      follow: '涨粉',
      baseline: '基准',
      lowerBetter: '越低越好',
      coreIssue: '核心问题',
      howToFix: '怎么改',
      officialScore: '平台评分',
      formatPrefix: '作品形态',
      todayTraffic: '今日流量',
      score: '综合分',
      noIssue: '各项都在健康线以上，可以复用这条的结构',
      smallSample: '样本还小，结论先当假设',
      syncFailed: '同步失败',
      detailWorks: '已抓详情',
      of: '/',
      retry: '重试',
    };

    const EN = {
      panel: 'Kuaishou works analysis',
      panelHint: 'What is wrong, by how much, and how to fix it',
      sync: 'Sync data',
      syncing: 'Syncing…',
      emptyTitle: 'No data collected yet',
      emptyBody: 'Press "Sync data". A browser window opens; sign in once and later syncs reuse the session.',
      emptyStep1: 'Open the creator platform and stay signed in',
      emptyStep2: 'Collect the work list and each work detail',
      emptyStep3: 'Check every work against health baselines and give fixes',
      loading: 'Loading…',
      syncRunning: 'Collecting, keep the browser window open…',
      fans: 'Followers',
      works: 'Public works',
      capturedAt: 'Captured',
      totalPlay: 'Plays',
      totalLike: 'Likes',
      totalFollow: 'New followers',
      engagement: 'Engagement',
      overview: 'Account overview',
      trend: 'Last 30 days',
      priority: 'Fix these first',
      priorityHint: 'Ranked by how many works fail the baseline',
      worksSection: 'Work checkup',
      worksHint: 'Key metrics vs health baselines — red fails, amber borderline, green healthy',
      noWorks: 'No public works collected',
      schedule: 'Publishing rhythm',
      scheduleHint: 'Grouped by publish hour and weekday',
      bestHour: 'Best hour',
      bestWeekday: 'Best weekday',
      gap: 'Average gap',
      days: 'days',
      topics: 'Topics and tags',
      topicsHint: 'Grouped by hashtag',
      topic: 'Topic',
      topicCount: 'Works',
      topicPlay: 'Avg plays',
      topicLike: 'Avg likes',
      noTopics: 'No hashtags in the collected works',
      moreAdvice: 'Other notes',
      play: 'Plays',
      like: 'Likes',
      comment: 'Comments',
      follow: 'Follows',
      baseline: 'Baseline',
      lowerBetter: 'lower is better',
      coreIssue: 'Core issue',
      howToFix: 'How to fix',
      officialScore: 'Platform score',
      formatPrefix: 'Format',
      todayTraffic: "Today's traffic",
      score: 'Score',
      noIssue: 'All metrics above baseline — reuse this structure',
      smallSample: 'Small sample — treat as a hypothesis',
      syncFailed: 'Sync failed',
      detailWorks: 'Details',
      of: '/',
      retry: 'Retry',
    };

    /* ---------- 格式化 ---------- */

    function formatCount(value) {
      const n = Number(value) || 0;
      if (n >= 100000000) return `${(n / 100000000).toFixed(1)}亿`;
      if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
      return String(Math.round(n));
    }

    function formatPercent(value, digits) {
      if (value === null || value === undefined || !Number.isFinite(Number(value))) return '--';
      const n = Number(value) * 100;
      const d = digits === undefined ? (Math.abs(n) < 10 ? 1 : 0) : digits;
      return `${n.toFixed(d)}%`;
    }

    /** 体检项的数值：百分比带小数，倍数用 x，平台评分直接显示整数分。 */
    function checkValueText(check) {
      if (check.unit === 'score') return String(Math.round(check.value * 100));
      if (check.unit === 'percent') return formatPercent(check.value);
      return `${check.value.toFixed(2)}x`;
    }

    /** 作品形态一行：图片轮播 / 视频各多少条，以及图片类该看什么。 */
    function buildFormatLine(summary, t) {
      if (!summary) return '';
      const parts = [];
      if (summary.atlas) parts.push(`${summary.atlas} 条图片轮播（图片 + BGM）`);
      if (summary.video) parts.push(`${summary.video} 条视频`);
      if (!parts.length) return '';
      const tail = summary.atlas && !summary.video
        ? '。图片类没有口播开头，留存看首图、图片顺序和每张停留时间。'
        : '';
      return `${t('formatPrefix')}：${parts.join(' · ')}${tail}`;
    }

    function shortTitle(title, max = 40) {      const text = String(title || '').replace(/#[^\s#]+/g, '').replace(/\s+/g, ' ').trim();
      if (!text) return '无标题';
      return text.length > max ? `${text.slice(0, max)}…` : text;
    }

    function token(name) {
      return `var(${name})`;
    }

    const C = {
      bg: token('--dsw-alias-bg-base'),
      card: token('--dsw-alias-bg-layer-1'),
      card2: token('--dsw-alias-bg-layer-2'),
      border: token('--dsw-alias-border-l1'),
      border2: token('--dsw-alias-border-l2'),
      text: token('--dsw-alias-label-primary'),
      sub: token('--dsw-alias-label-secondary'),
      brand: token('--dsw-alias-brand-primary'),
      ok: token('--dsw-alias-state-success-primary'),
      warn: token('--dsw-alias-state-warn-primary'),
      err: token('--dsw-alias-state-error-primary'),
      idle: token('--dsw-alias-state-idle-primary'),
    };

    const STATUS_COLOR = { bad: C.err, warn: C.warn, good: C.ok, na: C.idle };
    const statusColor = (status) => STATUS_COLOR[status] || C.idle;

    /**
     * 给主题色叠透明度。主题变量是 var(...)，不能直接拼 "44" 这样的 alpha 后缀，
     * 用 color-mix 让浅底 / 描边也能跟随浅色深色主题。
     */
    function tint(color, percent) {
      return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
    }

    const S = {
      root: { height: '100%', overflowY: 'auto', background: C.bg, color: C.text, font: 'inherit' },
      inner: { maxWidth: 1120, margin: '0 auto', padding: '20px 24px 48px', display: 'flex', flexDirection: 'column', gap: 18 },
      toolbar: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 },
      title: { fontSize: 18, fontWeight: 600, lineHeight: '26px' },
      subtitle: { fontSize: 12, color: C.sub, marginTop: 4 },
      buttonPrimary: {
        border: '1px solid transparent',
        background: C.brand,
        color: '#fff',
        borderRadius: 8,
        padding: '6px 14px',
        fontSize: 13,
        cursor: 'pointer',
        lineHeight: '20px',
        fontWeight: 500,
      },
      section: { border: `1px solid ${C.border}`, background: C.card, borderRadius: 12, padding: '14px 16px 16px' },
      sectionHead: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 12 },
      sectionTitle: { fontSize: 14, fontWeight: 600 },
      sectionHint: { fontSize: 12, color: C.sub },
      kpiRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 },
      kpi: { border: `1px solid ${C.border}`, background: C.card2, borderRadius: 10, padding: '8px 10px' },
      kpiLabel: { fontSize: 11, color: C.sub },
      kpiValue: { fontSize: 19, fontWeight: 600, marginTop: 2, fontVariantNumeric: 'tabular-nums' },
      workCard: { border: `1px solid ${C.border}`, background: C.card2, borderRadius: 10, padding: 12, marginTop: 10 },
      workHead: { display: 'grid', gridTemplateColumns: '52px minmax(0, 1fr) auto', gap: 12, alignItems: 'flex-start' },
      cover: { width: 52, height: 70, borderRadius: 6, objectFit: 'cover', background: C.card, display: 'block' },
      workTitle: { fontSize: 13, fontWeight: 500, lineHeight: '20px' },
      workMeta: { fontSize: 11, color: C.sub, marginTop: 3 },
      scoreBadge: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        width: 58,
        height: 58,
        borderRadius: 10,
        border: `1px solid ${C.border2}`,
      },
      scoreNum: { fontSize: 22, fontWeight: 700, lineHeight: '24px', fontVariantNumeric: 'tabular-nums' },
      scoreLabel: { fontSize: 10, color: C.sub },
      issueLine: {
        marginTop: 10,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 10px',
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 500,
        lineHeight: '20px',
      },
      chips: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 },
      chip: {
        minWidth: 92,
        flex: '0 0 auto',
        border: '1px solid',
        borderRadius: 8,
        padding: '6px 9px',
        background: C.card,
      },
      chipLabel: { fontSize: 10, color: C.sub, whiteSpace: 'nowrap' },
      chipValue: { fontSize: 17, fontWeight: 700, lineHeight: '22px', fontVariantNumeric: 'tabular-nums' },
      chipBase: { fontSize: 10, color: C.sub },
      fixBox: { marginTop: 10, display: 'flex', flexDirection: 'column', gap: 5 },
      fixTitle: { fontSize: 11, color: C.sub, fontWeight: 600, letterSpacing: '0.02em' },
      fixItem: { fontSize: 12, lineHeight: '19px', color: C.text, display: 'flex', gap: 7 },
      fixDot: { width: 5, height: 5, borderRadius: 3, marginTop: 7, flex: '0 0 auto' },
      priorityCard: {
        display: 'grid',
        gridTemplateColumns: '28px minmax(0, 1fr)',
        gap: 10,
        padding: '10px 12px',
        border: `1px solid ${C.border}`,
        background: C.card2,
        borderRadius: 10,
      },
      blockTitle: { fontSize: 11, fontWeight: 600, color: C.sub, marginBottom: 6, letterSpacing: '0.02em' },
      miniCard: {
        border: `1px solid ${C.border}`,
        background: C.card,
        borderRadius: 8,
        padding: '6px 9px',
      },
      tagChip: {
        fontSize: 11,
        color: C.sub,
        border: `1px solid ${C.border2}`,
        borderRadius: 10,
        padding: '2px 8px',
        whiteSpace: 'nowrap',
      },
      linkButton: {
        border: 'none',
        background: 'transparent',
        color: C.brand,
        fontSize: 12,
        padding: 0,
        cursor: 'pointer',
        textAlign: 'left',
      },
      rank: {
        width: 24,
        height: 24,
        borderRadius: 12,
        background: C.card,
        border: `1px solid ${C.border2}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 12,
        fontWeight: 600,
      },
      adviceTitle: { fontSize: 13, fontWeight: 600 },
      adviceText: { fontSize: 12, color: C.sub, lineHeight: '19px', marginTop: 3 },
      evidence: { fontSize: 12, color: C.sub, marginTop: 5, fontVariantNumeric: 'tabular-nums' },
      muted: { fontSize: 12, color: C.sub },
      table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
      th: { textAlign: 'left', color: C.sub, fontWeight: 500, padding: '6px 8px', borderBottom: `1px solid ${C.border}` },
      td: { padding: '7px 8px', borderBottom: `1px solid ${C.border}` },
      empty: { border: `1px dashed ${C.border2}`, borderRadius: 12, padding: '28px 24px', background: C.card },
      emptyTitle: { fontSize: 15, fontWeight: 600 },
      emptyBody: { fontSize: 13, color: C.sub, lineHeight: '21px', marginTop: 8, maxWidth: 620 },
      step: { fontSize: 12, color: C.sub, marginTop: 6 },
      error: { border: `1px solid ${C.err}`, borderRadius: 10, padding: '10px 12px', fontSize: 12, color: C.err, background: C.card, lineHeight: '19px' },
    };

    /* ---------- 图表 ---------- */

    function TrendChart({ dates, lines }) {
      const width = 640;
      const height = 150;
      const padL = 34;
      const padR = 10;
      const padT = 12;
      const padB = 22;
      if (!dates.length || !lines.length) return h('div', { style: S.muted }, '暂无趋势数据');
      const max = Math.max(1, ...lines.flatMap((line) => line.data));
      const x = (index) => padL + (dates.length <= 1 ? 0 : (index * (width - padL - padR)) / (dates.length - 1));
      const y = (value) => padT + (1 - value / max) * (height - padT - padB);
      const colors = [C.brand, C.ok, C.warn];

      return h('div', null, [
        h('svg', {
          key: 'svg',
          viewBox: `0 0 ${width} ${height}`,
          style: { width: '100%', height: 160, display: 'block' },
          role: 'img',
          'aria-label': '近 30 天趋势',
        }, [
          ...[0, 0.5, 1].map((ratio, index) => h('line', {
            key: `grid${index}`,
            x1: padL,
            x2: width - padR,
            y1: padT + ratio * (height - padT - padB),
            y2: padT + ratio * (height - padT - padB),
            stroke: C.border,
            strokeWidth: 1,
          })),
          h('text', { key: 'max', x: 4, y: padT + 4, fill: C.sub, fontSize: 10 }, formatCount(max)),
          ...lines.map((line, lineIndex) => h('polyline', {
            key: `line${lineIndex}`,
            fill: 'none',
            stroke: colors[lineIndex % colors.length],
            strokeWidth: 2,
            strokeLinejoin: 'round',
            points: line.data.map((value, index) => `${x(index)},${y(value)}`).join(' '),
          })),
          h('text', { key: 'first', x: padL, y: height - 6, fill: C.sub, fontSize: 10 }, dates[0] || ''),
          h('text', {
            key: 'last', x: width - padR, y: height - 6, fill: C.sub, fontSize: 10, textAnchor: 'end',
          }, dates[dates.length - 1] || ''),
        ]),
        h('div', { key: 'legend', style: { display: 'flex', gap: 16, marginTop: 4, flexWrap: 'wrap' } },
          lines.map((line, index) => h('span', { key: line.name, style: { ...S.muted, display: 'inline-flex', alignItems: 'center', gap: 6 } }, [
            h('span', { key: 'sw', style: { width: 8, height: 8, borderRadius: 4, background: colors[index % colors.length] } }),
            `${line.name} ${formatCount(line.total)}`,
          ]))),
      ]);
    }

    function HourBars({ byHour, bestHour }) {
      const width = 640;
      const height = 110;
      const padB = 18;
      const max = Math.max(1, ...byHour.map((slot) => slot.avgPlay));
      const barWidth = (width - 8) / 24 - 3;
      return h('svg', {
        viewBox: `0 0 ${width} ${height}`,
        style: { width: '100%', height: 120, display: 'block' },
        role: 'img',
        'aria-label': '发布时段分布',
      }, [
        ...byHour.map((slot, index) => {
          const barHeight = slot.avgPlay > 0 ? Math.max(2, (slot.avgPlay / max) * (height - padB - 6)) : 0;
          const isBest = bestHour && bestHour.hour === slot.hour;
          return h('rect', {
            key: `bar${index}`,
            x: 4 + index * ((width - 8) / 24),
            y: height - padB - barHeight,
            width: barWidth,
            height: barHeight,
            rx: 2,
            fill: isBest ? C.brand : C.border2,
          });
        }),
        ...[0, 6, 12, 18, 23].map((hour) => h('text', {
          key: `tick${hour}`, x: 4 + hour * ((width - 8) / 24), y: height - 4, fill: C.sub, fontSize: 10,
        }, String(hour).padStart(2, '0'))),
      ]);
    }

    /* ---------- 组件 ---------- */

    function CheckChip({ check }) {
      const color = statusColor(check.status);
      return h('div', { style: { ...S.chip, borderColor: tint(color, 40), background: tint(color, 6) } }, [
        h('div', { key: 'l', style: S.chipLabel }, check.label),
        h('div', { key: 'v', style: { ...S.chipValue, color } }, checkValueText(check)),
        h('div', { key: 'b', style: S.chipBase }, `${check.lowerIsBetter ? '<' : '>'} ${check.benchmarkText}`),
      ]);
    }

    function WorkCard({ work, t }) {
      const headline = work.headline || { level: 'good', text: t('noIssue') };
      const color = statusColor(headline.level);
      const checks = work.checks || [];
      const fixes = (work.fixList || []).slice(0, 3);
      const official = checks.filter((check) => check.official);

      return h('div', { style: S.workCard }, [
        h('div', { key: 'head', style: S.workHead }, [
          work.cover
            ? h('img', { key: 'cover', src: work.cover, style: S.cover, loading: 'lazy', referrerPolicy: 'no-referrer' })
            : h('div', { key: 'cover', style: S.cover }),
          h('div', { key: 'body', style: { minWidth: 0 } }, [
            h('div', { key: 'title', style: S.workTitle }, shortTitle(work.title)),
            h('div', { key: 'meta', style: S.workMeta },
              `${work.publishText} · ${work.formatLabel || (work.isVideo ? '视频' : '图片轮播')} · 播放 ${formatCount(work.play)} · 赞 ${formatCount(work.like)} · 涨粉 ${formatCount(work.follow)}`),
          ]),
          h('div', { key: 'score', style: { ...S.scoreBadge, borderColor: tint(statusColor(work.score >= 70 ? 'good' : work.score >= 45 ? 'warn' : 'bad'), 40) } }, [
            h('div', { key: 'n', style: { ...S.scoreNum, color: statusColor(work.score >= 70 ? 'good' : work.score >= 45 ? 'warn' : 'bad') } }, String(work.score)),
            h('div', { key: 'l', style: S.scoreLabel }, t('score')),
          ]),
        ]),
        h('div', {
          key: 'issue',
          style: { ...S.issueLine, background: tint(color, 8), color, border: `1px solid ${tint(color, 30)}` },
        }, [
          h('span', { key: 'tag', style: { fontSize: 11, opacity: 0.8 } }, t('coreIssue')),
          h('span', { key: 'text' }, headline.text),
        ]),
        h('div', { key: 'chips', style: S.chips }, checks.filter((check) => !check.official).map((check) => h(CheckChip, { key: check.key, check }))),
        work.funnel
          ? h('div', { key: 'funnel-line', style: { ...S.muted, marginTop: 8, fontVariantNumeric: 'tabular-nums' } },
            [
              '这条的漏斗：播放 100%',
              work.funnel.twoSec !== null ? `→ 撑过 2 秒 ${formatPercent(work.funnel.twoSec)}` : null,
              work.funnel.fiveSec !== null ? `→ 到 5 秒 ${formatPercent(work.funnel.fiveSec)}` : null,
              `→ 互动 ${formatPercent(work.funnel.engagement, 2)}`,
              `→ 关注 ${formatPercent(work.funnel.follow, 2)}`,
            ].filter(Boolean).join(' '))
          : null,
        official.length
          ? h('div', { key: 'official', style: { ...S.chips, marginTop: 8 } }, [
            h('span', { key: 'label', style: { ...S.chipBase, alignSelf: 'center' } }, `${t('officialScore')}：`),
            ...official.map((check) => h(CheckChip, { key: check.key, check })),
          ])
          : null,
        fixes.length
          ? h('div', { key: 'fix', style: S.fixBox }, [
            h('div', { key: 'title', style: S.fixTitle }, t('howToFix')),
            ...fixes.map((fix, index) => h('div', { key: `f${index}`, style: S.fixItem }, [
              h('span', { key: 'dot', style: { ...S.fixDot, background: statusColor(fix.status) } }),
              h('span', { key: 'text' }, fix.fix),
            ])),
          ])
          : null,
        h(DetailBlock, { key: 'detail', work, t }),
      ]);
    }

    function PriorityCard({ item, index }) {
      const color = item.level === 'high' ? C.err : item.level === 'mid' ? C.warn : C.sub;
      return h('div', { style: S.priorityCard }, [
        h('div', { key: 'rank', style: { ...S.rank, color, borderColor: tint(color, 35) } }, String(index + 1)),
        h('div', { key: 'body', style: { minWidth: 0 } }, [
          h('div', { key: 'head', style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } }, [
            h('span', { key: 't', style: { ...S.adviceTitle, color } }, item.title),
            item.goal
              ? h('span', {
                key: 'goal',
                style: { ...S.tagChip, fontSize: 10, color: item.goal === '涨粉' ? C.ok : C.brand, borderColor: tint(item.goal === '涨粉' ? C.ok : C.brand, 35) },
              }, item.goal)
              : null,
          ]),
          item.evidence ? h('div', { key: 'e', style: S.evidence }, item.evidence) : null,
          h('div', { key: 'd', style: S.adviceText }, item.detail),
        ]),
      ]);
    }

    function Kpi({ label, value }) {
      return h('div', { style: S.kpi }, [
        h('div', { key: 'l', style: S.kpiLabel }, label),
        h('div', { key: 'v', style: S.kpiValue }, value),
      ]);
    }

    /** 核心数据的显示值：时长按秒，比率按百分数。 */
    function metricText(metric) {
      if (!metric || metric.value === null || metric.value === undefined) return '--';
      if (metric.unit === 'ms') return `${(metric.value / 1000).toFixed(1)}s`;
      if (metric.unit === 'percent') return `${Number(metric.value).toFixed(1)}%`;
      return formatCount(metric.value);
    }

    function RetentionChart({ points }) {
      if (!points || points.length < 2) return null;
      const width = 420;
      const height = 90;
      const maxTime = points[points.length - 1].time || 1;
      const x = (time) => 6 + (time / maxTime) * (width - 12);
      const y = (ratio) => height - 6 - (ratio / 100) * (height - 12);
      return h('svg', {
        viewBox: `0 0 ${width} ${height}`,
        style: { width: '100%', maxWidth: 460, height: 96, display: 'block' },
        role: 'img',
        'aria-label': '留存曲线',
      }, [
        ...[0, 50, 100].map((ratio, index) => h('line', {
          key: `grid${index}`,
          x1: 6,
          x2: width - 6,
          y1: y(ratio),
          y2: y(ratio),
          stroke: C.border,
          strokeWidth: 1,
        })),
        h('polyline', {
          key: 'line',
          fill: 'none',
          stroke: C.brand,
          strokeWidth: 2,
          strokeLinejoin: 'round',
          points: points.map((point) => `${x(point.time)},${y(point.ratio)}`).join(' '),
        }),
        h('text', { key: 't0', x: 6, y: height - 1, fill: C.sub, fontSize: 9 }, '0s'),
        h('text', { key: 't1', x: width - 6, y: height - 1, fill: C.sub, fontSize: 9, textAnchor: 'end' }, `${maxTime}s`),
      ]);
    }

    /** 流量来源：按渠道画横条，今天的口径。 */
    function TrafficBars({ traffic }) {
      const channels = (traffic && traffic.play && traffic.play.channels) || [];
      if (!channels.length) return h('div', { style: S.muted }, '暂无流量来源数据');
      const max = Math.max(1, ...channels.map((item) => item.count));
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 5, marginTop: 2 } },
        channels.map((item) => h('div', {
          key: item.name,
          style: { display: 'grid', gridTemplateColumns: '62px 1fr 46px', gap: 8, alignItems: 'center' },
        }, [
          h('span', { key: 'n', style: { fontSize: 11, color: C.sub } }, item.name),
          h('div', { key: 'track', style: { height: 8, borderRadius: 4, background: C.border, overflow: 'hidden' } }, [
            h('div', {
              key: 'fill',
              style: {
                width: `${(item.count / max) * 100}%`,
                height: '100%',
                borderRadius: 4,
                background: item.count > 0 ? C.brand : 'transparent',
              },
            }),
          ]),
          h('span', {
            key: 'v',
            style: { fontSize: 11, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: item.count > 0 ? C.text : C.sub },
          }, formatCount(item.count)),
        ])));
    }

    /**
     * 留存漏斗：把「播放 → 2 秒 → 5 秒 → 互动 → 关注」串起来，
     * 一眼看出人是从哪一段开始没的。
     */
    function Funnel({ funnel, t }) {
      if (!funnel || !funnel.stages) return null;
      const stages = funnel.stages.filter((stage) => stage.value !== null);
      const worst = funnel.worst;
      return h('div', { style: { marginTop: 14 } }, [
        h('div', { key: 'title', style: { ...S.blockTitle, marginBottom: 8 } }, '留存漏斗（按播放量加权）'),
        h('div', { key: 'rows', style: { display: 'flex', flexDirection: 'column', gap: 6 } },
          funnel.stages.map((stage) => {
            const known = stage.value !== null;
            const pct = known ? stage.value * 100 : null;
            const isWorst = worst && stage.label === worst.to;
            return h('div', {
              key: stage.key,
              style: { display: 'grid', gridTemplateColumns: '84px 1fr 68px', gap: 10, alignItems: 'center' },
            }, [
              h('span', { key: 'l', style: { fontSize: 12, color: isWorst ? C.err : C.sub } }, stage.label),
              h('div', { key: 'track', style: { height: 14, borderRadius: 7, background: C.border, overflow: 'hidden' } }, [
                h('div', {
                  key: 'fill',
                  style: {
                    width: `${known ? Math.max(1, Math.min(100, pct)) : 0}%`,
                    height: '100%',
                    borderRadius: 7,
                    background: isWorst ? C.err : C.brand,
                    opacity: known ? 1 : 0.25,
                  },
                }),
              ]),
              h('span', {
                key: 'v',
                style: {
                  fontSize: 12,
                  textAlign: 'right',
                  fontVariantNumeric: 'tabular-nums',
                  color: isWorst ? C.err : C.text,
                  fontWeight: isWorst ? 600 : 400,
                },
              }, known ? `${pct < 1 ? pct.toFixed(2) : pct.toFixed(1)}%` : '--'),
            ]);
          })),
        worst
          ? h('div', { key: 'worst', style: { ...S.muted, marginTop: 8, color: C.err } },
            `最漏的一段：${worst.from} → ${worst.to}，这一段丢掉了 ${Math.round(worst.absoluteLoss * 100)}% 的播放。`)
          : null,
        h('div', { key: 'tip', style: { ...S.muted, marginTop: 4, opacity: 0.8 } },
          t('funnelTip') || '看完率对图片轮播不可用，平台只给视频算完播。'),
      ]);
    }

    /** 活动中心的一个活动：重点是「要带哪个话题」和「还剩几天」。 */
    function ActivityCard({ item }) {
      const [open, setOpen] = useState(false);
      const urgent = item.daysLeft > 0 && item.daysLeft <= 3;
      const scoreColor = item.matchScore >= 70 ? C.ok : item.matchScore >= 40 ? C.warn : C.err;
      return h('div', { style: S.workCard }, [
        h('div', { key: 'head', style: { display: 'grid', gridTemplateColumns: '52px minmax(0, 1fr) auto', gap: 10, alignItems: 'flex-start' } }, [
          item.cover
            ? h('img', { key: 'c', src: item.cover, style: S.cover, loading: 'lazy', referrerPolicy: 'no-referrer' })
            : h('div', { key: 'c', style: S.cover }),
          h('div', { key: 'b', style: { minWidth: 0 } }, [
            h('div', { key: 't', style: S.workTitle }, item.title),
            h('div', { key: 'm', style: S.workMeta },
              [item.brief, item.participants ? `${formatCount(item.participants)} 人参与` : ''].filter(Boolean).join(' · ')),
            (item.topics || []).length
              ? h('div', { key: 'topics', style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 } },
                item.topics.map((topic) => h('span', {
                  key: topic,
                  style: { ...S.tagChip, color: C.brand, borderColor: tint(C.brand, 35) },
                }, `#${topic}`)))
              : null,
            item.rules && item.rules.points.length
              ? h('div', { key: 'rules', style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 } },
                item.rules.points.map((point) => h('span', { key: point, style: { ...S.tagChip, fontSize: 10 } }, point)))
              : null,
            item.rules && item.rules.text
              ? h('div', { key: 'ruletext' }, [
                h('button', {
                  key: 'btn',
                  type: 'button',
                  style: { ...S.linkButton, marginTop: 6 },
                  onClick: () => setOpen(!open),
                }, open ? '收起规则' : '查看完整规则'),
                open
                  ? h('div', {
                    key: 'body',
                    style: { ...S.muted, whiteSpace: 'pre-wrap', lineHeight: '18px', marginTop: 6, maxHeight: 220, overflowY: 'auto' },
                  }, item.rules.text)
                  : null,
              ])
              : null,
          ]),
          h('div', { key: 'side', style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5 } }, [
            h('span', {
              key: 'score',
              style: { ...S.badge, minWidth: 0, background: tint(scoreColor, 10), color: scoreColor, padding: '0 8px' },
            }, `匹配 ${item.matchScore}`),
            item.participated ? h('span', { key: 'joined', style: S.tagChip }, '已参加') : null,
            item.gain ? h('span', { key: 'gain', style: { fontSize: 11, color: C.sub } }, item.gain) : null,
            item.daysLeft > 0
              ? h('span', {
                key: 'd',
                style: { fontSize: 11, color: urgent ? C.err : C.sub, fontWeight: urgent ? 600 : 400 },
              }, `剩 ${item.daysLeft} 天`)
              : null,
          ]),
        ]),
      ]);
    }

    /** 今日任务：发几条作品、访问成长中心这类，后台给的是「完成 0/2」。 */
    function TaskRow({ task }) {
      return h('div', {
        style: {
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) auto auto',
          gap: 10,
          padding: '7px 0',
          borderTop: `1px solid ${C.border}`,
          alignItems: 'center',
        },
      }, [
        h('span', { key: 't', style: { fontSize: 12 } }, task.title),
        h('span', { key: 'p', style: { fontSize: 11, color: C.sub } }, task.progress || ''),
        h('span', { key: 'r', style: { fontSize: 11, color: C.brand, minWidth: 28, textAlign: 'right' } },
          task.reward ? `+${String(task.reward).replace(/^\+/, '')}` : ''),
      ]);
    }

    function shortTag(title) {
      return String(title || '').replace('诊断', '').replace('评估', '').replace('V2', '');
    }

    /** 标题体检：把「参考标题普遍有的东西」拆成三个能自查的点。 */
    function titleFacts(title) {
      const text = String(title || '');
      const body = text.replace(/#[^\s#]+/g, '').trim();
      const hasNumber = /\d/.test(body);
      const hasQuestion = /[?？]|怎么|为什么|哪/.test(body);
      const signals = [
        hasNumber ? '有数字' : '没数字',
        hasQuestion ? '有疑问/悬念' : '没疑问',
        `${body.length} 字`,
      ];
      return `${body.slice(0, 16)}${body.length > 16 ? '…' : ''}｜${signals.join('，')}`;
    }

    /**
     * 后台「作品数据详情」的四个 tab：核心数据 / 观看分析 / 流量来源 / 喜爱度诊断。
     * 之前只取了播放量，这几块现在都摊开。
     */
    function DetailBlock({ work, t }) {
      const [open, setOpen] = useState(true);
      const core = work.coreMetrics || [];
      const watch = work.watch || { retention: [], supported: false, note: '' };
      const traffic = work.trafficFull || null;
      const favor = work.favor || null;
      const tags = work.diagnoseTags || [];

      return h('div', { style: { marginTop: 10 } }, [
        h('button', {
          key: 'toggle',
          type: 'button',
          style: S.linkButton,
          onClick: () => setOpen(!open),
        }, open ? '收起全部数据' : '展开全部数据（核心数据 / 观看分析 / 流量来源 / 喜爱度）'),
        open ? h('div', { key: 'body', style: { display: 'flex', flexDirection: 'column', gap: 14, marginTop: 10 } }, [
          h('div', { key: 'core' }, [
            h('div', { key: 'h', style: S.blockTitle }, '核心数据'),
            h('div', { key: 'grid', style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(104px, 1fr))', gap: 8 } },
              core.map((metric) => h('div', { key: metric.key, style: S.miniCard }, [
                h('div', { key: 'l', style: S.chipLabel }, metric.label),
                h('div', {
                  key: 'v',
                  style: { ...S.chipValue, color: metric.available ? C.text : C.sub },
                }, metricText(metric)),
              ]))),
            h('div', { key: 'h2', style: { ...S.blockTitle, marginTop: 10 } }, '互动效果'),
            h('div', { key: 'grid2', style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(104px, 1fr))', gap: 8 } },
              [
                ['点赞', work.like],
                ['评论', work.comment],
                ['收藏', work.collect],
                ['涨粉', work.follow],
              ].map(([label, value]) => h('div', { key: label, style: S.miniCard }, [
                h('div', { key: 'l', style: S.chipLabel }, label),
                h('div', { key: 'v', style: S.chipValue }, formatCount(value)),
              ]))),
          ]),
          h('div', { key: 'watch' }, [
            h('div', { key: 'h', style: S.blockTitle }, '观看分析'),
            watch.supported
              ? h(RetentionChart, { key: 'chart', points: watch.retention })
              : h('div', { key: 'na', style: S.muted }, '平台暂不支持这条作品的观看分析（影集/图片作品常见）'),
            watch.note
              ? h('div', { key: 'note', style: { ...S.muted, marginTop: 6, lineHeight: '18px' } }, `平台提示：${watch.note}`)
              : null,
            h('div', { key: 'limit', style: { ...S.muted, marginTop: 4, opacity: 0.8 } }, '平台口径：只统计发布后 7 天内的数据'),
          ]),
          h('div', { key: 'traffic' }, [
            h('div', { key: 'h', style: S.blockTitle }, '流量来源'),
            h(TrafficBars, { key: 'bars', traffic }),
            h('div', { key: 'limit', style: { ...S.muted, marginTop: 4, opacity: 0.8 } }, '平台口径：近 7 日，每日 12 点更新'),
          ]),
          h('div', { key: 'favor' }, [
            h('div', { key: 'h', style: S.blockTitle }, '喜爱度诊断'),
            h('div', { key: 'row', style: { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' } }, [
              h('span', { key: 'f', style: S.muted },
                `喜爱度：${favor && favor.available ? favor.total : '统计中（发布后 2 天左右产出）'}`),
              ...tags.map((tag) => h('span', { key: tag.id, style: S.tagChip }, `${shortTag(tag.title)}：${tag.tag}`)),
            ]),
          ]),
          (work.contentScores || []).length
            ? h('div', { key: 'content' }, [
              h('div', { key: 'h', style: S.blockTitle }, '内容诊断（评分 · 诊断助手 · 平台参考）'),
              ...work.contentScores.map((score) => {
                const color = score.score >= 75 ? C.ok : score.score >= 60 ? C.warn : C.err;
                return h('div', { key: score.title, style: { ...S.miniCard, marginBottom: 8 } }, [
                  h('div', { key: 'head', style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 } }, [
                    h('span', { key: 't', style: { fontSize: 12, fontWeight: 600 } }, score.title),
                    h('span', { key: 's', style: { fontSize: 18, fontWeight: 700, color } }, `${score.score} 分`),
                  ]),
                  score.desc
                    ? h('div', { key: 'd', style: { ...S.muted, marginTop: 4, lineHeight: '18px' } }, score.desc)
                    : null,
                  score.title.includes('标题')
                    ? h('div', { key: 'cmp', style: { ...S.muted, marginTop: 6, lineHeight: '18px' } }, [
                      `你的标题：${titleFacts(work.title)}`,
                    ])
                    : null,
                  (score.reference || []).length
                    ? h('div', { key: 'ref', style: { display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' } },
                      score.reference.map((ref) => h('div', { key: ref.photoId, style: { width: 122 } }, [
                        ref.cover
                          ? h('img', {
                            key: 'i',
                            src: ref.cover,
                            style: { width: 122, height: 68, objectFit: 'cover', borderRadius: 6, display: 'block', background: C.card2 },
                            loading: 'lazy',
                            referrerPolicy: 'no-referrer',
                          })
                          : h('div', { key: 'i', style: { width: 122, height: 68, borderRadius: 6, background: C.card2 } }),
                        h('div', { key: 't', style: { fontSize: 10, lineHeight: '14px', marginTop: 3, color: C.text } }, shortTitle(ref.title, 22)),
                        h('div', { key: 'v', style: { fontSize: 10, color: C.sub, marginTop: 1 } },
                          `${formatCount(ref.viewCount)} 播放${ref.official ? ' · 官方课程' : ''}`),
                      ])))
                    : null,
                ]);
              }),
            ])
            : null,
        ]) : null,
      ]);
    }

    /* ---------- 面板 ---------- */

    function Panel() {
      const [phase, setPhase] = useState('idle');
      const [data, setData] = useState(null);
      const [error, setError] = useState('');
      const alive = useRef(true);

      const load = useCallback(async () => {
        setPhase('loading');
        setError('');
        try {
          const response = await fetch('/kuaishou/api/data', { cache: 'no-store' });
          const payload = await response.json();
          if (!alive.current) return;
          setData(payload.snapshot || null);
          setPhase('idle');
        } catch (err) {
          if (!alive.current) return;
          setError(String((err && err.message) || err));
          setPhase('error');
        }
      }, []);

      const sync = useCallback(async () => {
        setPhase('syncing');
        setError('');
        try {
          const response = await fetch('/kuaishou/api/sync', { method: 'POST', cache: 'no-store' });
          const payload = await response.json();
          if (!alive.current) return;
          if (payload.ok) {
            setData(payload.snapshot || null);
            setPhase('idle');
          } else {
            setData(payload.snapshot || null);
            setError(payload.message || payload.code || 'sync-failed');
            setPhase('error');
          }
        } catch (err) {
          if (!alive.current) return;
          setError(String((err && err.message) || err));
          setPhase('error');
        }
      }, []);

      useEffect(() => {
        alive.current = true;
        load();
        return () => { alive.current = false; };
      }, [load]);

      const t = (key) => {
        const dict = (window.__DSH_LOCALE__ && window.__DSH_LOCALE__ === 'en') ? EN : ZH;
        return dict[key] || ZH[key] || key;
      };

      const snapshot = data;
      const header = h('div', { style: S.toolbar }, [
        h('div', { key: 'title' }, [
          h('div', { key: 't', style: S.title }, t('panel')),
          h('div', { key: 's', style: S.subtitle },
            snapshot && snapshot.account
              ? `${snapshot.account.name || ''} · ${t('fans')} ${formatCount(snapshot.account.fans)} · ${t('capturedAt')} ${String(snapshot.capturedAt || '').slice(5, 16).replace('T', ' ')}`
              : t('panelHint')),
        ]),
        h('div', { key: 'actions' }, h('button', {
          type: 'button',
          style: { ...S.buttonPrimary, opacity: phase === 'syncing' ? 0.7 : 1 },
          disabled: phase === 'syncing',
          onClick: sync,
        }, phase === 'syncing' ? t('syncing') : t('sync'))),
      ]);

      let body;
      if (phase === 'loading' && !snapshot) {
        body = h('div', { key: 'loading', style: S.muted }, t('loading'));
      } else if (!snapshot) {
        body = h('div', { key: 'empty', style: S.empty }, [
          h('div', { key: 't', style: S.emptyTitle }, t('emptyTitle')),
          h('div', { key: 'b', style: S.emptyBody }, t('emptyBody')),
          h('div', { key: 's1', style: S.step }, `1. ${t('emptyStep1')}`),
          h('div', { key: 's2', style: S.step }, `2. ${t('emptyStep2')}`),
          h('div', { key: 's3', style: S.step }, `3. ${t('emptyStep3')}`),
        ]);
      } else {
        const totals = snapshot.totals || {};
        const series = snapshot.series || { dates: [], lines: [] };
        const schedule = snapshot.schedule || { byHour: [], byWeekday: [], bestHour: null };
        const works = snapshot.works || [];
        const topics = snapshot.topics || [];
        const fixes = snapshot.priorityFixes || [];
        const top = fixes.slice(0, 3);
        const rest = fixes.slice(3);
        const lines = (series.lines || [])
          .filter((line) => ['PLAY', 'LIKE', 'PURE_INCREASE_FAN'].includes(line.tab))
          .slice(0, 3);

        body = h('div', { key: 'content', style: { display: 'flex', flexDirection: 'column', gap: 18 } }, [
          snapshot.goals
            ? h('section', { key: 'goals', style: { ...S.section, padding: '10px 16px' } }, [
              h('div', { key: 'row', style: { display: 'flex', gap: 22, flexWrap: 'wrap', alignItems: 'baseline' } }, [
                h('span', { key: 't', style: { fontSize: 13, fontWeight: 600 } }, '目标：曝光 + 涨粉'),
                h('span', { key: 'e', style: S.muted },
                  `曝光：总播放 ${formatCount(snapshot.goals.exposure.totalPlay)} · 近 7 天 ${formatCount(snapshot.goals.exposure.recent7)} · 单日峰值 ${formatCount(snapshot.goals.exposure.peakDaily)}`),
                h('span', { key: 'f', style: S.muted },
                  `涨粉：粉丝 ${formatCount(snapshot.goals.fans.total)} · 本轮新增 ${snapshot.goals.fans.newFans}`),
              ]),
            ])
            : null,
          h('section', { key: 'overview', style: S.section }, [
            h('div', { key: 'head', style: S.sectionHead }, [
              h('div', { key: 't', style: S.sectionTitle }, t('overview')),
              h('div', { key: 'h', style: S.sectionHint }, `${t('detailWorks')} ${snapshot.limits ? snapshot.limits.detailWorks : 0} ${t('of')} ${works.length}`),
            ]),
            h('div', { key: 'kpi', style: S.kpiRow }, [
              h(Kpi, { key: 'play', label: t('totalPlay'), value: formatCount(totals.play) }),
              h(Kpi, { key: 'like', label: t('totalLike'), value: formatCount(totals.like) }),
              h(Kpi, { key: 'follow', label: t('totalFollow'), value: formatCount(totals.follow) }),
              h(Kpi, { key: 'eng', label: t('engagement'), value: formatPercent(totals.engagement) }),
              h(Kpi, { key: 'works', label: t('works'), value: String(totals.works || 0) }),
            ]),
            h('div', { key: 'format', style: { ...S.muted, marginTop: 10 } },
              buildFormatLine(snapshot.formatSummary, t)),
            h(Funnel, { key: 'funnel', funnel: snapshot.funnel, t }),
            h('div', { key: 'trend', style: { marginTop: 14 } }, [
              h('div', { key: 'label', style: { ...S.sectionHint, marginBottom: 4 } }, t('trend')),
              h(TrendChart, { key: 'chart', dates: series.dates || [], lines }),
            ]),
          ]),

          h('section', { key: 'priority', style: S.section }, [
            h('div', { key: 'head', style: S.sectionHead }, [
              h('div', { key: 't', style: S.sectionTitle }, t('priority')),
              h('div', { key: 'h', style: S.sectionHint }, t('priorityHint')),
            ]),
            h('div', { key: 'list', style: { display: 'flex', flexDirection: 'column', gap: 8 } },
              top.map((item, index) => h(PriorityCard, { key: `p${index}`, item, index }))),
          ]),

          h('section', { key: 'works', style: S.section }, [
            h('div', { key: 'head', style: S.sectionHead }, [
              h('div', { key: 't', style: S.sectionTitle }, t('worksSection')),
              h('div', { key: 'h', style: S.sectionHint }, t('worksHint')),
            ]),
            works.length
              ? h('div', { key: 'list' }, works.map((work) => h(WorkCard, { key: work.photoId, work, t })))
              : h('div', { key: 'none', style: S.muted }, t('noWorks')),
          ]),

          h('section', { key: 'activities', style: S.section }, [
            h('div', { key: 'head', style: S.sectionHead }, [
              h('div', { key: 't', style: S.sectionTitle }, '活动中心'),
              h('div', { key: 'h', style: S.sectionHint }, [
                snapshot.activitySummary
                  ? `共 ${snapshot.activitySummary.total} 个 · 已参加 ${snapshot.activitySummary.joined} · ${snapshot.activitySummary.endingSoon} 个 3 天内截止`
                  : '',
                '（每天看一眼，挑匹配度高的做）',
              ].join('')),
            ]),
            (snapshot.tasks || []).length
              ? h('div', { key: 'tasks', style: { marginBottom: 12 } }, [
                h('div', { key: 'h', style: S.blockTitle }, '今日任务'),
                ...snapshot.tasks.map((task) => h(TaskRow, { key: task.id, task })),
              ])
              : null,
            (snapshot.activities || []).length
              ? h('div', { key: 'list' }, snapshot.activities.slice(0, 8).map((item) => h(ActivityCard, { key: item.id, item })))
              : h('div', { key: 'none', style: S.muted }, '没有取到活动数据，点「同步数据」再试一次'),
          ]),

          h('section', { key: 'schedule', style: S.section }, [
            h('div', { key: 'head', style: S.sectionHead }, [
              h('div', { key: 't', style: S.sectionTitle }, t('schedule')),
              h('div', { key: 'h', style: S.sectionHint }, t('scheduleHint')),
            ]),
            h('div', { key: 'facts', style: { display: 'flex', gap: 22, flexWrap: 'wrap', marginBottom: 10 } }, [
              h('span', { key: 'hour', style: S.muted },
                `${t('bestHour')}：${schedule.bestHour ? `${String(schedule.bestHour.hour).padStart(2, '0')}:00（${schedule.bestHour.count} 条，平均 ${formatCount(schedule.bestHour.avgPlay)}）` : '--'}`),
              h('span', { key: 'weekday', style: S.muted },
                `${t('bestWeekday')}：${schedule.bestWeekday ? `${schedule.bestWeekday.label}（平均 ${formatCount(schedule.bestWeekday.avgPlay)}）` : '--'}`),
              h('span', { key: 'gap', style: S.muted },
                `${t('gap')}：${schedule.gapDays === null ? '--' : `${schedule.gapDays} ${t('days')}`}`),
            ]),
            h(HourBars, { key: 'bars', byHour: schedule.byHour || [], bestHour: schedule.bestHour }),
          ]),

          h('section', { key: 'topics', style: S.section }, [
            h('div', { key: 'head', style: S.sectionHead }, [
              h('div', { key: 't', style: S.sectionTitle }, t('topics')),
              h('div', { key: 'h', style: S.sectionHint }, t('topicsHint')),
            ]),
            topics.length
              ? h('table', { key: 'table', style: S.table }, [
                h('thead', { key: 'head' }, h('tr', null, [
                  h('th', { key: 'tag', style: S.th }, t('topic')),
                  h('th', { key: 'count', style: { ...S.th, textAlign: 'right' } }, t('topicCount')),
                  h('th', { key: 'play', style: { ...S.th, textAlign: 'right' } }, t('topicPlay')),
                  h('th', { key: 'like', style: { ...S.th, textAlign: 'right' } }, t('topicLike')),
                ])),
                h('tbody', { key: 'body' }, topics.slice(0, 12).map((row) => h('tr', { key: row.tag }, [
                  h('td', { key: 'tag', style: S.td }, `#${row.tag}`),
                  h('td', { key: 'count', style: { ...S.td, textAlign: 'right' } }, String(row.count)),
                  h('td', { key: 'play', style: { ...S.td, textAlign: 'right' } }, formatCount(row.avgPlay)),
                  h('td', { key: 'like', style: { ...S.td, textAlign: 'right' } }, String(row.avgLike)),
                ]))),
              ])
              : h('div', { key: 'none', style: S.muted }, t('noTopics')),
          ]),

          rest.length
            ? h('section', { key: 'more', style: S.section }, [
              h('div', { key: 'head', style: S.sectionHead }, [
                h('div', { key: 't', style: S.sectionTitle }, t('moreAdvice')),
                snapshot.limits && snapshot.limits.sampleSmall
                  ? h('div', { key: 'h', style: S.sectionHint }, t('smallSample'))
                  : null,
              ]),
              h('div', { key: 'list', style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                rest.map((item, index) => h(PriorityCard, { key: `r${index}`, item, index: index + top.length }))),
            ])
            : null,
        ]);
      }

      return h('div', { style: S.root }, [
        h('div', { key: 'inner', style: S.inner }, [
          header,
          error ? h('div', { key: 'err', style: S.error }, error) : null,
          phase === 'syncing' ? h('div', { key: 'running', style: S.muted }, t('syncRunning')) : null,
          body,
        ]),
      ]);
    }

    function PanelIcon(props) {
      const size = (props && props.size) || 20;
      return h('svg', {
        viewBox: '0 0 24 24',
        width: size,
        height: size,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.6,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
      }, [
        h('path', { key: 'axis', d: 'M3 20h18' }),
        h('path', { key: 'b1', d: 'M6 20v-5' }),
        h('path', { key: 'b2', d: 'M12 20v-9' }),
        h('path', { key: 'b3', d: 'M18 20v-13' }),
        h('path', { key: 'tick', d: 'M15.5 4.5 18 4l.6 2.5' }),
      ]);
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(
          () => ctx.slots.inject('main', () => ctx.slots.register({
            name: 'main',
            key: PANEL_ID,
            inject: () => ({}),
          }, Panel)),
          'kuaishou-analysis: main panel',
        );

        ctx.effect(
          () => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 6,
            label: () => '快手分析',
          }, PanelIcon)),
          'kuaishou-analysis: sidebar entry',
        );
      },
    };
  },
});
