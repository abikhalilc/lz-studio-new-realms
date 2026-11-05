// OC41 generation uses verified policy IDs and omits unverified cross-tenancy report access.
local multi = import 'gen/landing_zone_multi.jsonnet';
local catalog = importstr 'addons/oci-landingzone-studio/OC41-SECURITY-POLICIES.txt';
local verified_policy_ids = [
  line
  for line in std.split(catalog, '\n')
  if std.startsWith(line, 'ocid1.securityzonessecuritypolicy.oc41..')
];
local summarize(region, short_name, cis_level, hub_kind) =
  local outputs = multi({
    realm: 'oc41',
    region: region,
    region_short_name: short_name,
    cis_level: cis_level,
    hub: { kind: hub_kind, network: { vcn: '10.0.0.0/21' } },
    environments: {
      prod: {
        project_network: { network: { vcn: '10.0.64.0/21' } },
        projects: { proj1: {} },
      },
    },
  });
  local security = outputs['security_cis%s.json' % cis_level];
  local recipes = security.security_zones_configuration.recipes;
  local shared_policies = recipes['SZ-RCP-LZ-02-SHARED-NETWORK-KEY'].security_policies_ocids;
  local environment_policies = recipes['SZ-RCP-LZ-03-PROD-ENVIRONMENT-KEY'].security_policies_ocids;
  local policies = outputs['iam.json'].policies_configuration.supplied_policies;
  local services = policies['PCY-SERVICES-ADMIN-KEY'].statements;
  local cost_statements = policies['PCY-COST-ADMIN-KEY'].statements;
  local serialized = std.manifestJson(outputs);
  assert std.length(shared_policies) == 4 && std.length(environment_policies) == 26;
  assert std.length(std.setDiff(std.set(shared_policies + environment_policies), std.set(verified_policy_ids))) == 0;
  assert services[std.length(services) - 1] ==
         'allow service blockstorage, oke, streaming, fssocprod, objectstorage-%s to use keys in tenancy' % region;
  assert cost_statements == [
    "allow group 'id_lz_common'/'grp-cost-admin' to manage usage-report in tenancy",
    "allow group 'id_lz_common'/'grp-cost-admin' to manage usage-budgets in tenancy",
  ];
  assert std.length(std.findSubstr('.oc1.', serialized)) == 0 &&
         std.length(std.findSubstr('.oc19.', serialized)) == 0;
  assert std.length(std.findSubstr('eu-frankfurt-', serialized)) == 0;
  assert std.objectHas(
    outputs['network.json'].network_configuration.network_configuration_categories['0-shared'].vcns,
    'VCN-%s-LZ-HUB-KEY' % std.asciiUpper(short_name)
  );
  assert cis_level != 2 ||
         security.vaults_configuration.keys['KEY-LZ-SHARED-OSS-AUDIT-BKT-KEY'].service_grantees == ['objectstorage-%s' % region];
  {
    output_files: std.objectFields(outputs),
    reporting_region: security.cloud_guard_configuration.reporting_region,
    verified_shared_policies: std.length(shared_policies),
    verified_environment_policies: std.length(environment_policies),
    cost_policy_statements: cost_statements,
  };
{
  pcz_cis1: summarize('me-dubai-3', 'pcz', 1, 'hub_e'),
  pcz_cis2: summarize('me-dubai-3', 'pcz', 2, 'hub_e'),
  abr_cis2: summarize('me-dubai-2', 'abr', 2, 'hub_e'),
  pcz_firewalled_cis2: summarize('me-dubai-3', 'pcz', 2, 'hub_a'),
}
