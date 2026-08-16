// Characters that are hard to confuse when an admin reads a password out
// loud or writes it down: no O/0, I/l/1, or similar lookalikes.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzACDEFGHJKLMNPQRSTUVWXYZ23456789';
const LENGTH = 10;

/**
 * Generates an initial password for an admin-created account.
 *
 * Math.random is not cryptographically secure, which is acceptable here and
 * only here: this password exists to be read aloud once, used once, and
 * replaced immediately — the forced-change screen blocks the app until the
 * user sets their own. Never reuse this for anything durable.
 */
export function generatePassword(): string {
  let out = '';
  for (let i = 0; i < LENGTH; i += 1) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}
