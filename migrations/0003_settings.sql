-- Hane ayarları (anahtar/değer). Şimdilik: period_start_day (bütçe döneminin başladığı gün, 1–28).
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Değişiklik geçmişi artık ayarları da kapsar: entity kısıtına 'settings' eklenir (SQLite'ta kısıt değişmediği için tablo yeniden kurulur).
CREATE TABLE audit_log_new (
  id TEXT PRIMARY KEY,
  entity TEXT NOT NULL CHECK (entity IN ('plan', 'entry', 'month', 'settings')),
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  user_id TEXT,
  at INTEGER NOT NULL
);
INSERT INTO audit_log_new (id, entity, entity_id, action, before_json, after_json, user_id, at)
  SELECT id, entity, entity_id, action, before_json, after_json, user_id, at FROM audit_log;
DROP TABLE audit_log;
ALTER TABLE audit_log_new RENAME TO audit_log;
CREATE INDEX audit_entity_idx ON audit_log(entity, entity_id, at);
