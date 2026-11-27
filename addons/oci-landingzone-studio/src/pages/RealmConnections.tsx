import { useEffect, useState } from 'react';
import type { CredentialProfile, PolicyConnection, PolicyPreview } from '../../shared/policyImport';

export default function RealmConnections({ realm, request, onChange }: {
  realm: string; request: (path: string, method?: string, data?: unknown) => Promise<unknown>; onChange: () => void;
}) {
  const [connections, setConnections] = useState<(PolicyConnection & { managedEndpoint?: boolean })[]>([]);
  const [profiles, setProfiles] = useState<CredentialProfile[]>([]);
  const [editing, setEditing] = useState<PolicyConnection | null>(null); const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  async function load() {
    const result = await request('connections') as { connections: typeof connections; profiles: CredentialProfile[] };
    setConnections(result.connections.filter(c => c.realm === realm)); setProfiles(result.profiles);
  }
  useEffect(() => {
    let active = true;
    void request('connections').then(v => { if (active) { const result = v as { connections: typeof connections; profiles: CredentialProfile[] }; setConnections(result.connections.filter(c => c.realm === realm)); setProfiles(result.profiles); } }).catch(e => { if (active) setError((e as Error).message); });
    return () => { active = false; };
    // Reload on mounting in the importer, using the current administrator session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realm]);
  async function act(operation: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('');
    try { await operation(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const change = (key: keyof PolicyConnection, value: string) => setEditing(v => v ? { ...v, [key]: value } : v);
  return <section aria-label="Manage realm connections" onKeyDown={e => { if (editing && e.key === 'Enter' && e.target instanceof HTMLInputElement) e.preventDefault(); }}>
    <h3>Realm connections</h3><p>Connections are shared and saved separately from realm drafts. Choose an existing credential profile on the Studio server. Private keys are never entered here.</p>
    {error && <p className="realm-error" role="alert">{error}</p>}{notice && <p className="realm-success" role="status">{notice}</p>}
    {connections.map(c => <div className="realm-panel" key={c.id}>
      <strong>{c.label}</strong><p>{c.region} · server profile {c.profile}</p>
      {c.managedEndpoint && <p>This connection uses an endpoint managed by the server operator.</p>}
      <div className="realm-actions">
        <button type="button" disabled={busy || !!editing} onClick={() => { setEditing(c); setCreating(false); setError(''); setNotice(''); }}>Edit connection {c.id}</button>
        <button type="button" disabled={busy || !!editing} onClick={() => { void act(async () => { const result = await request('policies/discover', 'POST', { source: c.id, realm: c.realm }) as PolicyPreview; setNotice(`Connected to ${c.label}. ${result.matches.filter(m => m.candidates.length === 1).length} framework policies matched${result.complete ? '.' : '; review missing or ambiguous policies in the import preview.'}`); }); }}>Test connection {c.id}</button>
        <button type="button" className="danger" disabled={busy || !!editing} onClick={() => { if (window.confirm(`Delete connection ${c.label}? Credentials and saved realm policies will be retained.`)) void act(async () => { await request('connections/' + c.id, 'DELETE', { revision: c.revision }); await load(); onChange(); setNotice('Connection deleted.'); }); }}>Delete connection {c.id}</button>
      </div>
    </div>)}
    {!editing && <button type="button" disabled={busy || !/^oc[1-9][0-9]*$/.test(realm)} onClick={() => { setCreating(true); setEditing({ id: '', label: '', realm, region: '', profile: '', tenancyOcid: '' }); setError(''); setNotice(''); }}>Add realm connection</button>}
    {editing && <div className="realm-panel">
      <h4>{creating ? 'Add realm connection' : 'Edit realm connection'}</h4>
      <fieldset disabled={busy}><div className="realm-form-grid">
        <label>Connection ID<input readOnly={!creating} maxLength={64} value={editing.id} onChange={e => change('id', e.target.value)} /></label>
        <label>Connection name<input maxLength={100} value={editing.label} onChange={e => change('label', e.target.value)} /></label>
        <label>Connection realm<input readOnly value={editing.realm} /></label>
        <label>Server credential profile<select value={editing.profile} onChange={e => { const profile = profiles.find(p => p.name === e.target.value); setEditing(v => v ? { ...v, profile: e.target.value, tenancyOcid: profile?.tenancyOcid || v.tenancyOcid, region: profile?.region || v.region } : v); }}><option value="">Select a server profile</option>{profiles.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}</select></label>
        <label>Connection region<input value={editing.region} onChange={e => change('region', e.target.value)} /></label>
        <label>Connection tenancy OCID<input value={editing.tenancyOcid} onChange={e => change('tenancyOcid', e.target.value)} /></label>
      </div>
      {!profiles.length && <p>No credential profiles were found. The server operator must provision an OCI CLI profile before a connection can use it.</p>}
      <div className="realm-actions"><button type="button" className="primary" disabled={!editing.profile} onClick={() => { void act(async () => { await request(creating ? 'connections' : 'connections/' + editing.id, creating ? 'POST' : 'PUT', editing); await load(); setEditing(null); onChange(); setNotice('Connection saved. You can now test it or retrieve policies.'); }); }}>Save connection</button><button type="button" onClick={() => setEditing(null)}>Cancel connection edit</button></div>
      </fieldset>
    </div>}
  </section>;
}
