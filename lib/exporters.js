'use strict';
const ExcelJS = require('exceljs');

const SUBSTANCES = ['coffee','tea','energy','khat','ginseng','kola','leonotis'];
const SUBSTANCE_LABELS = {
  coffee:'Coffee', tea:'Tea', energy:'Energy Drinks', khat:'Khat (Catha edulis)',
  ginseng:'Ginseng', kola:'Kola Nut', leonotis:'Leonotis leonurus (Wild Dagga)'
};
const FREQ    = ['Daily','Weekly','Monthly','Rarely'];
const REASONS = ['To stay awake / study','Habit / social','Enjoy taste','Other'];
const ATTITUDES = [
  'Using stimulants like khat can help students study for longer hours.',
  'Most of my close friends use caffeine products to help with studying.',
  'I am aware of the health risks associated with regular khat use.'
];
// Correct answers for Section B (for the knowledge score)
const KNOWLEDGE_KEY = { kn1: true, kn2: false, kn3: false, kn4: true };
const KNOWLEDGE_LABELS = {
  kn1: 'Active stimulant in khat is cathinone',
  kn2: 'Chronic khat use has no effect on dental health',
  kn3: 'Ginseng is legal for recreational use in Kenya',
  kn4: 'Excessive caffeine can cause anxiety and insomnia'
};

/* ---------------- helpers ---------------- */
function boolToStr(v) {
  if (v === true)  return 'True';
  if (v === false) return 'False';
  return '';
}
function pct(n, d) { return d > 0 ? Math.round((n / d) * 1000) / 10 : 0; }
function ageBand(age) {
  if (age == null) return '(blank)';
  if (age < 18) return '<18';
  if (age <= 20) return '18–20';
  if (age <= 23) return '21–23';
  if (age <= 26) return '24–26';
  if (age <= 30) return '27–30';
  return '31+';
}
function countBy(rows, key) {
  const m = new Map();
  for (const r of rows) {
    const v = (r[key] == null || r[key] === '') ? '(blank)' : String(r[key]);
    m.set(v, (m.get(v) || 0) + 1);
  }
  return m;
}
function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function mode(arr) {
  if (!arr.length) return null;
  const m = new Map();
  for (const v of arr) m.set(v, (m.get(v) || 0) + 1);
  let best = null, bestCount = 0;
  for (const [v, c] of m) if (c > bestCount) { best = v; bestCount = c; }
  return best;
}
function stddev(arr) {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((a, b) => a + (b - mean) ** 2, 0) / (arr.length - 1);
  return Math.round(Math.sqrt(variance) * 100) / 100;
}

/* ---------------- flatten for CSV / Raw Data sheet ---------------- */
function flatten(r) {
  const sub = r.substances || {};
  const att = r.attitudes  || {};
  const out = {
    id: r.id,
    submitted_at: r.submitted_at instanceof Date ? r.submitted_at.toISOString() : r.submitted_at,
    age: r.age ?? '',
    gender: r.gender || '',
    year_of_study: r.year_of_study || '',
    residence: r.residence || '',
    kn1: boolToStr(r.kn1), kn2: boolToStr(r.kn2), kn3: boolToStr(r.kn3), kn4: boolToStr(r.kn4)
  };
  for (const s of SUBSTANCES) {
    const row = sub[s] || {};
    for (const f of ['c1','c2','c3','c4','c5']) out[`${s}_${f}`] = row[f] || '';
  }
  out.att1 = att.att1 ?? '';
  out.att2 = att.att2 ?? '';
  out.att3 = att.att3 ?? '';
  out.other_substance   = r.other_substance   || '';
  out.perceived_effects = r.perceived_effects || '';
  return out;
}

/* ---------------- CSV ---------------- */
function toCSV(rows) {
  const flat = rows.map(flatten);
  if (!flat.length) return '';
  const headers = Object.keys(flat[0]);
  const esc = v => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(',')];
  for (const r of flat) lines.push(headers.map(h => esc(r[h])).join(','));
  return '\uFEFF' + lines.join('\n');   // BOM → Excel opens UTF-8 correctly
}

/* ---------------- Excel ---------------- */
function styleHeaderRow(ws) {
  const row = ws.getRow(1);
  row.font = { bold: true, color: { argb: 'FF14603A' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5EE' } };
  row.alignment = { vertical: 'middle' };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

function addCoverSheet(wb, { total, today, khatEver, filters }) {
  const ws = wb.addWorksheet('Cover');
  ws.columns = [{ width: 30 }, { width: 60 }];
  ws.addRow(['Plant Stimulant Use Survey']).font = { bold: true, size: 16 };
  ws.addRow(['Kenya Medical Training College – Nakuru Campus']);
  ws.addRow([]);
  ws.addRow(['Generated',  new Date().toLocaleString()]);
  ws.addRow(['Total submitted', total]);
  ws.addRow(['Submitted today', today]);
  ws.addRow(['Khat — ever used', `${khatEver} (${pct(khatEver, total)}%)`]);
  ws.addRow([]);
  ws.addRow(['Filters']).font = { bold: true };
  const f = filters || {};
  ws.addRow(['From date', f.from || 'all']);
  ws.addRow(['To date',   f.to   || 'all']);
  ws.addRow(['Gender',    f.gender || 'all']);
  ws.addRow(['Year',      f.year   || 'all']);
  ws.addRow(['Khat',      f.khat   || 'all']);
}

function addRawSheet(wb, rows) {
  const flat = rows.map(flatten);
  if (!flat.length) return;
  const headers = Object.keys(flat[0]);
  const ws = wb.addWorksheet('Raw Data');
  ws.columns = headers.map(h => ({ header: h, key: h, width: Math.max(12, Math.min(28, h.length + 4)) }));
  for (const r of flat) ws.addRow(r);
  styleHeaderRow(ws);
}

function addDemographicsSheet(wb, rows) {
  const ws = wb.addWorksheet('Demographics');
  ws.columns = [{ header: 'Category', key: 'c', width: 18 }, { header: 'Value', key: 'v', width: 30 }, { header: 'Count', key: 'n', width: 10 }, { header: '%', key: 'p', width: 10 }];
  const addBlock = (label, map, total) => {
    ws.addRow({ c: label, v: '', n: '', p: '' }).font = { bold: true };
    for (const [v, n] of map) ws.addRow({ c: '', v, n, p: pct(n, total) + '%' });
    ws.addRow({ c: '', v: 'TOTAL', n: total, p: '100%' });
    ws.addRow({});
  };
  addBlock('Age band', countBy(rows.map(r => ({ ab: ageBand(r.age) })), 'ab'), rows.length);
  addBlock('Gender',   countBy(rows, 'gender'),       rows.length);
  addBlock('Year of study', countBy(rows, 'year_of_study'), rows.length);
  addBlock('Residence', countBy(rows, 'residence'),   rows.length);
  styleHeaderRow(ws);
}

function addKnowledgeSheet(wb, rows) {
  const ws = wb.addWorksheet('Knowledge');
  ws.columns = [
    { header: 'Question', key: 'q', width: 55 },
    { header: 'Correct answer', key: 'k', width: 15 },
    { header: 'Correct n', key: 'cn', width: 12 },
    { header: 'Answered n', key: 'an', width: 12 },
    { header: '% correct', key: 'p', width: 12 }
  ];
  for (const [id, label] of Object.entries(KNOWLEDGE_LABELS)) {
    const want = KNOWLEDGE_KEY[id];
    let correct = 0, answered = 0;
    for (const r of rows) {
      if (r[id] === true || r[id] === false) {
        answered++;
        if (r[id] === want) correct++;
      }
    }
    ws.addRow({ q: label, k: want ? 'True' : 'False', cn: correct, an: answered, p: pct(correct, answered) + '%' });
  }
  styleHeaderRow(ws);
}

function addPrevalenceSheet(wb, rows) {
  const ws = wb.addWorksheet('Prevalence');
  ws.columns = [
    { header: 'Substance', key: 's', width: 30 },
    { header: 'Ever %', key: 'e', width: 12 },
    { header: 'Past 12mo %', key: 'y', width: 14 },
    { header: 'Past 30d %', key: 'm', width: 14 },
    { header: 'n (ever Yes)', key: 'n', width: 14 }
  ];
  const total = rows.length;
  for (const id of SUBSTANCES) {
    let ever = 0, past12 = 0, past30 = 0;
    for (const r of rows) {
      const sub = (r.substances || {})[id] || {};
      if (sub.c1 === 'Yes') ever++;
      if (sub.c2 === 'Yes') past12++;
      if (sub.c3 === 'Yes') past30++;
    }
    ws.addRow({
      s: SUBSTANCE_LABELS[id],
      e: pct(ever, total) + '%',
      y: pct(past12, total) + '%',
      m: pct(past30, total) + '%',
      n: ever
    });
  }
  styleHeaderRow(ws);
}

function addFrequencySheet(wb, rows) {
  const ws = wb.addWorksheet('Frequency');
  ws.columns = [
    { header: 'Substance', key: 's', width: 30 },
    ...FREQ.map(f => ({ header: f, key: f, width: 12 })),
    { header: 'Answered', key: 'n', width: 12 }
  ];
  for (const id of SUBSTANCES) {
    const counts = Object.fromEntries(FREQ.map(f => [f, 0]));
    let answered = 0;
    for (const r of rows) {
      const sub = (r.substances || {})[id] || {};
      const v = sub.c4;
      if (v && counts[v] != null) { counts[v]++; answered++; }
    }
    ws.addRow({ s: SUBSTANCE_LABELS[id], ...counts, n: answered });
  }
  styleHeaderRow(ws);
}

function addReasonsSheet(wb, rows) {
  const ws = wb.addWorksheet('Reasons');
  ws.columns = [
    { header: 'Substance', key: 's', width: 30 },
    ...REASONS.map(f => ({ header: f, key: f, width: 20 })),
    { header: 'Answered', key: 'n', width: 12 }
  ];
  for (const id of SUBSTANCES) {
    const counts = Object.fromEntries(REASONS.map(r => [r, 0]));
    let answered = 0;
    for (const r of rows) {
      const sub = (r.substances || {})[id] || {};
      const v = sub.c5;
      if (v && counts[v] != null) { counts[v]++; answered++; }
    }
    ws.addRow({ s: SUBSTANCE_LABELS[id], ...counts, n: answered });
  }
  styleHeaderRow(ws);
}

function addAttitudesSheet(wb, rows) {
  const ws = wb.addWorksheet('Attitudes');
  ws.columns = [
    { header: 'Statement', key: 's', width: 60 },
    { header: 'Mean', key: 'm', width: 10 },
    { header: 'Median', key: 'md', width: 10 },
    { header: 'Mode', key: 'mo', width: 10 },
    { header: 'SD', key: 'sd', width: 10 },
    { header: 'n', key: 'n', width: 10 }
  ];
  ATTITUDES.forEach((label, i) => {
    const key = 'att' + (i + 1);
    const vals = rows.map(r => (r.attitudes || {})[key]).filter(v => typeof v === 'number' && v >= 1 && v <= 5);
    const mean = vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100 : null;
    ws.addRow({
      s: label,
      m: mean ?? '',
      md: median(vals) ?? '',
      mo: mode(vals) ?? '',
      sd: stddev(vals),
      n: vals.length
    });
  });
  styleHeaderRow(ws);
}

function addCrossTabsSheet(wb, rows) {
  const ws = wb.addWorksheet('Cross-tabs');
  ws.columns = [
    { header: 'Stratum', key: 's', width: 20 },
    { header: 'Value', key: 'v', width: 20 },
    { header: 'n', key: 'n', width: 10 },
    { header: 'Khat ever used', key: 'k', width: 16 },
    { header: 'Khat ever %', key: 'p', width: 14 }
  ];
  const strat = (title, field) => {
    const groups = new Map();
    for (const r of rows) {
      const v = r[field] || '(blank)';
      const khat = ((r.substances || {}).khat || {}).c1 === 'Yes';
      if (!groups.has(v)) groups.set(v, { n: 0, k: 0 });
      const g = groups.get(v);
      g.n++; if (khat) g.k++;
    }
    ws.addRow({ s: title }).font = { bold: true };
    for (const [v, g] of groups) ws.addRow({ s: '', v, n: g.n, k: g.k, p: pct(g.k, g.n) + '%' });
    ws.addRow({});
  };
  strat('By year of study', 'year_of_study');
  strat('By gender', 'gender');
  strat('By residence', 'residence');
  ws.addRow({ s: 'By age band' }).font = { bold: true };
  const ageGroups = new Map();
  for (const r of rows) {
    const v = ageBand(r.age);
    const khat = ((r.substances || {}).khat || {}).c1 === 'Yes';
    if (!ageGroups.has(v)) ageGroups.set(v, { n: 0, k: 0 });
    const g = ageGroups.get(v);
    g.n++; if (khat) g.k++;
  }
  for (const [v, g] of ageGroups) ws.addRow({ s: '', v, n: g.n, k: g.k, p: pct(g.k, g.n) + '%' });
  styleHeaderRow(ws);
}

async function buildWorkbook(rows, context) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'KMTC Nakuru Survey';
  wb.created = new Date();
  addCoverSheet(wb, context);
  addRawSheet(wb, rows);
  addDemographicsSheet(wb, rows);
  addKnowledgeSheet(wb, rows);
  addPrevalenceSheet(wb, rows);
  addFrequencySheet(wb, rows);
  addReasonsSheet(wb, rows);
  addAttitudesSheet(wb, rows);
  addCrossTabsSheet(wb, rows);
  return wb;
}

module.exports = {
  SUBSTANCES, SUBSTANCE_LABELS, ATTITUDES, KNOWLEDGE_LABELS, KNOWLEDGE_KEY,
  flatten, toCSV, buildWorkbook, pct, ageBand
};