import { expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import { credentialProfiles, connectionStore } from '../../server/policyConnections';
import { createPolicyImporter } from '../../server/policyImport';
import { openDatabase, createAdmin, createStudioServer } from '../../server/app';
const connection = { id: 'du', label: 'Du connection', realm: 'oc41', region: 'me-dubai-3', tenancyOcid: 'ocid1.tenancy.oc41..aaaaaaaatest', profile: 'DU' };
const profiles = () => [{ name: 'DU', tenancyOcid: connection.tenancyOcid, region: connection.region }];
it('returns only safe credential profile metadata and supports defaults', () => {
  const dir = mkdtempSync(join(tmpdir(), 'studio-profiles-')); const path = join(dir, 'config');
  try {
    writeFileSync(path, `[DEFAULT]\ntenancy=${connection.tenancyOcid}\nregion=me-dubai-3\nkey_file=/secret/key.pem\nfingerprint=SECRET\n[DU]\nuser=SECRET_USER\npass_phrase=SECRET_PASSWORD\n`);
    expect(credentialProfiles(path)).toEqual([{ name: 'DEFAULT', tenancyOcid: connection.tenancyOcid, region: connection.region }, ...profiles()]);
    expect(JSON.stringify(credentialProfiles(path))).not.toContain('SECRET');
    expect(credentialProfiles(join(dir, 'missing'))).toEqual([]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
it('audits CRUD, guards revisions and profiles, and never resurrects deleted seeds', () => {
  const db = openDatabase(':memory:');
  try {
    const store = connectionStore(db, [connection], profiles); const importer = createPolicyImporter(store.list);
    expect(() => store.save({ ...connection, id: 'bad', realm: 'oc1' }, 'admin', true)).toThrow();
    expect(() => store.save({ ...connection, id: 'bad', profile: 'UNCONFIGURED' }, 'admin', true)).toThrow('available');
    const created = store.save({ ...connection, id: 'new', endpoint: 'https://attacker.test' }, 'admin', true);
    expect(created.endpoint).toBeUndefined(); expect(importer.sources).toHaveLength(2);
    const updated = store.save({ ...created, label: 'Updated' }, 'admin', false); expect(updated.revision).toBe(2);
    expect(() => store.save(created, 'admin', false)).toThrow('another session');
    expect(() => store.remove(updated.id, 1, 'admin')).toThrow('changed');
    store.remove(updated.id, 2, 'admin'); store.remove(connection.id, 1, 'admin');
    expect(importer.sources).toEqual([]); expect(connectionStore(db, [connection], profiles).list()).toEqual([]);
    expect(db.prepare('SELECT action FROM audit ORDER BY id').all().map(r => r.action)).toEqual(['connection-create', 'connection-update', 'connection-delete', 'connection-delete']);
  } finally { db.close(); }
});
it('preserves server endpoint restrictions when editing a connection', () => {
  const db = openDatabase(':memory:');
  try {
    const store = connectionStore(db, [{ ...connection, endpoint: 'https://cloudguard.me-dubai-3.example.test' }], profiles);
    const saved = store.save({ ...store.list()[0], label: 'Renamed', endpoint: 'https://attacker.test' }, 'admin', false);
    expect(saved.endpoint).toBe('https://cloudguard.me-dubai-3.example.test');
    expect(() => store.save({ ...saved, region: 'me-dubai-4' }, 'admin', false)).toThrow('server-managed');
  } finally { db.close(); }
});
it('protects configuration with authentication and CSRF and updates discovery immediately', async () => {
  const db = openDatabase(':memory:'); await createAdmin(db, 'test-admin', 'test-only-password-1234');
  const store = connectionStore(db, [], profiles); const server = createStudioServer({ db, connections: store, policyImporter: createPolicyImporter(store.list) });
  try {
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const call = (path: string, method = 'GET', value?: unknown, cookie = '', csrf = '') => fetch(origin + '/api/admin/' + path, { method, headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': csrf }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
    expect((await call('connections')).status).toBe(401); expect((await call('connections', 'POST', connection)).status).toBe(401);
    const login = await call('login', 'POST', { username: 'test-admin', password: 'test-only-password-1234' });
    const cookie = login.headers.get('set-cookie')!.split(';')[0]; const { csrf } = await login.json();
    expect((await call('connections', 'POST', connection, cookie)).status).toBe(403);
    const created = await call('connections', 'POST', connection, cookie, csrf); expect(created.status).toBe(201); const { connection: saved } = await created.json();
    const listed = await (await call('connections', 'GET', undefined, cookie)).json(); expect(listed.connections[0].profile).toBe('DU'); expect(listed.profiles).toEqual(profiles());
    const publicSources = await (await call('policy-sources', 'GET', undefined, cookie)).json(); expect(publicSources.sources[0].id).toBe('du'); expect(publicSources.sources[0].profile).toBeUndefined();
    const update = await call('connections/du', 'PUT', { ...saved, label: 'Changed' }, cookie, csrf); expect(update.status).toBe(200);
    expect((await call('connections/du', 'DELETE', { revision: saved.revision }, cookie, csrf)).status).toBe(400);
    const { connection: changed } = await update.json(); expect((await call('connections/du', 'DELETE', { revision: changed.revision }, cookie, csrf)).status).toBe(200);
    expect((await (await call('policy-sources', 'GET', undefined, cookie)).json()).sources).toEqual([]);
  } finally { await new Promise<void>(r => server.close(() => r())); db.close(); }
});
