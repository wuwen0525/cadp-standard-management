import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

async function login(base, username = 'admin', password = 'qa-password-123') {
  const response = await fetch(base + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
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

  const importDir = join(dataDir, 'imports');
  mkdirSync(importDir, { recursive: true });
  writeFileSync(join(importDir, 'legacy-ledger.json'), JSON.stringify({
    schemaVersion: 1,
    sourceName: '历史台账测试.xlsx',
    sourceModifiedAt: '2026-08-01T00:00:00.000Z',
    sourceHash: 'qa-ledger-v1',
    records: [{
      sourceKey: 'progress:6', sourceSheet: '工作进展表', sourceRow: 6, serial: '1', projectName: '历史台账接口测试标准',
      planCode: 'QA-2026', standardCode: '', currentStage: 6, status: '在研', commissioningUnit: '测试委托方',
      contact: '测试联系人 10000', contractInfo: '测试合同路径', establishmentFee: '3', reviewFee: '5',
      publicationFee: '1.5', totalFee: '9.5', expertFee: '', remarks: '测试备注', progress: [{ label: '立项公告', value: '已完成' }]
    }],
    published: [{ sourceKey: 'published:3', sourceRow: 3, name: '历史发布测试标准', code: 'T/CADP QA-2026', publisher: '测试单位', releaseDate: '2026.08.01', planCode: 'QA-2026' }],
    plans: [{ sourceKey: 'plan-2025:2', sourceRow: 2, year: 2025, name: '历史年度计划测试标准' }]
  }), 'utf8');

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
    assert.equal(initial.user.mustChangePassword, false);
    assert.equal(initial.permissions.manageUsers, true);
    assert.equal(initial.permissions.manageLedger, true);
    assert.equal(initial.ledgerSummary.records, 1);
    assert.equal(initial.ledgerRecords.length, 1);
    assert.equal(initial.ledgerRecords[0].contact, '测试联系人 10000');
    assert.equal(initial.annualPlans.length, 1);

    await request('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'operator.qa', displayName: '测试经办人', role: 'operator', password: 'operator-temp-123' })
    });
    let operatorCookie = await login(base, 'operator.qa', 'operator-temp-123');
    let operatorData = await (await fetch(base + '/api/bootstrap', { headers: { Cookie: operatorCookie } })).json();
    assert.equal(operatorData.user.mustChangePassword, true);
    assert.equal(operatorData.permissions.manageProjects, true);
    assert.equal(operatorData.permissions.manageUsers, false);
    assert.equal(operatorData.ledgerRecords.length, 0);
    const blockedBeforePasswordChange = await fetch(base + '/api/projects', { method: 'POST', headers: { Cookie: operatorCookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '不应创建', owner: '测试组' }) });
    assert.equal(blockedBeforePasswordChange.status, 403);
    const changedPassword = await fetch(base + '/api/account/password', { method: 'POST', headers: { Cookie: operatorCookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword: 'operator-temp-123', newPassword: 'operator-secure-456' }) });
    assert.equal(changedPassword.status, 200);
    operatorCookie = await login(base, 'operator.qa', 'operator-secure-456');
    assert.equal((await fetch(base + '/api/users', { headers: { Cookie: operatorCookie } })).status, 403);
    operatorData = await (await fetch(base + '/api/bootstrap', { headers: { Cookie: operatorCookie } })).json();
    assert.equal(operatorData.ledgerRecords.length, 1);

    const blockingItem = initial.missingItems.find(item => initial.projects.find(project => project.id === item.projectId)?.current === item.stage);
    assert.ok(blockingItem);
    const blockedAdvance = await fetch(base + '/api/projects/' + blockingItem.projectId + '/advance', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(blockedAdvance.status, 409);
    assert.equal((await blockedAdvance.json()).code, 'MATERIALS_INCOMPLETE');

    const created = await (await request('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '接口联调测试标准', code: 'QA-001', owner: '测试组', due: '2026-12-31', notes: '重启后仍应存在' })
    })).json();
    assert.equal(created.project.name, '接口联调测试标准');

    const ledgerId = initial.ledgerRecords[0].id;
    const updatedLedger = await (await request('/api/ledger/' + ledgerId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...initial.ledgerRecords[0], remarks: '重启后保留人工修改', currentStage: 7 })
    })).json();
    assert.equal(updatedLedger.record.currentStage, 7);
    const promotedLedger = await (await request('/api/ledger/' + ledgerId + '/promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    })).json();
    assert.equal(promotedLedger.project.name, '历史台账接口测试标准');
    assert.equal(promotedLedger.record.linkedProjectId, promotedLedger.project.id);

    const advanced = await (await request('/api/projects/' + created.project.id + '/advance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    })).json();
    assert.equal(advanced.project.current, 2);

    const archived = await (await request('/api/projects/' + created.project.id + '/archive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived: true })
    })).json();
    assert.equal(archived.project.archived, true);

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

    const archiveUpload = await (await request('/api/projects/' + created.project.id + '/documents?stage=2&filename=archive-note.txt', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: Buffer.from('project archive file', 'utf8')
    })).json();
    assert.equal(archiveUpload.document.stage, 2);

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

    const manualBackup = await (await request('/api/backups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    assert.match(manualBackup.backup.id, /^backup-/);
    const backupDatabase = await request(manualBackup.backup.databaseUrl);
    assert.ok(Number(backupDatabase.headers.get('content-length')) > 0);

    await stop();
    await start();
    cookie = await login(base);
    const persisted = await (await request('/api/bootstrap')).json();
    assert.equal(persisted.projects.find(item => item.id === created.project.id).current, 2);
    assert.equal(persisted.projects.find(item => item.id === created.project.id).archived, true);
    assert.equal(persisted.documents.some(item => item.name === 'qa-file.txt'), true);
    assert.equal(persisted.documents.some(item => item.name === 'archive-note.txt'), true);
    assert.equal(persisted.roadmap.find(item => item.id === roadmap.id).done, true);
    assert.equal(persisted.activities.some(item => item.project === '接口联调测试标准'), true);
    assert.ok(persisted.backups.length >= 1);
    assert.equal(persisted.ledgerRecords[0].remarks, '重启后保留人工修改');
    assert.equal(persisted.ledgerRecords[0].currentStage, 7);
    assert.equal(persisted.ledgerRecords[0].linkedProjectId, promotedLedger.project.id);
  } finally {
    await stop();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
