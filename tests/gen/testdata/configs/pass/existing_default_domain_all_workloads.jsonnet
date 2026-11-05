// Existing Default-domain groups and policies stay consistent across all integrated workload types.
// contains: ocid1.domain.oc41..aaaaaaaafakefixture
// contains: 'Default'/'grp-lz-network-admin'
// contains: GRP-LZ-PROD-PLATFORM-OKE-ADMINS-KEY
// contains: GRP-LZ-PROD-PLATFORM-OCVS-ADMINS-KEY
// contains: exacc
// contains: exacs
{
  realm: 'oc41', region: 'me-dubai-3', region_short_name: 'pcz',
  identity_domain: { mode: 'existing_default', id: 'ocid1.domain.oc41..aaaaaaaafakefixture' },
  hub: { kind: 'hub_e', network: { vcn: '10.0.0.0/21' } },
  environments: {
    prod: {
      project_network: { network: { vcn: '10.0.64.0/21' } },
      projects: { proj1: {} },
      platforms: {
        oke: {
          network: { vcn: '10.0.80.0/20' },
          extension: { type: 'oke_simple', params: {
            kubernetes_version: 'v1.35.2', services_cidr: '10.96.0.0/16',
            api_endpoint_allowed_cidrs: ['10.0.1.0/24'], public_load_balancer: true,
          } },
        },
        ocvs: {
          network: { vcn: '10.0.96.0/21' },
          extension: { type: 'ocvs', params: {
            ssh_authorized_keys: 'ssh-rsa AAAAocvsfixture',
            cluster: {
              service_label: 'prod-ocvs', sddc_display_name: 'prod-ocvs',
              cluster_display_name: 'prod-ocvs-cluster', vmware_software_version: '7.0 update 3',
              is_hcx_enabled: false, compute_availability_domain: '1', esxi_hosts_count: 3,
              vsphere_type: 'MANAGEMENT', initial_host_ocpu_count: 52,
              initial_host_shape_name: 'BM.DenseIO2.52', workload_network_cidr: '172.16.0.0/24',
            },
          } },
        },
        exacc: { extension: { type: 'exacc', params: {
          project_db_compartments: ['proj1'],
          notification_emails: { default: ['ops@example.com'] },
        } } },
      },
    },
  },
  shared_platforms: {
    exacc: { extension: { type: 'exacc', params: {
      notification_emails: { default: ['ops@example.com'] },
    } } },
    exacs: {
      network: { vcn: '10.0.24.0/21' },
      extension: { type: 'exacs', params: {
        project_db_compartments: { prod: ['proj1'] },
        notification_emails: { default: ['ops@example.com'] },
      } },
    },
  },
  remote_peering_connections: {
    acceptor: {
      remote_cidrs: ['172.30.0.0/21'], peer_region_name: 'me-dubai-2',
      peer_id: 'RPC-ABR-LZ-HUB-KEY', peer_tenancy_ocid: 'ocid1.tenancy.oc41..fixtureacceptor',
    },
  },
}
