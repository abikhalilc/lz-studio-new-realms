// Existing-domain references must match the selected realm before any resources are rendered.
// error_contains: config.identity_domain.id must belong to config.realm
local normalize = (import 'gen/config.libsonnet').normalize;
local defaults = import 'gen/defaults.libsonnet';
normalize(defaults.hub_e + {
  realm: 'oc41',
  identity_domain: { mode: 'existing_default', id: 'ocid1.domain.oc1..aaaaaaaafakefixture' },
})
