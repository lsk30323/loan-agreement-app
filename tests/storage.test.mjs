import { needsBackupReminder } from "../src/storage.js";

// ===== storage.js 순수 함수 테스트 (백업 알림 판단) =====
import assert from "node:assert/strict";
let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log("PASS:", name); };

const DAY = 86400000;
const now = Date.UTC(2026, 5, 20); // 임의 기준 시각(ms)

t("데이터 없으면 알림 안 함", () => {
  assert.equal(needsBackupReminder(false, null, now), false);
  assert.equal(needsBackupReminder(false, now - 1000 * DAY, now), false);
});
t("데이터 있고 백업 이력 없으면 알림", () => {
  assert.equal(needsBackupReminder(true, null, now), true);
});
t("마지막 백업 14일 미만이면 알림 안 함", () => {
  assert.equal(needsBackupReminder(true, now - 13 * DAY, now), false);
  assert.equal(needsBackupReminder(true, now, now), false);
});
t("마지막 백업 14일 이상이면 알림", () => {
  assert.equal(needsBackupReminder(true, now - 14 * DAY, now), true);
  assert.equal(needsBackupReminder(true, now - 30 * DAY, now), true);
});
t("thresholdDays 커스터마이즈", () => {
  assert.equal(needsBackupReminder(true, now - 5 * DAY, now, 7), false);
  assert.equal(needsBackupReminder(true, now - 8 * DAY, now, 7), true);
});

console.log(`\n총 ${pass}개 테스트 통과 ✅`);
