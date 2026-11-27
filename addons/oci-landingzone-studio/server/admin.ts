import { emitKeypressEvents, createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { openDatabase, createAdmin } from './app.ts';

async function secret(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) throw new Error('Run administrator setup in an interactive terminal.');
  process.stdout.write(prompt); emitKeypressEvents(process.stdin); process.stdin.setRawMode(true); process.stdin.resume();
  return new Promise((resolveSecret, reject) => {
    let value = '';
    const onKey = (str: string, key: { name: string; ctrl: boolean }) => {
      if (key.name === 'return' || (key.ctrl && key.name === 'c')) {
        process.stdin.off('keypress', onKey); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n');
        if (key.ctrl) reject(new Error('Cancelled.')); else resolveSecret(value);
      } else if (key.name === 'backspace') value = value.slice(0, -1);
      else if (!key.ctrl && str && [...str].every(ch => ch.charCodeAt(0) >= 32)) value += str;
    };
    process.stdin.on('keypress', onKey);
  });
}

try {
  const input = createInterface({ input: process.stdin, output: process.stdout });
  const username = await new Promise<string>(r => input.question('Administrator username: ', r)); input.close();
  const password = await secret('Password (12+ characters; hidden): ');
  if (await secret('Confirm password: ') !== password) throw new Error('Passwords do not match.');
  const db = openDatabase(resolve(process.env.STUDIO_DATA_DIR ?? '.studio-data', 'studio.sqlite'));
  try { await createAdmin(db, username.trim(), password); } finally { db.close(); }
  console.info('Administrator created. Open /admin/realms to sign in.');
} catch (error) { console.error((error as Error).message); process.exitCode = 1; }
