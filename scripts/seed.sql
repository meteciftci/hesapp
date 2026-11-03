-- Yerel geliştirme için uydurma örnek veri (gerçek kişi, banka ya da tutar içermez).
-- Kullanım: pnpm seed   (önce pnpm db:migrate:local ile şema kurulmuş olmalı)
-- Tekrar çalıştırmak güvenlidir: önceki örnek veriyi silip yeniden üretir.
DELETE FROM audit_log;
DELETE FROM entries;
DELETE FROM plans;
DELETE FROM months;

INSERT INTO plans (id, direction, kind, name, amount, day_of_month, start_month, installment_count, end_month, variable, auto_pay, created_at, updated_at) VALUES
  ('seed-maas-a',  'income',  'recurring',   'Maaş A',              4500000, 5,  strftime('%Y-%m', 'now', 'start of month', '-11 months'), NULL, NULL, 0, 0, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),
  ('seed-maas-b',  'income',  'recurring',   'Maaş B',              3800000, 5,  strftime('%Y-%m', 'now', 'start of month', '-11 months'), NULL, NULL, 0, 0, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),
  ('seed-konut',   'expense', 'installment', 'Örnek Konut Kredisi', 1825040, 15, strftime('%Y-%m', 'now', 'start of month', '-11 months'), 84,   NULL, 0, 1, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),
  ('seed-tasit',   'expense', 'installment', 'Örnek Taşıt Kredisi', 910000,  20, strftime('%Y-%m', 'now', 'start of month', '-5 months'),  36,   NULL, 0, 1, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),
  ('seed-kart',    'expense', 'recurring',   'Örnek Kart',          1200000, 25, strftime('%Y-%m', 'now', 'start of month', '-11 months'), NULL, NULL, 1, 0, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),
  ('seed-elektrik','expense', 'recurring',   'Elektrik',            180000,  10, strftime('%Y-%m', 'now', 'start of month', '-11 months'), NULL, NULL, 1, 1, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000);

-- Taksitli planlar: tüm taksitler; vadesi geçmiş olanlar ödendi.
WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 84),
src(plan_id, name, amount, day, first_offset, total, auto) AS (
  VALUES ('seed-konut', 'Örnek Konut Kredisi', 1825040, 15, -11, 84, 1), ('seed-tasit', 'Örnek Taşıt Kredisi', 910000, 20, -5, 36, 1)
)
INSERT INTO entries (id, month, plan_id, installment_no, type, direction, name, planned_amount, is_estimate, due_date, paid_at, auto_pay, overridden, created_at, updated_at)
SELECT lower(hex(randomblob(16))), m, plan_id, i, 'normal', 'expense', name, amount, 0, m || '-' || printf('%02d', day),
       CASE WHEN m || '-' || printf('%02d', day) < date('now') THEN strftime('%s', 'now') * 1000 END, auto, 0, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000
  FROM (SELECT src.*, n.i, strftime('%Y-%m', 'now', 'start of month', (src.first_offset + n.i - 1) || ' months') AS m FROM src JOIN n ON n.i <= src.total);

-- Tekrarlayan planlar: 11 ay geriden 12 ay ileriye. Değişken olanlar (kart, elektrik) gelecekte "tahmini" doğar.
WITH RECURSIVE n(i) AS (SELECT -11 UNION ALL SELECT i + 1 FROM n WHERE i < 12),
src(plan_id, name, direction, amount, day, variable, auto) AS (
  VALUES ('seed-maas-a', 'Maaş A', 'income', 4500000, 5, 0, 0), ('seed-maas-b', 'Maaş B', 'income', 3800000, 5, 0, 0),
         ('seed-kart', 'Örnek Kart', 'expense', 1200000, 25, 1, 0), ('seed-elektrik', 'Elektrik', 'expense', 180000, 10, 1, 1)
)
INSERT INTO entries (id, month, plan_id, installment_no, type, direction, name, planned_amount, is_estimate, due_date, paid_at, auto_pay, overridden, created_at, updated_at)
SELECT lower(hex(randomblob(16))), m, plan_id, NULL, 'normal', direction, name, amount, CASE WHEN variable = 1 AND due >= date('now') THEN 1 ELSE 0 END, due,
       CASE WHEN due < date('now') THEN strftime('%s', 'now') * 1000 END, auto, 0, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000
  FROM (SELECT src.*, strftime('%Y-%m', 'now', 'start of month', n.i || ' months') AS m, strftime('%Y-%m', 'now', 'start of month', n.i || ' months') || '-' || printf('%02d', src.day) AS due FROM src JOIN n);

-- Başlangıç bakiyesi: ilk örnek ayın başında.
INSERT INTO months (month, status, anchor_balance) VALUES (strftime('%Y-%m', 'now', 'start of month', '-11 months'), 'open', 2500000);
