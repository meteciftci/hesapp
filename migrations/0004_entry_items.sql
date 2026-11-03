-- Gider kalemleri: bir giderin (ör. kart ekstresi) içindeki harcamalar. İsteğe bağlıdır;
-- kaydın tutarı yine ekstre toplamıdır, kalemler ay toplamına ayrıca eklenmez (plan, bölüm 14.2).
CREATE TABLE entry_items (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES entries(id),
  name TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount >= 0),
  date TEXT,
  installment_no INTEGER CHECK (installment_no IS NULL OR installment_no >= 1),
  installment_count INTEGER CHECK (installment_count IS NULL OR installment_count >= 1),
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX entry_items_entry_idx ON entry_items(entry_id);
