-- Kişiye isteğe bağlı iletişim e-postası (yalnızca bilgi amaçlı; giriş passkey ile yapılır).
ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE auth_invites ADD COLUMN email TEXT;
