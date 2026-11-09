import { describe, expect, it } from 'vitest';
import { deploymentConsoleLinks, OC41_CONSOLE_STEP, ORCHESTRATOR_RELEASE_URL, deploymentReadme, deploymentVerification, deploymentPrerequisites, deploymentSettings, deploymentCliSteps, expectedDeploymentFiles } from './deployment';
import { emptyLzModel } from '../model/defaults';
import { buildConfig } from './lzConfig';
import { newPlatform } from './platforms';
import { emptyHybridConnectivity, newVpn } from './hybridConnectivity';

describe('default deployment settings', () => {
  it('includes domain verification in the ZIP instructions and keeps DR group permissions with Home', () => {
    const model = emptyLzModel();
    model.foundation.identityDomain = { mode: 'existing_default', id: 'ocid1.domain.oc1..fixture' };
    const config = buildConfig(model);
    expect(deploymentReadme(config, expectedDeploymentFiles(config))).toContain('active Default identity domain');
    config.stack_scope = 'regional';
    const prerequisites = deploymentPrerequisites(config).join('\n');
    expect(prerequisites).toContain('DR reuses Home IAM');
    expect(prerequisites).not.toContain('can manage the requested groups');
  });

  it('presents preparation, phase 1 inputs and apply, then phase 2 inputs and apply in execution order', () => {
    const config = buildConfig(emptyLzModel());
    const guide = deploymentReadme(config, expectedDeploymentFiles(config));
    const prepare = guide.indexOf('1. Prepare the files');
    const create = guide.indexOf('2. Create and apply phase 1');
    const firstInputs = guide.indexOf('  security_cis2_pre.json');
    const firstApply = guide.indexOf('Select Create');
    const update = guide.indexOf('3. Update and apply phase 2');
    const finalInputs = guide.indexOf('  security_cis2.json');
    const finalApply = guide.indexOf('Save the updated variables');
    expect(prepare).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(prepare);
    expect(firstInputs).toBeGreaterThan(create);
    expect(firstApply).toBeGreaterThan(firstInputs);
    expect(update).toBeGreaterThan(firstApply);
    expect(finalInputs).toBeGreaterThan(update);
    expect(finalApply).toBeGreaterThan(finalInputs);
  });

  it('omits DR, RPC, firewall backend and external connection instructions from an ordinary Home guide', () => {
    const config = buildConfig(emptyLzModel());
    const guide = deploymentReadme(config, expectedDeploymentFiles(config));
    expect(guide).not.toContain('For DR');
    expect(guide).not.toContain('compartments_output.json');
    expect(guide).not.toContain('network_output.json');
    expect(guide).not.toContain('local_dependency_file_paths');
    expect(guide).not.toContain('RPC');
    expect(guide).not.toContain('network_backends.json');
    expect(guide).not.toContain('Complete external setup');
  });

  it('retains the pinned Orchestrator and private Object Storage default', () => {
    const url = new URL(deploymentConsoleLinks(buildConfig(emptyLzModel()))!.createStackUrl);
    expect(`${url.origin}${url.pathname}`).toBe('https://cloud.oracle.com/resourcemanager/stacks/create');
    expect(url.searchParams.has('zipUrl')).toBe(false);
    expect(url.searchParams.has('zipUrlVariables')).toBe(false);
    expect(ORCHESTRATOR_RELEASE_URL).toBe('https://github.com/oci-landing-zones/terraform-oci-modules-orchestrator/releases/tag/v2.2.0');
  });

  it('packages the default settings and exact phase file lists without design values', () => {
    const config = buildConfig(emptyLzModel());
    const guide = deploymentReadme(config, ['iam.json', 'governance.json', 'network.json',
      'security_cis2_pre.json', 'security_cis2.json', 'observability_cis2_pre.json', 'observability_cis2.json']);
    expect(guide).toContain('rms-facade');
    expect(guide).toContain('configuration_source = "ocibucket"');
    expect(guide).toContain('oci_configuration_bucket');
    expect(guide).toContain('studio_deployment_phase');
    const [first, second] = guide.split('3. Update and apply phase 2');
    expect(first).toContain('security_cis2_pre.json');
    expect(second).toContain('security_cis2.json');
    expect(second).not.toContain('security_cis2_pre.json');
    expect(guide).not.toContain('save_output');
    expect(guide).not.toContain('as dependency objects');
    expect(guide).not.toContain('private GitHub');
  });

  it('names RPC output settings only for acceptors and requesters using resource keys', () => {
    const config = buildConfig(emptyLzModel());
    const peer = { remote_cidrs: ['10.2.0.0/21'], peer_region_name: 'eu-amsterdam-1' };
    config.remote_peering_connections = { peer };
    expect(deploymentSettings(config).join('\n').replaceAll('`', '')).toContain('save_output = true');
    config.remote_peering_connections = { peer: { ...peer, peer_id: 'RPC-AMS-LZ-PEER-KEY' } };
    expect(deploymentSettings(config).join('\n').replaceAll('`', '')).toContain('automatically selects network_output.json as dependency objects');
    config.remote_peering_connections = { peer: { ...peer, peer_id: 'ocid1.remotepeeringconnection.oc1..example' } };
    expect(deploymentSettings(config).join('\n')).not.toContain('automatically selects');
    expect(deploymentCliSteps(config).join('\n')).not.toContain('local_dependency_file_paths');
  });

  it.each([1, 2] as const)('always names both Home dependencies for CIS%d DR', (cis) => {
    const config = buildConfig(emptyLzModel());
    config.stack_scope = 'regional';
    config.cis_level = cis;
    const steps = [...deploymentPrerequisites(config), ...deploymentSettings(config)].join('\n').replaceAll('`', '');
    expect(steps).toContain('save_output = true');
    expect(steps).toContain('compartments_output.json');
    expect(steps).toContain('network_output.json');
    expect(steps).toContain('automatically selects');
    expect(steps.includes('encryption keys')).toBe(cis === 2);
    expect(deploymentCliSteps(config).join('\n').replaceAll('`', '')).toContain('local_dependency_file_paths to the absolute paths of compartments_output.json and network_output.json');
    const guide = deploymentReadme(config, expectedDeploymentFiles(config));
    expect(guide.indexOf('On Home, set save_output')).toBeLessThan(guide.indexOf('2. Create and apply phase 1'));
    expect(guide.indexOf('as dependency objects')).toBeGreaterThan(0);
    expect(guide.indexOf('as dependency objects')).toBeLessThan(guide.indexOf('Select Create'));
    expect(guide).not.toContain('Set save_output = true to write runtime outputs');
  });

  it('sets Home output publishing before applying and collects outputs after phase 2', () => {
    const config = buildConfig(emptyLzModel());
    config.dr_region = 'eu-amsterdam-1';
    const guide = deploymentReadme(config, expectedDeploymentFiles(config));
    expect(guide.indexOf('Set save_output = true')).toBeGreaterThan(guide.indexOf('2. Create and apply phase 1'));
    expect(guide.indexOf('Set save_output = true')).toBeLessThan(guide.indexOf('Select Create'));
    expect(guide.indexOf('Retain compartments_output.json and network_output.json')).toBeGreaterThan(guide.indexOf('Save the updated variables'));
    expect(guide).not.toContain('as dependency objects');
  });

  it('previews OKE and Hub C files and retains the backend alternative in the packaged final phase', () => {
    const model = emptyLzModel();
    model.network.hubKind = 'hub_c';
    model.platforms = [newPlatform('oke_simple', [])];
    const config = buildConfig(model);
    const files = expectedDeploymentFiles(config);
    expect(files).toEqual(expect.arrayContaining(['network_backends.json', 'oke_clusters.json', 'oke_workers.json']));
    const guide = deploymentReadme(config, files);
    const second = guide.split('3. Update and apply phase 2')[1];
    expect(second).toContain('  network_backends.json');
    expect(second).not.toContain('  network.json');
    expect(second.indexOf('Configure the third-party firewall VMs')).toBeLessThan(second.indexOf('Set studio_deployment_phase'));
    expect(second.indexOf('  network_backends.json')).toBeLessThan(second.indexOf('Save the updated variables'));
  });

  it('keeps connectivity on the normal ORM path and includes only its applicable handover without secrets', () => {
    const model = emptyLzModel();
    model.hybridConnectivity = emptyHybridConnectivity();
    model.hybridConnectivity.ipsecs.office = newVpn('office');
    model.hybridConnectivity.ipsecs.office.tunnels_management.tunnel_1.shared_secret = 'SyntheticSessionKey123';
    const config = buildConfig(model);
    const guide = deploymentReadme(config, expectedDeploymentFiles(config));
    expect(guide).toContain('Deploy with OCI Resource Manager');
    expect(guide).toContain('both Oracle tunnel endpoints');
    expect(guide.split('Updating an existing landing zone')[0]).not.toContain('Adding a connection');
    expect(guide).toContain('Use the existing stack and Terraform state.');
    expect(guide).not.toContain('provider activation');
    expect(guide).not.toContain('SyntheticSessionKey123');
    expect(guide).not.toContain('incompatible provider');
    expect(guide).not.toContain('agreed neighbors and advertisements');
    model.hybridConnectivity.ipsecs.office.tunnels_management.tunnel_1.routing = 'BGP';
    const bgp = buildConfig(model);
    expect(deploymentReadme(bgp, expectedDeploymentFiles(bgp))).toContain('For the BGP tunnels');
  });
});

describe('existing Cloud Guard and OC41 reporting guidance', () => {
  it.each(['oc1', 'oc19', 'oc41'] as const)('scopes Home and DR guidance correctly for %s at both CIS levels', (realm) => {
    for (const cis of [1, 2] as const) {
      const config = buildConfig(emptyLzModel());
      config.realm = realm;
      config.cis_level = cis;
      const home = deploymentReadme(config, expectedDeploymentFiles(config));
      expect(home).toContain('inspect any existing tenancy-root target');
      expect(home).toContain('A matching name does not prove this stack owns it');
      expect(home).toContain('Existing targets skipped by the module retain their current recipe attachments');
      expect(home).toContain('successful Apply alone does not confirm');
      expect(home.indexOf('4. Verify deployed settings')).toBeGreaterThan(home.indexOf('3. Update and apply phase 2'));
      expect(home.includes('OC41 usage reports:')).toBe(realm === 'oc41');
      if (realm === 'oc41') {
        expect(home).toContain('Local usage-report and budget permissions remain');
        expect(home).toContain('do not reuse an OC1 or OC19 reporting-tenancy OCID');
      }
      config.stack_scope = 'regional';
      const dr = deploymentReadme(config, expectedDeploymentFiles(config));
      expect(dr).not.toContain('inspect any existing tenancy-root target');
      expect(dr).not.toContain('Verify deployed settings');
      expect(deploymentVerification(config)).toEqual([]);
      expect(dr.includes('OC41 usage reports:')).toBe(realm === 'oc41');
      if (realm === 'oc41') {
        expect(dr).toContain('this DR package contains no IAM configuration');
        expect(dr).toContain('Verify reporting access with the Home deployment owner');
        expect(dr).not.toContain('Local usage-report and budget permissions remain');
      }
    }
  });
});


describe('realm-aware deployment console links', () => {
  it.each([
    ['oc1', 'eu-frankfurt-1', 'https://cloud.oracle.com'],
    ['oc19', 'eu-frankfurt-2', 'https://cloud.oracle.eu'],
    ['oc41', 'me-dubai-3', 'https://cloud.dutechcloud.ae'],
    ['oc41', 'me-dubai-2', 'https://cloud.dutechcloud.ae'],
  ])('routes %s / %s Review and README links to the correct console', (realm, region, origin) => {
    for (const scope of ['complete', 'regional'] as const) {
      const config = buildConfig(emptyLzModel());
      Object.assign(config, { realm, region, stack_scope: scope });
      const links = deploymentConsoleLinks(config)!;
      const create = new URL(links.createStackUrl);
      const stacks = new URL(links.stacksUrl);
      expect(create.origin).toBe(origin);
      expect(stacks.origin).toBe(origin);
      expect(create.pathname).toBe('/resourcemanager/stacks/create');
      expect(stacks.pathname).toBe('/resourcemanager/stacks');
      expect(create.searchParams.get('region')).toBe(region);
      expect(stacks.searchParams.get('region')).toBe(region);
      expect(create.searchParams.has('zipUrl')).toBe(false);
      expect(create.searchParams.has('zipUrlVariables')).toBe(false);
      expect([...create.searchParams.keys()].sort()).toEqual(['region']);
      const readme = deploymentReadme(config, expectedDeploymentFiles(config));
      expect(readme).toContain(links.createStackUrl);
      expect(readme).toContain(links.stacksUrl);
      expect(readme.includes(OC41_CONSOLE_STEP)).toBe(realm === 'oc41');
      expect(readme).toContain('Use one stack for both phases');
      if (realm !== 'oc1') expect(readme).not.toContain('https://cloud.oracle.com/');
    }
  });

  it.each(['oc2', 'oc99', 'constructor', '__proto__'])('does not route unknown realm %s to the commercial console', (realm) => {
    const config = buildConfig(emptyLzModel());
    config.realm = realm;
    expect(deploymentConsoleLinks(config)).toBeNull();
    expect(deploymentReadme(config, expectedDeploymentFiles(config))).not.toContain('/resourcemanager/stacks');
  });
});


it.each([
  ['me-dubai-3', 'PCZ'], ['me-dubai-2', 'ABR'],
])('uses official OC41 metadata for %s independently of customized naming keys', (region, regionKey) => {
  const config = buildConfig(emptyLzModel());
  Object.assign(config, { realm: 'oc41', region, region_short_name: 'cus' });
  const guide = deploymentReadme(config, expectedDeploymentFiles(config));
  expect(guide).toContain(JSON.stringify({ realmKey: 'OC41', realmDomainComponent: 'dutechcloud.ae', regionKey, regionIdentifier: region }));
  expect(guide).toContain('OCI_REGION_METADATA');
  config.realm = 'oc1';
  expect(deploymentReadme(config, expectedDeploymentFiles(config))).not.toContain('OCI_REGION_METADATA');
});
