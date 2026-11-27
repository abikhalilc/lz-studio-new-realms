export interface RealmProfile {
  id: string;
  label: string;
  apiDomain: string;
  consoleUrl: string;
  regions: { id: string; shortName: string }[];
  fileStorageService: string;
  objectStorageServicePrefix: string;
  usageReportTenancy: string | null;
  securityZonePolicies: { shared_network: string[]; environment: string[] };
  enabled: boolean;
  revision: number;
}

/** Validate at the API boundary and again before using downloaded catalog data. */
export function validateRealm(value: unknown): RealmProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Enter a realm profile.');
  const v = value as RealmProfile;
  if (!/^oc[1-9][0-9]*$/.test(v.id)) throw new Error('Realm ID must look like oc41.');
  if (typeof v.label !== 'string' || !v.label.trim() || v.label.length > 100) throw new Error('Enter a name of up to 100 characters.');
  if (typeof v.apiDomain !== 'string' || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(v.apiDomain) || v.apiDomain.length > 253) throw new Error('Enter a valid API domain without a URL scheme.');
  let url: URL;
  try { url = new URL(v.consoleUrl); } catch { throw new Error('Enter an HTTPS console URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Console URL must be an HTTPS origin without a path, query or credentials.');
  if (!Array.isArray(v.regions) || !v.regions.length || v.regions.length > 200) throw new Error('Add between 1 and 200 regions.');
  const ids = new Set<string>(); const keys = new Set<string>();
  for (const r of v.regions) {
    if (!r || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)+-\d+$/.test(r.id) || !/^[a-z0-9]{2,3}$/.test(r.shortName)) throw new Error('Each region needs an identifier and a 2–3 character lowercase key.');
    if (ids.has(r.id) || keys.has(r.shortName)) throw new Error('Region identifiers and keys must be unique within a realm.');
    ids.add(r.id); keys.add(r.shortName);
  }
  for (const principal of [v.fileStorageService, v.objectStorageServicePrefix]) {
    if (typeof principal !== 'string' || !/^[a-zA-Z][a-zA-Z0-9-]{0,79}$/.test(principal)) throw new Error('Enter valid File Storage and Object Storage service identifiers.');
  }
  if (v.usageReportTenancy !== null && (typeof v.usageReportTenancy !== 'string' || !new RegExp(`^ocid1\\.tenancy\\.${v.id}\\.\\.[a-z0-9]+$`).test(v.usageReportTenancy))) throw new Error('Usage-report tenancy OCID must belong to this realm, or be blank.');
  for (const kind of ['shared_network', 'environment'] as const) {
    const policies = v.securityZonePolicies?.[kind];
    if (!Array.isArray(policies) || !policies.length || policies.length > 200 || policies.some(p => typeof p !== 'string' || !new RegExp(`^ocid1\\.securityzonessecuritypolicy\\.${v.id}\\.\\.[a-z0-9]+$`).test(p)) || new Set(policies).size !== policies.length) throw new Error(`Enter unique ${kind} Security Zone policy OCIDs belonging to ${v.id}.`);
  }
  if (typeof v.enabled !== 'boolean') throw new Error('Choose whether the realm is enabled.');
  return { id: v.id, label: v.label.trim(), apiDomain: v.apiDomain, consoleUrl: url.origin,
    regions: v.regions.map(r => ({ id: r.id, shortName: r.shortName })), fileStorageService: v.fileStorageService,
    objectStorageServicePrefix: v.objectStorageServicePrefix, usageReportTenancy: v.usageReportTenancy,
    securityZonePolicies: { shared_network: [...v.securityZonePolicies.shared_network], environment: [...v.securityZonePolicies.environment] },
    enabled: v.enabled, revision: Number.isSafeInteger(v.revision) && v.revision > 0 ? v.revision : 1 };
}
