// Adding OC41 does not allow unknown realm constants to reach resource builders.
// error_contains: config.realm must be one of: oc1, oc19, oc41
local normalize = (import 'gen/config.libsonnet').normalize;
local defaults = import 'gen/defaults.libsonnet';
normalize(defaults.hub_e + { realm: 'oc999' })
