import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(ROOT, process.env.DATA_DIR || '.runtime');
const UPLOAD_DIR = join(DATA_DIR, 'uploads');
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 3000);
const SESSION_DAYS = Math.max(1, Number(process.env.SESSION_DAYS || 7));
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const MAX_BODY = 30 * 1024 * 1024;

mkdirSync(UPLOAD_DIR, { recursive: true });
const db = new DatabaseSync(join(DATA_DIR, 'cadp.db'));
db.exec([
  'PRAGMA foreign_keys = ON;',
  'PRAGMA journal_mode = WAL;',
  'CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, display_name TEXT NOT NULL, role TEXT NOT NULL DEFAULT \'admin\', created_at TEXT NOT NULL, last_login_at TEXT);',
  'CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);',
  'CREATE TABLE IF NOT EXISTS projects (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, code TEXT NOT NULL DEFAULT \'\', owner TEXT NOT NULL DEFAULT \'\', due_date TEXT NOT NULL DEFAULT \'\', current_stage INTEGER NOT NULL DEFAULT 1 CHECK(current_stage BETWEEN 1 AND 15), status TEXT NOT NULL DEFAULT \'在研\', files_count INTEGER NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT \'\', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);',
  'CREATE TABLE IF NOT EXISTS missing_items (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, stage INTEGER NOT NULL CHECK(stage BETWEEN 1 AND 15), material TEXT NOT NULL, category TEXT NOT NULL, state TEXT NOT NULL DEFAULT \'open\' CHECK(state IN (\'open\',\'resolved\',\'ignored\')), source TEXT NOT NULL DEFAULT \'人工添加\', filename TEXT, updated_at TEXT NOT NULL);',
  'CREATE TABLE IF NOT EXISTS documents (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, missing_item_id INTEGER REFERENCES missing_items(id) ON DELETE SET NULL, stage INTEGER NOT NULL, original_name TEXT NOT NULL, stored_name TEXT NOT NULL, mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL, uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL);',
  'CREATE TABLE IF NOT EXISTS activities (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL, project_name TEXT NOT NULL, action TEXT NOT NULL, operator TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL);',
  'CREATE TABLE IF NOT EXISTS roadmap_items (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, owner TEXT NOT NULL DEFAULT \'待指定\', due TEXT NOT NULL DEFAULT \'待确定\', done INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);',
  'CREATE TABLE IF NOT EXISTS published_standards (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, year INTEGER NOT NULL);',
  'CREATE INDEX IF NOT EXISTS idx_missing_project ON missing_items(project_id, state);',
  'CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project_id, stage);',
  'CREATE INDEX IF NOT EXISTS idx_activities_created ON activities(created_at DESC);'
].join('\n'));

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
  db.prepare('INSERT INTO users (username, password_hash, display_name, role, created_at) VALUES (?, ?, ?, ?, ?)').run(username, hashPassword(password), '系统管理员', 'admin', now());
  if (!IS_PRODUCTION) console.log('本地初始账号：' + username + ' / ' + password + '（请在正式部署时使用环境变量修改）');
}

seedDatabase();
ensureAdmin();

function json(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders });
  res.end(JSON.stringify(payload));
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
  return db.prepare('SELECT users.id, users.username, users.display_name, users.role FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?').get(tokenHash(token), now()) || null;
}

function requireUser(req, res) {
  const user = sessionUser(req);
  if (!user) json(res, 401, { error: '请先登录' });
  return user;
}

function formatChinaTime(value) {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value)).replaceAll('/', '-');
}

function projectRow(row) {
  return { id: row.id, name: row.name, code: row.code, owner: row.owner, due: row.due_date, current: row.current_stage, status: row.status, files: row.files_count, notes: row.notes, updatedAt: row.updated_at };
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

function logActivity(projectId, projectName, action, operator, result = '已完成') {
  db.prepare('INSERT INTO activities (project_id, project_name, action, operator, result, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(projectId || null, projectName, action, operator, result, now());
}

function bootstrap(user) {
  const projects = db.prepare('SELECT * FROM projects ORDER BY CASE status WHEN \'在研\' THEN 0 WHEN \'待核实\' THEN 1 ELSE 2 END, current_stage DESC, id').all().map(projectRow);
  const missingItems = db.prepare('SELECT * FROM missing_items ORDER BY CASE state WHEN \'open\' THEN 0 ELSE 1 END, id').all().map(missingRow);
  const roadmap = db.prepare('SELECT * FROM roadmap_items ORDER BY done, id').all().map(row => ({ id: row.id, title: row.title, owner: row.owner, due: row.due, done: Boolean(row.done) }));
  const activities = db.prepare('SELECT * FROM activities ORDER BY created_at DESC, id DESC LIMIT 100').all().map(activityRow);
  const publishedStandards = db.prepare('SELECT code, name FROM published_standards ORDER BY id').all().map(row => [row.code, row.name]);
  const documents = db.prepare('SELECT * FROM documents ORDER BY created_at DESC, id DESC').all().map(documentRow);
  return { user: { id: user.id, username: user.username, displayName: user.display_name, role: user.role }, projects, missingItems, roadmap, activities, publishedStandards, documents, serverTime: now() };
}

function safeFilename(value) {
  return basename(String(value || 'file')).replace(/[<>:\"/\\|?*\x00-\x1f]/g, '_').slice(0, 180) || 'file';
}

const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/extra.css', ['extra.css', 'text/css; charset=utf-8']],
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
    if (!user || !verifyPassword(String(body.password || ''), user.password_hash)) return json(res, 401, { error: '账号或密码不正确' });
    const token = randomBytes(32).toString('base64url');
    const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now());
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(tokenHash(token), user.id, expires, now());
    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now(), user.id);
    const cookie = 'cadp_session=' + encodeURIComponent(token) + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + (SESSION_DAYS * 86400) + (isSecureRequest(req) ? '; Secure' : '');
    return json(res, 200, { ok: true, user: { username: user.username, displayName: user.display_name } }, { 'Set-Cookie': cookie });
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

  if (method === 'POST' && pathname === '/api/projects') {
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

  let match = pathname.match(/^\/api\/projects\/(\d+)$/);
  if (method === 'PUT' && match) {
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
    const id = Number(match[1]);
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project) return json(res, 404, { error: '项目不存在' });
    if (project.current_stage >= 15) return json(res, 409, { error: '流程已经完成' });
    const next = project.current_stage + 1;
    const status = next === 15 ? '已发布' : project.status;
    db.prepare('UPDATE projects SET current_stage = ?, status = ?, updated_at = ? WHERE id = ?').run(next, status, now(), id);
    logActivity(id, project.name, '完成第 ' + project.current_stage + ' 环节，进入第 ' + next + ' 环节', user.display_name);
    return json(res, 200, { project: projectRow(db.prepare('SELECT * FROM projects WHERE id = ?').get(id)) });
  }

  match = pathname.match(/^\/api\/projects\/(\d+)\/return$/);
  if (method === 'POST' && match) {
    const id = Number(match[1]);
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project) return json(res, 404, { error: '项目不存在' });
    const body = await readJson(req);
    const target = Math.min(project.current_stage, Math.max(1, Number(body.target || project.current_stage - 1)));
    db.prepare('UPDATE projects SET current_stage = ?, status = \'在研\', updated_at = ? WHERE id = ?').run(target, now(), id);
    logActivity(id, project.name, '退回至第 ' + target + ' 环节', user.display_name, '已退回');
    return json(res, 200, { project: projectRow(db.prepare('SELECT * FROM projects WHERE id = ?').get(id)) });
  }

  match = pathname.match(/^\/api\/missing\/(\d+)$/);
  if (method === 'PATCH' && match) {
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
    const body = await readJson(req);
    const title = String(body.title || '').trim();
    if (!title) return json(res, 400, { error: '请输入任务名称' });
    const stamp = now();
    const result = db.prepare('INSERT INTO roadmap_items (title, owner, due, done, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)').run(title, String(body.owner || '待指定'), String(body.due || '待确定'), stamp, stamp);
    return json(res, 201, { id: Number(result.lastInsertRowid) });
  }

  match = pathname.match(/^\/api\/roadmap\/(\d+)$/);
  if (method === 'PATCH' && match) {
    const body = await readJson(req);
    db.prepare('UPDATE roadmap_items SET done = ?, updated_at = ? WHERE id = ?').run(body.done ? 1 : 0, now(), Number(match[1]));
    return json(res, 200, { ok: true });
  }

  if (method === 'DELETE' && pathname === '/api/activities') {
    db.prepare('DELETE FROM activities').run();
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: '接口不存在' });
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://' + (req.headers.host || 'localhost'));
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
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

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
