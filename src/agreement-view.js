// =====================================================================
// agreement-view.js — 표준 차용증(금전소비대차계약서) 문서 렌더링 모듈 (doc-generator)
//
// spec §8(차용증 문서 양식) 구현. 인쇄용 A4 1장 분량의 HTML 문자열을 생성한다.
//   - 공개 API: renderAgreementHTML(agreement) -> string
//   - 컨테이너 내부에 들어갈 마크업만 반환(컨테이너 자체 포함).
//   - 스타일은 styles.css(.agreement-doc* / .print-doc)가 담당 → 인라인 style 최소화.
//   - 모든 사용자 입력은 escapeHtml로 이스케이프(XSS/깨짐 방지).
//
// 순수 함수 모듈 — DOM/스토리지/네트워크 의존성 없음.
// =====================================================================

import { formatContractAmount, numberToKoreanAmount } from "./calc.js";
import { labelOf, maskIdNumber, DISCLAIMER, isInt } from "./model.js";

// ---------------------------------------------------------------------
// 내부 헬퍼
// ---------------------------------------------------------------------

// HTML 특수문자 이스케이프(문자열 컨텍스트 + 속성 컨텍스트 모두 안전).
function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// 값이 비어 있는지(선택항목 줄 생략 판단용).
function isBlank(v) {
  return v === null || v === undefined || String(v).trim() === "";
}

// 천단위 콤마. 정수 '원'만 다루므로 정수 외 입력은 0으로 안전 처리.
function formatWon(num) {
  const n = isInt(num) ? num : 0;
  return n.toLocaleString("en-US");
}

// 정의목록(dl) 한 행: 라벨/값. 값이 비어 있으면 null(줄 생략) 반환.
// raw=true면 value를 이미 만들어진 HTML로 간주(이스케이프 생략) → 내부 생성 마크업 전용.
function row(label, value, { raw = false, omitIfBlank = true } = {}) {
  if (omitIfBlank && !raw && isBlank(value)) return null;
  const v = raw ? value : escapeHtml(value);
  return (
    `<div class="agreement-doc-row">` +
    `<dt class="agreement-doc-term">${escapeHtml(label)}</dt>` +
    `<dd class="agreement-doc-desc">${v}</dd>` +
    `</div>`
  );
}

// row 배열에서 null 제거 후 join.
function rows(list) {
  return list.filter(Boolean).join("");
}

// 당사자(채권자/채무자) 블록. includeAccount=true면 입금계좌 줄 포함.
function partyBlock(heading, party, { includeAccount = false } = {}) {
  const p = party || {};
  const lines = [
    row("성명", p.name),
    row("주민등록번호", isBlank(p.idNumber) ? "" : maskIdNumber(p.idNumber)),
    row("주소", p.address),
    row("연락처", p.phone),
  ];
  if (includeAccount) lines.push(row("입금계좌", p.account));
  return (
    `<section class="agreement-doc-party">` +
    `<h2 class="agreement-doc-party-title">${escapeHtml(heading)}</h2>` +
    `<dl class="agreement-doc-dl">${rows(lines)}</dl>` +
    `</section>`
  );
}

// 서명/날인 한 칸: 역할 + 성명 + "(인)" + 서명선.
function signatureCell(role, party) {
  const name = (party && !isBlank(party.name)) ? escapeHtml(party.name) : "";
  return (
    `<div class="agreement-doc-sign-cell">` +
    `<span class="agreement-doc-sign-role">${escapeHtml(role)}</span>` +
    `<span class="agreement-doc-sign-name">${name}</span>` +
    `<span class="agreement-doc-sign-seal">(인)</span>` +
    `<span class="agreement-doc-sign-line" aria-hidden="true"></span>` +
    `</div>`
  );
}

// 차용금액 문구: "금 ○○○원정 (₩0,000,000)" — 한글 + 숫자 병기.
function amountText(principal) {
  let korean;
  try {
    korean = formatContractAmount(principal); // "금 …원정"
  } catch {
    korean = "금 (금액 범위 오류)정";
  }
  return `${escapeHtml(korean)} <span class="agreement-doc-amount-num">(₩${escapeHtml(formatWon(principal))})</span>`;
}

// 이자 문구: 무이자면 "무이자", 아니면 "연 N% (단리/복리)".
function interestText(ag) {
  if (ag.interestKind === "none") return "무이자";
  const kindLabel = labelOf("interestKind", ag.interestKind); // 단리/복리
  const rate = (typeof ag.interestRate === "number") ? ag.interestRate : 0;
  return `연 ${escapeHtml(String(rate))}% (${escapeHtml(kindLabel)})`;
}

// 지급방법 문구: 계좌이체면 계좌 병기.
function paymentText(ag) {
  const label = labelOf("paymentMethod", ag.paymentMethod);
  if (ag.paymentMethod === "transfer" && ag.creditor && !isBlank(ag.creditor.account)) {
    return `${escapeHtml(label)} (입금계좌: ${escapeHtml(ag.creditor.account)})`;
  }
  return escapeHtml(label);
}

// ---------------------------------------------------------------------
// 공개 API
// ---------------------------------------------------------------------

// 인쇄용 차용증 1장 분량의 HTML 문자열을 반환(컨테이너 포함).
export function renderAgreementHTML(agreement) {
  const ag = agreement || {};
  const creditor = ag.creditor || {};
  const debtor = ag.debtor || {};

  // ---- 헤더 ----
  const header =
    `<header class="agreement-doc-header">` +
    `<h1 class="agreement-doc-title">차 용 증</h1>` +
    `<p class="agreement-doc-subtitle">금전소비대차계약서</p>` +
    `</header>`;

  // ---- 핵심 조건(차용금액/이자) ----
  const interestLines = [
    row("이자", interestText(ag), { raw: true, omitIfBlank: false }),
  ];
  if (ag.interestKind !== "none") {
    interestLines.push(row("이자 지급시기·방법", "원금 상환 시 함께 지급하며, 지급방법은 아래 '지급방법'에 따른다."));
  }

  const terms =
    `<section class="agreement-doc-terms">` +
    `<dl class="agreement-doc-dl">` +
    rows([
      row("차용금액", amountText(ag.principal), { raw: true, omitIfBlank: false }),
      ...interestLines,
      row("차용일", ag.loanDate),
      row("변제기일", ag.maturityDate),
      row("상환기간", isInt(ag.repaymentPeriodMonths) ? `${formatWon(ag.repaymentPeriodMonths)}개월` : ""),
      row("상환방법", labelOf("repaymentMethod", ag.repaymentMethod)),
      row("지급방법", paymentText(ag), { raw: true, omitIfBlank: false }),
    ]) +
    `</dl>` +
    `</section>`;

  // ---- 당사자 ----
  const parties =
    `<div class="agreement-doc-parties">` +
    partyBlock("채권자 (빌려준 사람)", creditor, { includeAccount: true }) +
    partyBlock("채무자 (빌린 사람)", debtor) +
    `</div>`;

  // ---- 선택 조항(지연손해금/기한이익상실/특약) ----
  const extraLines = [];
  if (!isBlank(ag.lateRate) && typeof ag.lateRate === "number") {
    extraLines.push(row("지연손해금율", `연 ${escapeHtml(String(ag.lateRate))}%`, { raw: true, omitIfBlank: false }));
  }
  extraLines.push(row(
    "기한의 이익 상실",
    "채무자가 원리금 지급을 지체하는 등 약정을 위반한 경우, 채권자의 청구에 따라 기한의 이익을 잃고 잔여 채무 전액을 즉시 변제한다.",
  ));
  if (!isBlank(ag.note)) {
    extraLines.push(row("특약사항", ag.note));
  }
  const extras = extraLines.filter(Boolean).length
    ? `<section class="agreement-doc-extras">` +
      `<h2 class="agreement-doc-section-title">기타 약정</h2>` +
      `<dl class="agreement-doc-dl">${rows(extraLines)}</dl>` +
      `</section>`
    : "";

  // ---- 본문 확인 문구 ----
  const statement =
    `<p class="agreement-doc-statement">` +
    `위와 같이 금전소비대차계약을 체결하고, 채무자는 위 금액을 채권자로부터 정히 차용하였음을 확인한다. ` +
    `본 계약의 성립을 증명하기 위하여 본 차용증을 작성하고 채권자·채무자가 서명·날인한다.` +
    `</p>`;

  // ---- 작성일자 ----
  const dateLine = !isBlank(ag.contractDate)
    ? `<p class="agreement-doc-date">작성일자 : ${escapeHtml(ag.contractDate)}</p>`
    : `<p class="agreement-doc-date">작성일자 : ____년 __월 __일</p>`;

  // ---- 서명/날인란 ----
  const signatures =
    `<section class="agreement-doc-signatures">` +
    signatureCell("채권자", creditor) +
    signatureCell("채무자", debtor) +
    `</section>`;

  // ---- 하단 면책 안내(축약) ----
  const disclaimerShort = DISCLAIMER.split(".")[0].trim() + ".";
  const footer =
    `<footer class="agreement-doc-footer">` +
    `<p class="agreement-doc-disclaimer">${escapeHtml(disclaimerShort)} 본 문서의 법적 효력·과세 여부는 전문가 상담이 필요합니다.</p>` +
    `</footer>`;

  return (
    `<article class="agreement-doc">` +
    header +
    terms +
    parties +
    extras +
    statement +
    dateLine +
    signatures +
    footer +
    `</article>`
  );
}
