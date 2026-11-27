import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { readFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname, resolve, extname } from 'node:path';
import { validateRealm, type RealmProfile } from '../shared/realm.ts';

const scrypt = promisify(scryptCallback);
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const SESSION_MS = 8 * 60 * 60 * 1000;
const COOKIE = 'studio_admin';
type Row = Record<string, string | number>;

export function openDatabase(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  if (path !== ':memory:') chmodSync(path, 0o600);
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS admins (username TEXT PRIMARY KEY, salt TEXT NOT NULL, password_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, username TEXT NOT NULL, csrf TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS realms (id TEXT PRIMARY KEY, profile TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, at TEXT NOT NULL, username TEXT NOT NULL, action TEXT NOT NULL, realm_id TEXT NOT NULL);`);
  if (!db.prepare("SELECT key FROM settings WHERE key='seeded'").get()) {
    const defaults = JSON.parse(readFileSync(new URL('../../../gen/realm-defaults.json', import.meta.url), 'utf8')) as RealmProfile[];
    db.exec('BEGIN');
    try {
      for (const item of defaults) { const realm = validateRealm(item); db.prepare('INSERT INTO realms VALUES (?,?)').run(realm.id, JSON.stringify(realm)); }
      db.prepare('INSERT INTO settings VALUES (?,?)').run('seeded', '1'); db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  return db;
}

export async function createAdmin(db: DatabaseSync, username: string, password: string) {
  if (!/^[a-zA-Z0-9_.-]{3,64}$/.test(username)) throw new Error('Use a username of 3–64 letters, digits, dots, underscores or hyphens.');
  if (password.length < 12 || password.length > 256) throw new Error('Use a password of 12–256 characters.');
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64) as Buffer;
  db.prepare('INSERT INTO admins VALUES (?,?,?)').run(username, salt, derived.toString('hex'));
}

class HttpError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status; } }

export function createStudioServer(options: { db: DatabaseSync; secureCookies?: boolean; dist?: string }) {
  const { db } = options;
  const attempts = new Map<string, { count: number; until: number }>();
  const profiles = () => (db.prepare('SELECT profile FROM realms ORDER BY id').all() as Row[]).map(r => JSON.parse(String(r.profile)) as RealmProfile);
  const session = (req: IncomingMessage) => {
    const token = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    return db.prepare('SELECT * FROM sessions WHERE token_hash=? AND expires>?').get(hash(token), Date.now()) as Row | undefined;
  };
  async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
    let size = 0; const chunks: Buffer[] = [];
    for await (const chunk of req) { size += chunk.length; if (size > 256_000) throw new HttpError(413, 'Request is too large.'); chunks.push(chunk); }
    try { const result: unknown = JSON.parse(Buffer.concat(chunks).toString()); if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error(); return result as Record<string, unknown>; }
    catch { throw new HttpError(400, 'Send a JSON object.'); }
  }
  function send(res: ServerResponse, status: number, value: unknown) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); }
  function mutate(user: string, action: string, id: string, operation: () => void) {
    db.exec('BEGIN');
    try { operation(); db.prepare('INSERT INTO audit(at,username,action,realm_id) VALUES (?,?,?,?)').run(new Date().toISOString(), user, action, id); db.exec('COMMIT'); }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin'); res.setHeader('X-Frame-Options', 'DENY');
    try {
      const path = new URL(req.url ?? '/', 'http://localhost').pathname;
      const method = req.method ?? 'GET';
      if (path.startsWith('/api/')) {
        if (!['GET', 'HEAD'].includes(method)) {
          let origin: URL;
          try { origin = new URL(String(req.headers.origin)); } catch { throw new HttpError(403, 'Same-origin requests are required.'); }
          if (origin.host !== req.headers.host || !['http:', 'https:'].includes(origin.protocol) || (options.secureCookies && origin.protocol !== 'https:')) throw new HttpError(403, 'Origin is not allowed.');
          if (!String(req.headers['content-type']).startsWith('application/json')) throw new HttpError(415, 'Send application/json.');
        }
        if (path === '/api/realms' && method === 'GET') { send(res, 200, { realms: profiles() }); return; }
        if (path === '/api/admin/session' && method === 'GET') {
          const user = session(req); send(res, 200, user ? { authenticated: true, username: user.username, csrf: user.csrf } : { authenticated: false, configured: !!db.prepare('SELECT username FROM admins LIMIT 1').get() }); return;
        }
        if (path === '/api/admin/login' && method === 'POST') {
          const ip = req.socket.remoteAddress ?? 'unknown'; const now = Date.now();
          for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
          if (attempts.size >= 10_000 || (attempts.get(ip)?.count ?? 0) >= 5) throw new HttpError(429, 'Too many sign-in attempts. Try again in 15 minutes.');
          const input = await body(req); const username = String(input.username ?? ''); const password = String(input.password ?? '');
          const last = attempts.get(ip); attempts.set(ip, { count: (last?.count ?? 0) + 1, until: last?.until ?? now + 900_000 });
          const user = db.prepare('SELECT * FROM admins WHERE username=?').get(username) as Row | undefined;
          const derived = await scrypt(password.slice(0, 256), String(user?.salt ?? 'invalid-user-salt'), 64) as Buffer;
          const valid = user && password.length <= 256 && timingSafeEqual(derived, Buffer.from(String(user.password_hash), 'hex'));
          if (!valid) throw new HttpError(401, 'Incorrect username or password.');
          attempts.delete(ip); db.prepare('DELETE FROM sessions WHERE expires<=?').run(now);
          const token = randomBytes(32).toString('hex'); const csrf = randomBytes(32).toString('hex');
          db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(hash(token), username, csrf, now + SESSION_MS);
          res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=28800${options.secureCookies ? '; Secure' : ''}`);
          send(res, 200, { authenticated: true, username, csrf }); return;
        }
        const user = session(req);
        if (!user) throw new HttpError(401, 'Sign in as an administrator.');
        if (method !== 'GET' && req.headers['x-csrf-token'] !== user.csrf) throw new HttpError(403, 'Session verification failed. Reload and sign in again.');
        if (path === '/api/admin/logout' && method === 'POST') {
          db.prepare('DELETE FROM sessions WHERE token_hash=?').run(user.token_hash);
          res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=0${options.secureCookies ? '; Secure' : ''}`); send(res, 200, { ok: true }); return;
        }
        if (path === '/api/admin/audit' && method === 'GET') { send(res, 200, { events: db.prepare('SELECT at,username,action,realm_id FROM audit ORDER BY id DESC LIMIT 100').all() }); return; }
        const match = path.match(/^\/api\/admin\/realms(?:\/(oc[1-9][0-9]*))?$/);
        if (!match) throw new HttpError(404, 'Endpoint not found.');
        if (!['POST', 'PUT', 'DELETE'].includes(method)) throw new HttpError(405, 'Method not allowed.');
        const input = await body(req); const id = match[1];
        const existing = id ? profiles().find(p => p.id === id) : undefined;
        if (id && !existing) throw new HttpError(404, 'Realm not found.');
        if (existing && input.revision !== existing.revision) throw new HttpError(409, 'This realm changed in another session. Reload before saving.');
        if (method === 'DELETE') {
          if (!id) throw new HttpError(400, 'Select a realm.');
          if (existing?.enabled && profiles().filter(p => p.enabled).length <= 1) throw new HttpError(409, 'Keep at least one enabled realm.');
          mutate(String(user.username), 'delete', id, () => { db.prepare('DELETE FROM realms WHERE id=?').run(id); }); send(res, 200, { ok: true }); return;
        }
        let realm: RealmProfile;
        try { realm = validateRealm(input); } catch (error) { throw new HttpError(400, (error as Error).message); }
        if (method === 'POST' && (id || profiles().some(p => p.id === realm.id))) throw new HttpError(409, 'This realm already exists.');
        if (method === 'PUT' && (!id || realm.id !== id)) throw new HttpError(400, 'Realm IDs cannot be changed.');
        if (!realm.enabled && existing?.enabled && profiles().filter(p => p.enabled).length <= 1) throw new HttpError(409, 'Keep at least one enabled realm.');
        if (profiles().some(p => p.id !== realm.id && p.regions.some(r => realm.regions.some(newRegion => newRegion.id === r.id)))) throw new HttpError(409, 'A region identifier is already assigned to another realm.');
        realm.revision = (existing?.revision ?? 0) + 1;
        mutate(String(user.username), existing ? 'update' : 'create', realm.id, () => { db.prepare('INSERT INTO realms VALUES (?,?) ON CONFLICT(id) DO UPDATE SET profile=excluded.profile').run(realm.id, JSON.stringify(realm)); }); send(res, existing ? 200 : 201, { realm }); return;
      }
      if (method !== 'GET' || !options.dist) throw new HttpError(404, 'Not found.');
      const file = resolve(options.dist, '.' + decodeURIComponent(path));
      if (file !== resolve(options.dist) && !file.startsWith(resolve(options.dist) + '/')) throw new HttpError(404, 'Not found.');
      const asset = existsSync(file) && extname(file) ? file : resolve(options.dist, 'index.html');
      const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.zip': 'application/zip' };
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
      res.writeHead(200, { 'Content-Type': mime[extname(asset)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(readFileSync(asset));
    } catch (error) { if (!res.headersSent) send(res, error instanceof HttpError ? error.status : 500, { error: error instanceof HttpError ? error.message : 'The server could not complete the request.' }); else res.end(); }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  return server;
}
