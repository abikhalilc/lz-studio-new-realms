import { expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createServer, loadConfigFromFile } from 'vite';
import { openDatabase, createAdmin, createStudioServer } from '../../server/app';

it('supports login and the full realm lifecycle through the configured Vite proxy while rejecting other origins', async () => {
  const db = openDatabase(':memory:');
  const password = randomBytes(24).toString('hex');
  await createAdmin(db, 'proxy-test-admin', password);
  const api = createStudioServer({ db });
  const root = mkdtempSync(join(tmpdir(), 'studio-proxy-test-'));
  let proxy: Awaited<ReturnType<typeof createServer>> | undefined;
  try {
    await new Promise<void>((accept, reject) => { api.once('error', reject); api.listen(0, '127.0.0.1', accept); });
    const apiOrigin = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
    const loaded = await loadConfigFromFile({ command: 'serve', mode: 'test' }, resolve('vite.config.ts'));
    const rule = loaded?.config.server?.proxy?.['/api'];
    expect(typeof rule).toBe('object');
    if (!rule || typeof rule === 'string') throw new Error('Use an explicit same-origin proxy configuration.');
    proxy = await createServer({ configFile: false, root, logLevel: 'silent',
      server: { host: '127.0.0.1', port: 0, hmr: false, watch: null, proxy: { '/api': { ...rule, target: apiOrigin } } } });
    await proxy.listen();
    const origin = `http://127.0.0.1:${(proxy.httpServer!.address() as AddressInfo).port}`;
    const login = await fetch(origin + '/api/admin/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'proxy-test-admin', password }) });
    expect(login.status).toBe(200);
    const session = await login.json();
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const send = async (path: string, method: string, body: unknown) => {
      const response = await fetch(origin + path, { method, headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    };
    const catalog = async () => (await (await fetch(origin + '/api/realms')).json()).realms as { id: string; label: string; enabled: boolean; regions: unknown[] }[];
    const defaults = (await catalog()).find(r => r.id === 'oc41')!;
    const fixture = JSON.parse(JSON.stringify(defaults).replaceAll('.oc41.', '.oc88.'));
    Object.assign(fixture, { id: 'oc88', label: 'Realm lifecycle test', regions: [{ id: 'eu-studio-test-1', shortName: 'tst' }] });
    expect((await send('/api/admin/realms', 'POST', fixture)).status).toBe(201);
    expect((await catalog()).find(r => r.id === 'oc88')?.enabled).toBe(true);
    fixture.label = 'Updated realm lifecycle test';
    fixture.regions.push({ id: 'eu-studio-test-2', shortName: 'ts2' });
    const updated = await send('/api/admin/realms/oc88', 'PUT', fixture);
    expect(updated.status).toBe(200);
    expect((await catalog()).find(r => r.id === 'oc88')).toMatchObject({ label: fixture.label, regions: fixture.regions });
    const disabled = await send('/api/admin/realms/oc88', 'PUT', { ...updated.body.realm, enabled: false });
    expect(disabled.status).toBe(200);
    expect((await catalog()).find(r => r.id === 'oc88')?.enabled).toBe(false);
    expect((await send('/api/admin/realms/oc88', 'DELETE', { revision: disabled.body.realm.revision })).status).toBe(200);
    expect((await catalog()).some(r => r.id === 'oc88')).toBe(false);
    const audit = await (await fetch(origin + '/api/admin/audit', { headers: { Cookie: cookie } })).json();
    expect(audit.events.map((e: { action: string }) => e.action)).toEqual(['delete', 'update', 'update', 'create']);
    const forbidden = await fetch(origin + '/api/admin/login', { method: 'POST', headers: { Origin: 'https://attacker.test', 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'proxy-test-admin', password }) });
    expect(forbidden.status).toBe(403);
    const logout = await fetch(origin + '/api/admin/logout', { method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf }, body: '{}' });
    expect(logout.status).toBe(200);
  } finally {
    await proxy?.close();
    await new Promise<void>(accept => api.close(() => accept()));
    db.close(); rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
