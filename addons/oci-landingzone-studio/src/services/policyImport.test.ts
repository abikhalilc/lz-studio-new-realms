import { expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { createPolicyImporter, mapPolicies, readPolicySources } from '../../server/policyImport';
import { createAdmin, createStudioServer, openDatabase } from '../../server/app';
import defaults from '../../../../gen/realm-defaults.json';

const mapping = JSON.parse(readFileSync(new URL('../../server/security-policy-mapping.json', import.meta.url), 'utf8')) as { name: string; groups: string[] }[];
const source = { id: 'test', label: 'Test realm', realm: 'oc88', region: 'me-example-1', profile: 'TEST', tenancyOcid: 'ocid1.tenancy.oc88..aaaaaaaax' };
const inventory = () => ({ data: { items: mapping.map((rule, i) => ({ id: `ocid1.securityzonessecuritypolicy.oc88..aaaaaaaap${i}`, 'display-name': rule.name, description: `Verified policy ${i}`, owner: 'ORACLE', 'lifecycle-state': 'ACTIVE' })) } });

it('maps exact names to 4 shared and 26 environment policies using actual returned OCIDs', () => {
  const response = inventory(); response.data.items.reverse();
  const preview = mapPolicies(response, source);
  expect(preview.complete).toBe(true);
  expect(preview.matches.filter(m => m.groups.includes('shared_network'))).toHaveLength(4);
  expect(preview.matches.filter(m => m.groups.includes('environment'))).toHaveLength(26);
  expect(preview.matches.flatMap(m => m.candidates).every(p => response.data.items.some(item => item.id === p.id))).toBe(true);
});
it('blocks missing and ambiguous matches, excludes unknown, inactive and non-Oracle policies', () => {
  const response = inventory(); const first = response.data.items[0];
  response.data.items.push({ ...first, id: first.id + 'x' });
  response.data.items[1]['lifecycle-state'] = 'INACTIVE';
  response.data.items[2].owner = 'CUSTOMER';
  response.data.items.push({ ...first, id: first.id + 'new', 'display-name': 'New optional policy' });
  const preview = mapPolicies(response, source);
  expect(preview.complete).toBe(false); expect(preview.matches[0].candidates).toHaveLength(2);
  expect(preview.matches[1].candidates).toHaveLength(0); expect(preview.matches[2].candidates).toHaveLength(0);
  expect(preview.unused.map(p => p.name)).toEqual(['New optional policy']);
});
it('rejects malformed, duplicate-ID and foreign-realm inventories', () => {
  expect(() => mapPolicies({}, source)).toThrow();
  const duplicate = inventory(); duplicate.data.items.push(duplicate.data.items[0]);
  expect(() => mapPolicies(duplicate, source)).toThrow();
  expect(() => mapPolicies(inventory(), { ...source, realm: 'oc41' })).toThrow();
});
it('loads only validated server connections and omits credential details from the public list', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'studio-policy-source-')); const file = join(dir, 'sources.json');
  try {
    expect(readPolicySources(file)).toEqual([]);
    writeFileSync(file, JSON.stringify([source]));
    const importer = createPolicyImporter(readPolicySources(file));
    expect(importer.sources).toEqual([{ id: source.id, label: source.label, realm: source.realm, region: source.region }]);
    await expect(importer.discover('unconfigured', source.realm)).rejects.toThrow('configured');
    await expect(importer.discover(source.id, 'oc41')).rejects.toThrow('configured');
    writeFileSync(file, JSON.stringify([{ ...source, profile: '--malicious;command' }])); expect(() => readPolicySources(file)).toThrow();
    writeFileSync(file, JSON.stringify([{ ...source, endpoint: 'http://insecure.test' }])); expect(() => readPolicySources(file)).toThrow();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
it('retrieves all pages through CLI arguments and sanitizes command failures', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'studio-policy-cli-')); const cli = join(dir, 'fake-oci'); const argsFile = join(dir, 'args.json');
  try {
    writeFileSync(cli, `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)));process.stdout.write(${JSON.stringify(JSON.stringify(inventory()))});`, { mode: 0o700 });
    expect((await createPolicyImporter([source], cli).discover(source.id, source.realm)).complete).toBe(true);
    expect(JSON.parse(readFileSync(argsFile, 'utf8'))).toEqual(['cloud-guard', 'security-policy-collection', 'list-security-policies', '--profile', 'TEST', '--region', source.region, '--compartment-id', source.tenancyOcid, '--all', '--output', 'json']);
    writeFileSync(cli, '#!/usr/bin/env node\nconsole.error("SECRET-CREDENTIAL-DETAILS");process.exit(1);');
    await expect(createPolicyImporter([source], cli).discover(source.id, source.realm)).rejects.toThrow('Could not retrieve policies');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
it('requires authentication and CSRF; discovery changes neither catalog nor audit until normal save', async () => {
  const db = openDatabase(':memory:'); await createAdmin(db, 'test-admin', 'test-only-password-1234');
  const preview = mapPolicies(inventory(), source);
  const server = createStudioServer({ db, policyImporter: { sources: [source], discover: async () => preview } });
  try {
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const call = (path: string, body?: unknown, cookie = '', csrf = '') => fetch(origin + '/api/admin/' + path, { method: body ? 'POST' : 'GET', headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': csrf }, ...(body ? { body: JSON.stringify(body) } : {}) });
    expect((await call('policy-sources')).status).toBe(401);
    expect((await call('policies/discover', { source: source.id, realm: source.realm })).status).toBe(401);
    const login = await call('login', { username: 'test-admin', password: 'test-only-password-1234' });
    const cookie = login.headers.get('set-cookie')!.split(';')[0]; const { csrf } = await login.json();
    expect((await call('policies/discover', {}, cookie)).status).toBe(403);
    const before = db.prepare('SELECT * FROM realms').all();
    const result = await call('policies/discover', { source: source.id, realm: source.realm }, cookie, csrf);
    expect(result.status).toBe(200); expect((await result.json()).complete).toBe(true);
    expect(db.prepare('SELECT * FROM realms').all()).toEqual(before);
    expect(db.prepare('SELECT * FROM audit').all()).toHaveLength(0);
    const policies = { shared_network: [] as string[], environment: [] as string[] };
    for (const m of preview.matches) for (const group of m.groups) policies[group].push(m.candidates[0].id);
    const realm = { ...defaults[2], id: source.realm, usageReportTenancy: null, regions: [{ id: source.region, shortName: 'tst' }], securityZonePolicies: policies };
    expect((await call('realms', realm, cookie, csrf)).status).toBe(201);
    expect(db.prepare('SELECT * FROM audit').all()).toHaveLength(1);
  } finally { await new Promise<void>(r => server.close(() => r())); db.close(); }
});
