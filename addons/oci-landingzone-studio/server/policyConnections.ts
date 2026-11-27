import type { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { PolicyConnection, CredentialProfile } from '../shared/policyImport.ts';

export function credentialProfiles(path = process.env.OCI_CLI_CONFIG_FILE ?? join(homedir(), '.oci/config')): CredentialProfile[] {
  if (!existsSync(path)) return [];
  const sections = new Map<string, Record<string, string>>(); let current: Record<string, string> | undefined;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const section = line.trim().match(/^\[([a-zA-Z0-9_.-]{1,64})\]$/);
    if (section) { current = {}; sections.set(section[1], current); continue; }
    const pair = line.match(/^\s*(tenancy|region)\s*=\s*([^#;]+?)\s*$/);
    if (current && pair) current[pair[1]] = pair[2];
  }
  const defaults = sections.get('DEFAULT');
  return [...sections].map(([name, values]) => {
    const tenancy = values.tenancy ?? defaults?.tenancy ?? '';
    const region = values.region ?? defaults?.region ?? '';
    return { name, tenancyOcid: /^ocid1\.tenancy\.oc[1-9][0-9]*\.\.[a-z0-9]+$/.test(tenancy) ? tenancy : '', region: /^[a-z][a-z0-9-]+-\d+$/.test(region) ? region : '' };
  });
}

export function validateConnection(value: unknown): PolicyConnection {
  if (!value || typeof value !== 'object') throw new Error('Enter connection details.');
  const s = value as PolicyConnection;
  if (typeof s.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(s.id)
    || typeof s.label !== 'string' || !s.label.trim() || s.label.length > 100
    || typeof s.realm !== 'string' || !/^oc[1-9][0-9]*$/.test(s.realm)
    || typeof s.region !== 'string' || !/^[a-z][a-z0-9-]+-\d+$/.test(s.region)
    || typeof s.profile !== 'string' || !/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,63}$/.test(s.profile)
    || typeof s.tenancyOcid !== 'string' || !new RegExp(`^ocid1\\.tenancy\\.${s.realm}\\.\\.[a-z0-9]+$`).test(s.tenancyOcid)) throw new Error('Enter a connection ID, name, realm, region, server profile and matching tenancy OCID.');
  return { id: s.id, label: s.label.trim(), realm: s.realm, region: s.region, profile: s.profile, tenancyOcid: s.tenancyOcid, revision: s.revision };
}

export function connectionStore(db: DatabaseSync, seeds: PolicyConnection[], profiles = credentialProfiles) {
  db.exec('CREATE TABLE IF NOT EXISTS policy_connections (id TEXT PRIMARY KEY, profile TEXT NOT NULL)');
  if (!db.prepare("SELECT key FROM settings WHERE key='policy-connections-seeded'").get()) {
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const seed of seeds) db.prepare('INSERT OR IGNORE INTO policy_connections VALUES (?,?)').run(seed.id, JSON.stringify({ ...seed, revision: 1 }));
      db.prepare('INSERT INTO settings VALUES (?,?)').run('policy-connections-seeded', '1'); db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  const list = () => (db.prepare('SELECT profile FROM policy_connections ORDER BY id').all() as { profile: string }[]).map(r => JSON.parse(r.profile) as PolicyConnection);
  function mutation(user: string, action: string, id: string, change: () => void) {
    db.exec('BEGIN IMMEDIATE');
    try { change(); db.prepare('INSERT INTO audit(at,username,action,realm_id) VALUES (?,?,?,?)').run(new Date().toISOString(), user, action, id); db.exec('COMMIT'); }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  return {
    list, profiles,
    save(input: unknown, user: string, create: boolean) {
      const value = validateConnection(input); const existing = list().find(s => s.id === value.id);
      if (create ? !!existing : !existing) throw new Error(create ? 'Connection ID already exists.' : 'Connection no longer exists.');
      if (existing && value.revision !== existing.revision) throw new Error('Connection changed in another session. Reload before saving.');
      if (!profiles().some(p => p.name === value.profile)) throw new Error('Choose an available server credential profile.');
      // Endpoints are server-owned. A browser can never redirect signed requests.
      const result = { ...value, ...(existing?.endpoint ? { endpoint: existing.endpoint } : {}), revision: (existing?.revision ?? 0) + 1 };
      if (existing?.endpoint && (existing.realm !== value.realm || existing.region !== value.region || existing.profile !== value.profile)) throw new Error('This connection has a server-managed endpoint. Create a new connection to change its realm, region or profile.');
      mutation(user, create ? 'connection-create' : 'connection-update', value.id, () => db.prepare('INSERT INTO policy_connections VALUES (?,?) ON CONFLICT(id) DO UPDATE SET profile=excluded.profile').run(result.id, JSON.stringify(result)));
      return result;
    },
    remove(id: string, revision: unknown, user: string) {
      const existing = list().find(s => s.id === id);
      if (!existing || existing.revision !== revision) throw new Error('Connection changed or was deleted. Reload before deleting.');
      mutation(user, 'connection-delete', id, () => db.prepare('DELETE FROM policy_connections WHERE id=?').run(id));
    },
  };
}
export type ConnectionStore = ReturnType<typeof connectionStore>;
