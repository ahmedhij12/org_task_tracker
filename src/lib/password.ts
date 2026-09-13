// Characters that are hard to confuse when an admin reads a password out
// loud or writes it down: no O/0, I/l/1, or similar lookalikes.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzACDEFGHJKLMNPQRSTUVWXYZ23456789';
const LENGTH = 10;

/**
 * The pre-filled temp password shown when the create/reset sheet opens — a
 * simple, easy-to-read-aloud default for handing to kitchen/floor staff.
 * The forced-change screen still blocks the app until they set their own,
 * so this is exactly as safe as any other temp password: used once, then
 * replaced. An admin can still type their own value or tap the refresh icon
 * (generatePassword()) for a random one instead.
 */
export const DEFAULT_TEMP_PASSWORD = '112233';

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
