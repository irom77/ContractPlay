export interface Account {
  id: string;
  email: string;
  displayName: string;
  primaryPlayerId: string;
  createdAt: number;
}

export interface MagicLink {
  tokenHash: string;
  email: string;
  displayName: string;
  guestPlayerId?: string;
  expiresAt: number;
}

export interface StoredHand {
  id: string;
  completedAt: number;
  data: unknown;
}

const accountColumns = "a.id, a.email, a.display_name AS displayName, a.primary_player_id AS primaryPlayerId, a.created_at AS createdAt";
const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** D1 persistence boundary. Callers hash credentials and validate imported hand data. */
export class AuthStore {
  constructor(private readonly db: D1Database) {}

  findAccountByEmail(email: string): Promise<Account | null> {
    return this.db.prepare(`SELECT ${accountColumns} FROM accounts a WHERE email = ?`)
      .bind(normalizeEmail(email)).first<Account>();
  }

  async getOrCreateAccount(email: string, displayName: string, now: number, guestPlayerId?: string): Promise<Account> {
    const normalized = normalizeEmail(email);
    const playerId = guestPlayerId ?? crypto.randomUUID();
    await this.db.batch([
      this.db.prepare("INSERT INTO accounts (id, email, display_name, primary_player_id, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(email) DO NOTHING")
        .bind(crypto.randomUUID(), normalized, displayName, playerId, now),
      this.db.prepare("INSERT INTO account_player_identities (player_id, account_id) SELECT primary_player_id, id FROM accounts WHERE email = ? ON CONFLICT(player_id) DO UPDATE SET account_id = excluded.account_id WHERE account_player_identities.account_id = excluded.account_id")
        .bind(normalized),
      ...(guestPlayerId ? [this.linkIdentityStatement(normalized, guestPlayerId)] : [])
    ]);
    return (await this.findAccountByEmail(normalized))!;
  }

  async updateDisplayName(accountId: string, displayName: string): Promise<void> {
    await this.db.prepare("UPDATE accounts SET display_name = ? WHERE id = ?").bind(displayName, accountId).run();
  }

  playerIdsForAccount(accountId: string): Promise<string[]> {
    return this.db.prepare("SELECT player_id FROM account_player_identities WHERE account_id = ? ORDER BY player_id")
      .bind(accountId).all<{ player_id: string }>().then(({ results }) => results.map((row) => row.player_id));
  }

  async insertMagicLink(link: MagicLink): Promise<void> {
    await this.db.prepare("INSERT INTO magic_links (token_hash, email, display_name, guest_player_id, expires_at) VALUES (?, ?, ?, ?, ?)")
      .bind(link.tokenHash, normalizeEmail(link.email), link.displayName, link.guestPlayerId ?? null, link.expiresAt).run();
  }

  /** Pending delivery is deliberately ineligible for redemption, even if sending fails. */
  async insertPendingMagicLink(link: MagicLink, now: number): Promise<void> {
    await this.db.prepare("INSERT INTO magic_links (token_hash, email, display_name, guest_player_id, expires_at, consumed_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(link.tokenHash, normalizeEmail(link.email), link.displayName, link.guestPlayerId ?? null, link.expiresAt, now).run();
  }

  async activateMagicLink(tokenHash: string): Promise<void> {
    await this.db.prepare("UPDATE magic_links SET consumed_at = NULL WHERE token_hash = ? AND redemption_id IS NULL")
      .bind(tokenHash).run();
  }

  async magicLinkEmail(tokenHash: string): Promise<string | null> {
    const row = await this.db.prepare("SELECT email FROM magic_links WHERE token_hash = ?").bind(tokenHash).first<{ email: string }>();
    return row?.email ?? null;
  }

  /** Atomic fixed-window admission, shared by all Worker instances. Only hashed keys persist. */
  async admitAuthAttempt(keyHash: string, now: number, windowMs: number, limit: number, cooldownMs = 0): Promise<boolean> {
    const row = await this.db.prepare(`INSERT INTO auth_rate_limits (key_hash, attempts, expires_at, last_at) VALUES (?, 1, ?, ?)
      ON CONFLICT(key_hash) DO UPDATE SET
        attempts = CASE WHEN expires_at <= ? THEN 1 ELSE attempts + 1 END,
        expires_at = CASE WHEN expires_at <= ? THEN excluded.expires_at ELSE expires_at END,
        last_at = excluded.last_at
      WHERE (expires_at <= ? OR attempts < ?) AND last_at <= ? RETURNING key_hash`)
      .bind(keyHash, now + windowMs, now, now, now, now, limit, now - cooldownMs).first();
    return row !== null;
  }

  async cleanupAuth(now: number): Promise<void> {
    await this.db.batch([
      this.db.prepare("DELETE FROM magic_links WHERE expires_at <= ?").bind(now),
      this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now),
      this.db.prepare("DELETE FROM auth_rate_limits WHERE expires_at <= ?").bind(now)
    ]);
  }

  /** All writes are guarded by this redemption's fresh transaction ID within one transaction. */
  async redeemMagicLink(input: { tokenHash: string; sessionHash: string; now: number; sessionExpiresAt: number }): Promise<Account | null> {
    const { tokenHash, sessionHash, now, sessionExpiresAt } = input;
    const redemptionId = crypto.randomUUID();
    const guard = "m.token_hash = ? AND m.redemption_id = ?";
    const results = await this.db.batch([
      this.db.prepare("UPDATE magic_links SET consumed_at = ?, redemption_id = ? WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?")
        .bind(now, redemptionId, tokenHash, now),
      this.db.prepare(`INSERT INTO accounts (id, email, display_name, primary_player_id, created_at) SELECT ?, m.email, m.display_name, CASE WHEN m.guest_player_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM account_player_identities i WHERE i.player_id = m.guest_player_id) THEN m.guest_player_id ELSE ? END, ? FROM magic_links m WHERE ${guard} ON CONFLICT(email) DO NOTHING`)
        .bind(crypto.randomUUID(), crypto.randomUUID(), now, tokenHash, redemptionId),
      this.db.prepare(`INSERT INTO account_player_identities (player_id, account_id) SELECT a.primary_player_id, a.id FROM accounts a JOIN magic_links m ON m.email = a.email WHERE ${guard} ON CONFLICT(player_id) DO UPDATE SET account_id = excluded.account_id WHERE account_player_identities.account_id = excluded.account_id`)
        .bind(tokenHash, redemptionId),
      // A guest already linked stays with its account: linking it again is skipped, and a guest that belongs to
      // another account is never moved. Signing in still succeeds, as a browser can keep the guest of an account it
      // signed out of; a new account then gets a fresh primary player ID (above).
      this.db.prepare(`INSERT INTO account_player_identities (player_id, account_id) SELECT m.guest_player_id, a.id FROM magic_links m JOIN accounts a ON a.email = m.email WHERE ${guard} AND m.guest_player_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM account_player_identities i WHERE i.player_id = m.guest_player_id)`)
        .bind(tokenHash, redemptionId),
      this.db.prepare(`INSERT INTO sessions (session_hash, account_id, expires_at) SELECT ?, a.id, ? FROM accounts a JOIN magic_links m ON a.email = m.email WHERE ${guard}`)
        .bind(sessionHash, sessionExpiresAt, tokenHash, redemptionId)
    ]);
    if (results[0]?.meta.changes !== 1) return null;
    return this.findSession(sessionHash, now);
  }

  findSession(sessionHash: string, now: number): Promise<Account | null> {
    return this.db.prepare(`SELECT ${accountColumns} FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.session_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?`)
      .bind(sessionHash, now).first<Account>();
  }

  async revokeSession(sessionHash: string, now: number): Promise<void> {
    await this.db.prepare("UPDATE sessions SET revoked_at = ? WHERE session_hash = ?").bind(now, sessionHash).run();
  }

  async upsertHands(accountId: string, hands: readonly StoredHand[], replace = true): Promise<void> {
    if (hands.length === 0) return;
    await this.db.batch([
      ...hands.map((hand) => this.db.prepare(`INSERT INTO online_hands (account_id, hand_id, completed_at, data_json) VALUES (?, ?, ?, ?) ON CONFLICT(account_id, hand_id) ${replace ? "DO UPDATE SET completed_at = excluded.completed_at, data_json = excluded.data_json" : "DO NOTHING"}`)
        .bind(accountId, hand.id, hand.completedAt, JSON.stringify(hand.data))),
      this.db.prepare("DELETE FROM online_hands WHERE account_id = ? AND hand_id NOT IN (SELECT hand_id FROM online_hands WHERE account_id = ? ORDER BY completed_at DESC, hand_id DESC LIMIT 25)")
        .bind(accountId, accountId)
    ]);
  }

  async listHands(accountId: string): Promise<StoredHand[]> {
    const { results } = await this.db.prepare("SELECT hand_id, completed_at, data_json FROM online_hands WHERE account_id = ? ORDER BY completed_at DESC, hand_id DESC LIMIT 25")
      .bind(accountId).all<{ hand_id: string; completed_at: number; data_json: string }>();
    return results.map((row) => ({ id: row.hand_id, completedAt: row.completed_at, data: JSON.parse(row.data_json) }));
  }

  private linkIdentityStatement(email: string, playerId: string): D1PreparedStatement {
    return this.db.prepare("INSERT INTO account_player_identities (player_id, account_id) SELECT ?, a.id FROM accounts a WHERE a.email = ? AND NOT EXISTS (SELECT 1 FROM account_player_identities i WHERE i.player_id = ? AND i.account_id = a.id)")
      .bind(playerId, email, playerId);
  }
}
