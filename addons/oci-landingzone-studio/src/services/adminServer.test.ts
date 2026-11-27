import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { openDatabase, createAdmin, createStudioServer } from '../../server/app';
import defaults from '../../../../gen/realm-defaults.json';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const staticDir = mkdtempSync(join(tmpdir(), 'studio-static-test-')); writeFileSync(join(staticDir, 'index.html'), '<h1>Studio fixture</h1>');
const db = openDatabase(':memory:'); const server = createStudioServer({ db, dist: staticDir });
const password = randomBytes(24).toString('hex'); let origin = ''; let cookie = ''; let csrf = '';
beforeAll(async () => {
  await createAdmin(db, 'test-admin', password);
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>(r => server.close(() => r())); db.close(); rmSync(staticDir, { recursive: true, force: true }); });
async function api(path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(origin + path, { method, headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: res.status, data: await res.json(), cookie: res.headers.get('set-cookie') };
}

it('protects shared CRUD with login, CSRF, validation, revisions, audit and session revocation', async () => {
  const home = await fetch(origin + '/'); expect(home.status).toBe(200); expect(await home.text()).toContain('Studio fixture');
  expect((await fetch(origin + '/admin/realms')).status).toBe(200);
  expect((await fetch(origin + '/..%2fserver/app.ts')).status).toBe(404);
  expect((await api('/api/realms')).data.realms).toHaveLength(3);
  expect((await api('/api/admin/realms', 'POST', {})).status).toBe(401);
  expect((await api('/api/admin/login', 'POST', { username: 'test-admin', password }, { Origin: 'https://attacker.test' })).status).toBe(403);
  const login = await api('/api/admin/login', 'POST', { username: 'test-admin', password });
  expect(login.status).toBe(200); expect(login.cookie).toContain('HttpOnly'); expect(login.cookie).toContain('SameSite=Strict');
  cookie = login.cookie!.split(';')[0]; csrf = login.data.csrf;
  expect((await api('/api/admin/realms', 'POST', {}, { 'X-CSRF-Token': 'wrong' })).status).toBe(403);
  const realm = { ...structuredClone(defaults[2]), id: 'oc88', label: 'Shared test realm', apiDomain: 'example.test', consoleUrl: 'https://console.example.test', regions: [{ id: 'me-example-1', shortName: 'tst' }],
    securityZonePolicies: Object.fromEntries(Object.entries(defaults[2].securityZonePolicies).map(([k, v]) => [k, v.map(p => p.replace('.oc41.', '.oc88.'))])) };
  expect((await api('/api/admin/realms', 'POST', { ...realm, usageReportTenancy: 'ocid1.tenancy.oc1..invalid' })).status).toBe(400);
  expect((await api('/api/admin/realms', 'POST', realm)).status).toBe(201);
  expect((await api('/api/realms')).data.realms.some((r: { id: string }) => r.id === 'oc88')).toBe(true);
  expect((await api('/api/admin/realms/oc88', 'PUT', { ...realm, label: 'Updated shared name' })).status).toBe(200);
  expect((await api('/api/admin/realms/oc88', 'PUT', realm)).status).toBe(409);
  expect((await api('/api/admin/realms/oc88', 'DELETE', { revision: 2 })).status).toBe(200);
  expect((await api('/api/admin/audit')).data.events.map((e: { action: string }) => e.action)).toEqual(['delete', 'update', 'create']);
  for (const id of ['oc19', 'oc41']) expect((await api('/api/admin/realms/' + id, 'DELETE', { revision: 1 })).status).toBe(200);
  expect((await api('/api/admin/realms/oc1', 'DELETE', { revision: 1 })).status).toBe(409);
  const stored = db.prepare('SELECT password_hash FROM admins').get()!;
  expect(stored.password_hash).not.toBe(password);
  expect((await api('/api/admin/logout', 'POST', {})).status).toBe(200);
  expect((await api('/api/admin/audit')).status).toBe(401);
  cookie = ''; csrf = '';
  for (let i = 0; i < 5; i++) expect((await api('/api/admin/login', 'POST', { username: 'test-admin', password: 'wrong' })).status).toBe(401);
  expect((await api('/api/admin/login', 'POST', { username: 'test-admin', password })).status).toBe(429);
}, 20_000);

it('persists accounts and catalog edits across restart without reseeding deleted realms', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'studio-db-test-')); const path = join(dir, 'studio.sqlite');
  try {
    const first = openDatabase(path); await createAdmin(first, 'persistent-admin', password);
    first.prepare('DELETE FROM realms WHERE id=?').run('oc19'); first.close();
    const second = openDatabase(path);
    expect(second.prepare('SELECT id FROM realms').all()).toHaveLength(2);
    expect(second.prepare('SELECT username FROM admins').get()?.username).toBe('persistent-admin');
    second.close(); expect(statSync(path).mode & 0o777).toBe(0o600);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
