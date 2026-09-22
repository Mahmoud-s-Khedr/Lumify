-- The original weekly uniqueness rule was an index (not a table constraint),
-- so remove it on already-deployed databases as well.
DROP INDEX IF EXISTS "round_schedules_round_id_weekday_key";
