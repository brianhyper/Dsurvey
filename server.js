require('dotenv').config();
const express = require('express');
const session = require('express-session');
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const exporters = require('./lib/exporters');

const app = express();
const PORT = process.env.PORT || 3000;
const VERSION = '0.1.0-phase1';
const STARTED_AT = Date.now();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000
});

pool.on('error', err => console.error('[db] idle client error:', err.message));

app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// JSON parse errors → JSON response, never HTML
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ ok: false, error: 'Malformed JSON in request body.' });
  }
  next(err);
});

if (!process.env.SESSION_SECRET) {
  console.warn('[warn] SESSION_SECRET not set — using ephemeral random secret. Sessions will reset on every restart.');
}
if (!process.env.ADMIN_PASSWORD) {
  console.warn('[warn] ADMIN_PASSWORD not set — admin login will be impossible.');
}

app.use(session({
  //secure: process.env.COOKIE_SECURE !== 'false',
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE !== 'false',                 // change later before prod deployment - secure: true,
    maxAge: 1000 * 60 * 60 * 8
  }
}));

const PUBLIC_DIR = path.join(__dirname, 'public');
if (fs.existsSync(PUBLIC_DIR)) app.use(express.static(PUBLIC_DIR));

// Cheap liveness probe — no DB, no I/O.
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    version: VERSION,
    uptime_secs: Math.round((Date.now() - STARTED_AT) / 1000),
    now: new Date().toISOString()
  });
});

// Manual DB verification.
app.get('/db-check', async (req, res) => {
  try {
    const t0 = Date.now();
    const { rows: [{ version }] } = await pool.query('SELECT version()');
    const { rows: [{ count: responseCount }] } = await pool.query(
      'SELECT COUNT(*)::int AS count FROM responses'
    );
    const { rows: [{ count: draftCount }] } = await pool.query(
      'SELECT COUNT(*)::int AS count FROM draft_progress'
    );
    const { rows: [summary] } = await pool.query('SELECT * FROM v_response_summary');

    res.json({
      ok: true,
      latency_ms: Date.now() - t0,
      postgres_version: version.split(' ').slice(0, 2).join(' '),
      tables: { responses: responseCount, draft_progress: draftCount },
      summary_view: summary
    });
  } catch (err) {
    console.error('[db-check] failed:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ---------- submit helpers ---------- */
const SUBSTANCE_IDS = ['coffee','tea','energy','khat','ginseng','kola','leonotis'];
const ATTITUDE_IDS  = ['att1','att2','att3'];

function hashIp(ip) {
  return crypto.createHash('sha256')
    .update(String(ip) + (process.env.SESSION_SECRET || ''))
    .digest('hex').slice(0, 16);
}

function boolFromTF(v) {
  if (v === 'True'  || v === true)  return true;
  if (v === 'False' || v === false) return false;
  return null;
}

function reshapeSubmission(b) {
  const substances = {};
  for (const id of SUBSTANCE_IDS) {
    substances[id] = {
      c1: b[`${id}_c1`] || null,
      c2: b[`${id}_c2`] || null,
      c3: b[`${id}_c3`] || null,
      c4: b[`${id}_c4`] || null,
      c5: b[`${id}_c5`] || null
    };
  }
  const attitudes = {};
  for (const id of ATTITUDE_IDS) {
    const v = b[id];
    attitudes[id] = (v != null && v !== '') ? Number(v) : null;
  }
  return {
    age:               b.age ? Number(b.age) : null,
    gender:            b.gender || null,
    year_of_study:     b.year || null,
    residence:         b.residence || null,
    kn1: boolFromTF(b.kn1),
    kn2: boolFromTF(b.kn2),
    kn3: boolFromTF(b.kn3),
    kn4: boolFromTF(b.kn4),
    substances,
    attitudes,
    perceived_effects: b.perceived_effects || null,
    other_substance:   b.other_substance || null,
    consent_given:     !!b.consent
  };
}

/* ---------- submit ---------- */
app.post('/api/submit', async (req, res) => {
  const b = req.body || {};

  // honeypot: if filled, this is a bot — pretend success, drop silently
  if (b._hp) return res.json({ ok: true, id: null });

  if (!b.consent) {
    return res.status(400).json({ ok: false, error: 'Consent is required.' });
  }
  if (!b.age || !b.gender || !b.year || !b.residence) {
    return res.status(400).json({ ok: false, error: 'Missing required demographic fields.' });
  }

  try {
    const r = reshapeSubmission(b);
    const { rows: [row] } = await pool.query(
      `INSERT INTO responses
         (status, submitted_at, last_activity, ip_hash, user_agent,
          age, gender, year_of_study, residence,
          kn1, kn2, kn3, kn4,
          substances, other_substance, attitudes, perceived_effects, consent_given)
       VALUES
         ('submitted', now(), now(), $1, $2,
          $3, $4, $5, $6,
          $7, $8, $9, $10,
          $11::jsonb, $12, $13::jsonb, $14, $15)
       RETURNING id, submitted_at`,
      [
        hashIp(req.ip), (req.get('user-agent') || '').slice(0, 200),
        r.age, r.gender, r.year_of_study, r.residence,
        r.kn1, r.kn2, r.kn3, r.kn4,
        JSON.stringify(r.substances), r.other_substance,
        JSON.stringify(r.attitudes), r.perceived_effects, r.consent_given
      ]
    );
    console.log(`[submit] stored response ${row.id}`);
    res.json({ ok: true, id: row.id, submitted_at: row.submitted_at });
  } catch (err) {
    console.error('[submit] failed:', err.message);
    res.status(500).json({ ok: false, error: 'Server error.' });
  }
});


/* ---------- admin auth ---------- */
function requireAdmin(req, res, next) {
  if (req.session && req.session.admin) return next();
  res.status(401).json({ ok: false, error: 'Unauthorized' });
}

function safePasswordEqual(a, b) {
  const ab = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  // timingSafeEqual needs equal-length buffers; pad the shorter to avoid a length oracle
  const len = Math.max(ab.length, bb.length, 1);
  const aPad = Buffer.alloc(len); ab.copy(aPad);
  const bPad = Buffer.alloc(len); bb.copy(bPad);
  return crypto.timingSafeEqual(aPad, bPad) && ab.length === bb.length;
}

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  const expected = process.env.ADMIN_PASSWORD;

  if (!expected) {
    console.error('[admin] ADMIN_PASSWORD not set — refusing login');
    return res.status(500).json({ ok: false, error: 'Server misconfigured.' });
  }

  if (!password || !safePasswordEqual(password, expected)) {
    console.warn(`[admin] failed login from ${req.ip}`);
    // small friction — makes brute force noticeably slower without locking anyone out
    return setTimeout(() => {
      res.status(401).json({ ok: false, error: 'Invalid password.' });
    }, 800);
  }

  req.session.admin = true;
  console.log(`[admin] login ok from ${req.ip}`);
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) console.error('[admin] logout error:', err.message);
    res.json({ ok: true });
  });
});

app.get('/api/admin/me', (req, res) => {
  res.json({ ok: true, admin: !!(req.session && req.session.admin) });
});


app.get('/api/admin/responses', requireAdmin, async (req, res) => {
  try {
    // ---------- pagination ----------
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 25, 1), 200);
    const page  = Math.max(parseInt(req.query.page)  || 1, 1);
    const offset = (page - 1) * limit;

    // ---------- filters ----------
    const conditions = ["status = 'submitted'"];
    const params = [];
    let p = 1;

    if (req.query.from)   { conditions.push(`submitted_at >= $${p++}`); params.push(req.query.from); }
    if (req.query.to)     { conditions.push(`submitted_at <  $${p++}`); params.push(req.query.to);   }
    if (req.query.gender) { conditions.push(`gender = $${p++}`);        params.push(req.query.gender); }
    if (req.query.year)   { conditions.push(`year_of_study = $${p++}`); params.push(req.query.year);   }

    if (req.query.khat === 'yes') conditions.push(`substances->'khat'->>'c1' = 'Yes'`);
    if (req.query.khat === 'no')  conditions.push(`(substances->'khat'->>'c1' IS NULL OR substances->'khat'->>'c1' = 'No')`);

    const where = 'WHERE ' + conditions.join(' AND ');

    // ---------- stats (unfiltered, always across all submitted) ----------
    const { rows: [stats] } = await pool.query(`
      SELECT
        COUNT(*)                                                       AS total_submitted,
        COUNT(*) FILTER (WHERE submitted_at::date = CURRENT_DATE)      AS today,
        COUNT(*) FILTER (WHERE substances->'khat'->>'c1' = 'Yes')      AS khat_ever,
        MAX(submitted_at)                                              AS latest
      FROM responses
      WHERE status = 'submitted'
    `);

    // ---------- filtered total ----------
    const { rows: [{ total }] } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM responses ${where}`, params
    );

    // ---------- page of rows ----------
    const { rows: items } = await pool.query(
      `SELECT id, submitted_at,
              age, gender, year_of_study, residence,
              kn1, kn2, kn3, kn4,
              substances, attitudes,
              perceived_effects, other_substance
         FROM responses
         ${where}
         ORDER BY submitted_at DESC
         LIMIT $${p++} OFFSET $${p++}`,
      [...params, limit, offset]
    );

    res.json({
      ok: true,
      stats: {
        total_submitted: Number(stats.total_submitted),
        today:           Number(stats.today),
        khat_ever:       Number(stats.khat_ever),
        khat_ever_pct:   stats.total_submitted > 0
          ? Math.round((stats.khat_ever / stats.total_submitted) * 100)
          : 0,
        latest: stats.latest
      },
      filter: { total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) },
      items
    });
  } catch (err) {
    console.error('[admin/responses] failed:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to load responses.' });
  }
});

/* ---------- shared filter builder ---------- */
function buildFilterQuery(req) {
  const conditions = ["status = 'submitted'"];
  const params = [];
  let p = 1;
  if (req.query.from)   { conditions.push(`submitted_at >= $${p++}`); params.push(req.query.from); }
  if (req.query.to)     { conditions.push(`submitted_at <  $${p++}`); params.push(req.query.to);   }
  if (req.query.gender) { conditions.push(`gender = $${p++}`);        params.push(req.query.gender); }
  if (req.query.year)   { conditions.push(`year_of_study = $${p++}`); params.push(req.query.year);   }
  if (req.query.khat === 'yes') conditions.push(`substances->'khat'->>'c1' = 'Yes'`);
  if (req.query.khat === 'no')  conditions.push(`(substances->'khat'->>'c1' IS NULL OR substances->'khat'->>'c1' = 'No')`);
  return { where: 'WHERE ' + conditions.join(' AND '), params };
}

/* ---------- CSV export ---------- */
app.get('/api/admin/export.csv', requireAdmin, async (req, res) => {
  try {
    const { where, params } = buildFilterQuery(req);
    const { rows } = await pool.query(
      `SELECT * FROM responses ${where} ORDER BY submitted_at DESC`, params
    );
    if (!rows.length) return res.status(404).send('No responses match the filters.');

    const csv = exporters.toCSV(rows);
    const fname = `survey_responses_${new Date().toISOString().slice(0,10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    res.send(csv);
  } catch (err) {
    console.error('[export.csv] failed:', err.message);
    res.status(500).json({ ok: false, error: 'CSV export failed.' });
  }
});

/* ---------- Excel export ---------- */
app.get('/api/admin/export.xlsx', requireAdmin, async (req, res) => {
  try {
    const { where, params } = buildFilterQuery(req);
    const { rows } = await pool.query(
      `SELECT * FROM responses ${where} ORDER BY submitted_at DESC`, params
    );
    if (!rows.length) return res.status(404).send('No responses match the filters.');

    const khatEver = rows.filter(r => ((r.substances || {}).khat || {}).c1 === 'Yes').length;
    const today = new Date().toISOString().slice(0,10);
    const todayCount = rows.filter(r => {
      const d = r.submitted_at instanceof Date ? r.submitted_at.toISOString() : r.submitted_at;
      return String(d).slice(0,10) === today;
    }).length;

    const wb = await exporters.buildWorkbook(rows, {
      total: rows.length,
      today: todayCount,
      khatEver,
      filters: {
        from: req.query.from, to: req.query.to,
        gender: req.query.gender, year: req.query.year, khat: req.query.khat
      }
    });

    const fname = `survey_export_${new Date().toISOString().slice(0,10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('[export.xlsx] failed:', err.message);
    res.status(500).json({ ok: false, error: 'Excel export failed.' });
  }
});


/* ---------- admin page ---------- */
app.get('/admin', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'admin.html'));
});



app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'Not found', path: req.path });
});

async function start() {
  try {
    await pool.query('SELECT 1');
    console.log('[db] connected');
  } catch (err) {
    console.error('[db] connection failed:', err.message);
    process.exit(1);
  }
 

  // Final error handler — never leak stack traces
app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  res.status(500).json({ ok: false, error: 'Server error.' });
});


  app.listen(PORT, () => {
    console.log(`[server] ${VERSION} listening on http://0.0.0.0:${PORT}`);
    console.log(`[server]   → /health`);
    console.log(`[server]   → /db-check`);
  });
}

process.on('SIGTERM', async () => {
  console.log('[server] SIGTERM — shutting down');
  await pool.end();
  process.exit(0);
});

start();