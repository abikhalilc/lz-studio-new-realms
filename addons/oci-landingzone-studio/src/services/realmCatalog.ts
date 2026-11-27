import defaults from '../../../../gen/realm-defaults.json';
import { validateRealm, type RealmProfile } from '../../shared/realm';
export type { RealmProfile } from '../../shared/realm';

let catalog: RealmProfile[] = defaults.map(validateRealm);
let shared = false;
const listeners = new Set<() => void>();
export const realmCatalogSnapshot = () => catalog;
export const subscribeRealmCatalog = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const getRealmProfile = (id: string) => catalog.find(p => p.id === id);
export const getRealmOptions = () => catalog.filter(p => p.enabled).map(({ id, label }) => ({ id, label }));
export const sharedRealmCatalog = () => shared;
export function realmSelectionError(foundation: { realm: string; region: string }): string | null {
  const realm = getRealmProfile(foundation.realm);
  if (!realm?.enabled) return 'This realm is unavailable. Ask an administrator to enable or restore it, or choose another realm.';
  if (shared && !realm.regions.some(r => r.id === foundation.region)) return 'This region is no longer available in the realm catalog. Choose another region.';
  return null;
}
export function setRealmCatalog(values: unknown[]) {
  const next = values.map(validateRealm);
  if (new Set(next.map(p => p.id)).size !== next.length) throw new Error('Realm catalog contains duplicate IDs.');
  if (!next.some(p => p.enabled)) throw new Error('Realm catalog must contain an enabled realm.');
  catalog = next; listeners.forEach(l => l());
}
export async function loadRealmCatalog() {
  const response = await fetch('/api/realms', { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
  // Retain static-hosting support. Other failures must not silently resurrect deleted realms.
  if (response.status === 404) { shared = false; return; }
  if (!response.ok) throw new Error('The shared realm catalog is unavailable. Start the Studio server and retry.');
  if (!response.headers.get('content-type')?.includes('application/json')) { shared = false; return; }
  const data = await response.json() as { realms?: unknown[] };
  if (!Array.isArray(data.realms)) throw new Error('The server returned an invalid realm catalog.');
  setRealmCatalog(data.realms); shared = true;
}

/** Include administrated constants in portable configs and worker requests. */
export function realmProfileOverride(id: string): RealmProfile | undefined {
  const profile = getRealmProfile(id);
  const builtin = defaults.find(p => p.id === id);
  // Compare content as well as identity: a persisted server catalog may predate
  // a repository update even while its original revision is still 1.
  return profile && (!builtin || JSON.stringify({ ...profile, revision: 1 }) !== JSON.stringify(validateRealm(builtin))) ? structuredClone(profile) : undefined;
}
