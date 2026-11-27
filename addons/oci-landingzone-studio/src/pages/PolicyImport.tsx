import { useEffect, useState } from 'react';
import type { PolicyPreview, PolicySource } from '../../shared/policyImport';
import type { RealmProfile } from '../../shared/realm';

type Policies = RealmProfile['securityZonePolicies'];
export default function PolicyImport({ realm, current, request, onStage }: {
  realm: string; current: Policies;
  request: (path: string, method?: string, data?: unknown) => Promise<unknown>;
  onStage: (policies: Policies) => void;
}) {
  const [sources, setSources] = useState<PolicySource[]>([]);
  const [source, setSource] = useState(''); const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<PolicyPreview | null>(null);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [reviewed, setReviewed] = useState(false);
  useEffect(() => {
    let active = true;
    if (open) void request('policy-sources').then(value => {
      if (active) setSources((value as { sources: PolicySource[] }).sources.filter(s => s.realm === realm));
    }).catch(e => { if (active) setError((e as Error).message); });
    return () => { active = false; };
    // The parent request uses the current session; reopening refreshes sources.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, realm]);
  async function discover() {
    setBusy(true); setError(''); setPreview(null); setReviewed(false);
    try { setPreview(await request('policies/discover', 'POST', { source, realm }) as PolicyPreview); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const proposed: Policies = { shared_network: [], environment: [] };
  for (const match of preview?.matches ?? []) if (match.candidates.length === 1) for (const group of match.groups) proposed[group].push(match.candidates[0].id);
  return <div className="realm-policy-import">
    <button type="button" onClick={() => setOpen(v => !v)}>Import policies from realm</button>
    {open && <section aria-label="Import policies from realm">
      <h3>Import policies from {realm || 'realm'}</h3>
      <p>Retrieve policies using a server connection. Review the framework mapping before adding it to this draft. Nothing is saved until you save the realm.</p>
      {error && <p className="realm-error" role="alert">{error}</p>}
      {!sources.length && <p>No server connection is configured for this realm. Configure policy-sources.json on the Studio server; see the Studio README.</p>}
      <label>Realm connection<select disabled={busy} value={source} onChange={e => { setSource(e.target.value); setPreview(null); setReviewed(false); }}>
        <option value="">Select a connection</option>{sources.map(s => <option key={s.id} value={s.id}>{s.label} · {s.region}</option>)}
      </select></label>
      <button type="button" disabled={busy || !source} onClick={() => { void discover(); }}>{busy ? 'Retrieving policies…' : 'Retrieve policies'}</button>
      {preview && <>
        <h3>Review policy mapping</h3><p>{preview.source.label} · {preview.source.realm} · {preview.source.region}</p>
        {(['shared_network', 'environment'] as const).map(group => <p key={group}><strong>{group === 'shared_network' ? 'Shared network' : 'Environment'}</strong>: {proposed[group].length} matched; {proposed[group].filter(id => !current[group].includes(id)).length} added, {current[group].filter(id => !proposed[group].includes(id)).length} removed from the draft.</p>)}
        {!preview.complete && <p className="realm-error" role="alert">Some required policies are missing or ambiguous. Import is blocked; ask your realm operator to verify the inventory. Existing draft policies are unchanged.</p>}
        <div className="realm-table-wrap"><table><thead><tr><th>Policy</th><th>Used by</th><th>Match</th></tr></thead><tbody>
          {preview.matches.map(m => <tr key={m.name}><td><strong>{m.name}</strong>{m.candidates.map(p => <div key={p.id}><p>{p.description}</p><small style={{ overflowWrap: 'anywhere' }}>{p.id}</small></div>)}</td><td>{m.groups.map(g => g === 'shared_network' ? 'Shared network' : 'Environment').join(', ')}</td><td>{m.candidates.length === 1 ? 'Matched' : m.candidates.length ? 'Ambiguous' : 'Missing'}</td></tr>)}
        </tbody></table></div>
        <details><summary>Other available policies ({preview.unused.length}) — excluded from these framework selections</summary>{preview.unused.map(p => <p key={p.id}><strong>{p.name}</strong><br />{p.description}<br /><small style={{ overflowWrap: 'anywhere' }}>{p.id}</small></p>)}</details>
        <label className="realm-checkbox"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />I reviewed the policy mapping and draft replacements.</label>
        <button type="button" disabled={!preview.complete || !reviewed} onClick={() => { onStage(proposed); setOpen(false); setPreview(null); }}>Use reviewed policies in draft</button>
      </>}
    </section>}
  </div>;
}
