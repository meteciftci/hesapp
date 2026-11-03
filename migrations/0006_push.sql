-- Vade bildirimi abonelikleri (plan, bölüm 14.7): cihaz başına bir satır.
CREATE TABLE push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  user_id TEXT,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_sent_at INTEGER,
  last_status INTEGER
);
