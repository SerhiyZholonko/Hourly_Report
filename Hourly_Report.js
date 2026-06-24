/**
 * Автозаповнення аркуша "По годинний звіт" з аркуша "Дані по дням".
 * Тригер щодня о 07:00 заповнює рядок за поточну дату
 * (період, що закрився сьогодні о 06:00 → блок "(вчора) - (сьогодні) 06:00").
 *
 * ЗМІНА ДЖЕРЕЛА 429:
 *   Дані для підрозділу 429 ОБр БпС тепер беруться НЕ з живого аркуша
 *   "429 ОБр БпС", а з архівного аркуша "Архів звітів" — туди щодоби
 *   зберігається текст із клітинки A1 (окремий скрипт archiveDailyReport).
 *   Парсинг тексту лишається той самий.
 *
 * ТОЧКИ ВХОДУ:
 *   fillDailyReport()                 — викликається тригером (дата = сьогодні)
 *   fillForDateString("20.06.2026")   — заповнити за конкретну дату
 *   dryRunForDate("19.06.2026")       — НІЧОГО не пише, лише друкує в лог
 *                                        порахований блок (для звірки з уже заповненим)
 *   check429ForDate("21.06.2026")     — показати, що саме витягується для 429 з архіву
 *   createDailyTrigger()              — створити/перестворити тригер на 07:00
 *
 * ПЕРЕД ПЕРШИМ ЗАПУСКОМ:
 *   1) Переконайся, що назва архівного аркуша у CFG.archiveSheet збігається
 *      з тією, куди зберігається A1 (за замовчуванням "Архів звітів").
 *   2) Запусти check429ForDate("<сьогодні>") і звір числа 429.
 *   3) Запусти dryRunForDate("<сьогодні>") і порівняй лог із наявним рядком.
 *   4) Запусти createDailyTrigger() (один раз) і дай дозволи.
 */

// ---------- НАЛАШТУВАННЯ ----------
const CFG = {
  dataSheet:    'Дані по дням',
  reportSheet:  'По годинний звіт',
  regionSheet:  'Відповідність смуг і областей',
  sheet429:     '429 ОБр БпС',     // живий аркуш — лишається лише як резерв
  archiveSheet: 'Архів звітів',    // НОВЕ джерело 429: архів збережених A1
  fallbackToLive429: true,         // якщо в архіві немає дати — взяти живий A1
  triggerHour:  7,
};

// Порядок підрозділів у звіті.
// blockKey — унікальний підрядок із заголовка блоку в "Дані по дням" (з дужкою "(").
// reactive — чи має підрозділ рядок "Шахед Реактивний".
// special429 — для 429 дані беремо з архіву (див. aggregate429_).
const UNITS = [
  { report: '414 ОБр БпС ББпАК',        blockKey: '(414 обр',        reactive: false },
  { report: 'Зведений загін 9 обр БпС', blockKey: '(9 обр',          reactive: false },
  { report: '424 ОБ БПС',               blockKey: '(424 об',         reactive: false },
  { report: '412 ОБр БпС 5ББАК',        blockKey: '(412 обр БпС DN', reactive: true  },
  { report: '429 ОБр БпС',              blockKey: '(429 обр',        reactive: false, special429: true },
  { report: '190 НЦ БпС',               blockKey: '(190 НЦ',         reactive: false },
  { report: '427 ОБр БпС',              blockKey: '(427 обр',        reactive: false },
  { report: '413 оп БпС',               blockKey: '(413 оп',         reactive: true  },
  { report: '412 ОБр ДБНК РБАК',        blockKey: '(412 обр БпС SD', reactive: false },
  { report: '20 ОБр БпС',               blockKey: '(20 обр',         reactive: false },
  { report: '411 ОП',                   blockKey: '(411 обр',        reactive: false },
  { report: 'ГВ БАС ФЕНИКС',            blockKey: '(БАС Фенікс',     reactive: false },
];

// Канонічні назви областей (як у шапці звіту). Колонки знаходяться автоматично.
const OBLAST_CANON = [
  'Харківська','Сумська','Дніпропетровська','Донецька','Одеська',
  'Чернігівська','Житомирська','Запорізька','Київська','Миколаївська'
];

// =================== ТОЧКИ ВХОДУ ===================

function fillDailyReport() {
  fillReportForDate(new Date());
}

function fillForDateString(s) {            // "20.06.2026"
  const p = s.split('.');
  fillReportForDate(new Date(+p[2], +p[1] - 1, +p[0]), { force: true });
}

function dryRunForDate(s) {
  const p = s.split('.');
  const res = fillReportForDate(new Date(+p[2], +p[1] - 1, +p[0]), { dryRun: true, force: true });
  Logger.log('--- DRY RUN %s ---', s);
  res.rows.forEach(r => Logger.log(r.map(x => x === '' ? '·' : x).join(' | ')));
  Logger.log('Не знайдено блоків: %s', res.missing.join(', ') || '—');
  return res;
}

// Перевірка: що саме витягується для 429 з архіву за дату.
function check429ForDate(s) {
  const agg = aggregate429_(s);
  if (!agg) { Logger.log('429 за %s: НЕ ЗНАЙДЕНО в архіві.', s); return; }
  Logger.log('429 за %s:', s);
  Logger.log('  Шахед/Герань=%s, Гербера=%s, вильоти=%s, екіпажі=%s',
             agg.shahed, agg.gerbera, agg.shSorties, agg.crewsSh);
  Logger.log('  ОТР=%s, Бараж=%s, вильоти=%s, екіпажі=%s',
             agg.otr, agg.barrage, agg.otrSorties, agg.crewsOtr);
  Logger.log('  Області Ш: %s', JSON.stringify(agg.regSh));
  Logger.log('  Області ОТР: %s', JSON.stringify(agg.regOtr));
}

// Обгортки БЕЗ аргументів — їх видно у випадайнику "Виконати".
function dryRunToday()   { dryRunForDate(fmtReport_(new Date())); }     // суха перевірка за сьогодні
function dryRun_19_06()  { dryRunForDate('19.06.2026'); }              // суха перевірка за 19.06.2026
function check429Today() { check429ForDate(fmtReport_(new Date())); }  // перевірка 429 за сьогодні
function fillToday()     { fillReportForDate(new Date(), { force: true }); } // записати за сьогодні
function fill_21_06()    { fillForDateString('20.06.2026'); }               // записати за 21.06.2026

function createDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'fillDailyReport') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('fillDailyReport')
    .timeBased().everyDays(1).atHour(CFG.triggerHour)
    .inTimezone(ss_().getSpreadsheetTimeZone())
    .create();
  Logger.log('Тригер створено: щодня о %s:00 (%s).', CFG.triggerHour, ss_().getSpreadsheetTimeZone());
}

// =================== ОСНОВНА ЛОГІКА ===================

function fillReportForDate(dateObj, opts) {
  opts = opts || {};
  const reportDate = fmtReport_(dateObj);   // dd.MM.yyyy — як у звіті
  const endData    = fmtData_(dateObj);     // dd.MM.yy   — кінець діапазону в "Дані по дням"

  const repSheet  = ss_().getSheetByName(CFG.reportSheet);
  const dataSheet = ss_().getSheetByName(CFG.dataSheet);
  if (!repSheet || !dataSheet) throw new Error('Не знайдено потрібних аркушів.');

  // антидубль
  if (!opts.force && reportHasDate_(repSheet, reportDate)) {
    Logger.log('Дата %s вже є у звіті — пропускаю.', reportDate);
    return { rows: [], missing: [] };
  }

  const values    = dataSheet.getDataRange().getValues();
  const cols      = dataColumns_(values);
  const regionMap = buildRegionMap_();
  const layout    = reportLayout_(repSheet);

  const allRows = [];
  const missing = [];

  UNITS.forEach(unit => {
    let agg = unit.special429
      ? aggregate429_(reportDate)                                   // ← тепер з архіву
      : aggregateUnit_(values, cols, unit, endData, regionMap);
    if (!agg) { missing.push(unit.report); agg = newAgg_(); }
    buildUnitRows_(unit, agg, layout).forEach(r => allRows.push(r));
  });

  if (!opts.dryRun && allRows.length) {
    allRows[0][0] = reportDate;             // дата лише в першому рядку дня (колонка A)
    const startRow = repSheet.getLastRow() + 1;
    const written = repSheet.getRange(startRow, 1, allRows.length, layout.lastCol);
    written.setValues(allRows);

    // Межі для всього блоку дня (як у решти таблиці).
    written.setBorder(true, true, true, true, true, true);

    // Підсвітити рядок з датою зеленим (як для інших дат).
    repSheet.getRange(startRow, 1, 1, layout.lastCol).setBackground('#00ff00');

    // Підсвітити "Кількість задіяних розрахунків", які треба заповнити вручну.
    if (layout.colCrews >= 0) {
      const mainTypes = ['Шахед/Герань', 'ОТР БПЛА'];
      const a1 = [];
      allRows.forEach((r, k) => {
        if (mainTypes.indexOf(r[layout.colType]) >= 0 && r[layout.colCrews] === '') {
          a1.push(repSheet.getRange(startRow + k, layout.colCrews + 1).getA1Notation());
        }
      });
      if (a1.length) {
        const rl = repSheet.getRangeList(a1);
        rl.setBackground('#fff2cc');   // світло-жовтий = заповнити вручну
        rl.setNote('Заповнити вручну: кількість задіяних розрахунків');
      }
    }

    Logger.log('Дата %s: записано %s рядків з рядка %s. Не знайдено: %s',
               reportDate, allRows.length, startRow, missing.join(', ') || '—');
  }

  return { rows: allRows, missing: missing };
}

// Агрегує блок одного підрозділу за дату (кінець діапазону = endDateStr).
function aggregateUnit_(values, cols, unit, endDateStr, regionMap) {
  for (let i = cols.headerRow + 1; i < values.length; i++) {
    const a = norm_(values[i][0]);
    if (a.indexOf('в/ч') === 0 && a.indexOf(unit.blockKey) >= 0) {
      const dr = norm_(values[i + 1] ? values[i + 1][0] : '');
      const m = dr.match(/(\d{2}\.\d{2}\.\d{2})\s*[-–]\s*(\d{2}\.\d{2}\.\d{2})/);
      if (!m || m[2] !== endDateStr) continue;     // не той день — шукаємо далі

      const agg = newAgg_();
      const seen = { sh: {}, otr: {} };
      for (let j = i + 2; j < values.length; j++) {
        const c0 = norm_(values[j][0]);
        if (c0.indexOf('в/ч') === 0) break;                   // наступний підрозділ
        if (/^\d{2}\.\d{2}\.\d{2}\s*[-–]/.test(c0)) break;     // наступний день
        if (!/^\d+$/.test(c0)) continue;                       // не рядок з номером

        const name   = norm_(values[j][cols.name]);
        const oblast = smugaToOblast_(values[j][cols.region], regionMap);
        const shS = num_(values[j][cols.shSorties]);
        const otS = num_(values[j][cols.otrSorties]);
        const sh  = parseShahedType_(values[j][cols.shType]);
        const ot  = parseOtrType_(values[j][cols.otrType]);

        agg.shahed     += sh.shahed;
        agg.gerbera    += sh.gerbera;
        agg.otr        += ot.otr;
        agg.barrage    += ot.barrage;
        agg.shSorties  += shS;
        agg.otrSorties += otS;

        if (oblast) {
          agg.oblasts[oblast] = true;  // бригада працює в цій області → 0 замість пусто
          agg.regSh[oblast]  = (agg.regSh[oblast]  || 0) + sh.shahed + sh.gerbera;
          agg.regOtr[oblast] = (agg.regOtr[oblast] || 0) + ot.otr + ot.barrage;
        }

        // ЕВРИСТИКА "Кількість задіяних розрахунків": унікальні типи БпЛА з вильотами.
        // Це НАБЛИЖЕННЯ. Для точних чисел потрібне окреме джерело екіпажів (як у 429).
        if (shS > 0) seen.sh[name]  = 1;
        if (otS > 0) seen.otr[name] = 1;
      }
      agg.crewsSh  = Object.keys(seen.sh).length;
      agg.crewsOtr = Object.keys(seen.otr).length;
      return agg;
    }
  }
  return null;
}

// 429: дані беремо з АРХІВНОГО аркуша (збережений текст A1) за потрібну дату.
// reportDate — dd.MM.yyyy. Шукаємо останній запис архіву з такою датою.
function aggregate429_(reportDate) {
  let text = read429FromArchive_(reportDate);

  if (text == null) {
    Logger.log('429: в архіві "%s" немає запису за %s.', CFG.archiveSheet, reportDate);
    if (CFG.fallbackToLive429) {
      const live = ss_().getSheetByName(CFG.sheet429);
      if (live) {
        text = live.getRange('A1').getValue();
        Logger.log('429: як резерв беру поточний A1 з аркуша "%s".', CFG.sheet429);
      }
    }
    if (text == null) return null;
  }

  return parse429Text_(text);
}

// Знаходить у архіві текст A1 за датою reportDate (dd.MM.yyyy).
// Колонка A — мітка часу збереження (напр. "21.06.2026 06:30"), колонка B — текст A1.
function read429FromArchive_(reportDate) {
  const arch = ss_().getSheetByName(CFG.archiveSheet);
  if (!arch || arch.getLastRow() < 2) return null;

  const n      = arch.getLastRow() - 1;            // без шапки
  const stamps = arch.getRange(2, 1, n, 1).getDisplayValues();
  const texts  = arch.getRange(2, 2, n, 1).getValues();

  // Беремо ОСТАННІЙ рядок із потрібною датою (якщо за день кілька збережень).
  for (let i = stamps.length - 1; i >= 0; i--) {
    if (archiveRowDate_(stamps[i][0]) === reportDate) {
      return String(texts[i][0] || '');
    }
  }
  return null;
}

// Витягує "dd.MM.yyyy" з мітки часу архіву (рядок або дата — байдуже).
function archiveRowDate_(displayVal) {
  const m = String(displayVal == null ? '' : displayVal).match(/(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? (m[1] + '.' + m[2] + '.' + m[3]) : '';
}

// Парсить текстовий звіт 429 (той самий формат, що був у живому аркуші).
function parse429Text_(text) {
  const lines = String(text).split('\n').map(norm_);
  const blank = lines.findIndex((l, idx) => idx > 2 && l === '');
  const sec1 = blank >= 0 ? lines.slice(0, blank) : lines;
  const sec2 = blank >= 0 ? lines.slice(blank + 1) : [];

  const val = (arr, label) => {
    const re = new RegExp(label + '[^-–\\d\\n]*[-–]\\s*(\\d+)');
    for (const l of arr) { const m = l.match(re); if (m) return +m[1]; }
    return 0;
  };

  const agg = newAgg_();
  // Секція 1 — Шахед/Герань + Гербера
  agg.shahed    = val(sec1, 'Шахед\\s*/?\\s*Герань');
  agg.gerbera   = val(sec1, 'Гербера');
  agg.shSorties = val(sec1, 'Кількість вильотів');
  agg.crewsSh   = val(sec1, 'Задіяних екіпажів');
  agg.regSh['Харківська'] = val(sec1, 'Харківська');
  agg.regSh['Сумська']    = val(sec1, 'Сумська');
  agg.regSh['Запорізька'] = val(sec1, 'Запор');
  // Секція 2 — ОТР + Бараж
  agg.otr        = val(sec2, 'ОТР\\s*БпЛА');
  agg.barrage    = val(sec2, 'Бараж');
  agg.otrSorties = val(sec2, 'Кількість вильотів');
  agg.crewsOtr   = val(sec2, 'Задіяних екіпажів');
  agg.regOtr['Харківська'] = val(sec2, 'Харківська');
  agg.regOtr['Сумська']    = val(sec2, 'Сумська');
  agg.regOtr['Запорізька'] = val(sec2, 'Запор');
  // 429 завжди звітує по цих трьох областях (0 там, де немає збиття)
  agg.oblasts = { 'Харківська': true, 'Сумська': true, 'Запорізька': true };
  return agg;
}

// Будує 4 (або 5) рядків звіту для одного підрозділу.
function buildUnitRows_(unit, agg, layout) {
  const W = layout.lastCol;
  const blank = () => new Array(W).fill('');

  const mkMain = (type, total, crews, sorties, regMap, oblasts) => {
    const r = blank();
    r[layout.colUnit]  = unit.report;
    r[layout.colType]  = type;
    r[layout.colTotal] = total;
    if (layout.colCrews   >= 0) r[layout.colCrews]   = crews;
    if (layout.colSorties >= 0) r[layout.colSorties] = sorties;
    // По всіх областях, де бригада працює: значення збиття або 0 (не пусто).
    Object.keys(oblasts || {}).forEach(o => {
      const ci = layout.colByOblast[o];
      if (ci != null && ci >= 0) r[ci] = (regMap && regMap[o]) ? regMap[o] : 0;
    });
    return r;
  };
  const mkTotal = (type, total) => {
    const r = blank();
    r[layout.colUnit]  = unit.report;
    r[layout.colType]  = type;
    r[layout.colTotal] = total;
    return r;
  };

  // "Кількість задіяних розрахунків" заповнюється ВРУЧНУ → лишаємо порожнім.
  // Виняток — 429, де є чисте джерело (архів з полем "Задіяних екіпажів").
  // Порожні клітинки підсвічуються у fillReportForDate().
  const crewsSh  = unit.special429 ? agg.crewsSh  : '';
  const crewsOtr = unit.special429 ? agg.crewsOtr : '';

  const rows = [];
  rows.push(mkMain('Шахед/Герань', agg.shahed, crewsSh, agg.shSorties, agg.regSh, agg.oblasts));
  rows.push(mkTotal('Гербера', agg.gerbera));
  if (unit.reactive) rows.push(mkTotal('Шахед Реактивний', 0)); // окремо в даних не виділяється
  rows.push(mkMain('ОТР БПЛА', agg.otr, crewsOtr, agg.otrSorties, agg.regOtr, agg.oblasts));
  rows.push(mkTotal('Баражуючий боєприпас', agg.barrage));
  return rows;
}

// =================== ДОПОМІЖНЕ ===================

function newAgg_() {
  return { shahed:0, gerbera:0, otr:0, barrage:0,
           shSorties:0, otrSorties:0, crewsSh:0, crewsOtr:0,
           regSh:{}, regOtr:{}, oblasts:{} };  // oblasts — області, де бригада працює
}

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }
function norm_(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
function num_(v) { const n = parseInt(String(v).replace(/[^\d\-]/g, ''), 10); return isNaN(n) ? 0 : n; }
function fmtReport_(d) { return Utilities.formatDate(d, ss_().getSpreadsheetTimeZone(), 'dd.MM.yyyy'); }
function fmtData_(d)   { return Utilities.formatDate(d, ss_().getSpreadsheetTimeZone(), 'dd.MM.yy');   }

function parseShahedType_(cell) {
  const s = String(cell || '');
  const sh = s.match(/Shahed\s*[-–]\s*(\d+)/i);
  const gb = s.match(/Гербер\w*\s*[-–]\s*(\d+)/i);
  return { shahed: sh ? +sh[1] : 0, gerbera: gb ? +gb[1] : 0 };
}
function parseOtrType_(cell) {
  const s = String(cell || '');
  const bb = s.match(/боєпр\.?\s*[-–]\s*(\d+)/i);
  const ot = s.match(/ОТР\s*БпЛА\s*[-–]\s*(\d+)/i);
  return { barrage: bb ? +bb[1] : 0, otr: ot ? +ot[1] : 0 };
}

function dataColumns_(values) {
  let hdr = -1;
  for (let i = 0; i < values.length; i++) {
    if (values[i].some(c => norm_(c) === 'Назва БпЛА')) { hdr = i; break; }
  }
  if (hdr < 0) throw new Error('Не знайдено шапку "Дані по дням" (Назва БпЛА).');
  const row = values[hdr].map(norm_);
  const find = sub => row.findIndex(c => c.indexOf(sub) >= 0);
  return {
    headerRow:  hdr,
    name:       find('Назва БпЛА'),
    region:     find('Район виконання'),
    shSorties:  find('бойових вильотів Shahed'),
    shType:     find('Тип повітряної цілі Shahed'),
    otrSorties: find('бойових вильотів Б'),
    otrType:    find('Тип повітряної цілі Б'),
  };
}

function reportLayout_(repSheet) {
  const lastCol = Math.max(repSheet.getLastColumn(), OBLAST_CANON.length + 6);
  const scanN = Math.min(10, repSheet.getLastRow());
  const scan = repSheet.getRange(1, 1, scanN, lastCol).getValues();
  let hr = scan.findIndex(r => r.some(c => norm_(c) === 'Підрозділ'));
  if (hr < 0) hr = 0;
  const hdr = scan[hr].map(norm_);
  const idxOf = name => hdr.findIndex(c => c === name);

  const layout = {
    lastCol,
    headerRow:  hr + 1,
    colUnit:    idxOf('Підрозділ'),
    colType:    idxOf('Тип цілі'),
    colTotal:   idxOf('Всього'),
    colCrews:   hdr.findIndex(c => c.indexOf('задіяних розрахунків') >= 0),
    colSorties: hdr.findIndex(c => c.indexOf('Кількість вильотів') >= 0),
    colByOblast: {}
  };
  OBLAST_CANON.forEach(o => { const i = idxOf(o); if (i >= 0) layout.colByOblast[o] = i; });
  return layout;
}

function reportHasDate_(repSheet, reportDate) {
  if (repSheet.getLastRow() < 1) return false;
  const colA = repSheet.getRange(1, 1, repSheet.getLastRow(), 1)
                       .getDisplayValues().map(r => norm_(r[0]));
  return colA.indexOf(reportDate) >= 0;
}

function buildRegionMap_() {
  const sh = ss_().getSheetByName(CFG.regionSheet);
  const map = {};
  if (sh) sh.getDataRange().getValues().forEach(r => {
    const smuga = norm_(r[0]).toLowerCase();
    const obl   = norm_(r[1]);
    if (smuga && obl) map[smuga] = canonOblast_(obl);
  });
  return map;
}

function canonOblast_(obl) {
  const o = norm_(obl).toLowerCase();
  if (o.indexOf('дніпров') === 0 || o.indexOf('дніпропетров') === 0) return 'Дніпропетровська';
  if (o.indexOf('харків') === 0) return 'Харківська';
  if (o.indexOf('сум') === 0)    return 'Сумська';
  if (o.indexOf('донец') === 0)  return 'Донецька';
  if (o.indexOf('одес') === 0)   return 'Одеська';
  if (o.indexOf('чернігів') === 0) return 'Чернігівська';
  if (o.indexOf('житомир') === 0)  return 'Житомирська';
  if (o.indexOf('запор') === 0)  return 'Запорізька';
  if (o.indexOf('київ') === 0)   return 'Київська';
  if (o.indexOf('микола') === 0) return 'Миколаївська';
  return obl;
}

function smugaToOblast_(smuga, regionMap) {
  const raw = norm_(smuga);
  if (!raw) return null;
  const k = raw.toLowerCase();
  if (regionMap[k]) return regionMap[k];

  if (k.indexOf('сум') === 0)          return 'Сумська';
  if (k.indexOf('запор') === 0)        return 'Запорізька';
  if (k.indexOf('чернігів') === 0)     return 'Чернігівська';
  if (k.indexOf('одес') === 0)         return 'Одеська';
  if (k.indexOf('харків') === 0)       return 'Харківська';
  if (k.indexOf('дніпропетров') === 0) return 'Дніпропетровська';
  if (k === 'дніпро')                  return 'Дніпропетровська';
  if (k.indexOf('житомир') === 0)      return 'Житомирська';
  if (k.indexOf('микола') === 0)       return 'Миколаївська';
  if (k.indexOf('київ') === 0)         return 'Київська';
  if (k.indexOf('сіверськ') === 0)     return 'Харківська';
  if (raw.indexOf(',') >= 0)           return smugaToOblast_(raw.split(',')[0], regionMap);
  return null;
}
function dryRun_22_06() { dryRunForDate('22.06.2026'); }

function createArchiveTrigger() {
  // прибрати старі тригери цієї ж функції, щоб не дублювалися
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'archiveDailyReport')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('archiveDailyReport')
    .timeBased().everyDays(1).atHour(6).nearMinute(30)
    .inTimezone(ss_().getSpreadsheetTimeZone())
    .create();

  Logger.log('Архівний тригер створено: щодня о 06:30.');
}