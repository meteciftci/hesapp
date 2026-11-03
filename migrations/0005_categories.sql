-- Kategoriler (plan, bölüm 14.4). Hazır liste gelir; Ayarlar'dan eklenir, adı değiştirilir, silinir.
-- Silinen kategori yumuşak silinir, kayıtları kategorisiz kalır.
CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'both' CHECK (direction IN ('income', 'expense', 'both')),
  sort INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);

INSERT INTO categories (id, name, direction, sort, created_at) VALUES
  ('cat-market', 'Market', 'expense', 10, 0),
  ('cat-fatura', 'Faturalar', 'expense', 20, 0),
  ('cat-konut', 'Kira ve aidat', 'expense', 30, 0),
  ('cat-kredi', 'Kredi', 'expense', 40, 0),
  ('cat-kart', 'Kredi kartı', 'expense', 50, 0),
  ('cat-ulasim', 'Ulaşım ve yakıt', 'expense', 60, 0),
  ('cat-saglik', 'Sağlık', 'expense', 70, 0),
  ('cat-egitim', 'Eğitim', 'expense', 80, 0),
  ('cat-giyim', 'Giyim', 'expense', 90, 0),
  ('cat-ev', 'Ev', 'expense', 100, 0),
  ('cat-eglence', 'Eğlence ve dışarıda yemek', 'expense', 110, 0),
  ('cat-maas', 'Maaş', 'income', 200, 0),
  ('cat-kira-geliri', 'Kira geliri', 'income', 210, 0),
  ('cat-diger', 'Diğer', 'both', 900, 0);

ALTER TABLE entries ADD COLUMN category_id TEXT REFERENCES categories(id);
ALTER TABLE plans ADD COLUMN category_id TEXT REFERENCES categories(id);
CREATE INDEX entries_category_idx ON entries(category_id);
