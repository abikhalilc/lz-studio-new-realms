/**
 * OCI realms and their regions (region identifier + three-letter region key).
 *
 * Sources (verified 2026-06):
 *   - https://docs.oracle.com/en-us/iaas/Content/General/Concepts/regions.htm
 *   - https://docs.oracle.com/en-us/iaas/Content/General/Concepts/identifiers.htm
 * OC41 entries verified 2026-11-05: see OC41-VERIFIED-PROFILE.txt for SDK
 * metadata and read-only region-subscription evidence. Catalog presence does not
 * establish service parity or deployment readiness in either region.
 */

export interface Region {
  id: string;        // region identifier, e.g. eu-frankfurt-1
  shortName: string; // three-letter region key, e.g. fra
}

export interface Realm {
  id: string;
  label: string;
}

export { getRealmOptions, getRealmProfile, setRealmCatalog, subscribeRealmCatalog, realmCatalogSnapshot, loadRealmCatalog } from './realmCatalog';
import { getRealmOptions, getRealmProfile } from './realmCatalog';

// Compatibility for callers that import the seed list. UI reads the live catalog.
export const REALM_OPTIONS: Realm[] = getRealmOptions();
export function isSupportedRealm(realm: string): boolean { return !!getRealmProfile(realm)?.enabled; }
export function getRegionsForRealm(realm: string): Region[] {
  const profile = getRealmProfile(realm);
  return profile?.enabled ? profile.regions : [];
}
export const REGIONS_BY_REALM: Record<string, Region[]> = Object.fromEntries(getRealmOptions().map(r => [r.id, getRegionsForRealm(r.id)]));

export function getDefaultRegionForRealm(realm: string): Region | null {
  return getRegionsForRealm(realm)[0] || null;
}

export function findRegion(realm: string, regionId: string): Region | null {
  return getRegionsForRealm(realm).find((region) => region.id === regionId) || null;
}

export function regionShortNameError(value: string): string | null {
  return value.length > 3 ? 'Use 3 characters or fewer for the region short name.' : null;
}
