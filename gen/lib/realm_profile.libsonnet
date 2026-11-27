local validation = import 'validation.libsonnet';
local collections = import 'collections.libsonnet';
local safe_service(value) = std.type(value) == 'string' && std.length(value) > 0 && collections.all([
  std.member('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-', ch)
  for ch in std.stringChars(value)
]);
local realm_ocid(value, kind, realm) =
  std.type(value) == 'string' &&
  local parts = std.split(value, '.');
  std.length(parts) == 5 && parts[0] == 'ocid1' && parts[1] == kind && parts[2] == realm && parts[3] == '' && parts[4] != '' &&
  collections.all([std.member('abcdefghijklmnopqrstuvwxyz0123456789.', ch) for ch in std.stringChars(value)]);
{
  normalize(value, realm)::
    if value == null then null else
    local p = validation.object(value, 'config.realm_profile');
    assert std.length(realm) > 2 && std.substr(realm, 0, 2) == 'oc' && std.substr(realm, 2, 1) != '0' &&
           collections.all([std.member('0123456789', ch) for ch in std.stringChars(std.substr(realm, 2, std.length(realm) - 2))]) : 'Realm ID must be oc followed by digits';
    assert p.id == realm : 'realm_profile.id must match config.realm';
    assert p.enabled == true : 'realm_profile must be enabled';
    assert safe_service(p.fileStorageService) && safe_service(p.objectStorageServicePrefix) : 'Invalid realm service identifiers';
    assert p.usageReportTenancy == null || realm_ocid(p.usageReportTenancy, 'tenancy', realm) : 'Usage-report tenancy must belong to the selected realm';
    assert collections.all([
      std.type(p.securityZonePolicies[kind]) == 'array' && std.length(p.securityZonePolicies[kind]) > 0 &&
      collections.all([realm_ocid(id, 'securityzonessecuritypolicy', realm) for id in p.securityZonePolicies[kind]])
      for kind in ['shared_network', 'environment']
    ]) : 'Security Zone policies must belong to the selected realm';
    p,

  constants(p):: {
    service_identifiers: {
      fss: p.fileStorageService,
      objectstorage(region):: p.objectStorageServicePrefix + region,
    },
    usage_report_tenancy_ocid: p.usageReportTenancy,
    security_zone_policy_ocids: p.securityZonePolicies,
  },
}
