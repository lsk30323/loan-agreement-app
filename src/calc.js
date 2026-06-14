// =====================================================================
// calc.js — 차용증 앱 상환 계산 엔진 (검증 완료된 참조 구현 + 앱 레이어 래퍼)
//
// 규칙(전역 불변식, spec §2.3 / §5):
//  - 모든 금액은 정수 '원' 단위. 이자는 매월 반올림(round). 부동소수점 누적오차 회피.
//  - 순수 함수만. DOM/스토리지/네트워크 의존성 없음 → Node로 단위 테스트 가능.
//
// 구성:
//  [1] 날짜(YYYY-MM) 유틸          : monthsBetween, addMonths
//  [2] 자유상환 원장 계산          : applyFreePayments
//  [3] 권장 월액 / 완납 시뮬레이션  : suggestMonthly, suggestMonthlyByMaturity, projectPayoffByMonthly
//  [4] 표준 상환 스케줄            : buildSchedule (annuity / equalPrincipal / lump)
//  [5] 한글 금액 변환              : numberToKoreanAmount, formatContractAmount
//  [6] 앱 레이어 래퍼(§5.5)        : Agreement 객체 + 'YYYY-MM-DD' 날짜를 받는 고수준 API
//
// ※ [1]~[5]는 spec 부록 A의 검증본을 그대로 유지한다(시그니처/동작 불변 — tests 의존).
//   [6]만 앱 통합용으로 추가했다.
// =====================================================================

const round = Math.round;

// ---------------------------------------------------------------------
// [1] "YYYY-MM" 월 단위 유틸
// ---------------------------------------------------------------------

// "YYYY-MM" 사이 개월 수 (toYM - fromYM)
export function monthsBetween(fromYM, toYM) {
  const [fy, fm] = fromYM.split("-").map(Number);
  const [ty, tm] = toYM.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

// "YYYY-MM"에 k개월 더하기
export function addMonths(ym, k) {
  let [y, m] = ym.split("-").map(Number);
  const total = (y * 12 + (m - 1)) + k;
  y = Math.floor(total / 12);
  m = (total % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------
// [2] 자유상환(free): 매월 이자=round(잔여원금×r) 먼저 충당 후 원금 차감.
// payments: [{ym, amount}] 시간순. 연속 월이 아니어도 개월차만큼 단리 이자 누적.
// loanYM: 이자 누적 시작월(대여월). 미지정 시 '첫 상환월의 1개월 전'으로 보아
//         첫 상환에 1개월치 이자를 부과한다(= 본 프로젝트의 확정 가정).
// ---------------------------------------------------------------------
export function applyFreePayments(principal, annualRate, payments, interestKind = "simple", loanYM = null) {
  const r = annualRate / 100 / 12;
  let bal = principal, totalInterest = 0, overpaid = 0;
  let prevYM = loanYM || (payments[0] ? addMonths(payments[0].ym, -1) : null);
  const rows = [];
  for (const p of payments) {
    let interest = 0;
    if (interestKind !== "none" && r > 0 && prevYM) {
      const elapsed = Math.max(0, monthsBetween(prevYM, p.ym));
      interest = round(bal * r * elapsed);
    }
    const toPrincipal = Math.max(0, p.amount - interest);
    const principalPaid = Math.min(bal, toPrincipal);
    if (toPrincipal > bal) overpaid += (toPrincipal - bal);
    bal -= principalPaid;
    totalInterest += Math.min(interest, p.amount);
    rows.push({ ym: p.ym, payment: p.amount, interest, principalPaid, balance: bal });
    prevYM = p.ym;
  }
  return { principal: bal, accruedInterest: totalInterest, overpaid, rows };
}

// ---------------------------------------------------------------------
// [3] 권장 월액 / 완납 시뮬레이션
// ---------------------------------------------------------------------

// 권장 월액(원리금균등 재계산): 잔여원금 P, 연이율, 남은 개월 n. 올림하여 완납 보장.
export function suggestMonthly(P, annualRate, n) {
  if (n <= 0) return 0;
  const r = annualRate / 100 / 12;
  if (r === 0) return Math.ceil(P / n);
  const f = Math.pow(1 + r, n);
  return Math.ceil((P * r * f) / (f - 1));
}

// 목표 만기까지 권장 월액 (앱 API). monthsLeft = 시작월~만기월 '포함' 개월 수.
export function suggestMonthlyByMaturity(P, annualRate, startYM, maturityYM) {
  const monthsLeft = monthsBetween(startYM, maturityYM) + 1; // 만기월 포함
  return { monthly: suggestMonthly(P, annualRate, monthsLeft), monthsLeft };
}

// 계획 월액으로 완납 시뮬레이션 (단리, 이자 먼저). 시작월/완납월/회차/마지막납입액.
export function projectPayoffByMonthly(P, annualRate, startYM, monthly, interestKind = "simple") {
  const r = annualRate / 100 / 12;
  let bal = P, rounds = 0, lastPayment = 0;
  for (let i = 0; i < 100000 && bal > 0; i++) {
    const interest = (interestKind !== "none" && r > 0) ? round(bal * r) : 0;
    if (monthly <= interest) return { rounds: Infinity, warning: "월계획액이 월이자 이하 — 원금 미감소" };
    const principalPaid = Math.min(bal, monthly - interest);
    lastPayment = principalPaid + interest;
    bal -= principalPaid;
    rounds++;
  }
  return { rounds, payoffMonth: addMonths(startYM, rounds - 1), lastPayment, finalBalance: bal };
}

// ---------------------------------------------------------------------
// [4] 표준 상환 스케줄: method = 'annuity' | 'equalPrincipal' | 'lump'
// ---------------------------------------------------------------------
export function buildSchedule(principal, annualRate, n, method) {
  const r = annualRate / 100 / 12;
  const rows = [];
  let bal = principal, sumP = 0, sumI = 0;
  if (method === "annuity") {
    const monthly = r === 0 ? round(principal / n) : round((principal * r * Math.pow(1+r,n)) / (Math.pow(1+r,n) - 1));
    for (let k = 1; k <= n; k++) {
      const interest = round(bal * r);
      let principalPart = (k === n) ? bal : monthly - interest;
      bal -= principalPart; sumP += principalPart; sumI += interest;
      rows.push({ k, payment: principalPart + interest, interest, principalPart, balance: bal });
    }
    return { monthly, rows, sumPrincipal: sumP, sumInterest: sumI, residual: bal };
  }
  if (method === "equalPrincipal") {
    const base = round(principal / n);
    for (let k = 1; k <= n; k++) {
      const interest = round(bal * r);
      let principalPart = (k === n) ? bal : base;
      bal -= principalPart; sumP += principalPart; sumI += interest;
      rows.push({ k, payment: principalPart + interest, interest, principalPart, balance: bal });
    }
    return { rows, sumPrincipal: sumP, sumInterest: sumI, residual: bal };
  }
  if (method === "lump") {
    for (let k = 1; k <= n; k++) {
      const interest = round(principal * r);
      const principalPart = (k === n) ? principal : 0;
      sumI += interest; if (k === n) sumP += principal;
      rows.push({ k, payment: principalPart + interest, interest, principalPart, balance: (k === n ? 0 : principal) });
    }
    return { rows, sumPrincipal: sumP, sumInterest: sumI, residual: 0 };
  }
  throw new Error("unknown method");
}

// ---------------------------------------------------------------------
// [5] 숫자 → 한글 금액 (0 ~ 100,000,000,000)
// ---------------------------------------------------------------------
export function numberToKoreanAmount(num) {
  if (!Number.isInteger(num) || num < 0 || num > 100000000000) throw new RangeError("금액 범위(0~100,000,000,000)");
  if (num === 0) return "영원";
  const D = ["","일","이","삼","사","오","육","칠","팔","구"], S = ["","십","백","천"], B = ["","만","억","조"];
  let res = "", gi = 0, n = num;
  while (n > 0) {
    const g0 = n % 10000;
    if (g0 > 0) {
      let gs = "", g = g0, pos = 0;
      while (g > 0) { const d = g % 10; if (d > 0) { const digit = (d === 1 && pos > 0) ? "" : D[d]; gs = digit + S[pos] + gs; } g = Math.floor(g/10); pos++; }
      res = gs + B[gi] + res;
    }
    n = Math.floor(n / 10000); gi++;
  }
  return res + "원";
}
export const formatContractAmount = (num) => "금 " + numberToKoreanAmount(num) + "정";

// =====================================================================
// [6] 앱 레이어 래퍼 (spec §5.5) — Agreement 객체 + 'YYYY-MM-DD' 날짜를 받는 고수준 API.
//     UI/문서 레이어는 가급적 이 래퍼를 사용한다. (위 [1]~[5]는 순수 저수준 함수)
//
//   Agreement(부분): { principal, interestRate, interestKind, loanDate,
//                      maturityDate?, repaymentPeriodMonths?, repaymentMethod, payments?[] }
//   Payment        : { date:'YYYY-MM-DD', amount:int }
// =====================================================================

// 'YYYY-MM-DD' → 'YYYY-MM'
export function ymOf(dateStr) {
  return (dateStr || "").slice(0, 7);
}

// 상환 원장(payments)을 시간순 정렬 후 {ym, amount}로 변환. asOf(포함) 이전만 선택 가능.
export function paymentsToYM(payments = [], asOfDate = null) {
  return payments
    .filter(p => p && p.amount > 0 && p.date && (!asOfDate || p.date <= asOfDate))
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map(p => ({ ym: ymOf(p.date), amount: Math.round(p.amount) }));
}

// (A) 현재 잔액 — spec §5.3(A). asOfDate(포함)까지의 상환을 반영.
//     interestKind='none'이면 단순 차감, 'simple'이면 이자 먼저 충당.
export function remainingPrincipal(agreement, asOfDate = null) {
  const { principal, interestRate = 0, interestKind = "none", loanDate } = agreement;
  const ymPayments = paymentsToYM(agreement.payments, asOfDate);
  const loanYM = loanDate ? ymOf(loanDate) : null;
  const res = applyFreePayments(principal, interestRate, ymPayments, interestKind, loanYM);
  return {
    principal: res.principal,
    accruedInterest: res.accruedInterest,
    overpaid: res.overpaid,
    rows: res.rows,
  };
}

// 상환기간 n(개월) 도출: repaymentPeriodMonths 우선, 없으면 loanDate~maturityDate.
export function loanTermMonths(agreement) {
  if (agreement.repaymentPeriodMonths && agreement.repaymentPeriodMonths >= 1) {
    return agreement.repaymentPeriodMonths;
  }
  if (agreement.loanDate && agreement.maturityDate) {
    return Math.max(1, monthsBetween(ymOf(agreement.loanDate), ymOf(agreement.maturityDate)));
  }
  return null;
}

// (B-1) 표준 상환 스케줄(앱 API) — lump/equalPrincipal/annuity. free/n없음이면 null.
export function scheduleForAgreement(agreement) {
  const method = agreement.repaymentMethod;
  if (method === "free") return null;
  const n = loanTermMonths(agreement);
  if (!n) return null;
  return buildSchedule(agreement.principal, agreement.interestRate || 0, n, method);
}

// (B-2) 목표 만기 기준 권장 월액(앱 API). startMonth='YYYY-MM'. 현재 잔액 기준 재계산.
export function suggestMonthlyByMaturityForAgreement(agreement, startMonth) {
  const bal = remainingPrincipal(agreement);
  const maturityYM = agreement.maturityDate ? ymOf(agreement.maturityDate) : null;
  if (!maturityYM) return null;
  const out = suggestMonthlyByMaturity(bal.principal, agreement.interestKind === "none" ? 0 : (agreement.interestRate || 0), startMonth, maturityYM);
  return { ...out, basePrincipal: bal.principal };
}

// (C) 계획 월액 기준 예상 완납일/회차(앱 API). startMonth='YYYY-MM'.
export function projectPayoffByMonthlyForAgreement(agreement, startMonth, monthly) {
  const bal = remainingPrincipal(agreement);
  const out = projectPayoffByMonthly(
    bal.principal,
    agreement.interestKind === "none" ? 0 : (agreement.interestRate || 0),
    startMonth,
    monthly,
    agreement.interestKind || "none",
  );
  return { ...out, basePrincipal: bal.principal };
}
