// =====================================================================
// app.js — 통합 SPA 셸 (frontend-ui)
//
// spec §5.3 / §7 / §8 / §10 구현.
//   - 화면 4개(차용증 입력 / 상환 원장 / 대시보드 / 차용증 출력)
//   - 여러 차용증 관리, localStorage 저장/복원, JSON 내보내기/가져오기
//   - 실시간 갱신: 상환 추가·삭제 시 원장·대시보드 즉시 재계산
//
// 모든 사용자 입력은 textContent/속성으로 안전 렌더(innerHTML로 직접 삽입 금지).
// 문서 출력만 agreement-view.renderAgreementHTML(이스케이프 처리됨)을 사용.
// 네트워크/외부 리소스 사용 금지.
// =====================================================================

import {
  remainingPrincipal,
  formatContractAmount,
  scheduleForAgreement,
  suggestMonthlyByMaturityForAgreement,
  projectPayoffByMonthlyForAgreement,
  ymOf,
  addMonths,
} from './calc.js';

import {
  INTEREST_KINDS,
  REPAYMENT_METHODS,
  PAYMENT_METHODS,
  labelOf,
  maskIdNumber,
  newAgreement,
  newPayment,
  deriveMaturityFromPeriod,
  derivePeriodFromMaturity,
  validateAgreement,
  validatePayment,
  DISCLAIMER,
} from './model.js';

import {
  loadAgreements,
  saveAgreements,
  exportToFile,
  importFromFile,
} from './storage.js';

import { renderAgreementHTML } from './agreement-view.js';

// ---------------------------------------------------------------------
// 앱 상태
// ---------------------------------------------------------------------
const state = {
  agreements: [],
  currentId: null,
  screen: 'edit',
  dashboardMode: 'maturity', // 'maturity' | 'monthly'
  editingPaymentId: null,    // 상환 원장에서 수정 중인 항목 id (null이면 추가 모드)
};

// ---------------------------------------------------------------------
// DOM 헬퍼
// ---------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function fmtWon(n) {
  return (Number.isInteger(n) ? n : Math.round(n || 0)).toLocaleString('en-US');
}

function setText(el, text) {
  if (el) el.textContent = text == null ? '' : String(text);
}

// dl(summary-grid)에 라벨/값 행을 안전하게 채운다. rows: [[label, value, className?]]
function renderSummary(container, items) {
  container.textContent = '';
  for (const [label, value, cls] of items) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    if (cls) dd.className = cls;
    container.append(dt, dd);
  }
}

function showGlobalMessage(text, kind /* 'ok' | 'error' */) {
  const el = $('global-message');
  el.textContent = text;
  el.className = 'global-message ' + (kind === 'error' ? 'is-error' : 'is-ok');
  el.hidden = false;
}
function clearGlobalMessage() {
  const el = $('global-message');
  el.hidden = true;
  el.textContent = '';
}

// ---------------------------------------------------------------------
// 현재 차용증 접근
// ---------------------------------------------------------------------
function currentAgreement() {
  return state.agreements.find((a) => a.id === state.currentId) || null;
}

function persist() {
  saveAgreements(state.agreements);
}

// ---------------------------------------------------------------------
// 초기 시드 (최초 실행 시 1건)
// ---------------------------------------------------------------------
function buildSeed() {
  const ag = newAgreement({
    creditor: { name: '홍부친', account: '00은행 000-00-000000' },
    debtor: { name: '홍자녀' },
    principal: 3870000,
    interestRate: 3.5,
    interestKind: 'simple',
    loanDate: '2026-03-31',
    contractDate: '2026-03-31',
    maturityDate: '2026-12-31',
    repaymentMethod: 'free',
    paymentMethod: 'transfer',
    note: '예시 데이터 — 387만 원 차용 사례(연 3.5% 단리, 자유상환).',
  });
  ag.payments = [
    newPayment({ date: '2026-04-30', amount: 600000 }),
    newPayment({ date: '2026-05-30', amount: 200000 }),
    newPayment({ date: '2026-06-30', amount: 200000 }),
  ];
  return ag;
}

// ---------------------------------------------------------------------
// enum select 채우기
// ---------------------------------------------------------------------
function fillSelect(selectEl, options) {
  selectEl.textContent = '';
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    selectEl.appendChild(opt);
  }
}

// ---------------------------------------------------------------------
// 차용증 드롭다운
// ---------------------------------------------------------------------
function renderAgreementSelect() {
  const sel = $('select-agreement');
  sel.textContent = '';
  for (const a of state.agreements) {
    const opt = document.createElement('option');
    opt.value = a.id;
    const who = a.debtor && a.debtor.name ? a.debtor.name : '(채무자 미입력)';
    opt.textContent = `${who} · ${fmtWon(a.principal)}원`;
    sel.appendChild(opt);
  }
  if (state.currentId) sel.value = state.currentId;
}

// =====================================================================
// 화면 ① 차용증 입력/편집
// =====================================================================
function fillAgreementForm(ag) {
  $('creditor-name').value = ag.creditor.name || '';
  $('creditor-idNumber').value = ag.creditor.idNumber || '';
  $('creditor-address').value = ag.creditor.address || '';
  $('creditor-phone').value = ag.creditor.phone || '';
  $('creditor-account').value = ag.creditor.account || '';

  $('debtor-name').value = ag.debtor.name || '';
  $('debtor-idNumber').value = ag.debtor.idNumber || '';
  $('debtor-address').value = ag.debtor.address || '';
  $('debtor-phone').value = ag.debtor.phone || '';

  $('principal').value = ag.principal === 0 ? '0' : (ag.principal || '');
  $('interestKind').value = ag.interestKind || 'none';
  $('interestRate').value = ag.interestRate === 0 ? '0' : (ag.interestRate ?? '');
  $('lateRate').value = (ag.lateRate === null || ag.lateRate === undefined) ? '' : ag.lateRate;
  $('loanDate').value = ag.loanDate || '';
  $('contractDate').value = ag.contractDate || '';

  $('repaymentMethod').value = ag.repaymentMethod || 'free';
  $('maturityDate').value = ag.maturityDate || '';
  $('repaymentPeriodMonths').value =
    (ag.repaymentPeriodMonths === null || ag.repaymentPeriodMonths === undefined) ? '' : ag.repaymentPeriodMonths;

  $('paymentMethod').value = ag.paymentMethod || 'transfer';
  $('note').value = ag.note || '';

  // 마스킹 상태 초기화(가린 상태로)
  resetMaskState('creditor-idNumber');
  resetMaskState('debtor-idNumber');

  updatePrincipalKorean();
  clearAgreementErrors();
}

// 폼 → agreement 객체(부분 적용). 현재 차용증을 기준으로 갱신.
function readAgreementForm() {
  const ag = currentAgreement();
  if (!ag) return null;

  const num = (v) => {
    const s = String(v).trim();
    if (s === '') return null;
    const n = Number(s);
    return Number.isNaN(n) ? null : n;
  };
  const intOrNull = (v) => {
    const n = num(v);
    return n === null ? null : Math.trunc(n);
  };

  ag.creditor.name = $('creditor-name').value.trim();
  ag.creditor.idNumber = getRawIdValue('creditor-idNumber');
  ag.creditor.address = $('creditor-address').value.trim();
  ag.creditor.phone = $('creditor-phone').value.trim();
  ag.creditor.account = $('creditor-account').value.trim();

  ag.debtor.name = $('debtor-name').value.trim();
  ag.debtor.idNumber = getRawIdValue('debtor-idNumber');
  ag.debtor.address = $('debtor-address').value.trim();
  ag.debtor.phone = $('debtor-phone').value.trim();

  ag.principal = intOrNull($('principal').value) ?? 0;
  ag.interestKind = $('interestKind').value;
  ag.interestRate = num($('interestRate').value) ?? 0;
  ag.lateRate = num($('lateRate').value); // null 허용
  ag.loanDate = $('loanDate').value;
  ag.contractDate = $('contractDate').value;

  ag.repaymentMethod = $('repaymentMethod').value;
  ag.maturityDate = $('maturityDate').value;
  ag.repaymentPeriodMonths = intOrNull($('repaymentPeriodMonths').value);

  ag.paymentMethod = $('paymentMethod').value;
  ag.note = $('note').value;
  return ag;
}

function updatePrincipalKorean() {
  const raw = String($('principal').value).trim();
  const out = $('principal-korean');
  if (raw === '') { setText(out, ''); return; }
  const n = Math.trunc(Number(raw));
  if (Number.isNaN(n) || n < 0 || n > 100000000000) {
    setText(out, '금액 범위(0~100,000,000,000원)를 벗어났습니다.');
    return;
  }
  try {
    setText(out, formatContractAmount(n));
  } catch {
    setText(out, '');
  }
}

function clearAgreementErrors() {
  $$('.field-error', $('form-agreement')).forEach((el) => { el.textContent = ''; });
  $$('.is-invalid', $('form-agreement')).forEach((el) => el.classList.remove('is-invalid'));
}

// fieldPath(예: 'creditor.name') → 에러 요소 / 입력 요소 매핑
const FIELD_INPUT_ID = {
  'creditor.name': 'creditor-name',
  'debtor.name': 'debtor-name',
  'principal': 'principal',
  'interestRate': 'interestRate',
  'lateRate': 'lateRate',
  'interestKind': 'interestKind',
  'repaymentMethod': 'repaymentMethod',
  'paymentMethod': 'paymentMethod',
  'loanDate': 'loanDate',
  'contractDate': 'contractDate',
  'maturityDate': 'maturityDate',
  'repaymentPeriodMonths': 'repaymentPeriodMonths',
};

function showAgreementErrors(errors) {
  clearAgreementErrors();
  for (const [path, msg] of Object.entries(errors)) {
    const errEl = $('err-' + path);
    if (errEl) errEl.textContent = msg;
    const inputId = FIELD_INPUT_ID[path];
    if (inputId && $(inputId)) $(inputId).classList.add('is-invalid');
  }
}

function showAgreementWarnings(warnings) {
  const box = $('agreement-warnings');
  if (!warnings || warnings.length === 0) {
    box.hidden = true;
    box.textContent = '';
    return;
  }
  box.textContent = '';
  const ul = document.createElement('ul');
  for (const w of warnings) {
    const li = document.createElement('li');
    li.textContent = w;
    ul.appendChild(li);
  }
  box.appendChild(ul);
  box.hidden = false;
}

// 실시간 이율 검증(20% 초과 즉시 경고)
function liveRateCheck(inputId, errId, label) {
  const raw = String($(inputId).value).trim();
  const errEl = $(errId);
  $(inputId).classList.remove('is-invalid');
  if (errEl) errEl.textContent = '';
  if (raw === '') return;
  const n = Number(raw);
  if (Number.isNaN(n)) {
    if (errEl) errEl.textContent = `${label}을 숫자로 입력하세요.`;
    $(inputId).classList.add('is-invalid');
  } else if (n > 20) {
    if (errEl) errEl.textContent = `${label}은 연 20%를 초과할 수 없습니다(이자제한법). 저장이 차단됩니다.`;
    $(inputId).classList.add('is-invalid');
  } else if (n < 0) {
    if (errEl) errEl.textContent = `${label}은 0% 이상이어야 합니다.`;
    $(inputId).classList.add('is-invalid');
  }
}

// 만기 ↔ 상환기간 자동 연동 (loanDate 기준)
function syncMaturityFromPeriod() {
  const loanDate = $('loanDate').value;
  const months = parseInt($('repaymentPeriodMonths').value, 10);
  if (!loanDate || !Number.isInteger(months) || months < 1) return;
  const maturity = deriveMaturityFromPeriod(loanDate, months);
  if (maturity) $('maturityDate').value = maturity;
}
function syncPeriodFromMaturity() {
  const loanDate = $('loanDate').value;
  const maturity = $('maturityDate').value;
  if (!loanDate || !maturity) return;
  const months = derivePeriodFromMaturity(loanDate, maturity);
  if (months !== null) $('repaymentPeriodMonths').value = months;
}

// ----- 주민번호 마스킹 토글 -----
// 입력칸은 평소 마스킹 표시. 원문은 dataset.raw에 보관.
function getRawIdValue(inputId) {
  const el = $(inputId);
  if (el.dataset.masked === 'true') return el.dataset.raw || '';
  return el.value.trim();
}
function resetMaskState(inputId) {
  const el = $(inputId);
  const raw = el.value.trim();
  el.dataset.raw = raw;
  el.dataset.masked = 'true';
  el.value = raw ? maskIdNumber(raw) : '';
  el.readOnly = !!raw; // 가린 상태에서는 편집 막음(보기로 전환해야 수정)
  syncMaskButton(inputId);
}
function syncMaskButton(inputId) {
  const btn = document.querySelector(`.btn-mask-toggle[data-target="${inputId}"]`);
  if (!btn) return;
  const el = $(inputId);
  btn.textContent = el.dataset.masked === 'true' ? '보기' : '가리기';
}
function toggleMask(inputId) {
  const el = $(inputId);
  if (el.dataset.masked === 'true') {
    // 보기로 전환: 원문 노출 + 편집 허용
    el.value = el.dataset.raw || '';
    el.dataset.masked = 'false';
    el.readOnly = false;
  } else {
    // 가리기로 전환: 현재 입력을 원문으로 저장 후 마스킹
    const raw = el.value.trim();
    el.dataset.raw = raw;
    el.dataset.masked = 'true';
    el.value = raw ? maskIdNumber(raw) : '';
    el.readOnly = !!raw;
  }
  syncMaskButton(inputId);
}

// =====================================================================
// 화면 ② 상환 원장
// =====================================================================
function sortedPayments(ag) {
  return (ag.payments || []).slice().sort((a, b) =>
    (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// 유효 상환(금액>0·날짜有)을 날짜순 정렬하고, calc 엔진의 회차별 분해(rows)를
// 같은 순서로 1:1 매핑해 반환한다. 원장 표·CSV가 동일한 계산 결과를 공유한다.
function ledgerRows(ag) {
  const bal = remainingPrincipal(ag);
  const valid = (ag.payments || [])
    .filter((p) => p && p.amount > 0 && p.date)
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { bal, items: valid.map((p, i) => ({ p, r: bal.rows[i] || null })) };
}

function renderLedger() {
  const ag = currentAgreement();
  const tbody = $('payment-tbody');
  tbody.textContent = '';
  if (!ag) { $('payment-empty').hidden = false; return; }

  const list = sortedPayments(ag);
  $('payment-empty').hidden = list.length > 0;

  // 회차별 분해(이자/원금충당/잔액)를 상환 id로 조회할 수 있게 매핑.
  const { bal, items } = ledgerRows(ag);
  const rowFor = new Map(items.map(({ p, r }) => [p.id, r]));

  for (const p of list) {
    const tr = document.createElement('tr');
    if (p.id === state.editingPaymentId) tr.classList.add('is-editing');
    const r = rowFor.get(p.id) || null;

    const tdDate = document.createElement('td');
    tdDate.textContent = p.date || '';
    const tdAmount = document.createElement('td');
    tdAmount.className = 'num';
    tdAmount.textContent = fmtWon(p.amount);
    const tdInterest = document.createElement('td');
    tdInterest.className = 'num';
    tdInterest.textContent = r ? fmtWon(r.interest) : '—';
    const tdPrincipal = document.createElement('td');
    tdPrincipal.className = 'num';
    tdPrincipal.textContent = r ? fmtWon(r.principalPaid) : '—';
    const tdBalance = document.createElement('td');
    tdBalance.className = 'num';
    tdBalance.textContent = r ? fmtWon(r.balance) : '—';
    const tdNote = document.createElement('td');
    tdNote.className = 'note-cell';
    tdNote.textContent = p.note || '';
    const tdAct = document.createElement('td');
    tdAct.className = 'action-cell';
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'btn btn-small';
    edit.textContent = '수정';
    edit.addEventListener('click', () => startEditPayment(p.id));
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn btn-small btn-danger-outline';
    del.textContent = '삭제';
    del.addEventListener('click', () => deletePayment(p.id));
    tdAct.append(edit, del);

    tr.append(tdDate, tdAmount, tdInterest, tdPrincipal, tdBalance, tdNote, tdAct);
    tbody.appendChild(tr);
  }

  // 합계
  const total = list.reduce((s, p) => s + (p.amount || 0), 0);
  renderSummary($('ledger-summary'), [
    ['총 상환액', fmtWon(total) + '원'],
    ['납부 이자 합계', fmtWon(bal.accruedInterest) + '원'],
    ['현재 잔여 원금', fmtWon(bal.principal) + '원'],
    ...(bal.overpaid > 0 ? [['과납액', fmtWon(bal.overpaid) + '원', 'is-warn']] : []),
  ]);
}

function deletePayment(paymentId) {
  const ag = currentAgreement();
  if (!ag) return;
  const p = (ag.payments || []).find((x) => x.id === paymentId);
  const label = p ? `${p.date} · ${fmtWon(p.amount)}원` : '이 상환 내역';
  if (!window.confirm(`${label} 을(를) 삭제할까요?`)) return;
  ag.payments = (ag.payments || []).filter((x) => x.id !== paymentId);
  if (state.editingPaymentId === paymentId) exitPaymentEditMode(false);
  persist();
  refreshLiveScreens(); // 원장 + 대시보드 즉시 재계산
}

// 수정 모드 진입: 선택한 상환을 폼에 채우고 버튼/타이틀을 수정용으로 전환.
function startEditPayment(paymentId) {
  const ag = currentAgreement();
  if (!ag) return;
  const p = (ag.payments || []).find((x) => x.id === paymentId);
  if (!p) return;
  state.editingPaymentId = paymentId;
  clearPaymentErrors();
  $('payment-date').value = p.date || '';
  $('payment-amount').value = (p.amount || p.amount === 0) ? p.amount : '';
  $('payment-note').value = p.note || '';
  setText($('payment-form-title'), '상환 수정');
  setText($('btn-add-payment'), '수정 저장');
  $('btn-cancel-edit-payment').hidden = false;
  renderLedger();         // 편집 중인 행 강조
  $('form-payment').scrollIntoView({ block: 'start' });
  $('payment-date').focus();
}

// 수정 모드 해제 + 폼 초기화. render=true면 원장 다시 그림.
function exitPaymentEditMode(render = true) {
  state.editingPaymentId = null;
  $('payment-date').value = '';
  $('payment-amount').value = '';
  $('payment-note').value = '';
  clearPaymentErrors();
  setText($('payment-form-title'), '상환 추가');
  setText($('btn-add-payment'), '상환 추가');
  $('btn-cancel-edit-payment').hidden = true;
  if (render) renderLedger();
}

function clearPaymentErrors() {
  setText($('err-payment.date'), '');
  setText($('err-payment.amount'), '');
  $('payment-date').classList.remove('is-invalid');
  $('payment-amount').classList.remove('is-invalid');
}

function handleAddPayment(e) {
  e.preventDefault();
  const ag = currentAgreement();
  if (!ag) return;
  clearPaymentErrors();

  const amountRaw = String($('payment-amount').value).trim();
  const data = {
    date: $('payment-date').value,
    amount: amountRaw === '' ? NaN : Math.trunc(Number(amountRaw)),
    note: $('payment-note').value.trim(),
  };

  const { valid, errors } = validatePayment(data);
  if (!valid) {
    if (errors.date) { setText($('err-payment.date'), errors.date); $('payment-date').classList.add('is-invalid'); }
    if (errors.amount) { setText($('err-payment.amount'), errors.amount); $('payment-amount').classList.add('is-invalid'); }
    return;
  }

  ag.payments = ag.payments || [];
  if (state.editingPaymentId) {
    // 수정: 기존 항목 갱신
    const target = ag.payments.find((x) => x.id === state.editingPaymentId);
    if (target) { target.date = data.date; target.amount = data.amount; target.note = data.note; }
    exitPaymentEditMode(false); // 폼/라벨 리셋 (renderLedger는 아래 refresh가 처리)
  } else {
    // 추가
    ag.payments.push(newPayment(data));
    // 폼 리셋(날짜는 반복 입력 편의상 유지 → 금액/메모만 비움)
    $('payment-amount').value = '';
    $('payment-note').value = '';
  }
  persist();
  refreshLiveScreens();
}

// ----- 상환 내역 CSV 내보내기 -----
// CSV 한 칸 이스케이프(콤마·따옴표·줄바꿈 포함 시 따옴표로 감싸고 "는 "" 처리).
function csvField(v) {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function buildLedgerCSV(ag) {
  const { items } = ledgerRows(ag);
  const header = ['상환일', '상환액', '이자', '원금충당', '잔액', '메모'];
  const lines = [header.map(csvField).join(',')];
  for (const { p, r } of items) {
    lines.push([
      p.date,
      p.amount,
      r ? r.interest : '',
      r ? r.principalPaid : '',
      r ? r.balance : '',
      p.note || '',
    ].map(csvField).join(','));
  }
  return lines.join('\r\n');
}

function csvStamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function handleExportLedgerCSV() {
  const ag = currentAgreement();
  if (!ag) return;
  const hasRows = (ag.payments || []).some((p) => p && p.amount > 0 && p.date);
  if (!hasRows) {
    showGlobalMessage('내보낼 상환 내역이 없습니다.', 'error');
    return;
  }
  // 엑셀에서 한글이 깨지지 않도록 UTF-8 BOM을 앞에 붙인다.
  const blob = new Blob(['\uFEFF' + buildLedgerCSV(ag)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const who = ((ag.debtor && ag.debtor.name) ? ag.debtor.name : 'unknown')
    .replace(/[\\/:*?"<>|\s]+/g, '_');
  const a = document.createElement('a');
  a.href = url;
  a.download = `loan-payments-${who}-${csvStamp()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
  showGlobalMessage('상환 내역 CSV를 내보냈습니다.', 'ok');
}

// =====================================================================
// 화면 ③ 상환 대시보드
// =====================================================================
function defaultStartMonth(ag) {
  const list = sortedPayments(ag);
  if (list.length > 0) {
    return addMonths(ymOf(list[list.length - 1].date), 1);
  }
  if (ag.loanDate) return addMonths(ymOf(ag.loanDate), 1);
  return ymOf(new Date().toISOString());
}

function getStartMonth(ag) {
  const v = $('dashboard-start-month').value;
  return v && /^\d{4}-\d{2}$/.test(v) ? v : defaultStartMonth(ag);
}

function renderDashboard() {
  const ag = currentAgreement();
  if (!ag) return;

  // 시작월 기본값 채우기(비어 있으면)
  if (!$('dashboard-start-month').value) {
    $('dashboard-start-month').value = defaultStartMonth(ag);
  }

  const bal = remainingPrincipal(ag);

  // 현재 잔액 요약
  renderSummary($('dashboard-balance'), [
    ['현재 잔여 원금', fmtWon(bal.principal) + '원'],
    ['납부 이자 합계', fmtWon(bal.accruedInterest) + '원'],
    ...(bal.overpaid > 0 ? [['과납액', fmtWon(bal.overpaid) + '원', 'is-warn']] : []),
  ]);

  // 진행률 = (원금 - 현재잔액) / 원금
  const principal = ag.principal || 0;
  const repaidPrincipal = Math.max(0, principal - bal.principal);
  const pct = principal > 0 ? Math.min(100, Math.round((repaidPrincipal / principal) * 1000) / 10) : 0;
  $('progress-bar').style.width = pct + '%';
  setText($('progress-label'),
    `원금 상환 진행률 ${pct}% (${fmtWon(repaidPrincipal)} / ${fmtWon(principal)}원)`);

  // 모드 토글 UI 동기화
  $('mode-maturity').classList.toggle('is-active', state.dashboardMode === 'maturity');
  $('mode-monthly').classList.toggle('is-active', state.dashboardMode === 'monthly');
  $('panel-maturity').hidden = state.dashboardMode !== 'maturity';
  $('panel-monthly').hidden = state.dashboardMode !== 'monthly';

  const startMonth = getStartMonth(ag);

  if (state.dashboardMode === 'maturity') {
    renderMaturityMode(ag, startMonth);
  } else {
    renderMonthlyMode(ag, startMonth);
  }

  renderSchedule(ag);
}

function renderMaturityMode(ag, startMonth) {
  const out = $('maturity-result');
  if (!ag.maturityDate) {
    renderSummary(out, [['안내', '변제기일(만기)을 입력하면 권장 월액이 계산됩니다.', 'is-warn']]);
    return;
  }
  const res = suggestMonthlyByMaturityForAgreement(ag, startMonth);
  if (!res) {
    renderSummary(out, [['안내', '변제기일을 확인하세요.', 'is-warn']]);
    return;
  }
  const payoff = addMonths(startMonth, Math.max(0, res.monthsLeft - 1));
  renderSummary(out, [
    ['시작월', startMonth],
    ['만기월', ymOf(ag.maturityDate)],
    ['남은 회차', res.monthsLeft + '회'],
    ['권장 월 상환액', fmtWon(res.monthly) + '원'],
    ['예상 완납월', payoff],
  ]);
}

function renderMonthlyMode(ag, startMonth) {
  const out = $('monthly-result');
  const raw = String($('dashboard-monthly').value).trim();
  if (raw === '') {
    renderSummary(out, [['안내', '계획 월액을 입력하면 예상 완납일이 계산됩니다.', 'is-warn']]);
    return;
  }
  const monthly = Math.trunc(Number(raw));
  if (Number.isNaN(monthly) || monthly <= 0) {
    renderSummary(out, [['안내', '계획 월액은 0보다 큰 정수여야 합니다.', 'is-danger']]);
    return;
  }
  const res = projectPayoffByMonthlyForAgreement(ag, startMonth, monthly);
  if (res.warning || !Number.isFinite(res.rounds)) {
    renderSummary(out, [
      ['시작월', startMonth],
      ['계획 월액', fmtWon(monthly) + '원'],
      ['상환 가능 여부', '상환 불가 (월 이자 이하 — 원금 미감소)', 'is-danger'],
    ]);
    return;
  }
  renderSummary(out, [
    ['시작월', startMonth],
    ['계획 월액', fmtWon(monthly) + '원'],
    ['남은 회차', res.rounds + '회'],
    ['예상 완납월', res.payoffMonth],
    ['마지막 납입액', fmtWon(res.lastPayment) + '원'],
  ]);
}

function renderSchedule(ag) {
  const card = $('schedule-card');
  const tbody = $('schedule-tbody');
  tbody.textContent = '';
  const sched = scheduleForAgreement(ag);
  if (!sched || !sched.rows || sched.rows.length === 0) {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  for (const r of sched.rows) {
    const tr = document.createElement('tr');
    const cells = [
      String(r.k),
      fmtWon(r.payment),
      fmtWon(r.interest),
      fmtWon(r.principalPart),
      fmtWon(r.balance),
    ];
    cells.forEach((val, i) => {
      const td = document.createElement('td');
      if (i > 0) td.className = 'num';
      td.textContent = val;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
}

// =====================================================================
// 화면 ④ 차용증 출력
// =====================================================================
function renderPreview() {
  const ag = currentAgreement();
  if (!ag) return;
  const html = renderAgreementHTML(ag);
  // agreement-view는 모든 사용자 입력을 자체 escapeHtml로 처리한다.
  $('print-preview-wrap').innerHTML = html;
  $('print-doc').innerHTML = html;
}

function doPrint() {
  const ag = currentAgreement();
  if (!ag) return;
  // 인쇄 직전 항상 최신 문서를 #print-doc에 주입
  $('print-doc').innerHTML = renderAgreementHTML(ag);
  window.print();
}

// =====================================================================
// 실시간 갱신: 원장 + 대시보드 동시 재계산
// =====================================================================
function refreshLiveScreens() {
  renderAgreementSelect();
  renderLedger();
  renderDashboard();
}

// =====================================================================
// 화면 전환
// =====================================================================
function switchScreen(screen) {
  state.screen = screen;
  $$('.tab-btn').forEach((btn) => {
    const active = btn.dataset.screen === screen;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  $$('.screen').forEach((sec) => {
    const active = sec.id === 'screen-' + screen;
    sec.classList.toggle('is-active', active);
    sec.hidden = !active;
  });
  // 진입 시 해당 화면 갱신
  if (screen === 'ledger') renderLedger();
  if (screen === 'dashboard') renderDashboard();
}

// =====================================================================
// 차용증 선택 / 생성 / 삭제
// =====================================================================
function selectAgreement(id) {
  state.currentId = id;
  if (state.editingPaymentId) exitPaymentEditMode(false); // 차용증 전환 시 수정 모드 해제
  const ag = currentAgreement();
  if (ag) {
    fillAgreementForm(ag);
    // 대시보드 입력 초기화(차용증마다 시작월 재산정)
    $('dashboard-start-month').value = '';
    $('dashboard-monthly').value = '';
    $('print-preview-wrap').innerHTML = '';
  }
  renderAgreementSelect();
  refreshLiveScreens();
}

function createAgreement() {
  const ag = newAgreement();
  state.agreements.push(ag);
  state.currentId = ag.id;
  persist();
  selectAgreement(ag.id);
  switchScreen('edit');
  showGlobalMessage('새 차용증을 만들었습니다. 정보를 입력하고 저장하세요.', 'ok');
}

function deleteCurrentAgreement() {
  const ag = currentAgreement();
  if (!ag) return;
  const who = ag.debtor && ag.debtor.name ? ag.debtor.name : '(채무자 미입력)';
  if (!window.confirm(`'${who} · ${fmtWon(ag.principal)}원' 차용증을 삭제할까요? 되돌릴 수 없습니다.`)) return;
  state.agreements = state.agreements.filter((a) => a.id !== ag.id);
  if (state.agreements.length === 0) {
    state.agreements.push(newAgreement());
  }
  state.currentId = state.agreements[0].id;
  persist();
  selectAgreement(state.currentId);
  showGlobalMessage('차용증을 삭제했습니다.', 'ok');
}

// =====================================================================
// 저장(화면 ①)
// =====================================================================
function handleSaveAgreement(e) {
  e.preventDefault();
  const ag = readAgreementForm();
  if (!ag) return;

  const { valid, errors, warnings } = validateAgreement(ag);
  showAgreementWarnings(warnings);
  if (!valid) {
    showAgreementErrors(errors);
    showGlobalMessage('입력값에 오류가 있어 저장하지 못했습니다. 표시된 항목을 확인하세요.', 'error');
    return;
  }
  clearAgreementErrors();
  persist();
  renderAgreementSelect();
  refreshLiveScreens();
  showGlobalMessage('저장되었습니다.', 'ok');
}

// =====================================================================
// 내보내기 / 가져오기
// =====================================================================
function handleExport() {
  exportToFile(state.agreements);
  showGlobalMessage('백업 JSON 파일을 내보냈습니다.', 'ok');
}

async function handleImportFile(file) {
  const res = await importFromFile(file);
  if (!res.ok) {
    showGlobalMessage('가져오기 실패: ' + res.errors.join(' / '), 'error');
    return;
  }
  state.agreements = res.agreements;
  if (state.agreements.length === 0) {
    state.agreements.push(newAgreement());
  }
  state.currentId = state.agreements[0].id;
  persist();
  selectAgreement(state.currentId);
  switchScreen('edit');
  showGlobalMessage(`가져오기 성공: 차용증 ${res.agreements.length}건을 불러왔습니다.`, 'ok');
}

// =====================================================================
// 이벤트 바인딩
// =====================================================================
function bindEvents() {
  // 탭
  $$('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchScreen(btn.dataset.screen));
  });

  // 상단 액션
  $('btn-new').addEventListener('click', createAgreement);
  $('btn-delete-agreement').addEventListener('click', deleteCurrentAgreement);
  $('btn-export').addEventListener('click', handleExport);
  $('btn-import').addEventListener('click', () => $('file-import').click());
  $('file-import').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) handleImportFile(file);
    e.target.value = ''; // 같은 파일 재선택 허용
  });

  // 차용증 선택
  $('select-agreement').addEventListener('change', (e) => selectAgreement(e.target.value));

  // 화면 ① 폼
  $('form-agreement').addEventListener('submit', handleSaveAgreement);
  $('principal').addEventListener('input', updatePrincipalKorean);
  $('interestRate').addEventListener('input', () => liveRateCheck('interestRate', 'err-interestRate', '연이율'));
  $('lateRate').addEventListener('input', () => liveRateCheck('lateRate', 'err-lateRate', '지연손해금율'));
  $('repaymentPeriodMonths').addEventListener('change', syncMaturityFromPeriod);
  $('maturityDate').addEventListener('change', syncPeriodFromMaturity);
  $('loanDate').addEventListener('change', () => {
    // 차용일 변경 시 한쪽 정보로 재연동
    if ($('repaymentPeriodMonths').value) syncMaturityFromPeriod();
    else if ($('maturityDate').value) syncPeriodFromMaturity();
  });

  // 마스킹 토글
  $$('.btn-mask-toggle').forEach((btn) => {
    btn.addEventListener('click', () => toggleMask(btn.dataset.target));
  });

  // 화면 ② 상환
  $('form-payment').addEventListener('submit', handleAddPayment);
  $('btn-cancel-edit-payment').addEventListener('click', () => exitPaymentEditMode(true));
  $('btn-export-csv').addEventListener('click', handleExportLedgerCSV);

  // 화면 ③ 대시보드
  $('mode-maturity').addEventListener('click', () => { state.dashboardMode = 'maturity'; renderDashboard(); });
  $('mode-monthly').addEventListener('click', () => { state.dashboardMode = 'monthly'; renderDashboard(); });
  $('dashboard-start-month').addEventListener('change', renderDashboard);
  $('dashboard-monthly').addEventListener('input', () => {
    if (state.dashboardMode === 'monthly') renderMonthlyMode(currentAgreement(), getStartMonth(currentAgreement()));
  });

  // 화면 ④ 출력
  $('btn-preview').addEventListener('click', () => { renderPreview(); });
  $('btn-print').addEventListener('click', doPrint);
}

// =====================================================================
// 초기화
// =====================================================================
function init() {
  // enum select
  fillSelect($('interestKind'), INTEREST_KINDS);
  fillSelect($('repaymentMethod'), REPAYMENT_METHODS);
  fillSelect($('paymentMethod'), PAYMENT_METHODS);

  // 면책 문구
  setText($('disclaimer'), DISCLAIMER);

  // 데이터 로드 (없으면 시드)
  state.agreements = loadAgreements();
  if (!state.agreements || state.agreements.length === 0) {
    state.agreements = [buildSeed()];
    saveAgreements(state.agreements);
  }
  state.currentId = state.agreements[0].id;

  bindEvents();

  renderAgreementSelect();
  selectAgreement(state.currentId);
  switchScreen('edit');
}

// labelOf는 import 정합성 확인용으로 사용처가 적지만 향후 표기 확장에 대비해 보존.
void labelOf;

document.addEventListener('DOMContentLoaded', init);
