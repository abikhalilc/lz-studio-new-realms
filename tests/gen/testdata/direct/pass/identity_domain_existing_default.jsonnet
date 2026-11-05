// Existing mode must create no domain, route every workload group to Default, and qualify every group policy consistently.
local multi = import 'gen/landing_zone_multi.jsonnet';
local config = import 'tests/gen/testdata/configs/pass/existing_default_domain_all_workloads.jsonnet';
local summarize(cis_level) =
  local outputs = multi(config + { cis_level: cis_level });
  local iam = outputs['iam.json'];
  local groups = iam.identity_domain_groups_configuration;
  local text = std.manifestJson(outputs);
  assert !std.objectHas(iam, 'identity_domains_configuration');
  assert !std.objectHas(iam, 'groups_configuration');
  assert groups.default_identity_domain_id == config.identity_domain.id;
  assert groups.ignore_external_membership_updates;
  assert std.length(std.findSubstr('id_lz_common', text)) == 0;
  assert std.length(std.findSubstr('COMMON-DOMAIN', text)) == 0;
  assert std.objectHas(groups.groups, 'GRP-LZ-PROD-PLATFORM-OKE-ADMINS-KEY');
  assert std.objectHas(groups.groups, 'GRP-LZ-PROD-PLATFORM-OCVS-ADMINS-KEY');
  assert std.length(std.findSubstr("Endorse group 'Default'/'grp-lz-network-admin'", text)) > 0;
  {
    output_files: std.objectFields(outputs),
    group_keys: std.objectFields(groups.groups),
    policy_count: std.length(std.objectFields(iam.policies_configuration.supplied_policies)),
    default_domain_id: groups.default_identity_domain_id,
    ignore_external_membership_updates: groups.ignore_external_membership_updates,
  };
{ cis1: summarize(1), cis2: summarize(2) }
