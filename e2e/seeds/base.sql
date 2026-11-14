-- Minimum state for Dave's Dev Deck: server config (what `Wolf.setup` would write) and David as
-- a super user. Idempotent. Run automatically by `e2e db reset`.
-- Prefix 'e' / name 'E2E' keep harness games ("E2E Game N", e1-townsquare) apart from the prod-tracked
-- "Test Game 1" / t1-* channels on the same server, so `e2e cleanup` can target them safely.

INSERT INTO server_configs (server_id, game_prefix, game_counter, game_name, server_name)
VALUES ('1399411876550676531', 'e', 1, 'E2E', 'Dave''s Dev Deck')
ON CONFLICT (server_id) DO NOTHING;

INSERT INTO super_users (user_id)
SELECT '162675596772638720'
WHERE NOT EXISTS (SELECT 1 FROM super_users WHERE user_id = '162675596772638720');

-- The banned_users migration seeds David as banned, which blocks every Wolf.in test.
DELETE FROM banned_users WHERE user_id = '162675596772638720';
