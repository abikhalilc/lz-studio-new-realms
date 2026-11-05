import type { FoundationConfig } from '../model/types';

/** Match generator boundary checks; the live domain must still be verified. */
export function identityDomainError(foundation: FoundationConfig): string | null {
  const choice = foundation.identityDomain;
  if (choice === undefined) return null;
  if (!choice || choice.mode !== 'existing_default') return 'Choose a supported identity domain option.';
  if (typeof choice.id !== 'string' || !choice.id) return 'Enter the OCID of the existing Default identity domain.';
  const parts = choice.id.split('.');
  if (parts.length !== 5 || parts[0] !== 'ocid1' || parts[1] !== 'domain' || !parts[4]
    || !/^[a-z0-9.-]+$/.test(choice.id)) return 'Enter a valid identity domain OCID.';
  if (parts[2] !== foundation.realm) return 'Use an identity domain OCID from the selected realm.';
  return null;
}

export function identityDomainLabel(foundation: FoundationConfig): string {
  return foundation.identityDomain ? 'Existing Default domain' : 'New domain (id_lz_common)';
}
