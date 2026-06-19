import {
  ledgerRows, csvField, buildLedgerCSV, buildScheduleCSV, portfolioSummary,
} from "../src/ledger.js";
import { newAgreement, newPayment } from "../src/model.js";

// ===== ledger.js 순수 함수 테스트 (원장 표시·CSV·포트폴리오 합계) =====
import assert from "node:assert/strict";
let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log("PASS:", name); };

// 387만원·3.5% 단리 자유상환, 입력 순서를 일부러 뒤섞어 정렬도 검증.
function sampleAg() {
  const ag = newAgreement({
    creditor: { name: "홍부친" }, debtor: { name: "홍자녀" },
    principal: 3870000, interestRate: 3.5, interestKind: "simple",
    loanDate: "2026-03-31", repaymentMethod: "free",
  });
  ag.payments = [
    newPayment({ date: "2026-05-30", amount: 200000 }),
    newPayment({ date: "2026-04-30", amount: 600000, note: "첫 상환, 콤마" }),
    newPayment({ date: "2026-06-30", amount: 200000 }),
  ];
  return ag;
}

t("ledgerRows: 날짜순 정렬 + calc rows 1:1 매핑", () => {
  const { bal, items } = ledgerRows(sampleAg());
  assert.equal(items.length, 3);
  assert.deepEqual(items.map((x) => x.p.date), ["2026-04-30", "2026-05-30", "2026-06-30"]);
  assert.deepEqual(items.map((x) => x.r.interest), [11288, 9570, 9015]);
  assert.deepEqual(items.map((x) => x.r.principalPaid), [588712, 190430, 190985]);
  assert.equal(items[2].r.balance, 2899873);
  assert.equal(bal.principal, 2899873);
});

t("csvField: 콤마·따옴표·줄바꿈만 따옴표로 감싸고 \"는 \"\" 처리", () => {
  assert.equal(csvField("abc"), "abc");
  assert.equal(csvField(600000), "600000");
  assert.equal(csvField("a,b"), '"a,b"');
  assert.equal(csvField('he"llo'), '"he""llo"');
  assert.equal(csvField("line1\nline2"), '"line1\nline2"');
  assert.equal(csvField(null), "");
});

t("buildLedgerCSV: 헤더 + 회차별 분해 + 콤마 메모 이스케이프", () => {
  const csv = buildLedgerCSV(sampleAg());
  const lines = csv.split("\r\n");
  assert.equal(lines[0], "상환일,상환액,이자,원금충당,잔액,메모");
  assert.equal(lines[1], '2026-04-30,600000,11288,588712,3281288,"첫 상환, 콤마"');
  assert.equal(lines[3], "2026-06-30,200000,9015,190985,2899873,");
  assert.equal(lines.length, 4);
});

t("buildScheduleCSV: 원리금균등은 헤더+n행·잔액0, 자유상환은 빈 문자열", () => {
  const ag = newAgreement({
    creditor: { name: "A" }, debtor: { name: "B" },
    principal: 12000000, interestRate: 6, interestKind: "simple",
    loanDate: "2026-01-01", repaymentPeriodMonths: 12, repaymentMethod: "annuity",
  });
  const csv = buildScheduleCSV(ag);
  const lines = csv.split("\r\n");
  assert.equal(lines[0], "회차,납입,이자,원금,잔액");
  assert.equal(lines.length, 13); // 헤더 + 12회차
  assert.ok(lines[12].endsWith(",0")); // 마지막 잔액 0
  // 자유상환은 표준 스케줄 없음
  assert.equal(buildScheduleCSV(sampleAg()), "");
});

t("portfolioSummary: 여러 차용증 합계", () => {
  const s = portfolioSummary([sampleAg(), sampleAg()]);
  assert.equal(s.count, 2);
  assert.equal(s.totalPrincipal, 3870000 * 2);
  assert.equal(s.totalRepaid, 1000000 * 2);
  assert.equal(s.totalRemaining, 2899873 * 2);
  assert.equal(s.totalInterest, 29873 * 2);
});

t("portfolioSummary: 빈 배열은 0 합계", () => {
  const s = portfolioSummary([]);
  assert.deepEqual(s, { count: 0, totalPrincipal: 0, totalRemaining: 0, totalInterest: 0, totalRepaid: 0 });
});

console.log(`\n총 ${pass}개 테스트 통과 ✅`);
