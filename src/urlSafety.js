import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.test', '.invalid'];

export async function assertSafePublicUrl(value, options = {}) {
  const url = value instanceof URL ? value : new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only http:// and https:// URLs can be audited.');
  }
  if (url.username || url.password) {
    throw new Error('URLs containing usernames or passwords are not allowed.');
  }

  if (options.allowPrivateNetwork) return url;

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!hostname || hostname === 'localhost' || BLOCKED_SUFFIXES.some(suffix => hostname.endsWith(suffix))) {
    throw new Error('Local and private-network URLs cannot be audited.');
  }

  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new Error('Private-network IP addresses cannot be audited.');
    return url;
  }

  let addresses;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error(`Could not resolve the hostname ${hostname}.`);
  }
  if (!addresses.length || addresses.some(item => isPrivateAddress(item.address))) {
    throw new Error('This hostname resolves to a private or reserved network address.');
  }
  return url;
}

export function isPrivateAddress(address) {
  const value = String(address || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!value) return true;

  if (value.includes(':')) {
    if (value === '::' || value === '::1' || value === '0:0:0:0:0:0:0:0' || value === '0:0:0:0:0:0:0:1') return true;
    if (value.startsWith('fc') || value.startsWith('fd') || /^fe[89ab]/.test(value)) return true;
    if (value.startsWith('ff')) return true;
    if (value.startsWith('2001:db8:')) return true;
    if (value.startsWith('::ffff:')) return true;
    return false;
  }

  const parts = value.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 88) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51) ||
    (a === 203 && b === 0) ||
    a >= 224;
}
