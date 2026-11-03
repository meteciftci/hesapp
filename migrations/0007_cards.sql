-- Kredi kartı tanımı: tutarı her ay değişen (ekstre) tekrarlayan gider planı. Kartı belli eden işaret;
-- arayüz "Ekstre gir" ve "Kartı iptal et" gösterir (bkz. plan, bölüm 14.8).
ALTER TABLE plans ADD COLUMN is_card INTEGER NOT NULL DEFAULT 0;
