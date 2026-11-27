import { afterEach, beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import defaults from '../../../../gen/realm-defaults.json';
import { setRealmCatalog, getRealmOptions, realmProfileOverride } from './realmCatalog';
import { validateRealm } from '../../shared/realm';
import { buildConfig, serializeConfig } from './lzConfig';
import { emptyLzModel } from '../model/defaults';
import { generateOutputs } from '../generator/generate';
import { evaluate, setAssetLoader } from '../generator/jsonnetVm';
import { deploymentConsoleLinks, deploymentCliSteps } from './deployment';

export const customRealmFixture = () => validateRealm({ ...structuredClone(defaults[2]), id: 'oc88', label: 'Test dedicated realm', apiDomain: 'example.test', consoleUrl: 'https://console.example.test',
  regions: [{ id: 'me-example-1', shortName: 'tst' }], fileStorageService: 'fss-test', objectStorageServicePrefix: 'objectstorage-test-', usageReportTenancy: null,
  securityZonePolicies: Object.fromEntries(Object.entries(defaults[2].securityZonePolicies).map(([k, v]) => [k, v.map(p => p.replace('.oc41.', '.oc88.'))])) });

beforeAll(() => setAssetLoader(async () => ({ wasmBinary: readFileSync('3rd/go-jsonnet/libjsonnet.wasm') })));
afterEach(() => setRealmCatalog(defaults));

it('uses custom realm metadata, portable constants and deployment links end to end', async () => {
  const realm = customRealmFixture(); setRealmCatalog([...defaults, realm]);
  expect(getRealmOptions().some(r => r.id === 'oc88')).toBe(true);
  const model = emptyLzModel(); Object.assign(model.foundation, { realm: realm.id, region: realm.regions[0].id, regionShortName: 'tst' });
  const source = serializeConfig(model);
  const config = await evaluate('config.jsonnet', { 'config.jsonnet': source }) as ReturnType<typeof buildConfig>;
  expect(config.realm_profile?.regions).toEqual(realm.regions);
  expect(deploymentConsoleLinks(config)?.createStackUrl).toContain('https://console.example.test/');
  expect(deploymentCliSteps(config).join(' ')).toContain('example.test');
  const output = await generateOutputs(model);
  expect(output.files['iam.json']).toContain('fss-test');
  expect(output.files['iam.json']).toContain('objectstorage-test-me-example-1');
  expect(output.files['security_cis2.json']).toContain('ocid1.securityzonessecuritypolicy.oc88.');
  expect(output.files['security_cis2.json']).not.toContain('.oc41.');
}, 60_000);

it('blocks disabled and deleted realms without changing saved designs', async () => {
  const realm = customRealmFixture(); setRealmCatalog([...defaults, { ...realm, enabled: false }]);
  const model = emptyLzModel(); model.foundation.realm = realm.id;
  expect(getRealmOptions().some(r => r.id === realm.id)).toBe(false);
  expect(() => serializeConfig(model)).not.toThrow();
  await expect(generateOutputs(model)).rejects.toThrow('unavailable');
  setRealmCatalog(defaults);
  await expect(generateOutputs(model)).rejects.toThrow('unavailable');
  expect(model.foundation.realm).toBe('oc88');
});

it('does not invent reporting tenancy OCIDs or copy policy IDs across realms', () => {
  const realm = customRealmFixture(); realm.securityZonePolicies.shared_network[0] = defaults[2].securityZonePolicies.shared_network[0];
  expect(() => validateRealm(realm)).toThrow('belonging to oc88');
  expect(realmProfileOverride('oc41')).toBeUndefined();
  expect(() => validateRealm({ ...defaults[0], consoleUrl: 'javascript:alert(1)' })).toThrow('HTTPS');
  expect(() => validateRealm({ ...defaults[0], regions: [defaults[0].regions[0], defaults[0].regions[0]] })).toThrow('unique');
});

it('starts new designs in an enabled realm after the commercial realm is disabled', () => {
  setRealmCatalog(defaults.map(r => r.id === 'oc1' ? { ...r, enabled: false } : r));
  const model = emptyLzModel();
  expect(model.foundation.realm).toBe('oc19');
  expect(model.foundation.region).toBe('eu-frankfurt-2');
});

it('embeds a persisted catalog that differs from repository seeds even at revision one', () => {
  setRealmCatalog(defaults.map(r => r.id === 'oc41' ? { ...r, label: 'Operator-managed label' } : r));
  expect(realmProfileOverride('oc41')?.label).toBe('Operator-managed label');
});
