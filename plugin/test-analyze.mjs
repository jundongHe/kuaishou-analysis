import fs from "node:fs";
import { buildSnapshot } from "./analyze.mjs";
const raw = JSON.parse(fs.readFileSync("../data/raw.json", "utf8"));
console.log("raw bytes", fs.statSync("../data/raw.json").size);
const snap = buildSnapshot(raw);
fs.writeFileSync("../data/snapshot.json", JSON.stringify(snap, null, 1));
console.log("snapshot bytes", fs.statSync("../data/snapshot.json").size);
console.log(JSON.stringify({
  account: snap.account,
  totals: snap.totals,
  works: snap.works.map(w => ({ id: w.photoId, play: w.play, like: w.like, follow: w.follow, score: w.score, grade: w.grade, tags: w.tags.length, traffic: w.traffic.length, retention: w.retention.length, diag: Object.keys(w.diagnose) })),
  seriesDates: snap.series.dates.length,
  schedule: { bestHour: snap.schedule.bestHour, bestWeekday: snap.schedule.bestWeekday, gap: snap.schedule.gapDays },
  topics: snap.topics.slice(0, 5),
  advice: snap.advice.map(a => a.title),
  limits: snap.limits,
}, null, 1));
