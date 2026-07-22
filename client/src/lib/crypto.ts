const STORAGE_META = 'ssh_vault_meta';
const STORAGE_CONNECTIONS = 'ssh_connections';
const STORAGE_LEGACY = 'ssh_connections';

const PBKDF2_ITERATIONS = 210_000;

export type VaultMeta = {
  salt: string;
  verifier: string;
  version: 1;
};

function b64encode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptText(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
  const packed = new Uint8Array(iv.length + cipher.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(cipher), iv.length);
  return b64encode(packed);
}

export async function decryptText(key: CryptoKey, packedB64: string): Promise<string> {
  const packed = b64decode(packedB64);
  const iv = packed.slice(0, 12);
  const data = packed.slice(12);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return new TextDecoder().decode(plain);
}

export function getVaultMeta(): VaultMeta | null {
  try {
    const raw = localStorage.getItem(STORAGE_META);
    return raw ? (JSON.parse(raw) as VaultMeta) : null;
  } catch {
    return null;
  }
}

export function hasVault(): boolean {
  return Boolean(getVaultMeta());
}

export async function setupVault(masterPassword: string): Promise<CryptoKey> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(masterPassword, salt);
  const verifier = await encryptText(key, 'noe-ssh-ok');
  const meta: VaultMeta = { salt: b64encode(salt), verifier, version: 1 };
  localStorage.setItem(STORAGE_META, JSON.stringify(meta));
  return key;
}

export async function unlockVault(masterPassword: string): Promise<CryptoKey> {
  const meta = getVaultMeta();
  if (!meta) throw new Error('Vault not set up');
  const key = await deriveKey(masterPassword, b64decode(meta.salt));
  try {
    const v = await decryptText(key, meta.verifier);
    // Accept legacy verifier string for existing vaults
    if (v !== 'noe-ssh-ok' && v !== 'super-ssh-ok') throw new Error('bad');
  } catch {
    throw new Error('主密码错误');
  }
  return key;
}

export type SecretFields = {
  password?: string;
  privateKey?: string;
  passphrase?: string;
  jumpHost?: {
    host: string;
    port?: number;
    username: string;
    password?: string;
    privateKey?: string;
    passphrase?: string;
  } | null;
};

export async function encryptSecrets(key: CryptoKey, secrets: SecretFields): Promise<string> {
  return encryptText(key, JSON.stringify(secrets));
}

export async function decryptSecrets(key: CryptoKey, cipherB64: string): Promise<SecretFields> {
  const json = await decryptText(key, cipherB64);
  return JSON.parse(json) as SecretFields;
}

/** Migrate legacy plaintext connections into encrypted vault. */
export async function migrateLegacyConnections(key: CryptoKey): Promise<number> {
  let list: Array<Record<string, unknown>> = [];
  try {
    list = JSON.parse(localStorage.getItem(STORAGE_LEGACY) || '[]');
  } catch {
    return 0;
  }
  let migrated = 0;
  const next = [];
  for (const c of list) {
    if (c.encrypted && typeof c.secrets === 'string') {
      next.push(c);
      continue;
    }
    const secrets: SecretFields = {
      password: (c.password as string) || '',
      privateKey: (c.privateKey as string) || '',
      passphrase: (c.passphrase as string) || '',
      jumpHost: (c.jumpHost as SecretFields['jumpHost']) || null,
    };
    const secretsCipher = await encryptSecrets(key, secrets);
    next.push({
      id: c.id,
      name: c.name,
      host: c.host,
      port: c.port,
      username: c.username,
      proxyType: c.proxyType || '',
      proxyHost: c.proxyHost || '',
      proxyPort: c.proxyPort || 0,
      encrypted: true,
      secrets: secretsCipher,
    });
    migrated += 1;
  }
  if (migrated > 0) {
    localStorage.setItem(STORAGE_CONNECTIONS, JSON.stringify(next));
  }
  return migrated;
}

export function loadRawConnections(): unknown[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_CONNECTIONS) || '[]');
  } catch {
    return [];
  }
}

export function saveRawConnections(list: unknown[]): void {
  localStorage.setItem(STORAGE_CONNECTIONS, JSON.stringify(list));
}

export function hasLegacyPlaintext(): boolean {
  try {
    const list = JSON.parse(localStorage.getItem(STORAGE_CONNECTIONS) || '[]') as Array<{ encrypted?: boolean; password?: string; privateKey?: string }>;
    return list.some((c) => !c.encrypted && (c.password || c.privateKey));
  } catch {
    return false;
  }
}
