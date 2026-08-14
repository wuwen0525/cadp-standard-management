import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

async function freePort() {
  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  socket.close();
  await once(socket, 'close');
  return port;
}

async function waitForServer(base, child, logs) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error('后端提前退出：\n' + logs.join(''));
    try {
      const response = await fetch(base + '/api/health');
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('等待后端启动超时：\n' + logs.join(''));
}

async function login(base) {
  const response = await fetch(base + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'qa-password-123' })
  });
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie').split(';')[0];
}

test('数据库接口、文件归档和重启持久化', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'cadp-standard-management-'));
  const port = await freePort();
  const base = 'http://127.0.0.1:' + port;
  const logs = [];
  let child;

  const start = async () => {
    child = spawn(process.execPath, ['server.mjs'], {
      cwd: ROOT,
      env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), DATA_DIR: dataDir, ADMIN_PASSWORD: 'qa-password-123' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stdout.on('data', chunk => logs.push(chunk.toString()));
    child.stderr.on('data', chunk => logs.push(chunk.toString()));
    await waitForServer(base, child, logs);
  };

  const stop = async () => {
    if (!child || child.exitCode !== null) return;
    child.kill('SIGTERM');
    await once(child, 'exit');
  };

  try {
    await start();
    assert.equal((await fetch(base + '/api/bootstrap')).status, 401);
    let cookie = await login(base);

    const request = async (path, options = {}) => {
      const response = await fetch(base + path, { ...options, headers: { Cookie: cookie, ...(options.headers || {}) } });
      assert.ok(response.ok, path + ' 返回 ' + response.status);
      return response;
    };

    const initial = await (await request('/api/bootstrap')).json();
    assert.equal(initial.projects.length, 62);
    assert.equal(initial.missingItems.length, 41);
    assert.equal(initial.publishedStandards.length, 33);

    const created = await (await request('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '接口联调测试标准', code: 'QA-001', owner: '测试组', due: '2026-12-31', notes: '重启后仍应存在' })
    })).json();
    assert.equal(created.project.name, '接口联调测试标准');

    const advanced = await (await request('/api/projects/' + created.project.id + '/advance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    })).json();
    assert.equal(advanced.project.current, 2);

    const missingId = initial.missingItems[0].id;
    const fileContent = Buffer.from('CADP upload integration test', 'utf8');
    const uploaded = await (await request('/api/missing/' + missingId + '/upload?filename=qa-file.txt', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: fileContent
    })).json();
    assert.equal(uploaded.document.size, fileContent.length);
    const downloaded = Buffer.from(await (await request(uploaded.document.downloadUrl)).arrayBuffer());
    assert.deepEqual(downloaded, fileContent);

    const roadmap = await (await request('/api/roadmap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '接口测试任务' })
    })).json();
    await request('/api/roadmap/' + roadmap.id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ done: true })
    });

    await stop();
    await start();
    cookie = await login(base);
    const persisted = await (await request('/api/bootstrap')).json();
    assert.equal(persisted.projects.find(item => item.id === created.project.id).current, 2);
    assert.equal(persisted.documents.some(item => item.name === 'qa-file.txt'), true);
    assert.equal(persisted.roadmap.find(item => item.id === roadmap.id).done, true);
    assert.equal(persisted.activities.some(item => item.project === '接口联调测试标准'), true);
  } finally {
    await stop();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
