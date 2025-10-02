-- Migration: refresh-spotlight
-- Created: 2025-10-02T17:42:35.248Z

-- First, set role_id to NULL for any players that have spotlight roles
-- This prevents foreign key constraint violations
UPDATE players 
SET role_id = NULL 
WHERE role_id IN (
    SELECT id FROM roles WHERE is_spotlight = TRUE
);

-- Also remove any game_role entries that reference spotlight roles
-- This prevents foreign key constraint violations on the game_role table
DELETE FROM game_role 
WHERE role_id IN (
    SELECT id FROM roles WHERE is_spotlight = TRUE
);

-- Now we can safely delete the spotlight roles
DELETE FROM roles WHERE is_spotlight = TRUE;

INSERT INTO roles (name, targets, moves, description, standard_results_flavor, immunities, special_properties, framer_interaction, team, in_wolf_chat, is_spotlight, has_charges, default_charges, has_win_by_number, default_win_by_number)
VALUES
  (
    'Mimic',
    'Players',
    TRUE,
    'At night, the Mimic may choose to visit another player to attempt to copy their night action. If the Mimic visits a town-aligned player with a night action, they may then perform that night action on subsequent nights. Visiting a non-town-aligned player or a player with no night action will return Failed. The Mimic may choose to attempt to copy another player’s night action instead of performing the night action they previously received. If successful, they replace their available night action with the newly copied one.',
    NULL,
    NULL,
    NULL,
    'Visiting a framed player to attempt to copy their night action will return Failed regardless of the player’s role.',
    'town',
    FALSE,
    TRUE,
    FALSE,
    0,
    FALSE,
    0
  );

INSERT INTO roles (name, targets, moves, description, standard_results_flavor, immunities, special_properties, framer_interaction, team, in_wolf_chat, is_spotlight, has_charges, default_charges, has_win_by_number, default_win_by_number)
VALUES
  (
    'Oopy Scoopy Ice Cream Man',
    'Players',
    TRUE,
    'Each night the Oopy Scoopy Ice Cream Man (OSICM) visits a player, who then orders an ice cream based on whether or not they have a night action. If the player does not have a night action, they order Vanilla. If they do have a night action, they order Chocolate.',
    NULL,
    NULL,
    NULL,
    'If the OSICM visits a framed player, they order any other scoopable frozen dessert at mod discretion. (e.g. Strawberry, Rocky Road, Mango sorbet, Stracciatella gelato, pistachio Froyo, dairy-free dulce de leche)',
    'town',
    FALSE,
    TRUE,
    FALSE,
    0,
    FALSE,
    0
  );

INSERT INTO roles (name, targets, moves, description, standard_results_flavor, immunities, special_properties, framer_interaction, team, in_wolf_chat, is_spotlight, has_charges, default_charges, has_win_by_number, default_win_by_number)
VALUES
  (
    'Aloha Wolf',
    'Players',
    TRUE,
    'The Aloha Wolf could have been Alpha if not for their obsession of everything Hawaiian. Despite his desire to celebrate every day as if it was Hawaiian day, he still has the urge to kill. Every night, the Aloha Wolf hands out a bloody lay to mark that player for death. Once three players have a bloody lay, the Aloha Wolf can initiate a hula dance. The three players with lays will dance until they die.',
    'The victims are decapitated with their heads and the bloody lay as the only parts of them found.',
    NULL,
    'The dance begins at the same point as Arson Lighting, so players with a bloody lay cannot perform any night actions. A doctor with a bloody lay will not be able to heal themselves, but they can heal other players with a bloody lay the night the dance begins.',
    NULL,
    'wolf',
    TRUE,
    TRUE,
    FALSE,
    0,
    FALSE,
    0
  );

INSERT INTO roles (name, targets, moves, description, standard_results_flavor, immunities, special_properties, framer_interaction, team, in_wolf_chat, is_spotlight, has_charges, default_charges, has_win_by_number, default_win_by_number)
VALUES
  (
    'Virtuoso Wolf',
    'Varies (in accordance with used ability)',
    TRUE,
    'The Virtuoso Wolf operates as a Wolf-Aligned Jack of All Trades variant with three charges: a killing charge, an info charge, and a misc charge. They can use a charge to mimic the ability of another wolf role that falls into that charges category (possible roles per category listed below). However, they may only use each type of charge once.  KILLING: Stalker, Glutton, Hypno INFO: Clairvoyant, Bloodhound, Lurker MISC: Consort, Lone Wolf, Framer',
    NULL,
    NULL,
    'The Virtuoso does not expend a charge if they fail on any of their actions.',
    NULL,
    'wolf',
    TRUE,
    TRUE,
    FALSE,
    0,
    FALSE,
    0
  );

INSERT INTO roles (name, targets, moves, description, standard_results_flavor, immunities, special_properties, framer_interaction, team, in_wolf_chat, is_spotlight, has_charges, default_charges, has_win_by_number, default_win_by_number)
VALUES
  (
    'Parasite',
    'Players',
    TRUE,
    'The Parasite is a neutral conversion role. As a night action, the player may submit a player in their journal. The following day, that player becomes the Parasite''s Host. A duo chat will be made between Parasite and Host, and the Parasite gains the chosen players alignment and win condition. After gaining a host, the Parasite becomes untargetable at home (UTAH). If the Host dies for any reason, the Parasite also dies with them.',
    NULL,
    NULL,
    'The parasite may not choose a host on the first night of the game.',
    NULL,
    'neutral',
    FALSE,
    TRUE,
    FALSE,
    0,
    FALSE,
    0
  );

INSERT INTO roles (name, targets, moves, description, standard_results_flavor, immunities, special_properties, framer_interaction, team, in_wolf_chat, is_spotlight, has_charges, default_charges, has_win_by_number, default_win_by_number)
VALUES
  (
    'The Whisperer',
    'Players',
    TRUE,
    'Each night, the Whisperer will occupy/roleblock everyone targeting their target, except those attacking or converting their target. The Whisperer needs to successfully occupy/roleblock (X) times to win and will leave the town after winning.',
    NULL,
    'Alpha Kills',
    'All standard Escort/Consort rules apply to The Whisperer.',
    NULL,
    'neutral',
    FALSE,
    TRUE,
    FALSE,
    0,
    TRUE,
    3
  );