local desc = import '../../descriptions.libsonnet';
local identity_domains = import '../../lib/identity_domain.libsonnet';

function(ctx)
  local identity = identity_domains.from_params(ctx.params);
{
  local n = ctx.n,
  local group_name = n.display_global('grp', ctx.display_segments + ['admins']),
  local policy_name = n.display_global('pcy', ctx.display_segments + ['admins']),

  [if identity.existing then 'identity_domain_groups_configuration' else 'groups_configuration']+: {
    groups+: {
      [n.key_global('GRP', [ctx.env, 'PLATFORM', ctx.plat, 'ADMINS'])]: {
        name: group_name,
        description: desc.group.platform(ctx.scope.scope_long_title, 'OCVS', 'SDDC administration'),
      },
    },
  },

  policies_configuration+: {
    supplied_policies+: {
      [n.key_global('PCY', [ctx.env, 'PLATFORM', ctx.plat, 'ADMINS'])]: {
        name: policy_name,
        description: desc.policy.grants(
          group_name,
          'OCVS platform administration access',
          'the %s OCVS platform and network compartments' % ctx.scope.scope_long_title
        ),
        compartment_id: 'TENANCY-ROOT',
        statements: [
          "allow group '%s'/'%s' to manage sddcs in compartment %s" % [identity.display_name, group_name, ctx.scope.compartment_path],
          "allow group '%s'/'%s' to manage instances in compartment %s" % [identity.display_name, group_name, ctx.scope.compartment_path],
          "allow group '%s'/'%s' to read virtual-network-family in compartment %s" % [identity.display_name, group_name, ctx.scope.network_compartment_path],
          "allow group '%s'/'%s' to use subnets in compartment %s" % [identity.display_name, group_name, ctx.scope.network_compartment_path],
          "allow group '%s'/'%s' to use vnics in compartment %s" % [identity.display_name, group_name, ctx.scope.network_compartment_path],
          "allow group '%s'/'%s' to use vlans in compartment %s" % [identity.display_name, group_name, ctx.scope.network_compartment_path],
          "allow group '%s'/'%s' to use private-ips in compartment %s" % [identity.display_name, group_name, ctx.scope.network_compartment_path],
          "allow group '%s'/'%s' to use network-security-groups in compartment %s" % [identity.display_name, group_name, ctx.scope.network_compartment_path],
        ],
      },
    },
  },
}
