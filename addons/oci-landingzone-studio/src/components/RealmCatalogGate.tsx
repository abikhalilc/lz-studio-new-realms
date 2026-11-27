import { useEffect, useState, type ReactNode } from 'react';
import { loadRealmCatalog } from '../services/realmCatalog';

export default function RealmCatalogGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false); const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const load = () => { void loadRealmCatalog().then(() => { if (active) { setReady(true); setError(''); } }).catch(e => { if (active) setError((e as Error).message); }); };
    load(); window.addEventListener('focus', load);
    return () => { active = false; window.removeEventListener('focus', load); };
  }, []);
  if (error) return <main style={{ padding: 40 }}><h1>Realm catalog unavailable</h1><p role="alert">{error}</p><button onClick={() => window.location.reload()}>Retry</button></main>;
  return ready ? children : <p role="status" style={{ padding: 40 }}>Loading realm catalog…</p>;
}
