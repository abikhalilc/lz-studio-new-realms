import { describe, expect, it } from 'vitest';
import { emptyLzModel } from '../model/defaults';
import { buildConfig, serializeConfig } from './lzConfig';
import { identityDomainError } from './identityDomain';
import { syncDrEnvironments } from './linkedDr';

describe('Studio identity domain', () => {
  it('preserves default configuration and only exports an explicit existing choice', () => {
    const model = emptyLzModel();
    const original = serializeConfig(model);
    expect(buildConfig(model)).not.toHaveProperty('identity_domain');
    model.foundation.identityDomain = { mode: 'existing_default', id: 'ocid1.domain.oc1..fixture' };
    expect(identityDomainError(model.foundation)).toBeNull();
    expect(buildConfig(model).identity_domain).toEqual({ mode: 'existing_default', id: 'ocid1.domain.oc1..fixture' });
    expect(serializeConfig(model)).toContain('identity_domain:');
    delete model.foundation.identityDomain;
    expect(serializeConfig(model)).toBe(original);
  });

  it.each([
    ['', 'Enter the OCID'],
    ['ocid1.tenancy.oc1..fixture', 'valid identity domain OCID'],
    ['ocid1.domain.oc1..', 'valid identity domain OCID'],
    ['ocid1.domain.oc1..bad value', 'valid identity domain OCID'],
    ['ocid1.domain.oc1..BAD', 'valid identity domain OCID'],
    ['ocid1.domain.oc19..fixture', 'selected realm'],
    ['ocid1.domain.oc41..fixture', 'selected realm'],
  ])('rejects an incomplete or mismatched ID: %s', (id, message) => {
    const model = emptyLzModel();
    model.foundation.identityDomain = { mode: 'existing_default', id };
    expect(identityDomainError(model.foundation)).toContain(message);
  });

  it.each(['oc1', 'oc19', 'oc41'])('accepts matching %s metadata without changing region options', (realm) => {
    const model = emptyLzModel();
    model.foundation.realm = realm;
    model.foundation.identityDomain = { mode: 'existing_default', id: `ocid1.domain.${realm}..fixture` };
    expect(identityDomainError(model.foundation)).toBeNull();
    model.foundation.realm = 'other';
    expect(identityDomainError(model.foundation)).toContain('selected realm');
  });

  it('inherits linked Home identity changes and clears a stale choice when Home returns to new-domain mode', () => {
    const home = emptyLzModel();
    const dr = structuredClone(home);
    home.foundation.identityDomain = { mode: 'existing_default', id: 'ocid1.domain.oc1..home' };
    const synced = syncDrEnvironments(dr, home);
    expect(synced.foundation.identityDomain).toEqual(home.foundation.identityDomain);
    expect(synced.foundation.identityDomain).not.toBe(home.foundation.identityDomain);
    delete home.foundation.identityDomain;
    expect(syncDrEnvironments(synced, home).foundation.identityDomain).toBeUndefined();
  });
});
