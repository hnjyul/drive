import { readFileSync } from "node:fs";

function readJSON(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return fallback;
  }
}

const THRESHOLD = { coveragePct: 90, e2ePct: 98 };

const coverage = readJSON("coverage/coverage-summary.json", null);
const coveragePct = coverage ? coverage.total.lines.pct : 0;

const e2e = readJSON("artifacts/e2e.json", null);
const specs = e2e?.suites?.flatMap((s) => s.specs ?? []) ?? [];
const e2ePct = specs.length
  ? (specs.filter((s) => s.ok).length / specs.length) * 100
  : 0;

console.log(
  `coverage=${coveragePct.toFixed(1)}% (threshold ${THRESHOLD.coveragePct}%), ` +
    `e2e=${e2ePct.toFixed(1)}% (threshold ${THRESHOLD.e2ePct}%)`
);

const fail = coveragePct < THRESHOLD.coveragePct || e2ePct < THRESHOLD.e2ePct;

if (fail) {
  console.error("QUALITY FAIL");
  process.exit(1);
}

console.log("QUALITY PASS");
