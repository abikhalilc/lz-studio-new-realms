import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { beforeAll, describe, expect, it } from 'vitest';
import { setAssetLoader } from '../generator/jsonnetVm';
import { generateOutputs } from '../generator/generate';
import { deploymentReadme, expectedDeploymentFiles, completionNetwork } from '../services/deployment';
import { deploymentStages } from '../generator/outputNames';
import { emptyLzModel } from '../model/defaults';
import { buildConfig } from '../services/lzConfig';
import { hubKindDefaults } from '../services/hubKinds';
import { zipTextFiles } from './zip';

beforeAll(() => setAssetLoader(async () => ({ wasmBinary: readFileSync('3rd/go-jsonnet/libjsonnet.wasm') })));

describe('OC41 generated ZIP release checks (no provisioning)', () => {
  it.each([
    [1, 'hub_a'], [2, 'hub_a'], [1, 'hub_b'], [2, 'hub_b'],
    [1, 'hub_c'], [2, 'hub_c'], [1, 'hub_e'], [2, 'hub_e'],
  ] as const)('exports a complete CIS%s %s bundle with existing Default identity', async (cisLevel, hubKind) => {
    const model = emptyLzModel();
    Object.assign(model.foundation, { realm: 'oc41', region: 'me-dubai-3', regionShortName: 'pcz', cisLevel,
      drRegion: 'me-dubai-2', notifications: { default: 'fixture@example.com' },
      identityDomain: { mode: 'existing_default', id: 'ocid1.domain.oc41..fixture' } });
    model.network = { hubKind, ...hubKindDefaults(hubKind) };
    const output = await generateOutputs(model);
    const config = buildConfig(model);
    const readme = deploymentReadme(config, Object.keys(output.files));
    const bundle = { 'config.jsonnet': output.config, ...output.files, 'README.txt': readme };
    const entries = unzipSync(new Uint8Array(await zipTextFiles(bundle).arrayBuffer()));
    expect(Object.keys(entries).sort()).toEqual(Object.keys(bundle).sort());
    for (const [name, text] of Object.entries(bundle)) expect(strFromU8(entries[name])).toBe(text);
    expect(Object.keys(output.files).sort()).toEqual(expectedDeploymentFiles(config).sort());
    const [pre, final] = deploymentStages(Object.keys(output.files), completionNetwork(config));
    for (const stage of [pre, final]) {
      const families = stage.files.flatMap((name) => Object.keys(JSON.parse(output.files[name])));
      expect(new Set(families).size).toBe(families.length);
      expect(stage.files.filter((name) => /^network(?:_backends)?\.json$/.test(name))).toHaveLength(1);
    }
    const iam = JSON.parse(output.files['iam.json']);
    expect(iam).not.toHaveProperty('identity_domains_configuration');
    expect(iam.identity_domain_groups_configuration.default_identity_domain_id).toBe('ocid1.domain.oc41..fixture');
    expect(output.files['iam.json']).toContain('manage usage-report in tenancy');
    expect(output.files['iam.json']).toContain('manage usage-budgets in tenancy');
    expect(Object.entries(output.files).flatMap(([name, text]) => text.match(/ocid1\.[^\s"',]+\.oc(?:1|19)\.[^\s"',]*/g)?.map((id) => `${name}: ${id}`) ?? [])).toEqual([]);
    expect(readme).toContain('https://cloud.dutechcloud.ae/resourcemanager/stacks/create?region=me-dubai-3');
    expect(readme).toContain('cross-tenancy access to the reporting tenancy');
    expect(readme).toContain('successful Apply alone does not confirm');
    expect(readme.includes('network_backends.json')).toBe(hubKind === 'hub_c');
  }, 60_000);
});
