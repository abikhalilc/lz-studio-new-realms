import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, existsSync } from 'node:fs';
import type { PolicySource, PolicyPreview, PolicyMatch } from '../shared/policyImport.ts';

interface Source extends PolicySource { profile: string; tenancyOcid: string; endpoint?: string }
const execute = promisify(execFile);
const mapping = JSON.parse(readFileSync(new URL('./security-policy-mapping.json', import.meta.url), 'utf8')) as Pick<PolicyMatch, 'name' | 'groups'>[];
export function readPolicySources(path: string): Source[] {
  if (!existsSync(path)) return [];
  const sources: Source[] = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(sources) || sources.length > 100) throw new Error('Invalid policy source configuration.');
  const ids = new Set<string>();
  for (const s of sources) {
    if (!s || !/^[a-zA-Z0-9_-]{1,64}$/.test(s.id) || ids.has(s.id) || typeof s.label !== 'string' || !s.label
      || !/^oc[1-9][0-9]*$/.test(s.realm) || !/^[a-z][a-z0-9-]+-\d+$/.test(s.region)
      || typeof s.profile !== 'string' || !/^[a-zA-Z0-9_.-]{1,64}$/.test(s.profile)
      || !new RegExp(`^ocid1\\.tenancy\\.${s.realm}\\.\\.[a-z0-9]+$`).test(s.tenancyOcid)) throw new Error('Invalid policy source configuration.');
    if (s.endpoint) { const url = new URL(s.endpoint); if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Policy endpoint must be HTTPS.'); }
    ids.add(s.id);
  }
  return sources;
}
export const publicSource = (s: Source): PolicySource => ({ id: s.id, label: s.label, realm: s.realm, region: s.region });
export function mapPolicies(value: unknown, source: PolicySource): PolicyPreview {
  const items = (value as { data?: { items?: unknown } })?.data?.items;
  if (!Array.isArray(items) || items.length > 2000) throw new Error('Unexpected OCI policy response.');
  const policies: { id: string; name: string; description: string }[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (item.owner !== 'ORACLE' || item['lifecycle-state'] !== 'ACTIVE') continue;
    if (typeof item.id !== 'string' || !new RegExp(`^ocid1\\.securityzonessecuritypolicy\\.${source.realm}\\.\\.[a-z0-9]+$`).test(item.id)
      || typeof item['display-name'] !== 'string' || typeof item.description !== 'string' || seen.has(item.id)) throw new Error('Invalid or duplicate policy in OCI response.');
    seen.add(item.id); policies.push({ id: item.id, name: item['display-name'], description: item.description });
  }
  const matches = mapping.map(rule => ({ ...rule, candidates: policies.filter(p => p.name === rule.name).map(({ id, description }) => ({ id, description })) }));
  return { source, matches, unused: policies.filter(p => !mapping.some(m => m.name === p.name)), complete: matches.every(m => m.candidates.length === 1) };
}
export function createPolicyImporter(sources: Source[] | (() => Source[]), cli = process.env.STUDIO_OCI_CLI ?? 'oci') {
  let running = false;
  return {
    get sources() { return (typeof sources === 'function' ? sources() : sources).map(publicSource); },
    async discover(id: string, realm: string) {
      const source = (typeof sources === 'function' ? sources() : sources).find(s => s.id === id && s.realm === realm);
      if (!source) throw new Error('Select a configured policy source for this realm.');
      if (running) throw new Error('Another policy import is running. Try again shortly.');
      running = true;
      try {
        const args = ['cloud-guard', 'security-policy-collection', 'list-security-policies', '--profile', source.profile, '--region', source.region, '--compartment-id', source.tenancyOcid, '--all', '--output', 'json'];
        if (source.endpoint) args.push('--endpoint', source.endpoint);
        let stdout: string;
        try { ({ stdout } = await execute(cli, args, { timeout: 45_000, maxBuffer: 4_000_000, env: { ...process.env, OCI_CLI_SUPPRESS_FILE_PERMISSIONS_WARNING: 'False' } })); }
        catch { throw new Error('Could not retrieve policies. Check the server OCI CLI, credential profile, endpoint, permissions and connectivity.'); }
        try { return mapPolicies(JSON.parse(stdout), publicSource(source)); }
        catch { throw new Error('OCI returned an invalid policy inventory. No policies were imported.'); }
      } finally { running = false; }
    },
  };
}
export type PolicyImporter = ReturnType<typeof createPolicyImporter>;
