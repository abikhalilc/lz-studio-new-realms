// Explicit deployment choices; omitted settings preserve published examples.
local validation = import 'validation.libsonnet';
{
  normalize(raw)::
    local values = if raw == null then {} else validation.allowed_keys(
      validation.object(raw, 'config.deployment_settings'),
      'config.deployment_settings',
      ['include_example_load_balancer', 'activate_audit_connector', 'cloud_guard_target_scope']
    );
    local settings = {
      include_example_load_balancer: true,
      activate_audit_connector: false,
      cloud_guard_target_scope: 'tenancy',
    } + values;
    assert std.type(settings.include_example_load_balancer) == 'boolean' :
           'deployment_settings.include_example_load_balancer must be a boolean';
    assert std.type(settings.activate_audit_connector) == 'boolean' :
           'deployment_settings.activate_audit_connector must be a boolean';
    assert std.member(['tenancy', 'security_zone'], settings.cloud_guard_target_scope) :
           'deployment_settings.cloud_guard_target_scope must be tenancy or security_zone';
    settings,
}
