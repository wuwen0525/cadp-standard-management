import { createServer } from 'node:http';
import { cpSync, createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(ROOT, process.env.DATA_DIR || '.runtime');
const UPLOAD_DIR = join(DATA_DIR, 'uploads');
const BACKUP_DIR = join(DATA_DIR, 'backups');
const IMPORT_DIR = join(DATA_DIR, 'imports');
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 3000);
const SESSION_DAYS = Math.max(1, Number(process.env.SESSION_DAYS || 7));
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const MAX_BODY = 30 * 1024 * 1024;
const eventClients = new Set();
let dataRevision = Date.now();

mkdirSync(UPLOAD_DIR, { recursive: true });
mkdirSync(BACKUP_DIR, { recursive: true });
mkdirSync(IMPORT_DIR, { recursive: true });
const db = new DatabaseSync(join(DATA_DIR, 'cadp.db'));
db.exec([
  'PRAGMA foreign_keys = ON;',
  'PRAGMA journal_mode = WAL;',
  'CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, display_name TEXT NOT NULL, role TEXT NOT NULL DEFAULT \'admin\', active INTEGER NOT NULL DEFAULT 1, password_changed_at TEXT, created_at TEXT NOT NULL, last_login_at TEXT);',
  'CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);',
  'CREATE TABLE IF NOT EXISTS projects (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, code TEXT NOT NULL DEFAULT \'\', owner TEXT NOT NULL DEFAULT \'\', due_date TEXT NOT NULL DEFAULT \'\', current_stage INTEGER NOT NULL DEFAULT 1 CHECK(current_stage BETWEEN 1 AND 15), status TEXT NOT NULL DEFAULT \'在研\', archived INTEGER NOT NULL DEFAULT 0, files_count INTEGER NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT \'\', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);',
  'CREATE TABLE IF NOT EXISTS missing_items (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, stage INTEGER NOT NULL CHECK(stage BETWEEN 1 AND 15), material TEXT NOT NULL, category TEXT NOT NULL, state TEXT NOT NULL DEFAULT \'open\' CHECK(state IN (\'open\',\'resolved\',\'ignored\')), source TEXT NOT NULL DEFAULT \'人工添加\', filename TEXT, updated_at TEXT NOT NULL);',
  'CREATE TABLE IF NOT EXISTS documents (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, missing_item_id INTEGER REFERENCES missing_items(id) ON DELETE SET NULL, stage INTEGER NOT NULL, original_name TEXT NOT NULL, stored_name TEXT NOT NULL, mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL, uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL);',
  'CREATE TABLE IF NOT EXISTS activities (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL, project_name TEXT NOT NULL, action TEXT NOT NULL, operator TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL);',
  'CREATE TABLE IF NOT EXISTS roadmap_items (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, owner TEXT NOT NULL DEFAULT \'待指定\', due TEXT NOT NULL DEFAULT \'待确定\', done INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);',
  'CREATE TABLE IF NOT EXISTS published_standards (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, year INTEGER NOT NULL);',
  'CREATE TABLE IF NOT EXISTS ledger_imports (source_name TEXT PRIMARY KEY, source_hash TEXT NOT NULL, source_modified_at TEXT NOT NULL, imported_at TEXT NOT NULL, record_count INTEGER NOT NULL DEFAULT 0, published_count INTEGER NOT NULL DEFAULT 0, plan_count INTEGER NOT NULL DEFAULT 0);',
  'CREATE TABLE IF NOT EXISTS ledger_records (id INTEGER PRIMARY KEY AUTOINCREMENT, source_key TEXT NOT NULL UNIQUE, source_sheet TEXT NOT NULL, source_row INTEGER NOT NULL, serial TEXT NOT NULL DEFAULT \'\', project_name TEXT NOT NULL, plan_code TEXT NOT NULL DEFAULT \'\', standard_code TEXT NOT NULL DEFAULT \'\', current_stage INTEGER NOT NULL DEFAULT 1 CHECK(current_stage BETWEEN 1 AND 15), status TEXT NOT NULL DEFAULT \'在研\', commissioning_unit TEXT NOT NULL DEFAULT \'\', contact TEXT NOT NULL DEFAULT \'\', contract_info TEXT NOT NULL DEFAULT \'\', establishment_fee TEXT NOT NULL DEFAULT \'\', review_fee TEXT NOT NULL DEFAULT \'\', publication_fee TEXT NOT NULL DEFAULT \'\', total_fee TEXT NOT NULL DEFAULT \'\', expert_fee TEXT NOT NULL DEFAULT \'\', remarks TEXT NOT NULL DEFAULT \'\', progress_json TEXT NOT NULL DEFAULT \'[]\', linked_project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL, source_modified_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);',
  'CREATE TABLE IF NOT EXISTS ledger_published (id INTEGER PRIMARY KEY AUTOINCREMENT, source_key TEXT NOT NULL UNIQUE, source_row INTEGER NOT NULL, name TEXT NOT NULL, code TEXT NOT NULL DEFAULT \'\', publisher TEXT NOT NULL DEFAULT \'\', release_date TEXT NOT NULL DEFAULT \'\', plan_code TEXT NOT NULL DEFAULT \'\', source_modified_at TEXT NOT NULL, updated_at TEXT NOT NULL);',
  'CREATE TABLE IF NOT EXISTS annual_plans (id INTEGER PRIMARY KEY AUTOINCREMENT, source_key TEXT NOT NULL UNIQUE, source_row INTEGER NOT NULL, year INTEGER NOT NULL, name TEXT NOT NULL, source_modified_at TEXT NOT NULL, updated_at TEXT NOT NULL);',
  'CREATE INDEX IF NOT EXISTS idx_missing_project ON missing_items(project_id, state);',
  'CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project_id, stage);',
  'CREATE INDEX IF NOT EXISTS idx_activities_created ON activities(created_at DESC);',
  'CREATE INDEX IF NOT EXISTS idx_ledger_stage ON ledger_records(status, current_stage);',
  'CREATE INDEX IF NOT EXISTS idx_annual_plans_year ON annual_plans(year);'
].join('\n'));

function ensureColumn(table, column, definition) {
  const columns = db.prepare('PRAGMA table_info(' + table + ')').all();
  if (!columns.some(item => item.name === column)) db.exec('ALTER TABLE ' + table + ' ADD COLUMN ' + column + ' ' + definition);
}

ensureColumn('users', 'active', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('users', 'password_changed_at', 'TEXT');
ensureColumn('projects', 'archived', 'INTEGER NOT NULL DEFAULT 0');
db.exec('CREATE INDEX IF NOT EXISTS idx_projects_archived ON projects(archived, status, current_stage);');

function now() {
  return new Date().toISOString();
}

function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  return salt + ':' + scryptSync(password, salt, 64).toString('hex');
}

function verifyPassword(password, stored) {
  const [salt, expectedHex] = String(stored).split(':');
  if (!salt || !expectedHex) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function loadSeeds() {
  const source = readFileSync(join(ROOT, 'data.js'), 'utf8');
  return vm.runInNewContext(source + '\n;({ publishedStandards, detailedProjects, seedProjects, seedMissing, roadmapSeed })', Object.create(null));
}

function projectKey(value) {
  return String(value || '').replace(/防洪防涝排水/g, '防洪排涝').replace(/[^\u4e00-\u9fffA-Za-z0-9]/g, '');
}

function findLinkedProject(projects, name) {
  const target = projectKey(name);
  if (!target) return null;
  const exact = projects.find(project => projectKey(project.name) === target);
  if (exact) return exact;
  if (target.length < 8) return null;
  const candidates = projects.filter(project => {
    const candidate = projectKey(project.name);
    return candidate.length >= 8 && (candidate.includes(target) || target.includes(candidate));
  });
  return candidates.length === 1 ? candidates[0] : null;
}

function importLegacyLedger() {
  const importFile = join(IMPORT_DIR, 'legacy-ledger.json');
  if (!existsSync(importFile)) return null;
  const payload = JSON.parse(readFileSync(importFile, 'utf8'));
  if (payload.schemaVersion !== 1 || !Array.isArray(payload.records) || !Array.isArray(payload.published) || !Array.isArray(payload.plans)) throw new Error('历史台账导入文件格式不正确');
  const sourceName = String(payload.sourceName || '历史台账');
  const sourceHash = String(payload.sourceHash || '');
  const previous = db.prepare('SELECT * FROM ledger_imports WHERE source_name = ?').get(sourceName);
  if (previous?.source_hash === sourceHash) return previous;
  const stamp = now();
  const sourceModifiedAt = String(payload.sourceModifiedAt || stamp);
  const projects = db.prepare('SELECT id, name FROM projects').all();
  const upsertRecord = db.prepare(`INSERT INTO ledger_records (
    source_key, source_sheet, source_row, serial, project_name, plan_code, standard_code, current_stage, status,
    commissioning_unit, contact, contract_info, establishment_fee, review_fee, publication_fee, total_fee,
    expert_fee, remarks, progress_json, linked_project_id, source_modified_at, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(source_key) DO UPDATE SET source_sheet = excluded.source_sheet, source_row = excluded.source_row,
    serial = excluded.serial, project_name = excluded.project_name, plan_code = excluded.plan_code,
    standard_code = excluded.standard_code, current_stage = excluded.current_stage, status = excluded.status,
    commissioning_unit = excluded.commissioning_unit, contact = excluded.contact, contract_info = excluded.contract_info,
    establishment_fee = excluded.establishment_fee, review_fee = excluded.review_fee,
    publication_fee = excluded.publication_fee, total_fee = excluded.total_fee, expert_fee = excluded.expert_fee,
    remarks = excluded.remarks, progress_json = excluded.progress_json,
    linked_project_id = COALESCE(ledger_records.linked_project_id, excluded.linked_project_id),
    source_modified_at = excluded.source_modified_at, updated_at = excluded.updated_at`);
  const upsertPublished = db.prepare(`INSERT INTO ledger_published (source_key, source_row, name, code, publisher, release_date, plan_code, source_modified_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_key) DO UPDATE SET source_row = excluded.source_row, name = excluded.name, code = excluded.code,
      publisher = excluded.publisher, release_date = excluded.release_date, plan_code = excluded.plan_code,
      source_modified_at = excluded.source_modified_at, updated_at = excluded.updated_at`);
  const upsertPlan = db.prepare(`INSERT INTO annual_plans (source_key, source_row, year, name, source_modified_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_key) DO UPDATE SET source_row = excluded.source_row, year = excluded.year, name = excluded.name,
      source_modified_at = excluded.source_modified_at, updated_at = excluded.updated_at`);
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const item of payload.records) {
      const linked = findLinkedProject(projects, item.projectName);
      upsertRecord.run(
        String(item.sourceKey), String(item.sourceSheet), Number(item.sourceRow), String(item.serial || ''),
        String(item.projectName), String(item.planCode || ''), String(item.standardCode || ''),
        Math.min(15, Math.max(1, Number(item.currentStage || 1))), String(item.status || '在研'),
        String(item.commissioningUnit || ''), String(item.contact || ''), String(item.contractInfo || ''),
        String(item.establishmentFee || ''), String(item.reviewFee || ''), String(item.publicationFee || ''),
        String(item.totalFee || ''), String(item.expertFee || ''), String(item.remarks || ''),
        JSON.stringify(Array.isArray(item.progress) ? item.progress : []), linked?.id || null,
        sourceModifiedAt, stamp, stamp
      );
    }
    for (const item of payload.published) upsertPublished.run(String(item.sourceKey), Number(item.sourceRow), String(item.name), String(item.code || ''), String(item.publisher || ''), String(item.releaseDate || ''), String(item.planCode || ''), sourceModifiedAt, stamp);
    for (const item of payload.plans) upsertPlan.run(String(item.sourceKey), Number(item.sourceRow), Number(item.year || 2025), String(item.name), sourceModifiedAt, stamp);
    db.prepare(`INSERT INTO ledger_imports (source_name, source_hash, source_modified_at, imported_at, record_count, published_count, plan_count)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_name) DO UPDATE SET source_hash = excluded.source_hash, source_modified_at = excluded.source_modified_at,
        imported_at = excluded.imported_at, record_count = excluded.record_count, published_count = excluded.published_count,
        plan_count = excluded.plan_count`).run(sourceName, sourceHash, sourceModifiedAt, stamp, payload.records.length, payload.published.length, payload.plans.length);
    db.prepare('INSERT INTO activities (project_id, project_name, action, operator, result, created_at) VALUES (NULL, ?, ?, ?, ?, ?)').run('历史 Excel 台账', `导入 ${payload.records.length} 条项目、${payload.published.length} 条发布记录和 ${payload.plans.length} 条年度计划`, '系统', '已完成', stamp);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return db.prepare('SELECT * FROM ledger_imports WHERE source_name = ?').get(sourceName);
}

function seedDatabase() {
  const seeds = loadSeeds();
  const stamp = now();
  if (db.prepare('SELECT COUNT(*) AS total FROM projects').get().total === 0) {
    const insert = db.prepare('INSERT INTO projects (id, name, code, owner, due_date, current_stage, status, files_count, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const project of seeds.seedProjects) insert.run(project.id, project.name, project.code || '', project.owner || '', project.due || '', project.current, project.status, project.files || 0, project.notes || '', stamp, stamp);
  }
  {
    const insert = db.prepare('INSERT OR IGNORE INTO missing_items (id, project_id, stage, material, category, state, source, filename, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const projectRows = db.prepare('SELECT id, name FROM projects').all();
    for (const item of seeds.seedMissing) {
      let target = projectRows.find(project => project.id === item.projectId);
      if (!target) {
        const detail = seeds.detailedProjects.find(project => project.id === item.projectId);
        const detailKey = projectKey(detail?.name);
        target = projectRows.find(project => {
          const candidate = projectKey(project.name);
          return detailKey && (candidate.includes(detailKey) || detailKey.includes(candidate));
        });
      }
      if (target) insert.run(item.id, target.id, item.stage, item.material, item.category, item.state, item.source, item.filename || null, stamp);
    }
  }
  if (db.prepare('SELECT COUNT(*) AS total FROM roadmap_items').get().total === 0) {
    const insert = db.prepare('INSERT INTO roadmap_items (id, title, owner, due, done, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const item of seeds.roadmapSeed) insert.run(item.id, item.title, item.owner, item.due, item.done ? 1 : 0, stamp, stamp);
  }
  if (db.prepare('SELECT COUNT(*) AS total FROM published_standards').get().total === 0) {
    const insert = db.prepare('INSERT INTO published_standards (code, name, year) VALUES (?, ?, ?)');
    for (const item of seeds.publishedStandards) insert.run(item[0], item[1], Number(item[0].slice(-4)));
  }
  if (db.prepare('SELECT COUNT(*) AS total FROM activities').get().total === 0) {
    const insert = db.prepare('INSERT INTO activities (project_id, project_name, action, operator, result, created_at) VALUES (NULL, ?, ?, ?, ?, ?)');
    insert.run('材料导入', '扫描 62 个项目目录并导入项目台账', '系统', '已完成', stamp);
    insert.run('正式标准库', '导入已发布团体标准 33 项', '系统', '已完成', stamp);
  }
}

function ensureAdmin() {
  if (db.prepare('SELECT COUNT(*) AS total FROM users').get().total > 0) return;
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'cadp123456';
  if (IS_PRODUCTION && !process.env.ADMIN_PASSWORD) {
    throw new Error('正式部署必须设置 ADMIN_PASSWORD 环境变量。');
  }
  const changedAt = process.env.ADMIN_PASSWORD ? now() : null;
  db.prepare('INSERT INTO users (username, password_hash, display_name, role, active, password_changed_at, created_at) VALUES (?, ?, ?, ?, 1, ?, ?)').run(username, hashPassword(password), '系统管理员', 'admin', changedAt, now());
  if (!IS_PRODUCTION) console.log('本地初始账号：' + username + ' / ' + password + '（请在正式部署时使用环境变量修改）');
}

seedDatabase();
ensureAdmin();
importLegacyLedger();

function json(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders });
  res.end(JSON.stringify(payload));
}

function sendEvent(res, event, payload) {
  res.write('event: ' + event + '\n');
  res.write('data: ' + JSON.stringify(payload) + '\n\n');
}

function broadcastChange(pathname, method) {
  dataRevision += 1;
  const payload = { revision: dataRevision, pathname, method, changedAt: now() };
  for (const client of eventClients) {
    try { sendEvent(client, 'change', payload); } catch { eventClients.delete(client); }
  }
}

function openEventStream(req, res, user) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    'X-Content-Type-Options': 'nosniff'
  });
  res.flushHeaders?.();
  eventClients.add(res);
  sendEvent(res, 'ready', { revision: dataRevision, serverTime: now(), userId: user.id });
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 25000);
  heartbeat.unref();
  const close = () => {
    clearInterval(heartbeat);
    eventClients.delete(res);
  };
  req.once('close', close);
  res.once('close', close);
}

function readBody(req, limit = MAX_BODY) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) {
        rejectBody(Object.assign(new Error('请求内容过大'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks)));
    req.on('error', rejectBody);
  });
}

async function readJson(req) {
  const body = await readBody(req, 1024 * 1024);
  if (!body.length) return {};
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    throw Object.assign(new Error('JSON 格式不正确'), { status: 400 });
  }
}

function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map(item => item.trim()).filter(Boolean).map(item => {
    const index = item.indexOf('=');
    return [decodeURIComponent(item.slice(0, index)), decodeURIComponent(item.slice(index + 1))];
  }));
}

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

function isSecureRequest(req) {
  return Boolean(req.socket.encrypted) || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

function sessionUser(req) {
  const token = cookies(req).cadp_session;
  if (!token) return null;
  return db.prepare('SELECT users.id, users.username, users.display_name, users.role, users.active, users.password_changed_at FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND users.active = 1').get(tokenHash(token), now()) || null;
}

function requireUser(req, res) {
  const user = sessionUser(req);
  if (!user) json(res, 401, { error: '请先登录' });
  return user;
}

function requireRole(user, res, roles) {
  if (!roles.includes(user.role)) {
    json(res, 403, { error: '当前账号没有执行此操作的权限' });
    return false;
  }
  return true;
}

function formatChinaTime(value) {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value)).replaceAll('/', '-');
}

function projectRow(row) {
  return { id: row.id, name: row.name, code: row.code, owner: row.owner, due: row.due_date, current: row.current_stage, status: row.status, archived: Boolean(row.archived), files: row.files_count, notes: row.notes, updatedAt: row.updated_at };
}

function missingRow(row) {
  return { id: row.id, projectId: row.project_id, stage: row.stage, material: row.material, category: row.category, state: row.state, source: row.source, filename: row.filename || '' };
}

function activityRow(row) {
  return { id: row.id, time: formatChinaTime(row.created_at), project: row.project_name, action: row.action, operator: row.operator, result: row.result };
}

function documentRow(row) {
  return { id: row.id, projectId: row.project_id, missingItemId: row.missing_item_id, stage: row.stage, name: row.original_name, mimeType: row.mime_type, size: row.size_bytes, createdAt: formatChinaTime(row.created_at), downloadUrl: '/api/documents/' + row.id + '/download' };
}

function ledgerRow(row, includeSensitive = false) {
  let progress = [];
  try { progress = JSON.parse(row.progress_json || '[]'); } catch {}
  return {
    id: row.id,
    sourceKey: row.source_key,
    sourceSheet: row.source_sheet,
    sourceRow: row.source_row,
    serial: row.serial,
    projectName: row.project_name,
    planCode: row.plan_code,
    standardCode: row.standard_code,
    currentStage: row.current_stage,
    status: row.status,
    commissioningUnit: row.commissioning_unit,
    contact: includeSensitive ? row.contact : '',
    contractInfo: includeSensitive ? row.contract_info : '',
    establishmentFee: includeSensitive ? row.establishment_fee : '',
    reviewFee: includeSensitive ? row.review_fee : '',
    publicationFee: includeSensitive ? row.publication_fee : '',
    totalFee: includeSensitive ? row.total_fee : '',
    expertFee: includeSensitive ? row.expert_fee : '',
    remarks: row.remarks,
    progress,
    linkedProjectId: row.linked_project_id || null,
    updatedAt: row.updated_at
  };
}

function logActivity(projectId, projectName, action, operator, result = '已完成') {
  db.prepare('INSERT INTO activities (project_id, project_name, action, operator, result, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(projectId || null, projectName, action, operator, result, now());
}

function folderStats(folder) {
  let files = 0;
  let bytes = 0;
  if (!existsSync(folder)) return { files, bytes };
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const target = join(folder, entry.name);
    if (entry.isDirectory()) {
      const nested = folderStats(target);
      files += nested.files;
      bytes += nested.bytes;
    } else {
      files += 1;
      bytes += statSync(target).size;
    }
  }
  return { files, bytes };
}

function listBackups() {
  if (!existsSync(BACKUP_DIR)) return [];
  return readdirSync(BACKUP_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && /^backup-[0-9TZ-]+$/.test(entry.name))
    .map(entry => {
      const folder = join(BACKUP_DIR, entry.name);
      const manifestPath = join(folder, 'manifest.json');
      if (existsSync(manifestPath)) {
        try {
          const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
          return { ...manifest, databaseUrl: '/api/backups/' + entry.name + '/database' };
        } catch {}
      }
      const stats = folderStats(folder);
      return { id: entry.name, createdAt: statSync(folder).birthtime.toISOString(), reason: '历史备份', fileCount: stats.files, totalBytes: stats.bytes, databaseUrl: '/api/backups/' + entry.name + '/database' };
    })
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function pruneBackups(limit = 30) {
  for (const backup of listBackups().slice(limit)) {
    if (!/^backup-[0-9TZ-]+$/.test(backup.id)) continue;
    const target = join(BACKUP_DIR, backup.id);
    if (resolve(target).startsWith(resolve(BACKUP_DIR) + sep) && existsSync(target)) rmSync(target, { recursive: true, force: true });
  }
}

function createBackup(operator = '系统', reason = '手动备份') {
  const createdAt = now();
  const id = 'backup-' + createdAt.replaceAll(':', '-').replaceAll('.', '-');
  const folder = join(BACKUP_DIR, id);
  mkdirSync(folder, { recursive: false });
  try {
    const databaseFile = join(folder, 'cadp.db');
    db.exec("VACUUM INTO '" + databaseFile.replaceAll("'", "''") + "'");
    if (existsSync(UPLOAD_DIR) && readdirSync(UPLOAD_DIR).length) cpSync(UPLOAD_DIR, join(folder, 'uploads'), { recursive: true });
    const stats = folderStats(folder);
    const manifest = { id, createdAt, reason, operator, fileCount: stats.files, totalBytes: stats.bytes };
    writeFileSync(join(folder, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    pruneBackups();
    logActivity(null, '系统备份', reason, operator);
    return { ...manifest, databaseUrl: '/api/backups/' + id + '/database' };
  } catch (error) {
    rmSync(folder, { recursive: true, force: true });
    throw error;
  }
}

function ensureDailyBackup() {
  const latest = listBackups()[0];
  if (!latest || Date.now() - new Date(latest.createdAt).getTime() >= 24 * 60 * 60 * 1000) createBackup('系统', '每日自动备份');
}

function bootstrap(user) {
  const projects = db.prepare('SELECT * FROM projects ORDER BY CASE status WHEN \'在研\' THEN 0 WHEN \'待核实\' THEN 1 ELSE 2 END, current_stage DESC, id').all().map(projectRow);
  const missingItems = db.prepare('SELECT * FROM missing_items ORDER BY CASE state WHEN \'open\' THEN 0 ELSE 1 END, id').all().map(missingRow);
  const roadmap = db.prepare('SELECT * FROM roadmap_items ORDER BY done, id').all().map(row => ({ id: row.id, title: row.title, owner: row.owner, due: row.due, done: Boolean(row.done) }));
  const activities = db.prepare('SELECT * FROM activities ORDER BY created_at DESC, id DESC LIMIT 100').all().map(activityRow);
  const publishedStandards = db.prepare('SELECT code, name FROM published_standards ORDER BY id').all().map(row => [row.code, row.name]);
  const documents = db.prepare('SELECT * FROM documents ORDER BY created_at DESC, id DESC').all().map(documentRow);
  const canAdmin = user.role === 'admin';
  const canManageLedger = ['admin', 'operator'].includes(user.role);
  const accountReady = Boolean(user.password_changed_at);
  const users = canAdmin ? db.prepare('SELECT id, username, display_name, role, active, password_changed_at, created_at, last_login_at FROM users ORDER BY active DESC, id').all().map(row => ({ id: row.id, username: row.username, displayName: row.display_name, role: row.role, active: Boolean(row.active), passwordChanged: Boolean(row.password_changed_at), createdAt: formatChinaTime(row.created_at), lastLoginAt: row.last_login_at ? formatChinaTime(row.last_login_at) : '' })) : [];
  const backups = canAdmin ? listBackups().slice(0, 20) : [];
  const ledgerRecords = accountReady ? db.prepare('SELECT * FROM ledger_records ORDER BY source_row, id').all().map(row => ledgerRow(row, canManageLedger)) : [];
  const annualPlans = accountReady ? db.prepare('SELECT id, year, name, source_row FROM annual_plans ORDER BY year DESC, source_row, id').all().map(row => ({ id: row.id, year: row.year, name: row.name, sourceRow: row.source_row })) : [];
  const latestImport = db.prepare('SELECT * FROM ledger_imports ORDER BY imported_at DESC LIMIT 1').get();
  const ledgerSummary = latestImport ? {
    sourceName: latestImport.source_name,
    sourceModifiedAt: latestImport.source_modified_at,
    importedAt: latestImport.imported_at,
    records: latestImport.record_count,
    published: latestImport.published_count,
    plans: latestImport.plan_count,
    linked: db.prepare('SELECT COUNT(*) AS total FROM ledger_records WHERE linked_project_id IS NOT NULL').get().total
  } : { records: 0, published: 0, plans: 0, linked: 0 };
  const standardsByYear = db.prepare('SELECT year, COUNT(*) AS total FROM published_standards GROUP BY year ORDER BY year').all().map(row => ({ year: row.year, total: row.total }));
  return {
    user: { id: user.id, username: user.username, displayName: user.display_name, role: user.role, mustChangePassword: !user.password_changed_at },
    permissions: { manageProjects: canManageLedger, manageLedger: canManageLedger, manageUsers: canAdmin, manageBackups: canAdmin },
    projects, missingItems, roadmap, activities, publishedStandards, documents, users, backups,
    ledgerRecords, annualPlans, ledgerSummary, analytics: { standardsByYear }, serverTime: now(), revision: dataRevision
  };
}

function safeFilename(value) {
  return basename(String(value || 'file')).replace(/[<>:\"/\\|?*\x00-\x1f]/g, '_').slice(0, 180) || 'file';
}

const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/extra.css', ['extra.css', 'text/css; charset=utf-8']],
  ['/analytics.css', ['analytics.css', 'text/css; charset=utf-8']],
  ['/data.js', ['data.js', 'text/javascript; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']]
]);

function serveStatic(pathname, res) {
  const entry = staticFiles.get(pathname);
  if (!entry) return false;
  const file = join(ROOT, entry[0]);
  if (!existsSync(file)) return false;
  res.writeHead(200, {
    'Content-Type': entry[1],
    'Cache-Control': pathname === '/' || pathname.endsWith('.html') ? 'no-cache' : 'public, max-age=300',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'same-origin'
  });
  createReadStream(file).pipe(res);
  return true;
}

async function handleApi(req, res, url) {
  const method = req.method || 'GET';
  const pathname = url.pathname;

  if (method === 'GET' && pathname === '/api/health') return json(res, 200, { ok: true, database: 'connected', time: now() });

  if (method === 'POST' && pathname === '/api/login') {
    const body = await readJson(req);
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(String(body.username || '').trim());
    if (!user || !user.active || !verifyPassword(String(body.password || ''), user.password_hash)) return json(res, 401, { error: '账号或密码不正确，或账号已停用' });
    const token = randomBytes(32).toString('base64url');
    const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now());
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(tokenHash(token), user.id, expires, now());
    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now(), user.id);
    const cookie = 'cadp_session=' + encodeURIComponent(token) + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + (SESSION_DAYS * 86400) + (isSecureRequest(req) ? '; Secure' : '');
    return json(res, 200, { ok: true, user: { username: user.username, displayName: user.display_name, mustChangePassword: !user.password_changed_at } }, { 'Set-Cookie': cookie });
  }

  if (method === 'POST' && pathname === '/api/logout') {
    const token = cookies(req).cadp_session;
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
    return json(res, 200, { ok: true }, { 'Set-Cookie': 'cadp_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' });
  }

  const user = requireUser(req, res);
  if (!user) return;

  if (method === 'GET' && pathname === '/api/bootstrap') return json(res, 200, bootstrap(user));
  if (method === 'GET' && pathname === '/api/session') return json(res, 200, { user });
  if (method === 'GET' && pathname === '/api/events') return openEventStream(req, res, user);

  if (method === 'POST' && pathname === '/api/account/password') {
    const body = await readJson(req);
    const currentPassword = String(body.currentPassword || '');
    const newPassword = String(body.newPassword || '');
    const account = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    if (!verifyPassword(currentPassword, account.password_hash)) return json(res, 400, { error: '当前密码不正确' });
    if (newPassword.length < 10) return json(res, 400, { error: '新密码至少需要 10 位' });
    if (newPassword === currentPassword) return json(res, 400, { error: '新密码不能与当前密码相同' });
    db.prepare('UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?').run(hashPassword(newPassword), now(), user.id);
    const currentToken = cookies(req).cadp_session;
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(user.id, tokenHash(currentToken));
    logActivity(null, '账号安全', '修改登录密码', user.display_name);
    return json(res, 200, { ok: true });
  }

  if (!user.password_changed_at) return json(res, 403, { error: '首次登录请先修改初始密码', code: 'PASSWORD_CHANGE_REQUIRED' });

  if (method === 'GET' && pathname === '/api/users') {
    if (!requireRole(user, res, ['admin'])) return;
    return json(res, 200, { users: bootstrap(user).users });
  }

  if (method === 'POST' && pathname === '/api/users') {
    if (!requireRole(user, res, ['admin'])) return;
    const body = await readJson(req);
    const username = String(body.username || '').trim();
    const displayName = String(body.displayName || '').trim();
    const password = String(body.password || '');
    const role = String(body.role || 'viewer');
    if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) return json(res, 400, { error: '账号需为 3—32 位字母、数字、点、横线或下划线' });
    if (!displayName) return json(res, 400, { error: '请填写姓名' });
    if (password.length < 10) return json(res, 400, { error: '初始密码至少需要 10 位' });
    if (!['admin', 'operator', 'viewer', 'expert'].includes(role)) return json(res, 400, { error: '用户角色无效' });
    if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) return json(res, 409, { error: '该账号已经存在' });
    db.prepare('INSERT INTO users (username, password_hash, display_name, role, active, password_changed_at, created_at) VALUES (?, ?, ?, ?, 1, NULL, ?)').run(username, hashPassword(password), displayName, role, now());
    logActivity(null, '用户管理', '创建用户“' + displayName + '”', user.display_name);
    return json(res, 201, { ok: true });
  }

  let match = pathname.match(/^\/api\/users\/(\d+)$/);
  if (method === 'PATCH' && match) {
    if (!requireRole(user, res, ['admin'])) return;
    const id = Number(match[1]);
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!target) return json(res, 404, { error: '用户不存在' });
    const body = await readJson(req);
    const role = body.role === undefined ? target.role : String(body.role);
    const active = body.active === undefined ? Boolean(target.active) : Boolean(body.active);
    if (!['admin', 'operator', 'viewer', 'expert'].includes(role)) return json(res, 400, { error: '用户角色无效' });
    if (id === user.id && !active) return json(res, 400, { error: '不能停用当前登录账号' });
    if (target.role === 'admin' && (role !== 'admin' || !active)) {
      const administrators = db.prepare("SELECT COUNT(*) AS total FROM users WHERE role = 'admin' AND active = 1").get().total;
      if (administrators <= 1) return json(res, 400, { error: '系统必须保留至少一个启用的管理员' });
    }
    db.prepare('UPDATE users SET role = ?, active = ? WHERE id = ?').run(role, active ? 1 : 0, id);
    if (!active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    logActivity(null, '用户管理', (active ? '更新' : '停用') + '用户“' + target.display_name + '”', user.display_name);
    return json(res, 200, { ok: true });
  }

  if (method === 'POST' && pathname === '/api/backups') {
    if (!requireRole(user, res, ['admin'])) return;
    return json(res, 201, { backup: createBackup(user.display_name, '手动备份') });
  }

  match = pathname.match(/^\/api\/backups\/(backup-[0-9TZ-]+)\/database$/);
  if (method === 'GET' && match) {
    if (!requireRole(user, res, ['admin'])) return;
    const file = join(BACKUP_DIR, match[1], 'cadp.db');
    if (!existsSync(file)) return json(res, 404, { error: '备份不存在' });
    const size = statSync(file).size;
    res.writeHead(200, { 'Content-Type': 'application/vnd.sqlite3', 'Content-Length': size, 'Content-Disposition': 'attachment; filename="cadp-backup.db"', 'X-Content-Type-Options': 'nosniff' });
    createReadStream(file).pipe(res);
    return;
  }

  match = pathname.match(/^\/api\/ledger\/(\d+)$/);
  if (method === 'PUT' && match) {
    if (!requireRole(user, res, ['admin', 'operator'])) return;
    const id = Number(match[1]);
    const existing = db.prepare('SELECT * FROM ledger_records WHERE id = ?').get(id);
    if (!existing) return json(res, 404, { error: '历史台账记录不存在' });
    const body = await readJson(req);
    const projectName = String(body.projectName || '').trim();
    const status = String(body.status || '在研');
    if (!projectName) return json(res, 400, { error: '标准名称不能为空' });
    if (!['在研', '暂停', '待核实', '已发布', '已撤销'].includes(status)) return json(res, 400, { error: '台账状态无效' });
    const currentStage = Math.min(15, Math.max(1, Number(body.currentStage || existing.current_stage)));
    db.prepare(`UPDATE ledger_records SET project_name = ?, plan_code = ?, standard_code = ?, current_stage = ?, status = ?,
      commissioning_unit = ?, contact = ?, contract_info = ?, establishment_fee = ?, review_fee = ?, publication_fee = ?,
      total_fee = ?, expert_fee = ?, remarks = ?, updated_at = ? WHERE id = ?`).run(
      projectName, String(body.planCode || ''), String(body.standardCode || ''), currentStage, status,
      String(body.commissioningUnit || ''), String(body.contact || ''), String(body.contractInfo || ''),
      String(body.establishmentFee || ''), String(body.reviewFee || ''), String(body.publicationFee || ''),
      String(body.totalFee || ''), String(body.expertFee || ''), String(body.remarks || ''), now(), id
    );
    logActivity(existing.linked_project_id, projectName, '修改历史 Excel 台账记录', user.display_name);
    return json(res, 200, { record: ledgerRow(db.prepare('SELECT * FROM ledger_records WHERE id = ?').get(id), true) });
  }

  match = pathname.match(/^\/api\/ledger\/(\d+)\/promote$/);
  if (method === 'POST' && match) {
    if (!requireRole(user, res, ['admin', 'operator'])) return;
    const id = Number(match[1]);
    const record = db.prepare('SELECT * FROM ledger_records WHERE id = ?').get(id);
    if (!record) return json(res, 404, { error: '历史台账记录不存在' });
    let project = record.linked_project_id ? db.prepare('SELECT * FROM projects WHERE id = ?').get(record.linked_project_id) : null;
    if (!project) project = findLinkedProject(db.prepare('SELECT * FROM projects').all(), record.project_name);
    if (!project) {
      const stamp = now();
      const code = record.standard_code || record.plan_code || '历史台账';
      const notes = ['由历史 Excel 台账转入', record.remarks].filter(Boolean).join('；');
      const result = db.prepare('INSERT INTO projects (name, code, owner, due_date, current_stage, status, files_count, notes, created_at, updated_at) VALUES (?, ?, ?, \'\', ?, ?, 0, ?, ?, ?)').run(record.project_name, code, record.commissioning_unit || '待补充', record.current_stage, record.status, notes, stamp, stamp);
      project = db.prepare('SELECT * FROM projects WHERE id = ?').get(Number(result.lastInsertRowid));
    }
    db.prepare('UPDATE ledger_records SET linked_project_id = ?, updated_at = ? WHERE id = ?').run(project.id, now(), id);
    logActivity(project.id, project.name, '历史 Excel 台账关联到项目台账', user.display_name);
    return json(res, 200, { project: projectRow(project), record: ledgerRow(db.prepare('SELECT * FROM ledger_records WHERE id = ?').get(id), true) });
  }

  if (method === 'POST' && pathname === '/api/projects') {
    if (!requireRole(user, res, ['admin', 'operator'])) return;
    const body = await readJson(req);
    const name = String(body.name || '').trim();
    const owner = String(body.owner || '').trim();
    if (!name || !owner) return json(res, 400, { error: '请填写标准名称和牵头单位' });
    const stamp = now();
    const result = db.prepare('INSERT INTO projects (name, code, owner, due_date, current_stage, status, files_count, notes, created_at, updated_at) VALUES (?, ?, ?, ?, 1, \'在研\', 0, ?, ?, ?)').run(name, String(body.code || '提案项目').trim(), owner, String(body.due || ''), String(body.notes || ''), stamp, stamp);
    const id = Number(result.lastInsertRowid);
    logActivity(id, name, '创建项目并进入提案环节', user.display_name);
    return json(res, 201, { project: projectRow(db.prepare('SELECT * FROM projects WHERE id = ?').get(id)) });
  }

  match = pathname.match(/^\/api\/projects\/(\d+)$/);
  if (method === 'PUT' && match) {
    if (!requireRole(user, res, ['admin', 'operator'])) return;
    const id = Number(match[1]);
    const existing = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!existing) return json(res, 404, { error: '项目不存在' });
    const body = await readJson(req);
    const name = String(body.name || '').trim();
    const status = String(body.status || '在研');
    if (!name) return json(res, 400, { error: '标准名称不能为空' });
    if (!['在研', '暂停', '待核实', '已发布', '已撤销'].includes(status)) return json(res, 400, { error: '项目状态无效' });
    const current = Math.min(15, Math.max(1, Number(body.current || existing.current_stage)));
    db.prepare('UPDATE projects SET name = ?, code = ?, owner = ?, due_date = ?, current_stage = ?, status = ?, notes = ?, updated_at = ? WHERE id = ?').run(name, String(body.code || ''), String(body.owner || ''), String(body.due || ''), current, status, String(body.notes || ''), now(), id);
    const updated = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    logActivity(id, updated.name, '修改项目基本信息', user.display_name);
    return json(res, 200, { project: projectRow(updated) });
  }

  match = pathname.match(/^\/api\/projects\/(\d+)\/advance$/);
  if (method === 'POST' && match) {
    if (!requireRole(user, res, ['admin', 'operator'])) return;
    const id = Number(match[1]);
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project) return json(res, 404, { error: '项目不存在' });
    if (project.archived) return json(res, 409, { error: '归档项目不能推进流程，请先恢复项目' });
    if (project.current_stage >= 15) return json(res, 409, { error: '流程已经完成' });
    const openMaterials = db.prepare("SELECT * FROM missing_items WHERE project_id = ? AND stage = ? AND state = 'open' ORDER BY id").all(id, project.current_stage);
    if (openMaterials.length) return json(res, 409, { error: '当前环节还有 ' + openMaterials.length + ' 项材料待处理', code: 'MATERIALS_INCOMPLETE', missingItems: openMaterials.map(missingRow) });
    const next = project.current_stage + 1;
    const status = next === 15 ? '已发布' : project.status;
    db.prepare('UPDATE projects SET current_stage = ?, status = ?, updated_at = ? WHERE id = ?').run(next, status, now(), id);
    logActivity(id, project.name, '完成第 ' + project.current_stage + ' 环节，进入第 ' + next + ' 环节', user.display_name);
    return json(res, 200, { project: projectRow(db.prepare('SELECT * FROM projects WHERE id = ?').get(id)) });
  }

  match = pathname.match(/^\/api\/projects\/(\d+)\/return$/);
  if (method === 'POST' && match) {
    if (!requireRole(user, res, ['admin', 'operator'])) return;
    const id = Number(match[1]);
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project) return json(res, 404, { error: '项目不存在' });
    const body = await readJson(req);
    const target = Math.min(project.current_stage, Math.max(1, Number(body.target || project.current_stage - 1)));
    db.prepare('UPDATE projects SET current_stage = ?, status = \'在研\', updated_at = ? WHERE id = ?').run(target, now(), id);
    logActivity(id, project.name, '退回至第 ' + target + ' 环节', user.display_name, '已退回');
    return json(res, 200, { project: projectRow(db.prepare('SELECT * FROM projects WHERE id = ?').get(id)) });
  }

  match = pathname.match(/^\/api\/projects\/(\d+)\/archive$/);
  if (method === 'POST' && match) {
    if (!requireRole(user, res, ['admin', 'operator'])) return;
    const id = Number(match[1]);
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project) return json(res, 404, { error: '项目不存在' });
    const body = await readJson(req);
    const archived = Boolean(body.archived);
    db.prepare('UPDATE projects SET archived = ?, updated_at = ? WHERE id = ?').run(archived ? 1 : 0, now(), id);
    logActivity(id, project.name, archived ? '项目归档' : '恢复归档项目', user.display_name);
    return json(res, 200, { project: projectRow(db.prepare('SELECT * FROM projects WHERE id = ?').get(id)) });
  }

  match = pathname.match(/^\/api\/missing\/(\d+)$/);
  if (method === 'PATCH' && match) {
    if (!requireRole(user, res, ['admin', 'operator'])) return;
    const id = Number(match[1]);
    const item = db.prepare('SELECT missing_items.*, projects.name AS project_name FROM missing_items JOIN projects ON projects.id = missing_items.project_id WHERE missing_items.id = ?').get(id);
    if (!item) return json(res, 404, { error: '待补材料不存在' });
    const body = await readJson(req);
    const state = String(body.state || '');
    if (!['open', 'resolved', 'ignored'].includes(state)) return json(res, 400, { error: '处理状态无效' });
    db.prepare('UPDATE missing_items SET state = ?, updated_at = ? WHERE id = ?').run(state, now(), id);
    const action = item.material + '：' + (state === 'ignored' ? '忽略误报' : state === 'resolved' ? '补充完成' : '重新打开');
    logActivity(item.project_id, item.project_name, action, user.display_name);
    return json(res, 200, { item: missingRow(db.prepare('SELECT * FROM missing_items WHERE id = ?').get(id)) });
  }

  match = pathname.match(/^\/api\/missing\/(\d+)\/upload$/);
  if (method === 'POST' && match) {
    if (!requireRole(user, res, ['admin', 'operator'])) return;
    const id = Number(match[1]);
    const item = db.prepare('SELECT missing_items.*, projects.name AS project_name FROM missing_items JOIN projects ON projects.id = missing_items.project_id WHERE missing_items.id = ?').get(id);
    if (!item) return json(res, 404, { error: '待补材料不存在' });
    const originalName = safeFilename(url.searchParams.get('filename'));
    const content = await readBody(req);
    if (!content.length) return json(res, 400, { error: '文件内容为空' });
    const storedName = randomBytes(16).toString('hex') + extname(originalName).slice(0, 12);
    await mkdir(UPLOAD_DIR, { recursive: true });
    await writeFile(join(UPLOAD_DIR, storedName), content, { flag: 'wx' });
    const stamp = now();
    const result = db.prepare('INSERT INTO documents (project_id, missing_item_id, stage, original_name, stored_name, mime_type, size_bytes, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(item.project_id, id, item.stage, originalName, storedName, String(req.headers['content-type'] || 'application/octet-stream'), content.length, user.id, stamp);
    db.prepare('UPDATE missing_items SET state = \'resolved\', filename = ?, updated_at = ? WHERE id = ?').run(originalName, stamp, id);
    db.prepare('UPDATE projects SET files_count = files_count + 1, updated_at = ? WHERE id = ?').run(stamp, item.project_id);
    logActivity(item.project_id, item.project_name, item.material + '：上传 ' + originalName, user.display_name);
    const document = db.prepare('SELECT * FROM documents WHERE id = ?').get(Number(result.lastInsertRowid));
    return json(res, 201, { item: missingRow(db.prepare('SELECT * FROM missing_items WHERE id = ?').get(id)), document: documentRow(document) });
  }

  match = pathname.match(/^\/api\/projects\/(\d+)\/documents$/);
  if (method === 'POST' && match) {
    if (!requireRole(user, res, ['admin', 'operator'])) return;
    const projectId = Number(match[1]);
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    if (!project) return json(res, 404, { error: '项目不存在' });
    const stage = Math.min(15, Math.max(1, Number(url.searchParams.get('stage') || project.current_stage)));
    const originalName = safeFilename(url.searchParams.get('filename'));
    const content = await readBody(req);
    if (!content.length) return json(res, 400, { error: '文件内容为空' });
    const storedName = randomBytes(16).toString('hex') + extname(originalName).slice(0, 12);
    await writeFile(join(UPLOAD_DIR, storedName), content, { flag: 'wx' });
    const stamp = now();
    const result = db.prepare('INSERT INTO documents (project_id, missing_item_id, stage, original_name, stored_name, mime_type, size_bytes, uploaded_by, created_at) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)').run(projectId, stage, originalName, storedName, String(req.headers['content-type'] || 'application/octet-stream'), content.length, user.id, stamp);
    db.prepare('UPDATE projects SET files_count = files_count + 1, updated_at = ? WHERE id = ?').run(stamp, projectId);
    logActivity(projectId, project.name, '归档文件：' + originalName, user.display_name);
    return json(res, 201, { document: documentRow(db.prepare('SELECT * FROM documents WHERE id = ?').get(Number(result.lastInsertRowid))) });
  }

  match = pathname.match(/^\/api\/documents\/(\d+)\/download$/);
  if (method === 'GET' && match) {
    const document = db.prepare('SELECT * FROM documents WHERE id = ?').get(Number(match[1]));
    if (!document) return json(res, 404, { error: '文件不存在' });
    const file = join(UPLOAD_DIR, document.stored_name);
    if (!existsSync(file)) return json(res, 404, { error: '文件记录存在，但磁盘文件缺失' });
    const encoded = encodeURIComponent(document.original_name);
    res.writeHead(200, { 'Content-Type': document.mime_type, 'Content-Length': document.size_bytes, 'Content-Disposition': "attachment; filename*=UTF-8''" + encoded, 'X-Content-Type-Options': 'nosniff' });
    createReadStream(file).pipe(res);
    return;
  }

  if (method === 'POST' && pathname === '/api/roadmap') {
    if (!requireRole(user, res, ['admin', 'operator'])) return;
    const body = await readJson(req);
    const title = String(body.title || '').trim();
    if (!title) return json(res, 400, { error: '请输入任务名称' });
    const stamp = now();
    const result = db.prepare('INSERT INTO roadmap_items (title, owner, due, done, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)').run(title, String(body.owner || '待指定'), String(body.due || '待确定'), stamp, stamp);
    return json(res, 201, { id: Number(result.lastInsertRowid) });
  }

  match = pathname.match(/^\/api\/roadmap\/(\d+)$/);
  if (method === 'PATCH' && match) {
    if (!requireRole(user, res, ['admin', 'operator'])) return;
    const body = await readJson(req);
    db.prepare('UPDATE roadmap_items SET done = ?, updated_at = ? WHERE id = ?').run(body.done ? 1 : 0, now(), Number(match[1]));
    return json(res, 200, { ok: true });
  }

  if (method === 'DELETE' && pathname === '/api/activities') {
    if (!requireRole(user, res, ['admin'])) return;
    db.prepare('DELETE FROM activities').run();
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: '接口不存在' });
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://' + (req.headers.host || 'localhost'));
    if (url.pathname.startsWith('/api/')) {
      const method = req.method || 'GET';
      const shouldBroadcast = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && !['/api/login', '/api/logout'].includes(url.pathname);
      if (shouldBroadcast) res.once('finish', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) broadcastChange(url.pathname, method);
      });
      return await handleApi(req, res, url);
    }
    if (req.method === 'GET' && serveStatic(url.pathname, res)) return;
    json(res, 404, { error: '页面不存在' });
  } catch (error) {
    if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : '服务器处理失败' });
    if (!error.status) console.error(error);
  }
});

server.listen(PORT, HOST, () => {
  console.log('团体标准管理系统已启动：http://' + HOST + ':' + PORT);
  console.log('数据库：' + join(DATA_DIR, 'cadp.db'));
});

const initialBackupTimer = setTimeout(() => {
  try { ensureDailyBackup(); } catch (error) { console.error('自动备份失败：', error); }
}, 500);
initialBackupTimer.unref();
const backupTimer = setInterval(() => {
  try { ensureDailyBackup(); } catch (error) { console.error('自动备份失败：', error); }
}, 6 * 60 * 60 * 1000);
backupTimer.unref();

function shutdown() {
  clearTimeout(initialBackupTimer);
  clearInterval(backupTimer);
  for (const client of eventClients) client.end();
  eventClients.clear();
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
