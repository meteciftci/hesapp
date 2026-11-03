-- Bütçe: planlar (tekrar eden tanımlar), kayıtlar (aylık satırlar), ay durumu ve değişiklik geçmişi.
-- Para tutarları kuruş cinsinden tam sayıdır. Ay: 'YYYY-AA', tarih: 'YYYY-AA-GG', zaman: ms.
-- created_by/updated_by/user_id: kullanıcı kimliği (bilerek yabancı anahtar yok; kişi çıkarılsa da kayıtlar kalır).

CREATE TABLE plans (
  id TEXT PRIMARY KEY,
  direction TEXT NOT NULL CHECK (direction IN ('income', 'expense')),
  kind TEXT NOT NULL CHECK (kind IN ('recurring', 'installment')),
  name TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount >= 0),
  day_of_month INTEGER NOT NULL CHECK (day_of_month BETWEEN 1 AND 31),
  start_month TEXT NOT NULL,
  installment_count INTEGER CHECK (installment_count IS NULL OR installment_count BETWEEN 1 AND 600),
  end_month TEXT,
  variable INTEGER NOT NULL DEFAULT 0,
  auto_pay INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  closed_at INTEGER,
  created_by TEXT,
  updated_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  CHECK ((kind = 'installment') = (installment_count IS NOT NULL))
);

CREATE TABLE entries (
  id TEXT PRIMARY KEY,
  month TEXT NOT NULL,
  plan_id TEXT REFERENCES plans(id),
  installment_no INTEGER,
  type TEXT NOT NULL DEFAULT 'normal' CHECK (type IN ('normal', 'reconciliation')),
  direction TEXT NOT NULL CHECK (direction IN ('income', 'expense')),
  name TEXT NOT NULL,
  planned_amount INTEGER NOT NULL CHECK (planned_amount >= 0),
  actual_amount INTEGER CHECK (actual_amount IS NULL OR actual_amount >= 0),
  is_estimate INTEGER NOT NULL DEFAULT 0,
  due_date TEXT,
  paid_at INTEGER,
  auto_pay INTEGER NOT NULL DEFAULT 0,
  overridden INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_by TEXT,
  updated_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX entries_month_idx ON entries(month);
CREATE INDEX entries_due_idx ON entries(due_date);
-- Bir plan bir ayda en fazla bir kayıt üretir. Silinen kayıt (mezar taşı) yeniden üretimi engeller.
CREATE UNIQUE INDEX entries_plan_month_uq ON entries(plan_id, month) WHERE plan_id IS NOT NULL;

-- Satırı olan ay: kapatılmış ay ya da başlangıç bakiyesi (anchor) girilmiş ay.
CREATE TABLE months (
  month TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  anchor_balance INTEGER,
  opening_balance INTEGER,
  closing_balance INTEGER,
  closed_at INTEGER,
  closed_by TEXT
);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  entity TEXT NOT NULL CHECK (entity IN ('plan', 'entry', 'month')),
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  user_id TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX audit_entity_idx ON audit_log(entity, entity_id, at);
