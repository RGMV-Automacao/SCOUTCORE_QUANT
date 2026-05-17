-- 014_prediction_actual_value.sql
-- Adiciona coluna `actual_value` em `prediction` para persistir o valor
-- numérico real apurado pelo settler (ex.: 11 chutes, 3 gols, 2 cartões).
--
-- Permite que UI mostre lado-a-lado "predito over 10.5 · real 11 → ✓".
-- Apenas mercados do catálogo ativo (over/under, escanteios_race, defesas,
-- chutes, chutes_alvo, faltas, impedimentos, cartões, gols) preenchem este
-- campo. Mercados binários (btts, 1x2, dupla, htft, asian_handicap) podem
-- deixar NULL — a UI cai para o `result` puro.

ALTER TABLE prediction ADD COLUMN actual_value REAL;
