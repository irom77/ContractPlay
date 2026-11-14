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

  playerIdsForAccount(accountId: string): Promise<string[]> {
    return this.db.prepare("SELECT player_id FROM account_player_identities WHERE account_id = ? ORDER BY player_id")
      .bind(accountId).all<{ player_id: string }>().then(({ results }) => results.map((row) => row.player_id));
  }

  async insertMagicLink(link: MagicLink): Promise<void> {
    await this.db.prepare("INSERT INTO magic_links (token_hash, email, display_name, guest_player_id, expires_at) VALUES (?, ?, ?, ?, ?)")
      .bind(link.tokenHash, normalizeEmail(link.email), link.displayName, link.guestPlayerId ?? null, link.expiresAt).run();
  }

  /** All writes are guarded by this redemption's fresh transaction ID within one transaction. */
  async redeemMagicLink(input: { tokenHash: string; sessionHash: string; now: number; sessionExpiresAt: number }): Promise<Account | null> {
    const { tokenHash, sessionHash, now, sessionExpiresAt } = input;
    const redemptionId = crypto.randomUUID();
    const guard = "m.token_hash = ? AND m.redemption_id = ?";
    const results = await this.db.batch([
      this.db.prepare("UPDATE magic_links SET consumed_at = ?, redemption_id = ? WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?")
        .bind(now, redemptionId, tokenHash, now),
      this.db.prepare(`INSERT INTO accounts (id, email, display_name, primary_player_id, created_at) SELECT ?, m.email, m.display_name, COALESCE(m.guest_player_id, ?), ? FROM magic_links m WHERE ${guard} ON CONFLICT(email) DO NOTHING`)
        .bind(crypto.randomUUID(), crypto.randomUUID(), now, tokenHash, redemptionId),
      this.db.prepare(`INSERT INTO account_player_identities (player_id, account_id) SELECT a.primary_player_id, a.id FROM accounts a JOIN magic_links m ON m.email = a.email WHERE ${guard} ON CONFLICT(player_id) DO UPDATE SET account_id = excluded.account_id WHERE account_player_identities.account_id = excluded.account_id`)
        .bind(tokenHash, redemptionId),
      // Repeated linking to the same account is harmless; a different owner violates the PK,
      // rolling back the token, account and session writes rather than moving that identity.
      this.db.prepare(`INSERT INTO account_player_identities (player_id, account_id) SELECT m.guest_player_id, a.id FROM magic_links m JOIN accounts a ON a.email = m.email WHERE ${guard} AND m.guest_player_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM account_player_identities i WHERE i.player_id = m.guest_player_id AND i.account_id = a.id)`)
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

  async upsertHands(accountId: string, hands: readonly StoredHand[]): Promise<void> {
    if (hands.length === 0) return;
    await this.db.batch([
      ...hands.map((hand) => this.db.prepare("INSERT INTO online_hands (account_id, hand_id, completed_at, data_json) VALUES (?, ?, ?, ?) ON CONFLICT(account_id, hand_id) DO UPDATE SET completed_at = excluded.completed_at, data_json = excluded.data_json")
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
