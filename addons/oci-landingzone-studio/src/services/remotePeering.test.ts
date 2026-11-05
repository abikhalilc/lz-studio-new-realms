import { describe, expect, it } from 'vitest';
import { emptyLzModel } from '../model/defaults';
import { newPlatform } from './platforms';
import { remotePeeringIssues } from './remotePeering';

describe('RPC Kubernetes CIDR validation', () => {
  it.each(['servicesCidr', 'podsCidr'] as const)('rejects a remote network overlapping OKE %s', (field) => {
    const model = emptyLzModel();
    const platform = newPlatform('oke_simple', [], model.environments);
    platform.okeParams = { ...platform.okeParams!, cniType: 'overlay', podsCidr: '10.244.0.0/16' };
    model.platforms = [platform];
    model.remotePeeringConnections = [{ id: 'peer', name: 'peer', role: 'acceptor', peerRegionName: 'eu-amsterdam-1',
      remoteCidrs: [platform.okeParams[field]!] }];

    expect(remotePeeringIssues(model)).toEqual([expect.objectContaining({
      connectionId: 'peer', field: 'remoteCidrs', message: expect.stringMatching(/overlaps.*OKE/),
    })]);
  });

  it('permits an independent remote network and ignores an unplaced OKE platform', () => {
    const model = emptyLzModel();
    const platform = newPlatform('oke_simple', [], model.environments);
    platform.environments = [];
    model.platforms = [platform];
    model.remotePeeringConnections = [{ id: 'peer', name: 'peer', role: 'acceptor', peerRegionName: 'eu-amsterdam-1', remoteCidrs: ['10.96.0.0/16'] }];
    expect(remotePeeringIssues(model)).toEqual([]);
    platform.environments = 'all';
    model.remotePeeringConnections[0].remoteCidrs = ['172.20.0.0/16'];
    expect(remotePeeringIssues(model)).toEqual([]);
  });
});


it('accepts verified OC41 peer regions and rejects commercial regions', () => {
  const model = emptyLzModel();
  Object.assign(model.foundation, { realm: 'oc41', region: 'me-dubai-3', regionShortName: 'pcz' });
  model.remotePeeringConnections = [{ id: 'peer', name: 'peer', role: 'acceptor', peerRegionName: 'me-dubai-2', remoteCidrs: ['172.20.0.0/16'] }];
  expect(remotePeeringIssues(model)).toEqual([]);
  model.remotePeeringConnections[0].peerRegionName = 'me-dubai-1';
  expect(remotePeeringIssues(model)).toEqual([expect.objectContaining({ field: 'peerRegionName' })]);
});
