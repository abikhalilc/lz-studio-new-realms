// Normalize the optional existing Default-domain choice and share its identity.
local validation = import 'validation.libsonnet';
local collections = import 'collections.libsonnet';

{
  normalize(value, realm)::
    if value == null then null
    else
      local domain = validation.allowed_keys(
        validation.object(value, 'config.identity_domain'),
        'config.identity_domain',
        ['mode', 'id']
      );
      assert validation.required(domain, 'mode', 'config.identity_domain.mode') == 'existing_default' :
             'config.identity_domain.mode must be existing_default';
      local id = validation.required(domain, 'id', 'config.identity_domain.id');
      assert std.type(id) == 'string' && id != '' :
             'config.identity_domain.id must be a non-empty domain OCID';
      local parts = std.split(id, '.');
      assert std.length(parts) == 5 && parts[0] == 'ocid1' && parts[1] == 'domain' &&
             parts[4] != '' && collections.all([
               std.member('abcdefghijklmnopqrstuvwxyz0123456789.-', char)
               for char in std.stringChars(id)
             ]) : 'config.identity_domain.id must be a domain OCID';
      assert parts[2] == realm :
             'config.identity_domain.id must belong to config.realm';
      { mode: 'existing_default', id: id },

  from_config(config)::
    local existing = std.objectHas(config, 'identity_domain') && config.identity_domain != null;
    {
      existing: existing,
      id: if existing then config.identity_domain.id else 'COMMON-DOMAIN',
      display_name: if existing then 'Default' else 'id_lz_common',
    },

  from_params(params)::
    if std.objectHas(params, 'scope_config') && std.objectHas(params.scope_config, 'identity_domain') then
      params.scope_config.identity_domain
    else self.from_config({}),
}
