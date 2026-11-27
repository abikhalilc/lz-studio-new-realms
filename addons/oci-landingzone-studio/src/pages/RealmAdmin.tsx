import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import TopBar from '../components/TopBar';
import { loadRealmCatalog, realmCatalogSnapshot, subscribeRealmCatalog } from '../services/realmCatalog';
import { validateRealm, type RealmProfile } from '../../shared/realm';
import './realmAdmin.css';
import PolicyImport from './PolicyImport';

interface Session { authenticated: boolean; username?: string; csrf?: string; configured?: boolean; setupAllowed?: boolean }
interface AuditEvent { at: string; username: string; action: string; realm_id: string }
const empty = (): RealmProfile => ({ id: '', label: '', apiDomain: '', consoleUrl: '', regions: [{ id: '', shortName: '' }],
  fileStorageService: '', objectStorageServicePrefix: 'objectstorage-', usageReportTenancy: null,
  securityZonePolicies: { shared_network: [], environment: [] }, enabled: true, revision: 1 });

function DeleteDialog({ realm, busy, onClose, onDelete }: { realm: RealmProfile; busy: boolean; onClose: () => void; onDelete: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog className="realm-delete-dialog" ref={ref} onCancel={event => { if (busy) event.preventDefault(); else onClose(); }} aria-labelledby="delete-realm-title">
    <h2 id="delete-realm-title">Delete {realm.label}?</h2>
    <p>This removes the realm from the shared catalog for everyone. Saved designs stay intact, but cannot be exported until the realm is restored. OCI resources are unaffected.</p>
    <div className="realm-actions"><button disabled={busy} onClick={onClose}>Cancel</button><button className="danger" disabled={busy} onClick={onDelete}>{busy ? 'Deleting…' : 'Delete realm'}</button></div>
  </dialog>;
}

export default function RealmAdmin() {
  const realms = useSyncExternalStore(subscribeRealmCatalog, realmCatalogSnapshot, realmCatalogSnapshot);
  const [session, setSession] = useState<Session | null>(null); const [loading, setLoading] = useState(true);
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<RealmProfile | null>(null); const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<RealmProfile | null>(null); const [events, setEvents] = useState<AuditEvent[]>([]);
  const [confirmation, setConfirmation] = useState('');
  const setup = session?.configured === false && session.setupAllowed === true;
  const [username, setUsername] = useState(''); const [password, setPassword] = useState('');
  const [policyImportRevision, setPolicyImportRevision] = useState(0);
  const editorTitle = useRef<HTMLHeadingElement>(null); const editorOpen = editing !== null;
  useEffect(() => {
    if (editorOpen) { editorTitle.current?.focus({ preventScroll: true }); editorTitle.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
  }, [editorOpen]);

  async function request(path: string, method = 'GET', data?: unknown) {
    const response = await fetch('/api/admin/' + path, { method, credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...(session?.csrf ? { 'X-CSRF-Token': session.csrf } : {}) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Shared administration requires the Studio server. See the setup instructions in the Studio README.');
    const result = await response.json();
    if (!response.ok) {
      // Keep an anonymous session object so a rejected password or expired
      // session does not permanently disable the sign-in button.
      if (response.status === 401) setSession(current => ({ authenticated: false, configured: current?.configured }));
      throw new Error(result.error ?? 'Request failed.');
    }
    return result;
  }
  useEffect(() => {
    let active = true;
    void fetch('/api/admin/session', { cache: 'no-store' }).then(async res => {
      if (!res.ok || !res.headers.get('content-type')?.includes('application/json')) throw new Error('Shared administration requires the Studio server. Start it using the Studio README.');
      const value = await res.json() as Session; if (active) setSession(value);
    }).catch(e => { if (active) setError((e as Error).message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (session?.authenticated) void fetch('/api/admin/audit', { cache: 'no-store' }).then(r => r.json()).then(v => { if (Array.isArray(v.events)) setEvents(v.events); }).catch(() => {});
  }, [session, notice]);
  async function login(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      if (setup) {
        if (password !== confirmation) throw new Error('Passwords do not match.');
        await request('setup', 'POST', { username, password });
        setSession({ authenticated: false, configured: true }); setConfirmation('');
        setNotice('Administrator created. Sign in with your new credentials.');
      } else setSession(await request('login', 'POST', { username, password }) as Session);
      setPassword('');
    }
    catch (e) { setError((e as Error).message); setPassword(''); } finally { setBusy(false); }
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!editing) return; setBusy(true); setError(''); setNotice('');
    try {
      const realm = validateRealm(editing);
      await request(creating ? 'realms' : 'realms/' + realm.id, creating ? 'POST' : 'PUT', realm);
      await loadRealmCatalog(); setEditing(null); setNotice(`${realm.label} ${creating ? 'created' : 'updated'}.`); window.scrollTo({ top: 0 });
    } catch (e) { setError((e as Error).message); window.scrollTo({ top: 0 }); } finally { setBusy(false); }
  }
  async function remove() {
    if (!deleting) return; setBusy(true); setError(''); setNotice('');
    try { await request('realms/' + deleting.id, 'DELETE', { revision: deleting.revision }); await loadRealmCatalog(); setNotice(`${deleting.label} deleted.`); setDeleting(null); }
    catch (e) { setError((e as Error).message); setDeleting(null); } finally { setBusy(false); }
  }
  const change = <K extends keyof RealmProfile>(key: K, value: RealmProfile[K]) => setEditing(p => p ? { ...p, [key]: value } : p);

  return <div className="realm-admin"><TopBar /><main>
    <div className="realm-heading"><div><p className="realm-eyebrow">ADMINISTRATION</p><h1>Realms</h1><p>Manage the OCI clouds available across Studio.</p></div>
      {session?.authenticated && <div className="realm-actions"><span>Signed in as <strong>{session.username}</strong></span><button disabled={busy} onClick={() => { setBusy(true); void request('logout', 'POST', {}).then(() => { setSession({ authenticated: false, configured: true }); setEditing(null); }).catch(e => setError((e as Error).message)).finally(() => setBusy(false)); }}>Sign out</button></div>}
    </div>
    {error && <div className="realm-error" role="alert">{error}</div>}{notice && <div className="realm-success" role="status">{notice}</div>}
    {loading ? <p role="status">Checking administrator session…</p> : !session?.authenticated ? <section className="realm-panel realm-login">
      <h2>{setup ? 'Create administrator' : 'Administrator sign in'}</h2><p>Realm changes are shared with everyone using this Studio server.</p>
      {session?.configured === false && !setup && <p className="realm-setup">Create the first administrator in the server terminal with <code>npm run admin:create</code>, then sign in here. No default password is provided.</p>}
      {setup && <p>Create the first shared administrator account. Choose a password of 12–256 characters and save it in your password manager.</p>}
      <form onSubmit={login}><label>Username<input autoComplete="username" required value={username} onChange={e => setUsername(e.target.value)} /></label>
        <label>Password<input type="password" autoComplete={setup ? 'new-password' : 'current-password'} minLength={setup ? 12 : undefined} maxLength={256} required value={password} onChange={e => setPassword(e.target.value)} /></label>
        {setup && <label>Confirm password<input type="password" autoComplete="new-password" required value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label>}
        <button className="primary" disabled={busy || !session} type="submit">{busy ? 'Please wait…' : setup ? 'Create administrator' : 'Sign in'}</button></form>
    </section> : <>
      <section className="realm-panel"><div className="realm-heading"><div><h2>Shared realm catalog</h2><p>{realms.length} realms · changes are recorded in the activity log</p></div><button className="primary" disabled={busy || !!editing} onClick={() => { setCreating(true); setEditing(empty()); setError(''); setNotice(''); }}>Add realm</button></div>
        <div className="realm-table-wrap"><table><thead><tr><th>Realm</th><th>API domain</th><th>Regions</th><th>Status</th><th>Actions</th></tr></thead><tbody>
          {realms.map(realm => <tr key={realm.id}><td><strong>{realm.label}</strong><small>{realm.id} · revision {realm.revision}</small></td><td>{realm.apiDomain}</td><td>{realm.regions.length}</td><td><span className={'realm-status ' + (realm.enabled ? 'enabled' : '')}>{realm.enabled ? 'Enabled' : 'Disabled'}</span></td><td><div className="realm-actions"><button disabled={busy || !!editing} aria-label={`Edit ${realm.id}`} onClick={() => { setCreating(false); setEditing(structuredClone(realm)); setError(''); setNotice(''); }}>Edit</button><button className="danger" disabled={busy || !!editing} aria-label={`Delete ${realm.id}`} onClick={() => setDeleting(realm)}>Delete</button></div></td></tr>)}
        </tbody></table></div>
      </section>
      {editing && <section className="realm-panel" aria-labelledby="realm-editor-title"><h2 id="realm-editor-title" ref={editorTitle} tabIndex={-1} style={{ scrollMarginTop: 80 }}>{creating ? 'Add realm' : `Edit ${editing.id}`}</h2>
        <p>Use verified realm metadata. Catalog entries describe deployment inputs; adding an entry does not certify OCI service availability.</p>
        <form onSubmit={save}><fieldset disabled={busy}><div className="realm-form-grid">
          <label>Realm ID<input required readOnly={!creating} placeholder="oc42" value={editing.id} onChange={e => change('id', e.target.value)} /></label>
          <label>Name<input required maxLength={100} placeholder="Dedicated cloud" value={editing.label} onChange={e => change('label', e.target.value)} /></label>
          <label>API domain<input required placeholder="examplecloud.com" value={editing.apiDomain} onChange={e => change('apiDomain', e.target.value)} /></label>
          <label>Console URL<input type="url" required placeholder="https://cloud.examplecloud.com" value={editing.consoleUrl} onChange={e => change('consoleUrl', e.target.value)} /></label>
        </div>
        <h3>Regions</h3><p>The first region is the default for new designs.</p>
        {editing.regions.map((region, i) => <div className="realm-region-row" key={i}>
          <label>Region {i + 1} identifier<input required value={region.id} placeholder="me-example-1" onChange={e => change('regions', editing.regions.map((r, n) => n === i ? { ...r, id: e.target.value } : r))} /></label>
          <label>Region {i + 1} key<input required maxLength={3} value={region.shortName} placeholder="abc" onChange={e => change('regions', editing.regions.map((r, n) => n === i ? { ...r, shortName: e.target.value } : r))} /></label>
          <button type="button" disabled={editing.regions.length === 1} aria-label={`Remove region ${i + 1}`} onClick={() => change('regions', editing.regions.filter((_, n) => n !== i))}>Remove</button>
        </div>)}<button type="button" onClick={() => change('regions', [...editing.regions, { id: '', shortName: '' }])}>Add region</button>
          <PolicyImport key={editing.id} realm={editing.id} current={editing.securityZonePolicies} request={request} onStage={policies => { change('securityZonePolicies', policies); setPolicyImportRevision(v => v + 1); }} />
        <details open={creating}><summary>Generator settings</summary><p>Obtain service principals and policy OCIDs from the realm operator. Leave the reporting tenancy blank when unverified; cross-tenancy report access will be omitted.</p>
          <div className="realm-form-grid"><label>File Storage service principal<input required value={editing.fileStorageService} onChange={e => change('fileStorageService', e.target.value)} /></label>
          <label>Object Storage service prefix<input required value={editing.objectStorageServicePrefix} onChange={e => change('objectStorageServicePrefix', e.target.value)} /></label></div>
          <label>Usage-report tenancy OCID (optional)<input value={editing.usageReportTenancy ?? ''} onChange={e => change('usageReportTenancy', e.target.value || null)} /></label>
          {(['shared_network', 'environment'] as const).map(kind => <label key={kind}>{kind === 'shared_network' ? 'Shared network' : 'Environment'} Security Zone policy OCIDs <small>One OCID per line, from this realm.</small><textarea required rows={kind === 'environment' ? 7 : 4} key={kind + policyImportRevision} defaultValue={editing.securityZonePolicies[kind].join('\n')} onChange={e => change('securityZonePolicies', { ...editing.securityZonePolicies, [kind]: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) })} /></label>)}
        </details>
        <label className="realm-checkbox"><input type="checkbox" checked={editing.enabled} onChange={e => change('enabled', e.target.checked)} />Enabled for new designs and exports</label>
        <p>Disabling or deleting a realm blocks exports for designs using it. Changes do not update existing ZIP files, stacks or OCI resources.</p>
        <div className="realm-actions"><button className="primary" type="submit">{busy ? 'Saving…' : creating ? 'Create realm' : 'Save changes'}</button><button type="button" onClick={() => setEditing(null)}>Cancel</button></div>
        </fieldset></form>
      </section>}
      <section className="realm-panel"><h2>Recent activity</h2>{events.length ? <ul className="realm-audit">{events.map((event, i) => <li key={i}><time>{new Date(event.at).toLocaleString()}</time><span><strong>{event.username}</strong> · {event.action} · {event.realm_id}</span></li>)}</ul> : <p>No realm changes recorded yet.</p>}</section>
    </>}
    {deleting && <DeleteDialog realm={deleting} busy={busy} onClose={() => setDeleting(null)} onDelete={() => { void remove(); }} />}
  </main></div>;
}
