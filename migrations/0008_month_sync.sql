-- Ay içi bakiye eşitleme: "Kayıt dışı harcamalar" kaydı ay kapanmadan da güncellenebilir. Kapanış bu kaydı
-- günceller; kapanıştan önceki (eşitlemeyle oluşmuş) değer burada saklanır ve ay yeniden açılınca geri yüklenir.
-- NULL: eski kapanış (kayıt silinir), 0: kapanıştan önce kayıt yoktu.
ALTER TABLE months ADD COLUMN recon_before INTEGER;
