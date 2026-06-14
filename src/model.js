// =====================================================================
// model.js — 차용증 도메인 데이터 모델 + 법률/입력 검증 규칙 (domain-legal)
//
// spec §4(데이터 모델), §6(법률·검증 규칙), §2.3(전역 불변식) 구현.
// 순수 ES 모듈 — DOM/스토리지/네트워크 의존성 없음.
//
// ⚠ 이 앱은 세무·법률 '자문'을 제공하지 않는다. 입력값 검증 + 정보 안내까지만(§6, §12).
// =====================================================================

export const SCHEMA_VERSION = 1;
export const STORAGE_KEY = "loan-app:v1:agreements";

// ---- 전역 한도(§2.3) --------------------------------------------------
export const LIMITS = Object.freeze({
  PRINCIPAL_MIN: 0,
  PRINCIPAL_MAX: 100000000000, // 1,000억
  RATE_MIN: 0,
  RATE_MAX: 20,                // 이자제한법 최고이자율 연 20%
  TERM_LONG_WARN_MONTHS: 360,  // 30년 초과 시 증여 의제 위험 안내
});

// ---- enum + 한글 라벨(§4.1) ------------------------------------------
export const INTEREST_KINDS = Object.freeze([
  { value: "none", label: "무이자" },
  { value: "simple", label: "단리" },
  { value: "compound", label: "복리" },
]);

export const REPAYMENT_METHODS = Object.freeze([
  { value: "lump", label: "만기일시상환" },
  { value: "equalPrincipal", label: "원금균등분할" },
  { value: "annuity", label: "원리금균등분할" },
  { value: "free", label: "자유상환" },
]);

export const PAYMENT_METHODS = Object.freeze([
  { value: "transfer", label: "계좌이체" },
  { value: "cash", label: "현금" },
]);

const ENUM_VALUES = {
  interestKind: INTEREST_KINDS.map(o => o.value),
  repaymentMethod: REPAYMENT_METHODS.map(o => o.value),
  paymentMethod: PAYMENT_METHODS.map(o => o.value),
};

// enum value → 한글 라벨
export function labelOf(group, value) {
  const map = { interestKind: INTEREST_KINDS, repaymentMethod: REPAYMENT_METHODS, paymentMethod: PAYMENT_METHODS }[group];
  const found = map && map.find(o => o.value === value);
  return found ? found.label : (value ?? "");
}

// ---- 식별자 ----------------------------------------------------------
export function genId() {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* noop */ }
  return "id-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 1e9).toString(36);
}

// ---- 빈 객체 팩토리 ---------------------------------------------------
export function newAgreement(overrides = {}) {
  return {
    id: genId(),
    schemaVersion: SCHEMA_VERSION,
    creditor: { name: "", idNumber: "", address: "", phone: "", account: "" },
    debtor: { name: "", idNumber: "", address: "", phone: "" },
    principal: 0,
    interestRate: 0,
    interestKind: "none",
    loanDate: "",
    contractDate: "",
    maturityDate: "",
    repaymentPeriodMonths: null,
    repaymentMethod: "free",
    paymentMethod: "transfer",
    lateRate: null,
    note: "",
    payments: [],
    ...overrides,
  };
}

export function newPayment(overrides = {}) {
  return { id: genId(), date: "", amount: 0, note: "", ...overrides };
}

// ---- 주민번호 마스킹(§4.1, §2.3) -------------------------------------
// "900101-1234567" → "900101-1******". 형식이 달라도 뒷자리 첫 글자만 노출.
export function maskIdNumber(idNumber) {
  if (!idNumber) return "";
  const digits = String(idNumber).replace(/[^0-9]/g, "");
  if (digits.length < 7) {
    // 앞 일부만 노출
    return digits.slice(0, Math.min(6, digits.length)).padEnd(digits.length, "*");
  }
  const front = digits.slice(0, 6);
  const backFirst = digits.slice(6, 7);
  const rest = "*".repeat(Math.max(0, digits.length - 7));
  return `${front}-${backFirst}${rest}`;
}

// ---- 날짜 유틸 -------------------------------------------------------
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDate(s) {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function lastDayOfMonth(y, m /* 1-12 */) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// 'YYYY-MM-DD'에 months개월 더하기(일자는 말일 보정).
export function addMonthsToDate(dateStr, months) {
  if (!isValidDate(dateStr)) return "";
  let [y, m, d] = dateStr.split("-").map(Number);
  const total = (y * 12 + (m - 1)) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const nd = Math.min(d, lastDayOfMonth(ny, nm));
  return `${ny}-${String(nm).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}

// loanDate + 개월수 → 변제기일
export function deriveMaturityFromPeriod(loanDate, months) {
  if (!isValidDate(loanDate) || !Number.isInteger(months) || months < 1) return "";
  return addMonthsToDate(loanDate, months);
}

// loanDate ~ maturityDate → 개월수(올림: 부분 월도 1개월로). 최소 1.
export function derivePeriodFromMaturity(loanDate, maturityDate) {
  if (!isValidDate(loanDate) || !isValidDate(maturityDate)) return null;
  const [ly, lm, ld] = loanDate.split("-").map(Number);
  const [my, mm, md] = maturityDate.split("-").map(Number);
  let months = (my - ly) * 12 + (mm - lm);
  if (md > ld) months += 1; // 말일 쪽이 더 크면 한 달 더
  return Math.max(1, months);
}

// ---- 숫자 헬퍼 -------------------------------------------------------
export function isInt(n) {
  return typeof n === "number" && Number.isInteger(n);
}

// ---- 검증: 차용증(§4.1, §6.1) ---------------------------------------
// 반환: { valid:boolean, errors:{[fieldPath]:msg}, warnings:string[] }
export function validateAgreement(ag) {
  const errors = {};
  const warnings = [];
  if (!ag || typeof ag !== "object") {
    return { valid: false, errors: { _: "차용증 데이터가 없습니다." }, warnings };
  }

  // 당사자 필수
  if (!ag.creditor || !ag.creditor.name || !String(ag.creditor.name).trim()) {
    errors["creditor.name"] = "채권자 성명은 필수입니다.";
  }
  if (!ag.debtor || !ag.debtor.name || !String(ag.debtor.name).trim()) {
    errors["debtor.name"] = "채무자 성명은 필수입니다.";
  }

  // 원금
  if (!isInt(ag.principal)) {
    errors["principal"] = "원금은 정수(원)여야 합니다.";
  } else if (ag.principal < LIMITS.PRINCIPAL_MIN || ag.principal > LIMITS.PRINCIPAL_MAX) {
    errors["principal"] = "원금은 0 ~ 100,000,000,000원(1,000억) 범위여야 합니다.";
  }

  // 이율 (이자제한법 20% 상한 — 강제)
  if (typeof ag.interestRate !== "number" || Number.isNaN(ag.interestRate)) {
    errors["interestRate"] = "연이율을 숫자로 입력하세요.";
  } else if (ag.interestRate < LIMITS.RATE_MIN || ag.interestRate > LIMITS.RATE_MAX) {
    errors["interestRate"] = "연이율은 0 ~ 20% 범위여야 합니다(이자제한법 최고이자율 연 20%).";
  }

  // 지연손해금율(선택)
  if (ag.lateRate !== null && ag.lateRate !== undefined && ag.lateRate !== "") {
    if (typeof ag.lateRate !== "number" || Number.isNaN(ag.lateRate)) {
      errors["lateRate"] = "지연손해금율을 숫자로 입력하세요.";
    } else if (ag.lateRate < LIMITS.RATE_MIN || ag.lateRate > LIMITS.RATE_MAX) {
      errors["lateRate"] = "지연손해금율도 0 ~ 20% 상한이 적용됩니다.";
    }
  }

  // enum
  if (!ENUM_VALUES.interestKind.includes(ag.interestKind)) {
    errors["interestKind"] = "이자 계산방식이 올바르지 않습니다.";
  }
  if (!ENUM_VALUES.repaymentMethod.includes(ag.repaymentMethod)) {
    errors["repaymentMethod"] = "상환방법이 올바르지 않습니다.";
  }
  if (!ENUM_VALUES.paymentMethod.includes(ag.paymentMethod)) {
    errors["paymentMethod"] = "지급방법이 올바르지 않습니다.";
  }

  // 날짜
  if (!isValidDate(ag.loanDate)) errors["loanDate"] = "차용일(YYYY-MM-DD)을 입력하세요.";
  if (!isValidDate(ag.contractDate)) errors["contractDate"] = "작성일(YYYY-MM-DD)을 입력하세요.";
  if (ag.maturityDate) {
    if (!isValidDate(ag.maturityDate)) {
      errors["maturityDate"] = "변제기일 형식이 올바르지 않습니다(YYYY-MM-DD).";
    } else if (isValidDate(ag.loanDate) && ag.maturityDate < ag.loanDate) {
      errors["maturityDate"] = "변제기일은 차용일 이후여야 합니다.";
    }
  }

  // 상환기간(개월)
  if (ag.repaymentPeriodMonths !== null && ag.repaymentPeriodMonths !== undefined && ag.repaymentPeriodMonths !== "") {
    if (!isInt(ag.repaymentPeriodMonths) || ag.repaymentPeriodMonths < 1) {
      errors["repaymentPeriodMonths"] = "상환기간(개월)은 1 이상의 정수여야 합니다.";
    }
  }

  // 분할상환(annuity/equalPrincipal)은 기간 정보가 필요
  if ((ag.repaymentMethod === "annuity" || ag.repaymentMethod === "equalPrincipal" || ag.repaymentMethod === "lump")) {
    const hasTerm = (isInt(ag.repaymentPeriodMonths) && ag.repaymentPeriodMonths >= 1) ||
      (isValidDate(ag.loanDate) && isValidDate(ag.maturityDate));
    if (!hasTerm) {
      warnings.push("선택한 상환방법은 상환기간(개월) 또는 변제기일이 있어야 스케줄을 만들 수 있습니다.");
    }
  }

  // ---- 안내성 경고(§6.2) — 저장은 막지 않음 ----
  const term = (isInt(ag.repaymentPeriodMonths) && ag.repaymentPeriodMonths) ||
    derivePeriodFromMaturity(ag.loanDate, ag.maturityDate);
  if (term && term > LIMITS.TERM_LONG_WARN_MONTHS) {
    warnings.push("상환기간이 30년(360개월)을 초과합니다. 지나치게 긴 기간은 사실상 증여로 볼 위험이 있습니다.");
  }
  if (ag.paymentMethod === "transfer" && (!ag.creditor || !ag.creditor.account)) {
    warnings.push("지급방법이 계좌이체입니다. 채권자 입금계좌를 입력하면 차용증에 명시됩니다.");
  }
  if (ag.interestKind !== "none" && ag.interestRate === 0) {
    warnings.push("이자방식이 '무이자'가 아닌데 연이율이 0%입니다. 무이자라면 이자방식을 '무이자'로 두는 것을 권장합니다.");
  }

  return { valid: Object.keys(errors).length === 0, errors, warnings };
}

// ---- 검증: 상환 원장(§4.2) ------------------------------------------
export function validatePayment(p) {
  const errors = {};
  if (!p || typeof p !== "object") return { valid: false, errors: { _: "상환 데이터가 없습니다." } };
  if (!isValidDate(p.date)) errors["date"] = "상환일(YYYY-MM-DD)을 입력하세요.";
  if (!isInt(p.amount) || p.amount <= 0) errors["amount"] = "상환액은 0보다 큰 정수(원)여야 합니다.";
  return { valid: Object.keys(errors).length === 0, errors };
}

// ---- 검증: 백업 JSON(가져오기, §4.3) --------------------------------
export function validateBackup(obj) {
  const errors = [];
  if (!obj || typeof obj !== "object") return { valid: false, errors: ["JSON 객체가 아닙니다."] };
  if (!("schemaVersion" in obj)) errors.push("schemaVersion이 없습니다.");
  if (!Array.isArray(obj.agreements)) {
    errors.push("agreements 배열이 없습니다.");
  } else {
    obj.agreements.forEach((a, i) => {
      if (!a || typeof a !== "object") { errors.push(`agreements[${i}]가 객체가 아닙니다.`); return; }
      if (!("principal" in a)) errors.push(`agreements[${i}].principal 누락`);
      if (a.payments && !Array.isArray(a.payments)) errors.push(`agreements[${i}].payments가 배열이 아닙니다.`);
    });
  }
  return { valid: errors.length === 0, errors };
}

// 가져온 차용증을 현재 스키마로 정규화(누락 필드 보강).
export function normalizeAgreement(a) {
  const base = newAgreement();
  const merged = {
    ...base,
    ...a,
    creditor: { ...base.creditor, ...(a.creditor || {}) },
    debtor: { ...base.debtor, ...(a.debtor || {}) },
    payments: Array.isArray(a.payments) ? a.payments.map(p => ({ ...newPayment(), ...p })) : [],
  };
  merged.schemaVersion = SCHEMA_VERSION;
  if (!merged.id) merged.id = genId();
  return merged;
}

// ---- 법률 안내 텍스트(§6.2) — 화면 도움말/툴팁용. 자문 아님 ----------
export const LEGAL_INFO = Object.freeze({
  title: "가족 간 차용 안내 (정보 제공 · 자문 아님)",
  asOf: "2026-06-14",
  items: [
    "최고이자율은 연 20%입니다(이자제한법). 약정이율이 없으면 민법상 법정이율 연 5%가 적용됩니다.",
    "국세청 적정이자율은 연 4.6%입니다. 무상·저리 대출의 이익(적정이자−실제이자)이 연 1,000만 원 이하면 증여세 비과세 → 환산하면 약 2억 1,700만 원 이하는 무이자 차용이 가능합니다.",
    "한도 내라도 원금을 실제로 상환해야 '대여'로 인정됩니다. 차용증만 쓰고 상환이 없으면 증여로 의제될 수 있습니다.",
    "직계존속 증여재산공제: 성인 자녀 5,000만 원(미성년 2,000만 원), 혼인·출산 시 1억 원 추가.",
    "작성일 입증을 위해 공증 또는 등기소 확정일자를 권장합니다. 원금·이자는 계좌이체로 주고받아 이체내역을 남기는 것이 안전합니다.",
    "상환기간이 지나치게 길면(예: 30년) 사실상 증여로 볼 위험이 있습니다. 합리적 기간 설정을 권장합니다.",
  ],
});

export const DISCLAIMER = "이 앱과 문서는 세무·법률 자문이 아니며, 일반 정보 제공·계산 보조 도구입니다. 차용증의 법적 효력, 증여세·이자소득 과세 여부 등은 세무사·변호사 등 전문가와 개별 상담이 필요합니다. 세제·이자율 수치(적정이자율 4.6%, 무이자 한도 약 2.17억, 최고이자율 20% 등)는 작성 기준일(2026-06-14) 시점이며 법령·고시 개정으로 달라질 수 있습니다. 데이터는 기기 내 로컬에만 저장됩니다.";
