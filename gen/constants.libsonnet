// Built-in realm constants share the same verified source as Studio and the admin catalog.
// Administrated realm overrides travel explicitly in config.realm_profile.
local profiles = import 'realm-defaults.json';
local contract = import 'lib/realm_profile.libsonnet';
{
  [p.id]: contract.constants(p)
  for p in profiles
}
