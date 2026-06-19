// =====================================================================
// ledger.js — 상환 원장/스케줄 표시·CSV·포트폴리오 합계용 순수 함수 모듈.
//
// DOM/스토리지/네트워크 의존성 없음 → Node로 단위 테스트 가능(tests/ledger.test.mjs).
// 계산은 검증 완료된 calc.js 결과만 가져다 가공한다(계산식은 calc.js가 단독 책임).
// =====================================================================

import { remainingPrincipal, scheduleForAgreement } from "./calc.js";

// 유효 상환(금액>0·날짜有)을 날짜순 정렬하고, calc 엔진의 회차별 분해(rows)를
// 같은 순서로 1:1 매핑해 반환한다. 원장 표·CSV가 동일한 계산 결과를 공유한다.
export function ledgerRows(ag) {
  const bal = remainingPrincipal(ag);
  const valid = (ag.payments || [])
    .filter((p) => p && p.amount > 0 && p.date)
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { bal, items: valid.map((p, i) => ({ p, r: bal.rows[i] || null })) };
}

// CSV 한 칸 이스케이프(콤마·따옴표·줄바꿈 포함 시 따옴표로 감싸고 "는 "" 처리).
export function csvField(v) {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function toCSV(header, rows) {
  const lines = [header.map(csvField).join(",")];
  for (const cells of rows) lines.push(cells.map(csvField).join(","));
  return lines.join("\r\n");
}

// 상환 내역 CSV 문자열(헤더 + 회차별 이자/원금충당/잔액).
export function buildLedgerCSV(ag) {
  const { items } = ledgerRows(ag);
  return toCSV(
    ["상환일", "상환액", "이자", "원금충당", "잔액", "메모"],
    items.map(({ p, r }) => [
      p.date,
      p.amount,
      r ? r.interest : "",
      r ? r.principalPaid : "",
      r ? r.balance : "",
      p.note || "",
    ]),
  );
}

// 표준 상환 스케줄 CSV 문자열. 스케줄이 없으면(자유상환·기간없음) "".
export function buildScheduleCSV(ag) {
  const sched = scheduleForAgreement(ag);
  if (!sched || !sched.rows || sched.rows.length === 0) return "";
  return toCSV(
    ["회차", "납입", "이자", "원금", "잔액"],
    sched.rows.map((r) => [r.k, r.payment, r.interest, r.principalPart, r.balance]),
  );
}

// 여러 차용증 합계 요약(전체 대시보드용).
export function portfolioSummary(agreements) {
  const list = Array.isArray(agreements) ? agreements : [];
  let totalPrincipal = 0, totalRemaining = 0, totalInterest = 0, totalRepaid = 0;
  for (const ag of list) {
    totalPrincipal += ag.principal || 0;
    const bal = remainingPrincipal(ag);
    totalRemaining += bal.principal;
    totalInterest += bal.accruedInterest;
    totalRepaid += (ag.payments || []).reduce((s, p) => s + (p.amount || 0), 0);
  }
  return { count: list.length, totalPrincipal, totalRemaining, totalInterest, totalRepaid };
}
