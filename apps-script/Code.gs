/**
 * 시트 DB 빌더 — 원본 Google 시트를 Drive 안의 DB 스프레드시트로 정규화·유지함
 * Notion 데이터베이스의 속성·보기 구조를 참고하되, 외부 서비스 연동 없이 Google Workspace 안에서만 동작함.
 *
 * 구성: Code.gs(서버) + Index.html(웹앱 화면) + appsscript.json(권한·배포 설정)
 * 최초 설치: README 절차 참조 (authorize 실행 → 웹앱 배포)
 */

const CFG_KEY = 'SHEETDB_CONFIG_V1';
const ERR_KEY = 'SHEETDB_LAST_ERROR';
const META = ['_row_key', '_src_row', '_synced_at', '_hash'];
const META_DESC = {
  _row_key: '고유 키 복사본 (중복·삭제 판정용)',
  _src_row: '원본시트 행 번호',
  _synced_at: '마지막 반영 시각',
  _hash: '반영 시점 값 지문 (DB 직접 수정 감지용, 숨김)',
};
const TAB = { schema: '_schema', views: '_views', people: '_people', archive: '_archive', log: '_log', detail: '_log_detail' };
const TAB_HEADERS = {
  _schema: ['속성명', '유형', '원본 컬럼', '시트 구현', '고유 키', '설명'],
  _views: ['보기명', '필터', '정렬', '그룹', '비고'],
  _people: ['이름', '이메일'],
  _archive: ['_archived_at', '_reason', '_run_id'],
  _log: ['실행ID', '실행방식', '시작', '종료', '추가', '갱신', '보관', '실패', '경고', '상태', '메시지'],
  _log_detail: ['실행ID', '고유 키', '처리', '내용'],
};
/** Notion 속성 유형을 참고한 DB 속성 유형 → 시트 구현 방식 */
const TYPES = {
  '제목': '1열 고정 · 굵게 · 틀 고정',
  '텍스트': '일반 셀',
  '숫자': '숫자 서식 #,##0',
  '선택': '데이터 확인 드롭다운 (값 자동 수집)',
  '다중 선택': '쉼표 구분 · 드롭다운 목록',
  '날짜': '날짜 서식 yyyy-mm-dd',
  '사람': '_people 탭 참조 드롭다운',
  '체크박스': '체크박스',
  'URL': '일반 셀 (링크 자동 인식)',
};
const AUTO_TYPE = { text: '텍스트', select: '선택', date: '날짜', number: '숫자', person: '사람', bool: '체크박스' };
const DEFAULT_RULES = { trigger: 'manual', every: '1h', dailyTime: '08:50', conflict: 'src', deletion: 'archive', conds: [], mail: '', teams: '' };
const DETAIL_MAX_ROWS = 5000;
const DB_VIEW_MAX_ROWS = 500;

/* =========================================================================
 * 웹앱 진입
 * ========================================================================= */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('시트 DB 빌더')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** 편집기에서 한 번 실행하여 Drive·Sheets·트리거·메일 권한을 승인함 */
function authorize() {
  DriveApp.getRootFolder().getName();
  ScriptApp.getProjectTriggers();
  MailApp.getRemainingDailyQuota();
  Logger.log('권한 승인 완료: ' + Session.getEffectiveUser().getEmail());
}

/* =========================================================================
 * 설정 저장소
 * ========================================================================= */
function getCfg_() {
  const raw = PropertiesService.getScriptProperties().getProperty(CFG_KEY);
  const c = raw ? JSON.parse(raw) : {};
  const base = { sourceId: '', sourceTab: '', headerRow: 1, dbMode: 'new', dbId: '', dbName: '[DB] 제안사업', dbFolderId: '', schema: [], keyCol: '' };
  const cfg = Object.assign(base, c);
  cfg.rules = Object.assign({}, DEFAULT_RULES, c.rules || {});
  return cfg;
}
function setCfg_(cfg) {
  PropertiesService.getScriptProperties().setProperty(CFG_KEY, JSON.stringify(cfg));
}
const tz_ = () => Session.getScriptTimeZone() || 'Asia/Seoul';
const fmt_ = (d, p) => Utilities.formatDate(d, tz_(), p || 'yyyy-MM-dd');
const disp_ = v => (v instanceof Date ? (v.getHours() || v.getMinutes() ? fmt_(v, 'yyyy-MM-dd HH:mm') : fmt_(v)) : v === null || v === undefined ? '' : v);
const dbTabName_ = cfg => 'DB_' + ((cfg.dbName || '').replace(/^\[DB\]\s*/, '').replace(/[\\/?*\[\]:]/g, '').trim().slice(0, 90) || '본문');

/* =========================================================================
 * 화면용 API (google.script.run) — 반환값은 문자열·숫자·불리언·배열·객체만 사용
 * ========================================================================= */
function api_dashboard() {
  const cfg = getCfg_();
  const out = { account: Session.getEffectiveUser().getEmail(), config: cfg, types: TYPES, source: null, db: null, runs: [], daily: [], triggers: describeTriggers_(), lastError: PropertiesService.getScriptProperties().getProperty(ERR_KEY) || '' };
  if (cfg.sourceId) {
    try {
      const src = readSource_(cfg);
      out.source = { ok: true, name: src.sheet.getParent().getName(), tab: cfg.sourceTab, cols: src.header.filter(String).length, rows: src.rows.length };
    } catch (e) { out.source = { ok: false, error: e.message }; }
  }
  if (cfg.dbId) {
    try {
      const ss = SpreadsheetApp.openById(cfg.dbId);
      const main = ss.getSheetByName(dbTabName_(cfg));
      const arc = ss.getSheetByName(TAB.archive);
      out.db = { ok: true, name: ss.getName(), url: ss.getUrl(), tab: dbTabName_(cfg), records: main ? Math.max(0, main.getLastRow() - 1) : 0, archived: arc ? Math.max(0, arc.getLastRow() - 1) : 0 };
      out.runs = readRuns_(ss, 30);
    } catch (e) { out.db = { ok: false, error: 'DB 파일을 열 수 없음: ' + e.message }; }
  }
  out.daily = daily7_(out.runs);
  return out;
}

function api_listSpreadsheets() {
  const cfg = getCfg_();
  const it = DriveApp.searchFiles("mimeType='application/vnd.google-apps.spreadsheet' and trashed=false");
  const out = [];
  while (it.hasNext() && out.length < 80) {
    const f = it.next();
    const p = f.getParents();
    out.push({ id: f.getId(), name: f.getName(), folder: p.hasNext() ? p.next().getName() : '공유 문서함', updated: f.getLastUpdated().getTime(), isDb: f.getId() === cfg.dbId });
  }
  return out.sort((a, b) => b.updated - a.updated);
}

function api_listFolders() {
  const root = DriveApp.getRootFolder();
  const out = [{ id: root.getId(), name: '내 드라이브' }];
  const it = DriveApp.searchFolders("trashed=false and 'me' in owners");
  while (it.hasNext() && out.length < 80) { const f = it.next(); out.push({ id: f.getId(), name: f.getName() }); }
  return out;
}

function api_getTabs(sheetId) {
  return SpreadsheetApp.openById(sheetId).getSheets().map(s => s.getName());
}

/** 원본 컬럼·값 성격·샘플 3행·추천 키/제목 */
function api_getColumns() {
  const cfg = getCfg_();
  if (!cfg.sourceId || !cfg.sourceTab) throw new Error('원본 · 저장 위치에서 원본 시트와 탭을 먼저 저장함');
  const src = readSource_(cfg);
  const cols = [];
  src.header.forEach((name, i) => {
    if (!name) return;
    const vals = src.rows.slice(0, 300).map(x => x.r[i]);
    cols.push({ name, i, kind: inferKind_(name, vals), unique: isUnique_(src.rows.map(x => x.r[i])) });
  });
  const keyGuess = (cols.find(c => c.unique && /id|번호|코드|key/i.test(c.name)) || cols.find(c => c.unique) || {}).name || '';
  const titleGuess = (cols.find(c => c.kind === 'text' && c.name !== keyGuess && /명|제목|title|name/i.test(c.name)) || cols.find(c => c.kind === 'text' && c.name !== keyGuess) || {}).name || '';
  return {
    columns: cols.map(c => ({ name: c.name, kind: c.kind, auto: c.name === titleGuess ? '제목' : AUTO_TYPE[c.kind] })),
    samples: src.rows.slice(0, 3).map(x => cols.map(c => String(disp_(x.r[c.i])))),
    keyGuess, types: TYPES,
  };
}

function api_saveConnection(p) {
  const cfg = getCfg_();
  if (!p.sourceId || !p.sourceTab) throw new Error('원본 스프레드시트와 시트 탭을 선택함');
  if (p.dbMode === 'exist' && !p.dbId) throw new Error('사용할 기존 DB 파일을 선택함');
  if (p.dbMode === 'new' && !String(p.dbName || '').trim()) throw new Error('DB 파일명을 입력함');
  if (p.dbMode === 'exist' && p.dbId === p.sourceId) throw new Error('원본 파일을 DB 파일로 지정할 수 없음');
  const hr = Math.max(1, Math.min(50, parseInt(p.headerRow, 10) || 1));
  if (p.dbMode === 'new') {
    const changed = p.dbName.trim() !== cfg.dbName || p.dbFolderId !== cfg.dbFolderId || cfg.dbMode !== 'new';
    if (changed) cfg.dbId = '';                       // 다음 실행 때 새 DB 파일 생성
    cfg.dbName = p.dbName.trim();
    cfg.dbFolderId = p.dbFolderId || '';
  } else {
    const ss = SpreadsheetApp.openById(p.dbId);
    cfg.dbId = p.dbId; cfg.dbName = ss.getName();
  }
  cfg.dbMode = p.dbMode;
  cfg.sourceId = p.sourceId; cfg.sourceTab = p.sourceTab; cfg.headerRow = hr;
  setCfg_(cfg);
  if (cfg.rules.trigger === 'edit') installTriggers_(cfg);   // 원본이 바뀌면 편집 트리거도 다시 연결
  return cfg;
}

function api_saveSchema(p) {
  const cfg = getCfg_();
  const on = (p.schema || []).filter(s => s.on);
  if (!on.length) throw new Error('DB에 넣을 컬럼이 최소 1개 필요함');
  if (!on.some(s => s.type === '제목')) throw new Error('제목 속성 1개를 지정함');
  if (on.filter(s => s.type === '제목').length > 1) throw new Error('제목 속성은 1개만 지정할 수 있음');
  if (!on.some(s => s.col === p.keyCol)) throw new Error('DB에 포함된 컬럼 중 고유 키 1개를 지정함');
  const names = on.map(s => String(s.prop || '').trim());
  if (names.some(n => !n)) throw new Error('비어 있는 속성명이 있음');
  if (new Set(names).size !== names.length) throw new Error('속성명이 중복됨: ' + names.filter((n, i) => names.indexOf(n) !== i).join(', '));
  if (names.some(n => META.indexOf(n) >= 0)) throw new Error('_로 시작하는 시스템 컬럼명은 속성명으로 쓸 수 없음');
  cfg.schema = p.schema.map(s => ({ col: s.col, kind: s.kind, prop: String(s.prop || s.col).trim(), type: TYPES[s.type] ? s.type : '텍스트', on: !!s.on }));
  cfg.keyCol = p.keyCol;
  setCfg_(cfg);
  return cfg;
}

function api_saveRules(r) {
  const cfg = getCfg_();
  if (r.teams && !/^https:\/\//.test(r.teams)) throw new Error('Teams 웹훅 URL은 https://로 시작해야 함');
  if (r.trigger === 'edit' && !cfg.sourceId) throw new Error('원본 시트를 먼저 저장함');
  if (r.every === 'daily' && !/^\d{1,2}:\d{2}$/.test(r.dailyTime || '')) throw new Error('실행 시각 형식이 올바르지 않음 (예: 08:50)');
  cfg.rules = Object.assign({}, DEFAULT_RULES, r, { conds: (r.conds || []).filter(c => c.col && c.op) });
  setCfg_(cfg);
  installTriggers_(cfg);
  return { config: cfg, triggers: describeTriggers_() };
}

function api_runSync() { return runSync_('수동'); }

function api_getRuns(days) {
  const cfg = getCfg_();
  if (!cfg.dbId) return [];
  return readRuns_(SpreadsheetApp.openById(cfg.dbId), Number(days) || 7);
}

function api_getRunDetail(runId) {
  const cfg = getCfg_();
  const sh = SpreadsheetApp.openById(cfg.dbId).getSheetByName(TAB.detail);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues()
    .filter(r => r[0] === runId).slice(0, 500)
    .map(r => ({ key: String(r[1]), res: String(r[2]), msg: String(r[3]) }));
}

/** DB 뷰 화면: 본문 레코드 + 파일 구조 */
function api_getDbView() {
  const cfg = getCfg_();
  if (!cfg.dbId) return { exists: false, name: cfg.dbName };
  const ss = SpreadsheetApp.openById(cfg.dbId);
  const main = ss.getSheetByName(dbTabName_(cfg));
  const values = main && main.getLastRow() ? main.getDataRange().getValues() : [[]];
  const header = values[0].map(String);
  const typeOf = {};
  cfg.schema.filter(s => s.on).forEach(s => { typeOf[s.prop] = s.type; });
  const rows = values.slice(1).filter(r => r.some(v => v !== '')).slice(0, DB_VIEW_MAX_ROWS);
  let sourceUrl = '';
  try {
    const src = SpreadsheetApp.openById(cfg.sourceId);
    sourceUrl = src.getUrl().replace(/\/edit.*$/, '') + '/edit#gid=' + src.getSheetByName(cfg.sourceTab).getSheetId();
  } catch (e) { /* 원본 접근 불가 시 링크 생략 */ }
  const folder = (() => { const p = DriveApp.getFileById(cfg.dbId).getParents(); return p.hasNext() ? p.next().getName() : '내 드라이브'; })();
  const count = n => { const s = ss.getSheetByName(n); return s ? Math.max(0, s.getLastRow() - 1) : 0; };
  return {
    exists: true, name: ss.getName(), url: ss.getUrl(), tab: dbTabName_(cfg), folder, sourceUrl,
    header, types: header.map(h => typeOf[h] || (META.indexOf(h) >= 0 ? '시스템' : '텍스트')),
    rows: rows.map(r => r.map(v => (typeof v === 'boolean' || typeof v === 'number') ? v : String(disp_(v)))),
    total: Math.max(0, values.length - 1),
    structure: [
      { name: dbTabName_(cfg), rows: count(dbTabName_(cfg)), desc: '레코드 본문. 속성 설계대로 서식·드롭다운·틀 고정 적용' },
      { name: TAB.schema, rows: count(TAB.schema), desc: '속성명 · 유형 · 원본 컬럼 · 설명. GPT가 DB 의미를 해석하는 기준표' },
      { name: TAB.views, rows: count(TAB.views), desc: '보기 정의(필터 · 정렬 · 그룹). 팀 공통 조회 기준' },
      { name: TAB.people, rows: count(TAB.people), desc: '사람 속성 드롭다운 원본 (이름 · 이메일)' },
      { name: TAB.archive, rows: count(TAB.archive), desc: '원본에서 삭제되었거나 행 조건에서 제외된 레코드' },
      { name: TAB.log, rows: count(TAB.log), desc: '실행 이력 요약' },
      { name: TAB.detail, rows: count(TAB.detail), desc: '행 단위 처리 결과 (최근 ' + DETAIL_MAX_ROWS + '행 유지)' },
    ],
  };
}

/* =========================================================================
 * 트리거
 * ========================================================================= */
const HANDLERS_ = ['trg_time', 'trg_edit', 'trg_editFlush'];

function installTriggers_(cfg) {
  ScriptApp.getProjectTriggers().forEach(t => { if (HANDLERS_.indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t); });
  const r = cfg.rules;
  if (r.trigger === 'cron') {
    const b = ScriptApp.newTrigger('trg_time').timeBased();
    if (r.every === '15m') b.everyMinutes(15);
    else if (r.every === '1h') b.everyHours(1);
    else { const [h, m] = r.dailyTime.split(':').map(Number); b.everyDays(1).atHour(h).nearMinute(m); }
    b.create();
  } else if (r.trigger === 'edit') {
    ScriptApp.newTrigger('trg_edit').forSpreadsheet(cfg.sourceId).onEdit().create();
  }
}

function describeTriggers_() {
  const cfg = getCfg_();
  const r = cfg.rules;
  const installed = ScriptApp.getProjectTriggers().map(t => t.getHandlerFunction());
  if (r.trigger === 'manual') return { text: '수동 실행', active: true };
  if (r.trigger === 'edit') return { text: '원본 편집 감지', active: installed.indexOf('trg_edit') >= 0 };
  const txt = r.every === '15m' ? '15분마다' : r.every === '1h' ? '1시간마다' : '매일 ' + r.dailyTime;
  return { text: '시간 기반 · ' + txt, active: installed.indexOf('trg_time') >= 0 };
}

function trg_time() { runSync_('시간 기반'); }

/** 원본 편집 시 1분 뒤 한 번만 실행 (연속 편집을 묶어서 처리) */
function trg_edit(e) {
  const cfg = getCfg_();
  try { if (e && e.range && e.range.getSheet().getName() !== cfg.sourceTab) return; } catch (x) { /* 무시 */ }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    const pending = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'trg_editFlush');
    if (!pending) ScriptApp.newTrigger('trg_editFlush').timeBased().after(60 * 1000).create();
  } finally { lock.releaseLock(); }
}
function trg_editFlush() {
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() === 'trg_editFlush') ScriptApp.deleteTrigger(t); });
  runSync_('원본 편집');
}

/* =========================================================================
 * 동기화 본체
 * ========================================================================= */
function runSync_(trigger) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { skipped: true, message: '다른 실행이 진행 중이라 건너뜀' };
  const t0 = new Date();
  const runId = 'RUN-' + fmt_(t0, 'MMdd-HHmmss') + String(t0.getMilliseconds()).padStart(3, '0');   // 같은 초 실행과 구분
  const stat = { c: 0, u: 0, a: 0, f: 0, w: 0 };
  const details = [];
  const log = (key, res, msg) => details.push([runId, key, res, msg]);
  let cfg = null, ss = null, fatal = '', result = null;
  try {
    cfg = getCfg_();
    validateCfg_(cfg);
    const src = readSource_(cfg);
    const props = orderedProps_(cfg);
    const colIdx = props.map(p => {
      const i = src.header.indexOf(p.col);
      if (i < 0) throw new Error('원본에 "' + p.col + '" 컬럼이 없음. DB 속성 설계를 다시 저장함');
      return i;
    });
    const keyIdx = src.header.indexOf(cfg.keyCol);
    const K = props.length;
    const header = props.map(p => p.prop).concat(META);

    const db = ensureDb_(cfg);
    ss = db.ss;
    const main = db.main;
    const cur = main.getLastRow() ? main.getDataRange().getValues() : [];
    const curHeader = (cur[0] || []).map(String);
    let rows = cur.slice(1).filter(r => r.some(v => v !== ''));

    // 속성 구성이 바뀐 경우 기존 레코드를 새 열 순서로 재배치
    if (curHeader.join('') && curHeader.join('\u0001') !== header.join('\u0001')) {
      const map = header.map(h => curHeader.indexOf(h));
      rows = rows.map(r => map.map(i => (i < 0 ? '' : r[i])));
      log('-', '경고', 'DB 속성 구성이 바뀌어 열을 재배치함 (삭제된 속성 값은 제거됨)');
      stat.w++;
    }

    const index = {};
    rows.forEach((r, i) => { const k = String(r[K]); if (k) index[k] = i; });
    const seen = {};
    const toArchive = {};
    const people = {};
    const now = new Date();

    src.rows.forEach(({ r, srcRow }) => {
      const key = String(disp_(r[keyIdx])).trim();
      if (!key) { stat.f++; log('(빈 값)', '실패', '원본 ' + srcRow + '행: 고유 키(' + cfg.keyCol + ')가 비어 있어 건너뜀'); return; }
      if (seen[key]) { stat.f++; log(key, '실패', '원본 ' + srcRow + '행: 고유 키가 ' + seen[key] + '행과 중복되어 건너뜀'); return; }
      seen[key] = srcRow;
      if (!passConds_(cfg.rules.conds, src.header, r)) {
        if (index[key] !== undefined) toArchive[index[key]] = '행 조건 제외';
        return;
      }
      const vals = props.map((p, j) => {
        const res = convert_(r[colIdx[j]], p.type);
        if (res.err) { stat.w++; log(key, '경고', p.prop + ': ' + res.err); }
        if (p.type === '사람' && res.v) String(res.v).split(',').forEach(n => { n = n.trim(); if (n) people[n] = true; });
        return res.v;
      });
      const h = hash_(vals);
      const at = index[key];
      if (at === undefined) {
        rows.push(vals.concat([key, srcRow, now, h]));
        index[key] = rows.length - 1;
        stat.c++; log(key, '추가', String(disp_(vals[0])));
        return;
      }
      const row = rows[at];
      const stored = String(row[K + 3] || '');
      const dbNow = hash_(row.slice(0, K));
      if (stored === h && dbNow === h) { row[K + 1] = srcRow; return; }          // 변경 없음
      if (cfg.rules.conflict === 'keep' && stored && dbNow !== stored) {
        stat.w++; log(key, '보존', 'DB에서 직접 수정한 값이 있어 갱신하지 않음'); return;
      }
      const changed = props.filter((p, j) => norm_(row[j]) !== norm_(vals[j])).map(p => p.prop);
      rows[at] = vals.concat([key, srcRow, now, h]);
      stat.u++; log(key, '갱신', (changed.join(', ') || '값 재기록') + ' 변경');
    });

    // 원본에서 사라진 레코드 처리
    const statusJ = props.findIndex(p => p.prop === '진행상태' && (p.type === '선택' || p.type === '텍스트'));
    Object.keys(index).forEach(key => {
      if (seen[key]) return;
      const i = index[key];
      if (cfg.rules.deletion === 'archive') toArchive[i] = '원본 행 삭제';
      else if (cfg.rules.deletion === 'status') {
        if (statusJ < 0) { if (!details.some(d => d[3].indexOf('진행상태 속성이 없어') === 0)) { stat.w++; log('-', '경고', '진행상태 속성이 없어 삭제 표시를 하지 못함'); } return; }
        if (rows[i][statusJ] !== '원본 삭제') { rows[i][statusJ] = '원본 삭제'; rows[i][K + 3] = hash_(rows[i].slice(0, K)); stat.u++; log(key, '갱신', '원본 행 삭제 → 진행상태 "원본 삭제"'); }
      }
    });

    // 보관 이동
    const arcIdx = Object.keys(toArchive).map(Number);
    if (arcIdx.length) {
      const arc = ss.getSheetByName(TAB.archive);
      arc.getRange(1, 1, 1, 3 + header.length).setValues([TAB_HEADERS._archive.concat(header)]);
      const arcRows = arcIdx.map(i => [now, toArchive[i], runId].concat(rows[i]));
      arc.getRange(arc.getLastRow() + 1, 1, arcRows.length, arcRows[0].length).setValues(arcRows);
      arcIdx.forEach(i => { stat.a++; log(String(rows[i][K]), '보관', toArchive[i] + ' → _archive 이동'); });
      const drop = {}; arcIdx.forEach(i => { drop[i] = true; });
      rows = rows.filter((r, i) => !drop[i]);
    }

    // 본문 기록: 서식 먼저 적용 후 한 번에 쓰기 (텍스트 속성의 '001' 등이 숫자로 바뀌지 않도록)
    main.getDataRange().clearContent();
    if (main.getMaxColumns() < header.length) main.insertColumnsAfter(main.getMaxColumns(), header.length - main.getMaxColumns());
    if (main.getMaxRows() < rows.length + 1) main.insertRowsAfter(main.getMaxRows(), rows.length + 1 - main.getMaxRows());
    const lastCol = main.getMaxColumns();
    if (lastCol > header.length) main.getRange(1, header.length + 1, main.getMaxRows(), lastCol - header.length).clear();
    updatePeople_(ss, Object.keys(people));
    formatDb_(ss, main, props, rows);
    main.getRange(1, 1, 1, header.length).setValues([header]);
    if (rows.length) main.getRange(2, 1, rows.length, header.length).setValues(rows);
    writeSchema_(ss, cfg, props);
    PropertiesService.getScriptProperties().deleteProperty(ERR_KEY);
  } catch (e) {
    fatal = e.message || String(e);
    PropertiesService.getScriptProperties().setProperty(ERR_KEY, fmt_(t0, 'MM-dd HH:mm') + ' · ' + fatal);
  } finally {
    const end = new Date();
    const status = fatal ? '실패' : stat.f ? '부분 실패' : '성공';
    try {
      if (!ss && cfg && cfg.dbId) ss = SpreadsheetApp.openById(cfg.dbId);
      if (ss) writeLog_(ss, [runId, trigger, t0, end, stat.c, stat.u, stat.a, stat.f, stat.w, status, fatal], details);
    } catch (x) { /* 로그 기록 실패는 무시 */ }
    if (cfg && (fatal || stat.f)) notify_(cfg, runId, status, fatal, stat, ss);
    lock.releaseLock();
    result = { id: runId, trig: trigger, start: fmt_(t0, 'MM-dd HH:mm:ss'), end: fmt_(end, 'HH:mm:ss'), c: stat.c, u: stat.u, a: stat.a, f: stat.f, w: stat.w, status, message: fatal };
  }
  return result;
}

function validateCfg_(cfg) {
  if (!cfg.sourceId || !cfg.sourceTab) throw new Error('원본 시트가 지정되지 않음');
  if (!cfg.schema.some(s => s.on)) throw new Error('DB 속성 설계가 저장되지 않음');
  if (!cfg.keyCol) throw new Error('고유 키가 지정되지 않음');
  if (!cfg.dbId && !cfg.dbName) throw new Error('DB 파일명이 비어 있음');
}

function readSource_(cfg) {
  const ss = SpreadsheetApp.openById(cfg.sourceId);
  const sheet = ss.getSheetByName(cfg.sourceTab);
  if (!sheet) throw new Error('원본에서 "' + cfg.sourceTab + '" 탭을 찾을 수 없음');
  const values = sheet.getDataRange().getValues();
  const hr = cfg.headerRow || 1;
  const header = (values[hr - 1] || []).map(v => String(v).trim());
  const rows = values.slice(hr)
    .map((r, i) => ({ r, srcRow: hr + 1 + i }))
    .filter(x => x.r.some(v => v !== '' && v !== null));
  return { sheet, header, rows };
}

/** 제목 속성을 1열로, 나머지는 원본 순서 유지 */
function orderedProps_(cfg) {
  const on = cfg.schema.filter(s => s.on);
  return on.filter(s => s.type === '제목').concat(on.filter(s => s.type !== '제목'));
}

function ensureDb_(cfg) {
  let ss = null, created = false;
  if (cfg.dbId) { try { ss = SpreadsheetApp.openById(cfg.dbId); } catch (e) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create(cfg.dbName);
    if (cfg.dbFolderId) DriveApp.getFileById(ss.getId()).moveTo(DriveApp.getFolderById(cfg.dbFolderId));
    cfg.dbId = ss.getId();
    setCfg_(cfg);
    created = true;
  }
  const mainName = dbTabName_(cfg);
  let main = ss.getSheetByName(mainName);
  if (!main) {
    if (created) { main = ss.getSheets()[0]; main.setName(mainName); }
    else main = ss.insertSheet(mainName, 0);
  }
  Object.keys(TAB_HEADERS).forEach(name => {
    let sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      sh.getRange(1, 1, 1, TAB_HEADERS[name].length).setValues([TAB_HEADERS[name]]).setFontWeight('bold').setBackground('#EEF1F6');
      sh.setFrozenRows(1);
      if (name === TAB.views) seedViews_(sh, cfg);
    }
  });
  return { ss, main, created };
}

function seedViews_(sh, cfg) {
  const has = n => cfg.schema.some(s => s.on && s.prop === n);
  const rows = [['전체', '', '', '', '기본 보기']];
  if (has('진행상태')) rows.push(['진행 중', '진행상태 ≠ 종료', '', '진행상태', '보드 보기용']);
  const date = cfg.schema.find(s => s.on && s.type === '날짜');
  if (date) rows.push(['마감 임박', '', date.prop + ' 오름차순', '', '']);
  sh.getRange(2, 1, rows.length, 5).setValues(rows);
}

function formatDb_(ss, main, props, rows) {
  const n = Math.max(rows.length, 1);
  const K = props.length;
  main.showColumns(1, main.getMaxColumns());
  main.setFrozenRows(1);
  main.setFrozenColumns(1);
  main.getRange(1, 1, 1, K + META.length).setFontWeight('bold').setBackground('#EEF1F6');
  props.forEach((p, j) => {
    const rg = main.getRange(2, j + 1, n, 1);
    rg.clearDataValidations().setFontWeight('normal').setNumberFormat('@');   // 기본: 일반 텍스트
    switch (p.type) {
      case '제목': rg.setFontWeight('bold'); break;
      case '숫자': rg.setNumberFormat('#,##0'); break;
      case '날짜': rg.setNumberFormat('yyyy-mm-dd'); break;
      case '체크박스': rg.setNumberFormat('General').setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build()); break;
      case '선택':
      case '다중 선택': {
        const opts = {};
        rows.forEach(r => String(r[j] || '').split(p.type === '다중 선택' ? ',' : '\u0000').forEach(v => { v = v.trim(); if (v) opts[v] = true; }));
        const list = Object.keys(opts).slice(0, 500);
        if (list.length) rg.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(list, true).setAllowInvalid(true).build());
        break;
      }
      case '사람': {
        const ppl = ss.getSheetByName(TAB.people);
        rg.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(ppl.getRange('A2:A'), true).setAllowInvalid(true).build());
        break;
      }
      default: break;
    }
  });
  const meta = main.getRange(1, K + 1, n + 1, META.length);
  meta.setFontColor('#8A93A3').setFontWeight('normal');
  main.getRange(1, K + 1, 1, META.length).setFontWeight('bold');
  main.getRange(2, K + 1, n, 1).setNumberFormat('@');
  main.getRange(2, K + 2, n, 1).setNumberFormat('0');
  main.getRange(2, K + 3, n, 1).setNumberFormat('yyyy-mm-dd hh:mm');
  main.getRange(2, K + 4, n, 1).setNumberFormat('@');
  main.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(p => { if (p.getDescription() === 'sheetdb-meta') p.remove(); });
  meta.protect().setDescription('sheetdb-meta').setWarningOnly(true);
  main.hideColumns(K + 4);
}

function writeSchema_(ss, cfg, props) {
  const sh = ss.getSheetByName(TAB.schema);
  const old = {};
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues().forEach(r => { old[r[0]] = r[5]; });
  const rows = props.map(p => [p.prop, p.type, p.col, TYPES[p.type], p.col === cfg.keyCol ? 'Y' : '', old[p.prop] || ''])
    .concat(META.map(m => [m, '시스템', '', '자동 생성 · 편집 경고', '', META_DESC[m]]));
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 6).clearContent();
  sh.getRange(2, 1, rows.length, 6).setValues(rows);
}

function updatePeople_(ss, names) {
  if (!names.length) return;
  const sh = ss.getSheetByName(TAB.people);
  const have = {};
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(r => { have[String(r[0]).trim()] = true; });
  const add = names.filter(n => !have[n]).map(n => [n, '']);
  if (add.length) sh.getRange(sh.getLastRow() + 1, 1, add.length, 2).setValues(add);
}

function writeLog_(ss, runRow, details) {
  const lg = ss.getSheetByName(TAB.log);
  if (lg) lg.getRange(lg.getLastRow() + 1, 1, 1, runRow.length).setValues([runRow]);
  const dt = ss.getSheetByName(TAB.detail);
  if (dt && details.length) {
    dt.getRange(dt.getLastRow() + 1, 1, details.length, 4).setValues(details);
    const over = dt.getLastRow() - 1 - DETAIL_MAX_ROWS;
    if (over > 0) dt.deleteRows(2, over);
  }
}

function readRuns_(ss, days) {
  const sh = ss.getSheetByName(TAB.log);
  if (!sh || sh.getLastRow() < 2) return [];
  const today = new Date(fmt_(new Date()) + 'T00:00:00');
  return sh.getRange(2, 1, sh.getLastRow() - 1, 11).getValues()
    .filter(r => r[2] instanceof Date)
    .map(r => {
      const d0 = new Date(fmt_(r[2]) + 'T00:00:00');
      return { id: String(r[0]), trig: String(r[1]), start: fmt_(r[2], 'MM-dd HH:mm:ss'), end: r[3] instanceof Date ? fmt_(r[3], 'HH:mm:ss') : '', day: fmt_(r[2], 'MM-dd'),
        days: Math.round((today - d0) / 86400000), c: +r[4] || 0, u: +r[5] || 0, a: +r[6] || 0, f: +r[7] || 0, w: +r[8] || 0, status: String(r[9]), message: String(r[10] || '') };
    })
    .filter(r => r.days < days)
    .reverse();
}

function daily7_(runs) {
  const out = [];
  for (let i = 6; i >= 0; i--) {
    const d = fmt_(new Date(Date.now() - i * 86400000), 'MM-dd');
    const rs = runs.filter(r => r.day === d);
    out.push({ d, c: sum_(rs, 'c'), u: sum_(rs, 'u'), a: sum_(rs, 'a'), f: sum_(rs, 'f') });
  }
  return out;
}
const sum_ = (a, k) => a.reduce((s, r) => s + r[k], 0);

/* =========================================================================
 * 값 변환 · 판정
 * ========================================================================= */
function convert_(v, type) {
  if (v === '' || v === null || v === undefined) return { v: type === '체크박스' ? false : '' };
  switch (type) {
    case '날짜': {
      if (v instanceof Date) return { v };
      const m = String(v).trim().match(/^(\d{4})[-./]\s?(\d{1,2})[-./]\s?(\d{1,2})/);
      if (m) { const d = new Date(+m[1], +m[2] - 1, +m[3]); if (d.getMonth() === +m[2] - 1) return { v: d }; }
      return { v: '', err: '"' + v + '"을 날짜로 해석할 수 없어 빈 값 처리' };
    }
    case '숫자': {
      if (typeof v === 'number') return { v };
      const n = Number(String(v).replace(/[,\s원₩]/g, ''));
      return isFinite(n) ? { v: n } : { v: '', err: '"' + v + '"을 숫자로 해석할 수 없어 빈 값 처리' };
    }
    case '체크박스': {
      if (typeof v === 'boolean') return { v };
      const s = String(v).trim().toUpperCase();
      if (['Y', 'YES', 'O', 'TRUE', '1', 'V'].indexOf(s) >= 0) return { v: true };
      if (['N', 'NO', 'X', 'FALSE', '0'].indexOf(s) >= 0) return { v: false };
      return { v: false, err: '"' + v + '"을 체크 여부로 해석할 수 없어 해제 처리' };
    }
    case '다중 선택':
      return { v: String(disp_(v)).split(/[,;\n]/).map(x => x.trim()).filter(Boolean).join(', ') };
    default:
      return { v: String(disp_(v)).trim() };
  }
}

function inferKind_(name, vals) {
  const v = vals.filter(x => x !== '' && x !== null && x !== undefined);
  if (!v.length) return 'text';
  // 값 대부분(80% 이상)이 같은 형식이면 그 형식으로 판정 — 오타 몇 건 때문에 텍스트로 떨어지지 않도록
  const share = f => v.filter(f).length / v.length >= 0.8;
  if (share(x => typeof x === 'boolean' || /^(Y|N|O|X|TRUE|FALSE)$/i.test(String(x).trim())) && v.some(x => typeof x === 'boolean' || /^(Y|N)$/i.test(String(x).trim()))) return 'bool';
  if (share(x => x instanceof Date || /^\d{4}[-./]\s?\d{1,2}[-./]\s?\d{1,2}/.test(String(x)))) return 'date';
  if (share(x => typeof x === 'number' || /^-?[\d,]+(\.\d+)?$/.test(String(x).trim()))) return 'number';
  if (/담당|PM|PL|작성자|책임|사람/i.test(name)) return 'person';
  const uniq = new Set(v.map(String)).size;
  if (uniq <= 30 && /상태|유형|구분|분류|단계|등급|종류|기관|부서/.test(name)) return 'select';
  if (v.length >= 4 && uniq <= Math.max(3, Math.floor(v.length * 0.5)) && uniq <= 30) return 'select';
  return 'text';
}

function isUnique_(vals) {
  const v = vals.map(x => String(disp_(x)).trim());
  return v.length > 0 && v.every(Boolean) && new Set(v).size === v.length;
}

function passConds_(conds, header, r) {
  return (conds || []).every(c => {
    const i = header.indexOf(c.col);
    if (i < 0) return true;
    const raw = r[i];
    const s = String(disp_(raw)).trim();
    const val = String(c.val || '').trim();
    switch (c.op) {
      case '=': return s === val;
      case '≠': return s !== val;
      case '포함': return s.indexOf(val) >= 0;
      case '비어 있음': return s === '';
      case '이후': return s !== '' && cmp_(raw, s, val) > 0;
      case '이전': return s !== '' && cmp_(raw, s, val) < 0;
      default: return true;
    }
  });
}
function cmp_(raw, s, val) {
  const a = typeof raw === 'number' ? raw : Number(s.replace(/,/g, ''));
  const b = Number(val.replace(/,/g, ''));
  if (isFinite(a) && isFinite(b) && val !== '') return a - b;
  return s < val ? -1 : s > val ? 1 : 0;
}

function norm_(v) {
  if (v instanceof Date) return fmt_(v);
  if (v === null || v === undefined) return '';
  return typeof v === 'string' ? v.trim() : String(v);
}
function hash_(vals) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(vals.map(norm_)), Utilities.Charset.UTF_8);
  return Utilities.base64Encode(bytes).slice(0, 16);
}

/* =========================================================================
 * 알림
 * ========================================================================= */
function notify_(cfg, runId, status, fatal, stat, ss) {
  const body = '[시트 DB 빌더] ' + status + ' · ' + runId + '\n'
    + (fatal ? '오류: ' + fatal + '\n' : '')
    + '추가 ' + stat.c + ' · 갱신 ' + stat.u + ' · 보관 ' + stat.a + ' · 실패 ' + stat.f + ' · 경고 ' + stat.w + '\n'
    + (ss ? 'DB 파일: ' + ss.getUrl() + '\n행 단위 내용은 _log_detail 탭 참조' : '');
  try { if (cfg.rules.mail) MailApp.sendEmail(cfg.rules.mail, '[시트 DB] ' + status + ' · ' + runId, body); } catch (e) { /* 메일 실패 무시 */ }
  try {
    if (cfg.rules.teams) UrlFetchApp.fetch(cfg.rules.teams, { method: 'post', contentType: 'application/json', payload: JSON.stringify({ text: body.replace(/\n/g, '<br>') }), muteHttpExceptions: true });
  } catch (e) { /* 웹훅 실패 무시 */ }
}
