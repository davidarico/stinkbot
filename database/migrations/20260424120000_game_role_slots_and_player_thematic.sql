-- Per-slot game roles (duplicate mechanical roles can have different themed names)
-- and per-player themed display name set at assignment.

ALTER TABLE players ADD COLUMN IF NOT EXISTS thematic_custom_name VARCHAR(255);

-- Copy legacy flavor from the old single row per (game_id, role_id) before we reshape game_role.
UPDATE players p
SET thematic_custom_name = gr.custom_name
FROM game_role gr
WHERE p.game_id = gr.game_id
  AND p.role_id = gr.role_id
  AND p.role_id IS NOT NULL
  AND gr.custom_name IS NOT NULL
  AND TRIM(gr.custom_name) <> ''
  AND (p.thematic_custom_name IS NULL OR TRIM(p.thematic_custom_name) = '');

CREATE TABLE game_role_new (
    id SERIAL PRIMARY KEY,
    game_id INTEGER NOT NULL,
    sort_index INTEGER NOT NULL,
    role_id INTEGER NOT NULL,
    custom_name TEXT,
    charges INTEGER NOT NULL DEFAULT 0,
    win_by_number INTEGER NOT NULL DEFAULT 0,
    UNIQUE (game_id, sort_index)
);

INSERT INTO game_role_new (game_id, sort_index, role_id, custom_name, charges, win_by_number)
SELECT z.game_id,
       ROW_NUMBER() OVER (PARTITION BY z.game_id ORDER BY z.role_id, z.n) - 1 AS sort_index,
       z.role_id,
       z.custom_name,
       z.charges,
       z.win_by_number
FROM (
    SELECT gr.game_id,
           gr.role_id,
           gr.custom_name,
           COALESCE(gr.charges, 0) AS charges,
           COALESCE(gr.win_by_number, 0) AS win_by_number,
           gs.i AS n
    FROM game_role gr
    INNER JOIN LATERAL generate_series(1, GREATEST(COALESCE(gr.role_count, 1), 1)) AS gs(i) ON TRUE
) z;

DROP TABLE game_role;
ALTER TABLE game_role_new RENAME TO game_role;

CREATE INDEX IF NOT EXISTS idx_game_role_game_id ON game_role (game_id);
