import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { setAssetLoader, evaluate } from './jsonnetVm';
import { buildVirtualFs } from './virtualFs';
import { generateOutputs, generateFromUpstreamDefaults } from './generate';
import { emptyLzModel } from '../model/defaults';
import { buildConfig } from '../services/lzConfig';
import { importConfig } from '../services/importConfig';

beforeAll(() => setAssetLoader(async () => ({ wasmBinary: readFileSync('3rd/go-jsonnet/libjsonnet.wasm') })));

it('exports active audit collection and Security Zone-owned Cloud Guard coverage without demo ingress', async () => {
  const model = emptyLzModel();
  const output = await generateOutputs(model);
  const network = JSON.parse(output.files['network.json']);
  expect(JSON.stringify(network)).not.toContain('l7_load_balancers');
  expect(JSON.stringify(network)).not.toContain('/testapp');
  for (const suffix of ['_pre', '']) {
    const observability = JSON.parse(output.files[`observability_cis2${suffix}.json`]);
    const connectors = Object.values(observability.service_connectors_configuration.service_connectors) as { activate: boolean }[];
    expect(connectors).toHaveLength(1);
    expect(connectors[0].activate).toBe(true);
    const security = JSON.parse(output.files[`security_cis2${suffix}.json`]);
    expect(security.cloud_guard_configuration).toBeUndefined();
    expect(Object.values(security.security_zones_configuration.security_zones)).toContainEqual(expect.objectContaining({
      compartment_id: 'CMP-LANDINGZONE-KEY',
    }));
  }
}, 60_000);

it('preserves the published example contract when deployment settings are omitted', async () => {
  const output = await generateFromUpstreamDefaults('hub_a');
  expect(output['network.json']).toContain('l7_load_balancers');
  const security = JSON.parse(output['security_cis2_pre.json']);
  expect(Object.values(security.cloud_guard_configuration.targets)).toEqual([expect.objectContaining({ resource_id: 'TENANCY-ROOT' })]);
  expect(output['observability_cis2_pre.json']).not.toContain('"activate"');
}, 60_000);

it.each([
  { activate_audit_connector: 'true' },
  { include_example_load_balancer: 'false' },
  { cloud_guard_target_scope: 'unknown' },
  { unknown_setting: true },
])('rejects invalid deployment settings %j', async (settings) => {
  const { files } = buildVirtualFs();
  await expect(evaluate('check.jsonnet', { ...files,
    'check.jsonnet': `(import 'lib/deployment_settings.libsonnet').normalize(${JSON.stringify(settings)})`,
  })).rejects.toThrow();
});

it('warns when migrating old Studio exports and rejects unsupported deployment choices', () => {
  const config = buildConfig(emptyLzModel());
  delete config.deployment_settings;
  expect(importConfig(config).warnings.join(' ')).toContain('example hub load balancer');
  config.deployment_settings = { include_example_load_balancer: true, activate_audit_connector: false, cloud_guard_target_scope: 'tenancy' };
  expect(() => importConfig(config)).toThrow('deployment_settings');
});
