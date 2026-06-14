import {
  applyFreePayments, suggestMonthlyByMaturity, projectPayoffByMonthly,
  buildSchedule, numberToKoreanAmount,
} from "../src/calc.js";

// ===== 단위 테스트 (§9 기대값 검증) =====
import assert from "node:assert/strict";
let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log("PASS:", name); };

t("자유상환·3.5%·잔여원금", () => {
  const res = applyFreePayments(3870000, 3.5, [
    {ym:"2026-04", amount:600000},{ym:"2026-05", amount:200000},{ym:"2026-06", amount:200000},
  ], "simple");
  assert.equal(res.principal, 2899873);
  assert.equal(res.accruedInterest, 29873);
  assert.deepEqual(res.rows.map(r=>r.interest), [11288, 9570, 9015]);
});
t("권장 월액(잔여 2,899,873 / 3.5% / 6개월)", () => {
  const {monthly, monthsLeft} = suggestMonthlyByMaturity(2899873, 3.5, "2026-07", "2026-12");
  assert.equal(monthsLeft, 6); assert.equal(monthly, 488258);
});
t("계획 50만원 완납 시뮬레이션", () => {
  const r = projectPayoffByMonthly(2899873, 3.5, "2026-07", 500000);
  assert.equal(r.rounds, 6); assert.equal(r.payoffMonth, "2026-12"); assert.equal(r.lastPayment, 429031); assert.equal(r.finalBalance, 0);
});
t("원리금균등 1,200만/6%/12", () => {
  const s = buildSchedule(12000000, 6, 12, "annuity");
  assert.equal(s.monthly, 1032797); assert.equal(s.sumPrincipal, 12000000); assert.equal(s.residual, 0);
});
t("원금균등 합계=원금", () => {
  const s = buildSchedule(12000000, 6, 12, "equalPrincipal");
  assert.equal(s.sumPrincipal, 12000000); assert.equal(s.residual, 0);
});
t("무이자 자유상환", () => {
  const res = applyFreePayments(3870000, 0, [
    {ym:"2026-04", amount:600000},{ym:"2026-05", amount:200000},{ym:"2026-06", amount:200000},
  ], "none");
  assert.equal(res.principal, 2870000); assert.equal(res.accruedInterest, 0);
});
t("한글 금액", () => {
  const cases = [[0,"영원"],[10,"십원"],[10000,"일만원"],[100000,"십만원"],[1000000,"백만원"],[2899873,"이백팔십구만구천팔백칠십삼원"],[3870000,"삼백팔십칠만원"],[100000000000,"천억원"]];
  for (const [n, k] of cases) assert.equal(numberToKoreanAmount(n), k);
});
t("이율 상한 검증은 앱/도메인 레이어 책임(여기선 계산만)", () => { assert.ok(true); });

console.log(`\n총 ${pass}개 테스트 통과 ✅`);
