-- Switch the shared ledger to two equal members without changing broker funds.
-- Current balances are redistributed equally following the agreed 50/50 ownership.
BEGIN;

INSERT INTO members (slug, display_name, capital) VALUES
  ('micky', 'Micky', 0),
  ('doc', 'Doc', 0)
ON CONFLICT (slug) DO UPDATE SET display_name = EXCLUDED.display_name;

WITH total AS (
  SELECT COALESCE(SUM(capital), 0) AS capital_total FROM members
)
UPDATE members
SET capital = (SELECT capital_total / 2 FROM total)
WHERE slug IN ('micky', 'doc');

DELETE FROM sessions WHERE member_slug NOT IN ('micky', 'doc');
DELETE FROM members WHERE slug NOT IN ('micky', 'doc');

COMMIT;
