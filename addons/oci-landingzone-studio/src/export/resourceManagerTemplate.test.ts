import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { emptyLzModel } from '../model/defaults';
import { buildConfig } from '../services/lzConfig';
import { completionNetwork, dependencyFiles, expectedDeploymentFiles } from '../services/deployment';
import { deploymentStages } from '../generator/outputNames';
import { buildResourceManagerTemplate } from './resourceManagerTemplate';

const source = new Uint8Array(readFileSync('3rd/orchestrator/upstream-v2.2.0.zip'));
const prefix = 'terraform-oci-modules-orchestrator-2.2.0/';
const facade = `${prefix}rms-facade/`;

describe('Studio Resource Manager template', () => {
  it('uses the exact pinned upstream archive', () => {
    expect(createHash('sha256').update(source).digest('hex')).toBe('c53f5492ab6e61eda9f3aa80ec85983ff5e40bf78d0e8e4e00d830116f37af71');
  });

  it.each(['complete', 'regional'] as const)('selects exact CIS1/CIS2 phase files for %s including Hub C alternatives', (scope) => {
    for (const cis of [1, 2] as const) for (const hub of ['hub_a', 'hub_c'] as const) {
      const config = buildConfig(emptyLzModel());
      Object.assign(config, { stack_scope: scope, cis_level: cis });
      config.hub.kind = hub;
      const files = expectedDeploymentFiles(config);
      const entries = unzipSync(buildResourceManagerTemplate(config, files, source));
      const tf = strFromU8(entries[`${facade}studio_deployment.tf`]);
      const [pre, final] = deploymentStages(files, completionNetwork(config));
      expect(JSON.parse(tf.match(/phase1 = (\[[^\n]+\])/)![1])).toEqual(pre.files);
      expect(JSON.parse(tf.match(/phase2 = (\[[^\n]+\])/)![1])).toEqual(final.files);
      expect(JSON.parse(tf.match(/studio_dependency_objects = (\[[^\n]*\])/)![1])).toEqual(dependencyFiles(config));
      expect(tf).toContain('An empty deployment is not allowed');
      const schema = strFromU8(entries[`${facade}schema.yml`]);
      expect(schema).toContain('title: "Deployment phase"');
      expect(schema).toContain('      - phase1\n      - phase2');
      const loader = strFromU8(entries[`${facade}get_configurations.tf`]);
      expect(loader).toContain('local.studio_configuration_objects');
      expect(loader).not.toContain('var.oci_configuration_objects');
      const deps = strFromU8(entries[`${facade}get_dependencies.tf`]);
      expect(deps).toContain('local.studio_dependency_objects');
      expect(deps).not.toContain('var.oci_dependency_objects');
    }
  });

  it('keeps provider/module versions and all unrelated source files unchanged', () => {
    const config = buildConfig(emptyLzModel());
    config.identity_domain = { mode: 'existing_default', id: 'ocid1.domain.oc1..privatefixture' };
    const before = unzipSync(source);
    const after = unzipSync(buildResourceManagerTemplate(config, expectedDeploymentFiles(config), source));
    const changed = Object.keys(before).filter((name) => !Buffer.from(before[name]).equals(Buffer.from(after[name])));
    expect(changed.sort()).toEqual(['security.tf', 'rms-facade/schema.yml', 'rms-facade/variables.tf', 'rms-facade/get_configurations.tf', 'rms-facade/get_dependencies.tf'].map((name) => prefix + name).sort());
    expect(strFromU8(after[`${prefix}security.tf`])).toContain('length(local.ext_dep_vaults_security_map) > 0 ? local.ext_dep_vaults_security_map : null');
    expect(Object.values(after).some((body) => strFromU8(body).includes('privatefixture'))).toBe(false);
    expect(Object.keys(after).filter((name) => !before[name]).sort()).toEqual([`${facade}STUDIO-COMPATIBILITY.txt`, `${facade}studio_deployment.tf`].sort());
  });
});


it.skipIf(spawnSync('terraform', ['version']).status !== 0)('rejects an empty bucket and accepts both explicit phases in Terraform 1.5+', () => {
  const config = buildConfig(emptyLzModel());
  const entries = unzipSync(buildResourceManagerTemplate(config, expectedDeploymentFiles(config), source));
  const dir = mkdtempSync(join(tmpdir(), 'studio-template-guard-'));
  try {
    writeFileSync(join(dir, 'main.tf'), strFromU8(entries[`${facade}studio_deployment.tf`]) + `
variable "configuration_source" { default = "ocibucket" }
variable "oci_configuration_bucket" {
 type = string
 default = null
}
variable "local_config_file_paths" { default = [] }
`);
    const run = (...args: string[]) => spawnSync('terraform', args, { cwd: dir, encoding: 'utf8', timeout: 20_000 });
    expect(run('init', '-backend=false', '-input=false').status).toBe(0);
    const empty = run('plan', '-input=false', '-no-color');
    expect(empty.status).not.toBe(0);
    expect(empty.stderr).toContain('An empty deployment is not allowed');
    for (const phase of ['phase1', 'phase2']) {
      const result = run('plan', '-input=false', '-no-color', '-var=oci_configuration_bucket=fixture', `-var=studio_deployment_phase=${phase}`);
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
    }
    expect(run('plan', '-input=false', '-no-color', '-var=oci_configuration_bucket=fixture', '-var=studio_deployment_phase=invalid').status).not.toBe(0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


it('keeps imported text literal instead of interpreting HCL expressions', () => {
  const config = buildConfig(emptyLzModel());
  config.region = 'region-${1+1}';
  const entries = unzipSync(buildResourceManagerTemplate(config, expectedDeploymentFiles(config), source));
  expect(strFromU8(entries[`${facade}variables.tf`])).toContain('region-$${1+1}');
});
