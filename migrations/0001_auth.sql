-- Kimlik doğrulama: kullanıcılar, passkey'ler, oturumlar ve geçici kayıtlar.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  created_at INTEGER NOT NULL
);

CREATE TABLE passkeys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL,
  transports TEXT NOT NULL DEFAULT '[]',
  name TEXT NOT NULL,
  device_type TEXT NOT NULL,
  backed_up INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX passkeys_user_idx ON passkeys(user_id);

CREATE TABLE auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL REFERENCES passkeys(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX auth_sessions_user_idx ON auth_sessions(user_id);

CREATE TABLE auth_invites (
  token_hash TEXT PRIMARY KEY,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_name TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE auth_challenges (
  token_hash TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('login', 'register')),
  kind TEXT NOT NULL CHECK (kind IN ('login', 'setup', 'invite', 'device')),
  expires_at INTEGER NOT NULL,
  user_id TEXT,
  user_name TEXT,
  invite_hash TEXT,
  session_hash TEXT,
  key_name TEXT NOT NULL DEFAULT 'Passkey'
);

CREATE TABLE auth_limits (
  id TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Bir kullanıcının son passkey'i silinemez (kendini dışarıda bırakmasın).
CREATE TRIGGER passkeys_keep_last BEFORE DELETE ON passkeys
WHEN (SELECT COUNT(*) FROM passkeys WHERE user_id = OLD.user_id) <= 1
  AND EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id)
BEGIN
  SELECT RAISE(ABORT, 'last_passkey');
END;
