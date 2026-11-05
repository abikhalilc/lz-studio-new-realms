import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { emptyLzModel } from '../../model/defaults';
import { WizardProvider } from '../wizardContext';
import FoundationStep from './FoundationStep';
import type { LzModel } from '../../model/types';
import { MemoryRouter } from 'react-router-dom';

function render(model: LzModel) {
  return renderToStaticMarkup(<WizardProvider initialModel={model}>
    <FoundationStep name="Test design" onNameChange={() => {}} onNameBlur={() => {}} />
  </WizardProvider>);
}

describe('observability fields', () => {
  it('keeps the old new-domain choice selected without an OCID field', () => {
    const html = render(emptyLzModel());
    expect(html).toContain('id="lz-identity-domain"');
    expect(html).toMatch(/<option value="create"[^>]*selected/);
    expect(html).not.toContain('id="lz-identity-domain-id"');
  });

  it('shows an accessible required OCID error for existing mode', () => {
    const model = emptyLzModel();
    model.foundation.identityDomain = { mode: 'existing_default', id: '' };
    const html = render(model);
    expect(html).toMatch(/id="lz-identity-domain-id"[^>]*aria-invalid="true"/);
    expect(html).toMatch(/id="lz-identity-domain-id"[^>]*required/);
    expect(html).toContain('lz-identity-domain-id-help lz-identity-domain-id-error');
    expect(html).toContain('Enter the OCID of the existing Default identity domain.');
  });

  it('locks linked identity settings while retaining the inherited value', () => {
    const model = emptyLzModel();
    model.foundation.stackScope = 'regional';
    model.foundation.identityDomain = { mode: 'existing_default', id: 'ocid1.domain.oc1..fixture' };
    const html = renderToStaticMarkup(<MemoryRouter><WizardProvider initialModel={model} homeSource={{ id: 'home', model }}>
      <FoundationStep name="DR" onNameChange={() => {}} onNameBlur={() => {}} />
    </WizardProvider></MemoryRouter>);
    expect(html).toMatch(/id="lz-identity-domain"[^>]*disabled/);
    expect(html).toMatch(/id="lz-identity-domain-id"[^>]*disabled/);
    expect(html).toContain('ocid1.domain.oc1..fixture');
    expect(html).toContain('This setting syncs from the linked Home Region design.');
  });

  it('keeps a custom region short name editable', () => {
    const model = emptyLzModel();
    model.foundation.regionShortName = 'fr2';
    const input = render(model).match(/<input\b[^>]*id="lz-region-short-name"[^>]*>/)?.[0];
    expect(input).toContain('value="fr2"');
    expect(input).toContain('maxLength="3"');
    expect(input).not.toContain('required');
    expect(input).not.toMatch(/readOnly|disabled|aria-invalid="true"/i);
  });

  it('associates an invalid short name with its inline error', () => {
    const model = emptyLzModel();
    model.foundation.regionShortName = ' fr2';
    const html = render(model);
    expect(html).toMatch(/id="lz-region-short-name"[^>]*aria-invalid="true"/);
    expect(html).toMatch(/id="lz-region-short-name"[^>]*aria-describedby="lz-region-short-name-error"/);
    expect(html).toContain('id="lz-region-short-name-error"');
    expect(html).toContain('Use 3 characters or fewer for the region short name.');
  });

  it.each(['', 'a-b', ' a '])('adds no required or format rule to region short names: %j', (value) => {
    const model = emptyLzModel();
    model.foundation.regionShortName = value;
    const input = render(model).match(/<input\b[^>]*id="lz-region-short-name"[^>]*>/)?.[0];
    expect(input).not.toMatch(/required|pattern=|aria-invalid="true"/);
  });

  it('locks linked DR environments and opens their Home Region design in a new tab', () => {
    const home = emptyLzModel();
    const dr = structuredClone(home);
    dr.foundation.stackScope = 'regional';
    const html = renderToStaticMarkup(<MemoryRouter><WizardProvider initialModel={dr} homeSource={{ id: 'saved-home', name: 'Primary design', model: home }}>
      <FoundationStep name="Recovery" onNameChange={() => {}} onNameBlur={() => {}} />
    </WizardProvider></MemoryRouter>);
    expect(html).toContain('Environments sync automatically from');
    expect(html).toContain('Primary design');
    expect(html).toContain('Environments synced from Home Region');
    expect(html).not.toContain('New environment name');
    expect(html).not.toContain('Remove prod from DR');
    expect(html).not.toContain('Environment 1 name');
    const homeLink = html.match(/<a\b[^>]*>Open Home Region<\/a>/)?.[0];
    expect(homeLink).toContain('href="/lz/saved-home"');
    expect(homeLink).toContain('target="_blank"');
    expect(homeLink).toContain('rel="noopener noreferrer"');
    expect(html).toMatch(/id="lz-deployment-type"[^>]+disabled/);
    expect(html).toMatch(/id="lz-realm"[^>]+disabled/);
    expect(html).toMatch(/id="lz-home-region"[^>]+disabled/);
    expect(html).not.toMatch(/id="lz-region"[^>]+disabled/);
  });

  it('preserves the locked environment snapshot when the Home Region design is unavailable', () => {
    const dr = emptyLzModel();
    dr.foundation.stackScope = 'regional';
    const html = renderToStaticMarkup(<WizardProvider initialModel={dr} homeSource={{ id: 'missing-home' }}>
      <FoundationStep name="Recovery" onNameChange={() => {}} onNameBlur={() => {}} />
    </WizardProvider>);
    expect(html).toContain('Home Region design is unavailable');
    expect(html).toContain('prod');
    expect(html).not.toContain('href="/lz/missing-home"');
    expect(html).not.toContain('New environment name');
  });
  it('offers deployment type without a description or DR starting-point field', () => {
    const complete = render(emptyLzModel());
    expect(complete).toContain('id="lz-deployment-type"');
    expect(complete).toMatch(/<option value="complete"[^>]*>Home Region<\/option>/);
    expect(complete).toMatch(/<option value="regional"[^>]*>DR<\/option>/);
    expect(complete).toContain('Home Region creates compartments, IAM and governance');
    expect(complete).not.toContain('id="lz-dr-source"');
    expect(complete).not.toContain('Description');
    const model = emptyLzModel();
    model.foundation.stackScope = 'regional';
    const regional = render(model);
    expect(regional).toContain('Home Region');
    expect(regional).not.toContain('id="lz-dr-source"');
    expect(regional).not.toContain('Apply starting point');
    expect(regional).not.toContain('Description');
  });
  it('explains DR environment matching and leaves deployment prerequisites to Review', () => {
    const model = emptyLzModel();
    model.foundation.stackScope = 'regional';
    model.foundation.notifications!.useSingleRecipient = false;
    const html = render(model);
    expect(html).toContain('Environments to recover');
    expect(html).toContain('Use the same environment names as your Home Region deployment.');
    expect(html).toMatch(/<details[^>]*><summary[^>]*>How DR uses these environments<\/summary>/);
    expect(html).not.toMatch(/<details[^>]*\bopen/);
    expect(html).toContain('compartments from your Home Region.');
    expect(html).toContain('Changes here affect only this DR design.');
    expect(html).not.toContain('Home-owned');
    expect(html).not.toContain('Home controls');
    expect(html).not.toContain('role="switch"');
    expect(render(emptyLzModel())).toContain('role="switch"');
    expect(html).toContain('Home Region');
    expect(html).not.toContain('Home stack owns matching compartments');
    model.environments = [];
    expect(render(model)).toContain('No recovery environments. Hub and shared services only.');
    expect(html).not.toContain('id="lz-observability-cloudguard"');
    expect(html).not.toContain('id="lz-observability-iam"');
    expect(html).toContain('id="lz-observability-network"');
  });
  it('starts with the shared recipient checked and a required email field', () => {
    const html = render(emptyLzModel());
    expect(html).toMatch(/type="checkbox"[^>]*checked/);
    expect(html).toMatch(/id="lz-observability-default"[^>]*required/);
    expect(html).toContain('Enter at least one notification email address.');
    expect(html).not.toContain('id="lz-observability-cloudguard"');
  });
  it('keeps the switch above topic inputs when separate recipients are selected', () => {
    const model = emptyLzModel();
    model.foundation.notifications!.useSingleRecipient = false;
    const html = render(model);
    const recipientChoice = html.indexOf('Use the same recipients for all topics');
    expect(recipientChoice).toBeGreaterThan(-1);
    expect(recipientChoice).toBeLessThan(html.indexOf('id="lz-observability-cloudguard"'));
    expect(html).not.toContain('id="lz-observability-default"');
    expect(html).not.toMatch(/type="checkbox"[^>]*checked/);
  });
  it('clears the field error for a valid shared recipient', () => {
    const model = emptyLzModel();
    model.foundation.notifications!.default = 'ops@example.com';
    expect(render(model)).not.toContain('role="alert"');
  });
});


describe('OC41 location controls', () => {
  it('offers the approved realm and only its verified Home and DR regions', () => {
    const model = emptyLzModel();
    Object.assign(model.foundation, { realm: 'oc41', region: 'me-dubai-3', regionShortName: 'pcz', drRegion: 'me-dubai-2' });
    const html = render(model);
    expect(html).toMatch(/<option value="oc41" selected="">OC41 - Du Alloy<\/option>/);
    const region = html.match(/<select id="lz-region"[^>]*>(.*?)<\/select>/)![1];
    expect(region).toContain('value="me-dubai-3"');
    expect(region).toContain('value="me-dubai-2"');
    expect(region).not.toContain('eu-frankfurt');
    expect(region).not.toContain('me-dubai-1');
    const dr = html.match(/<select id="lz-dr-region"[^>]*>(.*?)<\/select>/)![1];
    expect(dr).toContain('value="me-dubai-2" selected');
    expect(dr).not.toContain('me-dubai-3');
    expect(html).toContain('value="pcz"');
    model.foundation.stackScope = 'regional';
    Object.assign(model.foundation, { homeRegion: 'me-dubai-3', region: 'me-dubai-2', regionShortName: 'abr', drRegion: undefined });
    const regional = render(model);
    expect(regional).not.toContain('Select a Home Region different');
    expect(regional).not.toContain('Select a region in this realm');
    expect(regional).toContain('value="abr"');
  });
});
