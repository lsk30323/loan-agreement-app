// =====================================================================
// storage.js — 로컬 저장 + 백업(내보내기/가져오기) 모듈 (spec §4.3, §7 공통)
//
// 로컬 우선(local-first): 모든 데이터는 localStorage에만 저장한다.
// ⚠ 네트워크 전송 금지 — fetch/XHR/외부 리소스 사용하지 않는다(개인·금융정보 보호).
//
// 저장 형식: localStorage[STORAGE_KEY] = JSON { schemaVersion, agreements:Agreement[] }
//   (과거에 배열만 저장된 경우도 관대하게 처리)
// =====================================================================

import { STORAGE_KEY, SCHEMA_VERSION, normalizeAgreement, validateBackup } from './model.js';

// 마지막 백업(전체 JSON 내보내기/가져오기) 시각(ms)을 저장하는 키.
const BACKUP_KEY = "loan-app:v1:lastBackupAt";

// ---- 내부 헬퍼 -------------------------------------------------------

// 오늘 날짜를 'YYYYMMDD' 문자열로(브라우저 런타임 기준).
function todayStamp() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

// 임의 값에서 Agreement 배열을 추출해 정규화.
// - { agreements:[...] } 래퍼 → agreements 사용
// - [...] 배열만 저장된 과거 형식 → 그대로 사용
function extractAgreements(parsed) {
  let arr;
  if (Array.isArray(parsed)) {
    arr = parsed;
  } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.agreements)) {
    arr = parsed.agreements;
  } else {
    return [];
  }
  return arr.map(normalizeAgreement);
}

// ---- 공개 API --------------------------------------------------------

// localStorage에서 차용증 배열을 읽어 정규화. 없거나 파싱 실패 시 [].
export function loadAgreements() {
  let raw;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  return extractAgreements(parsed);
}

// 차용증 배열을 { schemaVersion, agreements } 래퍼로 localStorage에 저장.
export function saveAgreements(agreements) {
  const list = Array.isArray(agreements) ? agreements : [];
  const payload = { schemaVersion: SCHEMA_VERSION, agreements: list };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* 저장 실패(용량 초과 등) — 호출측에서 별도 처리. */
  }
}

// 백업/내보내기용 객체 생성.
export function makeBackupObject(agreements) {
  const list = Array.isArray(agreements) ? agreements : [];
  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    agreements: list,
  };
}

// 백업 객체를 application/json Blob으로 만들어 다운로드(파일명: loan-backup-YYYYMMDD.json).
export function exportToFile(agreements) {
  const obj = makeBackupObject(agreements);
  const json = JSON.stringify(obj, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `loan-backup-${todayStamp()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 다음 틱에 객체 URL 해제(클릭 다운로드가 완료된 뒤).
  setTimeout(() => URL.revokeObjectURL(url), 0);
  // 전체 백업이 완료됐으므로 마지막 백업 시각을 기록(백업 알림 해제용).
  markBackupDone();
}

// ---- 백업 알림 추적 -------------------------------------------------

// 마지막 백업 시각(ms)을 읽는다. 없거나 파싱 실패 시 null.
export function getLastBackupAt() {
  try {
    const v = localStorage.getItem(BACKUP_KEY);
    const n = v == null ? NaN : Number(v);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

// 마지막 백업 시각을 now로 기록한다.
export function markBackupDone(nowMs = Date.now()) {
  try {
    localStorage.setItem(BACKUP_KEY, String(nowMs));
  } catch {
    /* 저장 실패 무시 */
  }
  return nowMs;
}

// 백업 알림을 띄울지 결정하는 순수 함수(테스트 대상).
// - 데이터가 없으면 알리지 않음.
// - 백업 이력이 없으면(데이터는 있음) 알림.
// - 마지막 백업 후 thresholdDays 이상 지났으면 알림.
export function needsBackupReminder(hasData, lastBackupAtMs, nowMs, thresholdDays = 14) {
  if (!hasData) return false;
  if (!lastBackupAtMs) return true;
  return (nowMs - lastBackupAtMs) >= thresholdDays * 86400000;
}

// 선택한 파일을 읽어 검증 후 정규화된 차용증 배열을 반환.
// 성공: { ok:true, agreements:Agreement[] }
// 실패: { ok:false, errors:string[] }
export function importFromFile(file) {
  return new Promise((resolve) => {
    if (!file) {
      resolve({ ok: false, errors: ['파일이 선택되지 않았습니다.'] });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        resolve({ ok: false, errors: ['JSON 파싱에 실패했습니다. 올바른 백업 파일인지 확인하세요.'] });
        return;
      }
      const { valid, errors } = validateBackup(parsed);
      if (!valid) {
        resolve({ ok: false, errors });
        return;
      }
      const agreements = parsed.agreements.map(normalizeAgreement);
      resolve({ ok: true, agreements });
    };
    reader.onerror = () => {
      resolve({ ok: false, errors: ['파일을 읽지 못했습니다.'] });
    };
    reader.readAsText(file);
  });
}
