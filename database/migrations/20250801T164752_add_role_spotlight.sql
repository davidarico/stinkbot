-- Migration: add role spotlight
-- Created: 2025-08-01T16:47:52.824Z

-- Add your migration SQL here
-- Example:
-- CREATE TABLE example (
--     id SERIAL PRIMARY KEY,
--     name VARCHAR(255) NOT NULL
-- );
ALTER TABLE roles
ADD COLUMN is_spotlight BOOLEAN DEFAULT FALSE;

INSERT INTO roles (name, targets, moves, description, standard_results_flavor, immunities, special_properties, framer_interaction, team, in_wolf_chat, is_spotlight)
VALUES
  (
    'Aurasmith',
    'Players',
    TRUE,
    'The Aurasmith spends the night either making a crystal ball or delivering it to another player. The Aurasmith starts the game with a crystal ball; a player holding the crystal ball does not move. Crystal balls have one use and replace the user''s night action. The crystal ball allows its holder to choose a target and learn whether that player is TOWN or NOT TOWN.',
    NULL,
    NULL,
    'All crystal balls have one use and operate as the user''s night action.',
    'Framed players are seen as NOT TOWN, including neutrals.',
    'town',
    FALSE,
    TRUE
  );

INSERT INTO roles (name, targets, moves, description, standard_results_flavor, immunities, special_properties, framer_interaction, team, in_wolf_chat, is_spotlight)
VALUES
  (
    'Tracker',
    'Players',
    TRUE,
    'At night, the Tracker places a tracker on a player without their knowledge. Each morning thereafter the Tracker is informed of that player''s movements (similar to Lookout). Removing and placing a tracker each take one night. If a tracked player is killed, the Tracker still receives that night''s movement info and may place a new tracker the following night.',
    NULL,
    NULL,
    'The Tracker may remove and re-place the tracker at any point during the night.',
    'A tracked player who is framed will be seen traveling to the site of the Alpha target for each night they are framed.',
    'town',
    FALSE,
    TRUE
  );

INSERT INTO roles (name, targets, moves, description, standard_results_flavor, immunities, special_properties, framer_interaction, team, in_wolf_chat, is_spotlight)
VALUES
  (
    'Myrmidon',
    'Houses',
    TRUE,
    'On three nights, the Myrmidon can wait outside a player''s house. If the house receives at least one visitor, one visitor is eaten whole, leaving only their shoes in town square.',
    'Victim''s shoes will be found in Townsquare.',
    NULL,
    'The Myrmidon favors visitors in this order: Killing Roles > Protection Roles > Info Roles > All Other Roles. Once per game they may post outside their own house. When multiple roles of the same classification appear, the first in order of operations is consumed.',
    NULL,
    'wolf',
    TRUE,
    TRUE
  );

INSERT INTO roles (name, targets, moves, description, standard_results_flavor, immunities, special_properties, framer_interaction, team, in_wolf_chat, is_spotlight)
VALUES
  (
    'Wolf Pup',
    'Players',
    TRUE,
    'The Wolf Pup is a wolf not in wolf chat. Each night they travel to a player''s house seeking a wolf. Once they visit a wolf, they are told that player is a wolf. When the Pup is the last remaining wolf, they join wolf chat and become the Alpha Wolf.',
    NULL,
    NULL,
    'Does not receive wolf names at game start. Wolves know a Pup exists but not who. Upon finding a wolf, the Pup learns their identity and later becomes Alpha if the last wolf.',
    NULL,
    'wolf',
    FALSE,
    TRUE
  );

INSERT INTO roles (name, targets, moves, description, standard_results_flavor, immunities, special_properties, framer_interaction, team, in_wolf_chat, is_spotlight)
VALUES
  (
    'Housekeeper',
    'Houses',
    TRUE,
    'Each night the Housekeeper chooses a player whose home they think will have a kill. If correct, the Housekeeper cleans the home, removing all kill flavor. The Housekeeper wins after cleaning a set number of homes (typically two).',
    'Victims are found dead with no evidence as to how they died.',
    'None',
    'Cannot clean scenes at someone else''s home, in town square, or if the victim is missing. A body must exist in the targeted house. Cleans both the homeowner''s and any rampaged player''s kill flavor if rampage occurs in the visited home.',
    'The Housekeeper is permanently framed and follows regular framer rules.',
    'neutral',
    FALSE,
    TRUE
  );