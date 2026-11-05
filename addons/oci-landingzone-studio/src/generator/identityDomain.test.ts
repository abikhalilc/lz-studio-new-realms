import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { evaluate, setAssetLoader } from './jsonnetVm';
import { buildVirtualFs } from './virtualFs';

const config = readFileSync(resolve('../../tests/gen/testdata/configs/pass/existing_default_domain_all_workloads.jsonnet'), 'utf8');
interface IamOutput {
  identity_domain_groups_configuration: {
    default_identity_domain_id: string;
    ignore_external_membership_updates: boolean;
    groups: Record<string, { name: string; identity_domain_id?: string }>;
  };
  policies_configuration: { supplied_policies: Record<string, { statements: string[] }> };
}
beforeAll(() => {
  setAssetLoader(async () => ({ wasmBinary: readFileSync(resolve('3rd/go-jsonnet/libjsonnet.wasm')) }));
});

describe('existing Default identity domain', () => {
  it('matches every checked-in published IAM/identity snapshot with the choice omitted', async () => {
    const { files } = buildVirtualFs();
    const entries = Object.keys(files).filter((name) => /(?:identity(?:_uc[123])?|iam)\.jsonnet$/.test(name)).sort();
    expect(entries.length).toBeGreaterThan(20);
    const expected = Object.fromEntries(entries.map((name) => [
      `expected/${name}`, readFileSync(resolve('../../', name.replace(/\.jsonnet$/, '.json')), 'utf8'),
    ]));
    const code = `{ ${entries.map((name) => `${JSON.stringify(name)}: (import ${JSON.stringify(name)}) == std.parseJson(importstr ${JSON.stringify(`expected/${name}`)})`).join(',')} }`;
    const matches = await evaluate('identity-parity.jsonnet', { ...files, ...expected, 'identity-parity.jsonnet': code });
    expect(matches).toEqual(Object.fromEntries(entries.map((name) => [name, true])));
  }, 60_000);

  it.each([1, 2])('keeps base, RPC and every workload consistent at CIS%s', async (cisLevel) => {
    const { files, entry } = buildVirtualFs();
    const outputs = await evaluate(entry, files, { config: `(${config}) + { cis_level: ${cisLevel} }` }) as Record<string, unknown>;
    const iam = outputs['iam.json'] as IamOutput;
    expect(iam).not.toHaveProperty('identity_domains_configuration');
    expect(iam).not.toHaveProperty('groups_configuration');
    const groups = iam.identity_domain_groups_configuration;
    expect(groups.default_identity_domain_id).toBe('ocid1.domain.oc41..aaaaaaaafakefixture');
    expect(groups.ignore_external_membership_updates).toBe(true);
    expect(Object.values(groups.groups).every((group) => group.identity_domain_id === undefined || group.identity_domain_id === groups.default_identity_domain_id)).toBe(true);
    expect(groups.groups).toHaveProperty('GRP-LZ-PROD-PLATFORM-OKE-ADMINS-KEY');
    expect(groups.groups).toHaveProperty('GRP-LZ-PROD-PLATFORM-OCVS-ADMINS-KEY');
    for (const workload of ['exacc', 'exacs']) {
      expect(Object.values(groups.groups).some((group) => group.name.includes(workload))).toBe(true);
    }
    const statements = Object.values(iam.policies_configuration.supplied_policies).flatMap((policy) => policy.statements);
    expect(statements.some((statement) => statement.startsWith("Endorse group 'Default'/'grp-lz-network-admin'"))).toBe(true);
    expect(JSON.stringify(outputs)).not.toContain('id_lz_common');
    expect(JSON.stringify(outputs)).not.toContain('COMMON-DOMAIN');
  }, 60_000);

  it.each([
    [false, 'config.identity_domain must be an object'],
    [{ mode: 'custom' }, 'config.identity_domain.mode must be existing_default'],
    [{ mode: 'existing_default' }, 'config.identity_domain.id is required'],
    [{ mode: 'existing_default', id: 42 }, 'config.identity_domain.id must be a non-empty domain OCID'],
    [{ mode: 'existing_default', id: 'ocid1.tenancy.oc41..fixture' }, 'config.identity_domain.id must be a domain OCID'],
    [{ mode: 'existing_default', id: 'ocid1.domain.oc41..bad value' }, 'config.identity_domain.id must be a domain OCID'],
    [{ mode: 'existing_default', id: 'ocid1.domain.oc1..fixture' }, 'config.identity_domain.id must belong to config.realm'],
    [{ mode: 'existing_default', id: 'ocid1.domain.oc41..fixture', name: 'Custom' }, 'config.identity_domain contains unsupported keys: name'],
  ])('rejects invalid input %j', async (identityDomain, message) => {
    const { files } = buildVirtualFs();
    await expect(evaluate('identity-boundary.jsonnet', {
      ...files,
      'identity-boundary.jsonnet': `local normalize = (import 'config.libsonnet').normalize;
        normalize({ realm: 'oc41', hub: { kind: 'hub_e', network: { vcn: '10.0.0.0/21' } },
          identity_domain: ${JSON.stringify(identityDomain)} })`,
    })).rejects.toThrow(message as string);
  });

  it('preserves omitted and null new-domain behavior', async () => {
    const { files, entry } = buildVirtualFs();
    const base = "{ realm: 'oc19', region: 'eu-frankfurt-2', region_short_name: 'str', hub: { kind: 'hub_e', network: { vcn: '10.0.0.0/21' } } }";
    const original = await evaluate(entry, files, { config: base });
    const explicitNull = await evaluate(entry, files, { config: `${base} + { identity_domain: null }` });
    expect(explicitNull).toEqual(original);
    expect(JSON.stringify(original)).toContain('id_lz_common');
    expect(JSON.stringify(original)).toContain('COMMON-DOMAIN');
  }, 60_000);
});
