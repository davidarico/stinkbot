INSERT INTO roles (name, targets, moves, description, standard_results_flavor, immunities, special_properties, framer_interaction, team, in_wolf_chat)
VALUES
  (
    'Bartender',
    'Players',
    TRUE,
    'Each night, the Bartender visits one player and receives three roles that were in the game at the beginning: the targeted player''s true role and two lies. One role is town, one is wolf, and the final role is town or neutral.',
    NULL,
    NULL,
    'Roles that cannot be targeted (such as Sleepwalker or Orphan) and roles that replace others in info (such as Heir or Rivals) cannot appear in Bartender information. The Bartender fails if the target is untargetable at home. If revisiting a player, information is rerandomized.',
    'If the Bartender''s target is framed, the Bartender will receive three lies.',
    'town',
    FALSE
  );

INSERT INTO roles (name, targets, moves, description, standard_results_flavor, immunities, special_properties, framer_interaction, team, in_wolf_chat)
VALUES
  (
    'Couple',
    'N/A',
    FALSE,
    'The Couple can communicate privately with other couple members at night via couple chat. The Couple starts with two members; conversion roles join the chat when they become part of the Couple.',
    NULL,
    NULL,
    'The Couple has access to a private chat at night. Conversion roles who join the Couple gain access to couple chat.',
    NULL,
    'town',
    FALSE
  );

INSERT INTO roles (name, targets, moves, description, standard_results_flavor, immunities, special_properties, framer_interaction, team, in_wolf_chat)
VALUES
  (
    'Doctor',
    'Players',
    TRUE,
    'Each night, the Doctor may heal one player from any death, ensuring their survival to the next day, including untargetable-at-home roles.',
    'Bandages',
    NULL,
    'The Doctor may target themselves.',
    NULL,
    'town',
    FALSE
  );

INSERT INTO roles (name, targets, moves, description, standard_results_flavor, immunities, special_properties, framer_interaction, team, in_wolf_chat)
VALUES
  (
    'Escort',
    'Players',
    TRUE,
    'Each night, the Escort may visit a player, preventing a moving role from performing their action on them that night.',
    NULL,
    NULL,
    'The Escort is rampageable. They die if they visit a Serial Killer or Murderer; in that case, the killer''s flavor appears in town square and the kill fails. The Escort fails if the target is untargetable at home.',
    NULL,
    'town',
    FALSE
  );

INSERT INTO roles (name, targets, moves, description, standard_results_flavor, immunities, special_properties, framer_interaction, team, in_wolf_chat)
VALUES
  (
    'Gravedigger',
    'Dead players',
    TRUE,
    'Each night, the Gravedigger may visit the graveyard and learn the role of a player who has already died.',
    NULL,
    NULL,
    'Cannot act without a dead player in the graveyard. Cannot target a disappeared player.',
    'If the Gravedigger''s target was framed, they will appear as a random wolf role in the game.',
    'town',
    FALSE
  );

INSERT INTO roles (name, targets, moves, description, standard_results_flavor, immunities, special_properties, framer_interaction, team, in_wolf_chat)
VALUES
  (
    'Hunter',
    'Players',
    TRUE,
    'The Hunter may shoot and kill any other player a set number of times (typically three).',
    'Successful Hunter targets will show as being shot.',
    NULL,
    'Cannot shoot on the first game night. If a shot results in multiple deaths, only one bullet is expended. Failed shots do not expend bullets. The Hunter fails if the target is untargetable at home. The Hunter wins any 1-on-1 tie against a wolf.',
    NULL,
    'town',
    FALSE
  );

INSERT INTO roles (name, targets, moves, description, standard_results_flavor, immunities, special_properties, framer_interaction, team, in_wolf_chat)
VALUES
  (
    'Jailkeeper',
    'Players',
    TRUE,
    'Each night, the Jailkeeper may put a player in jail, preventing actions and protecting them from moving roles.',
    NULL,
    NULL,
    'A jailed player may still be framed.',
    'A jailed player may still be framed.',
    'town',
    FALSE
  );

INSERT INTO roles (name, targets, moves, description, standard_results_flavor, immunities, special_properties, framer_interaction, team, in_wolf_chat)
VALUES
  (
    'Knight',
    'N/A',
    FALSE,
    'The Knight has two lives represented by a suit of armor.',
    'Following the first death, a loss of armor is revealed by the moderator.',
    NULL,
    'The Knight dies if attacked twice in one night but remains revealed as the Knight.',
    NULL,
    'town',
    FALSE
  );

INSERT INTO roles (name, targets, moves, description, standard_results_flavor, immunities, special_properties, framer_interaction, team, in_wolf_chat)
VALUES
  (
    'Locksmith',
    'Houses',
    TRUE,
    'Every other night, the Locksmith may lock a player''s house, preventing moving roles from acting and protecting against moving player targets.',
    NULL,
    NULL,
    'Lock creation is a passive action that cannot be blocked. The Locksmith starts the game with a lock. They die if they travel to a Serial Killer or Murderer; their body appears in town square and the kill fails.',
    'A locked player may not be framed. If a locked player is targeted, the Framer will receive ''Failed''.',
    'town',
    FALSE
  );

INSERT INTO roles (name, targets, moves, description, standard_results_flavor, immunities, special_properties, framer_interaction, team, in_wolf_chat)
VALUES
  (
    'Lookout',
    'Players',
    FALSE,
    'Every night, the Lookout tracks a player''s movements, seeing which house they visited but not if they returned.',
    NULL,
    NULL,
    'Sees players traveling to jail or the graveyard. Only one destination per target is shown.',
    'The Lookout will see their target travel to the alpha target, even if no such kill appears in results.',
    'town',
    FALSE
  );

INSERT INTO roles (name, targets, moves, description, standard_results_flavor, immunities, special_properties, framer_interaction, team, in_wolf_chat)
VALUES
  (
    'Matchmaker',
    'Players',
    TRUE,
    'Each night, the Matchmaker selects two other players and learns ''MATCH'' if both share the same alignment or ''NO MATCH'' otherwise.',
    NULL,
    NULL,
    'Travels only to the first target. Fails if the first target is untargetable at home.',
    'If either target is framed, the Matchmaker will receive opposite of normal results.',
    'town',
    FALSE
  );

INSERT INTO roles (name, targets, moves, description, standard_results_flavor, immunities, special_properties, framer_interaction, team, in_wolf_chat)
VALUES
  (
    'Mayor',
    'N/A',
    FALSE,
    'Once per game, the Mayor can pardon a player about to be hanged, shifting the hang to the next highest vote, and can stuff ballots by adding two votes to their current vote.',
    'Pardon: announcement of pardon if the pardoned player is hanged, identity not revealed. Ballot stuff: identity revealed if decisive.',
    NULL,
    'Both actions are day actions and irrevocable once announced. The Mayor cannot pardon someone they stuffed or vice versa. Extra ballots do not count if the Mayor changes their vote.',
    NULL,
    'town',
    FALSE
  );

INSERT INTO roles (name, targets, moves, description, standard_results_flavor, immunities, special_properties, framer_interaction, team, in_wolf_chat)
VALUES
  (
    'Patrolman',
    'Houses',
    TRUE,
    'Each night, the Patrolman travels to a player''s house and sees all players entering or leaving. If a kill is attempted there, the Patrolman kills the killer and dies, saving all potential targets.',
    'Patrolman shows as both killer and Patrolman having died in a fight in the target''s front yard.',
    NULL,
    'Patrolman kills the killer even if it is a Serial Killer. Their kills cannot be healed by the Doctor.',
    'If the Patrolman''s target is framed, their target will appear to do the opposite action (movers shown as not moving and vice versa).',
    'town',
    FALSE
  );

INSERT INTO roles (name, targets, moves, description, standard_results_flavor, immunities, special_properties, framer_interaction, team, in_wolf_chat)
VALUES
  (
    'Seer',
    'Players',
    FALSE,
    'Every night, the Seer selects a player and receives their role.',
    NULL,
    NULL,
    'The only role to receive information if jailed.',
    'The Seer will receive a random role from any wolf role in the game.',
    'town',
    FALSE
  );

INSERT INTO roles (
  name, targets, moves, description,
  standard_results_flavor, immunities, special_properties,
  framer_interaction,   -- now we’ll give it a value
  team, in_wolf_chat
)
VALUES (
  'Sleepwalker',
  'N/A',
  TRUE,
  'Each night, the Sleepwalker selects two players to avoid and wanders to any other house besides their own and the avoided players.',
  'If the house they wander to is attacked, the Sleepwalker dies from the same attack, even if the target survives.',
  'Immune to attacks and information gathering from all moving roles that target players except for Stalker (untargetable at home).',
  'Players who target the Sleepwalker will receive ''FAILED''.',
  NULL,   -- ← placeholder for framer_interaction
  'town',
  FALSE
);


INSERT INTO roles (name, targets, moves, description, standard_results_flavor, immunities, special_properties, framer_interaction, team, in_wolf_chat)
VALUES
  (
    'Veteran',
    'N/A',
    FALSE,
    'A set number of times per game (typically three), the Veteran can go on ALERT to kill all moving roles that visit them that night.',
    'Victims vanish without a trace.',
    NULL,
    'Roles targeting the house are not killed. Multiple kills in one night expend only one alert. Veteran kills cannot be healed by the Doctor.',
    NULL,
    'town',
    FALSE
  );

INSERT INTO roles (name, targets, moves, description, standard_results_flavor, immunities, special_properties, framer_interaction, team, in_wolf_chat)
VALUES
  (
    'Villager',
    'N/A',
    FALSE,
    'The Villager has no special powers.',
    NULL,
    NULL,
    NULL,
    NULL,
    'town',
    FALSE
  );

INSERT INTO roles (name, targets, moves, description, standard_results_flavor, immunities, special_properties, framer_interaction, team, in_wolf_chat)
VALUES
  (
    'Alpha',
    'Players',
    TRUE,
    'Each night, the Alpha Wolf travels to a player''s home and kills them.',
    'Victims will be found dead with blood and fur near the body.',
    NULL,
    'If there is a dispute among the wolves over who to kill, the Alpha Wolf has the final say. If the Alpha Wolf dies, the Heir becomes the new Alpha Wolf (if in game), otherwise a new Alpha Wolf will be chosen by the wolves from among the alive vanilla wolves. If no vanilla wolf is alive, the wolves must choose a new Alpha from any living wolf in wolf chat. This player loses any prior role and abilities as their new role is Alpha Wolf. Info roles will see this player as the Alpha Wolf from then on. The Alpha Wolf will fail if they attempt to target an untargetable at home role. The Alpha Wolf may choose the same target twice in a row for their night action.',
    NULL,
    'wolf',
    TRUE
  );

INSERT INTO roles (name, targets, moves, description, standard_results_flavor, immunities, special_properties, framer_interaction, team, in_wolf_chat)
VALUES
  (
    'Bloodhound',
    'Houses',
    TRUE,
    'Each night, the Bloodhound chooses a role to search for among the town. The Bloodhound returns three names of alive players: one with that role and two random others.',
    NULL,
    NULL,
    'If the Bloodhound searches for a role not alive or not in the game, they receive a failure result. If multiple players have the role, one is chosen at random. Results rerandomize on repeated searches. The Bloodhound may not search for Villager.',
    NULL,
    'wolf',
    TRUE
  );

INSERT INTO roles (name, targets, moves, description, standard_results_flavor, immunities, special_properties, framer_interaction, team, in_wolf_chat)
VALUES
  (
    'Clairvoyant',
    'Homes',
    TRUE,
    'Each night, the Clairvoyant selects a player and receives their role.',
    NULL,
    NULL,
    'The Clairvoyant will fail if their target is untargetable at home.',
    NULL,
    'wolf',
    TRUE
  );

INSERT INTO roles (name, targets, moves, description, standard_results_flavor, immunities, special_properties, framer_interaction, team, in_wolf_chat)
VALUES
  (
    'Consort',
    'Players',
    TRUE,
    'Each night, the Consort visits a player, preventing a moving role on that night from leaving their home and performing their action.',
    NULL,
    NULL,
    'The Consort is non-rampageable. The Consort dies if they visit a Serial Killer or Murderer; in that case, the body appears in town square with the neutral killer''s flavor and the kill fails. The Consort will fail if their target is untargetable at home.',
    NULL,
    'wolf',
    TRUE
  );

INSERT INTO roles (name, targets, moves, description, standard_results_flavor, immunities, special_properties, framer_interaction, team, in_wolf_chat)
VALUES
  (
    'Framer',
    'Houses',
    TRUE,
    'Each night, the Framer travels to a player''s home and frames them to appear as a wolf to non-wolf info roles. This frame lasts two nights, starting the night it is applied.',
    NULL,
    NULL,
    'How info roles view a frame varies by role. If a framed player dies, the frame still lasts the full two nights.',
    NULL,
    'wolf',
    TRUE
  );

INSERT INTO roles (name, targets, moves, description, standard_results_flavor, immunities, special_properties, framer_interaction, team, in_wolf_chat)
VALUES
  (
    'Glutton',
    'Players',
    TRUE,
    'Once a night, the Glutton travels to a player''s home to eat them whole. The Glutton has a set number of charges that are burned if the attempt succeeds or fails, but not if blocked.',
    'Victims vanish without a trace. Doctor heals show as a player found covered in saliva but alive.',
    NULL,
    'If the target does not leave home, the Glutton consumes them. If the target moves, the attempt fails. The Glutton may not target a player that another wolf chat member is targeting.',
    NULL,
    'wolf',
    TRUE
  );

INSERT INTO roles (name, targets, moves, description, standard_results_flavor, immunities, special_properties, framer_interaction, team, in_wolf_chat)
VALUES
  (
    'Hypnotist',
    'Players',
    TRUE,
    'Once a night, the Hypnotist travels to a player''s home to hypnotize them. That target then involuntarily kills anyone they visit the following night.',
    'A player killed by a hypnotized player will be strangled to death. A hypnotized player wakes up Dizzy the next morning.',
    NULL,
    'If a hypnotized player visits any wolf role, the hypnosis is canceled and they complete their action normally, without waking up Dizzy.',
    NULL,
    'wolf',
    TRUE
  );

INSERT INTO roles (name, targets, moves, description, standard_results_flavor, immunities, special_properties, framer_interaction, team, in_wolf_chat)
VALUES
  (
    'Lone Wolf',
    'Players',
    TRUE,
    'Each night, the Lone Wolf travels to a player''s home. They cannot be targeted at home.',
    NULL,
    NULL,
    'The Lone Wolf cannot become Alpha until they are the final wolf remaining. The Lone Wolf is rampageable.',
    NULL,
    'wolf',
    TRUE
  );

INSERT INTO roles (name, targets, moves, description, standard_results_flavor, immunities, special_properties, framer_interaction, team, in_wolf_chat)
VALUES
  (
    'Stalker',
    'Houses',
    TRUE,
    'Once a night, the Stalker travels to a player''s home to slash them if they move. The Stalker has a set number of charges, burned on success or failure but not when blocked.',
    'Victims are found slashed to death on their front porch.',
    NULL,
    'If the target moves, the Stalker kills them. If the target does not move, the attempt fails.',
    NULL,
    'wolf',
    TRUE
  );

INSERT INTO roles (name, targets, moves, description, standard_results_flavor, immunities, special_properties, framer_interaction, team, in_wolf_chat)
VALUES
  (
    'Turncoat',
    'N/A',
    FALSE,
    'The Turncoat is a wolf not in wolf chat.',
    NULL,
    NULL,
    'Receives the names of all wolves at game start. Wolves are notified they have a Turncoat but not who. Receives names of any players who later join wolf chat. If the Turncoat is the last wolf, they join wolf chat and become Alpha Wolf.',
    NULL,
    'wolf',
    FALSE
  );

INSERT INTO roles (name, targets, moves, description, standard_results_flavor, immunities, special_properties, framer_interaction, team, in_wolf_chat)
VALUES
  (
    'Wolf',
    'N/A',
    FALSE,
    'The Wolf (Vanilla Wolf) has no special abilities and is in wolf chat.',
    NULL,
    NULL,
    'After Heir, a vanilla Wolf must become the next Alpha after Alpha Wolf death.',
    NULL,
    'wolf',
    TRUE
  );

INSERT INTO roles (name, targets, moves, description, standard_results_flavor, immunities, special_properties, framer_interaction, team, in_wolf_chat)
VALUES
  (
    'Arsonist',
    'Players',
    TRUE,
    'Each night the Arsonist may douse a player by visiting their home or light all doused players on fire, killing them and themselves. The Arsonist wins when X players die from being lit, not including themselves.',
    'Victims are found burned to death, including the Arsonist. It is not revealed who among the burned players was the Arsonist.',
    'Alpha Kills',
    'The Arsonist fails if they target an untargetable-at-home role. If anyone visits or blocks the Arsonist, they become doused. If anyone visits an Arsonist’s douse target, they become doused. The Light action precedes all other night actions. The Arsonist cannot be night-killed by the Alpha but can be killed by any other killer. If a Lookout watches the Arsonist on a night they Light, they receive the message You watch the Arsonist light their targets on fire as their information.',
    NULL,
    'neutral',
    FALSE
  );

INSERT INTO roles (name, targets, moves, description, standard_results_flavor, immunities, special_properties, framer_interaction, team, in_wolf_chat)
VALUES
  (
    'Graverobber',
    'Dead players',
    TRUE,
    'Each night the Graverobber travels to the graveyard and assumes the role and win condition of a player who has already died.',
    NULL,
    NULL,
    'Cannot act without a dead player in the graveyard. May not target a disappeared player.',
    NULL,
    'neutral',
    FALSE
  );

INSERT INTO roles (name, targets, moves, description, standard_results_flavor, immunities, special_properties, framer_interaction, team, in_wolf_chat)
VALUES
  (
    'Jester',
    'Players that voted to hang the Jester',
    FALSE,
    'The Jester’s win condition triggers when they are hanged. Upon hanging they select one person with an active vote on them and kill that person.',
    'Victims are pointed at by the Jester during hanging and then die.',
    NULL,
    NULL,
    NULL,
    'neutral',
    FALSE
  );

INSERT INTO roles (name, targets, moves, description, standard_results_flavor, immunities, special_properties, framer_interaction, team, in_wolf_chat)
VALUES
  (
    'Murderer',
    'Players',
    TRUE,
    'The Murderer is a neutral killer who must kill X town-aligned players to win. After killing X town players they leave the game and are declared a winner.',
    'Victims are found with an axe in their head.',
    NULL,
    'The Murderer fails if they target an untargetable-at-home role. If blocked or locked they kill that blocker and their body is found in town square the next morning. The Murderer is notified at game start of how many town kills are needed but not which kills count.',
    NULL,
    'neutral',
    FALSE
  );

INSERT INTO roles (name, targets, moves, description, standard_results_flavor, immunities, special_properties, framer_interaction, team, in_wolf_chat)
VALUES
  (
    'Orphan',
    'Players',
    TRUE,
    'Each night the Orphan travels to a player’s house. After three successful visits to the same player, the Orphan assumes that player’s role and win condition.',
    'If the player in the house the Orphan visits is attacked, the Orphan dies from the same attack, even if the target survives.',
    'Immune to attacks and information gathering from all moving roles that target players except for the Stalker.',
    'If jailed, locked, or blocked the Orphan does not convert and their conversion timer does not decrease. If they miss a night action or stay home, their conversion timer does not decrease and they do not operate as untargetable-at-home that night.',
    null,
    'neutral',
    FALSE
  );

INSERT INTO roles (name, targets, moves, description, standard_results_flavor, immunities, special_properties, framer_interaction, team, in_wolf_chat)
VALUES
  (
    'Plague Bringer',
    'Houses',
    TRUE,
    'Each night the Plague Bringer visits a player and infects them, any visitors to that player, and any visitors to the Plague Bringer. Infected players become sick and die two days later; if infected twice before death they become Carriers who infect visitors but do not die. The Plague Bringer wins when half of living players are infected.',
    'On day two of infection infected players wake with a bloody cough. On day three they are found dead of the plague but can still act that night.',
    NULL,
    'The Plague Bringer may visit the same target twice in a row.',
    null,
    'neutral',
    FALSE
  );

INSERT INTO roles (name, targets, moves, description, standard_results_flavor, immunities, special_properties, framer_interaction, team, in_wolf_chat)
VALUES
  (
    'Serial Killer',
    'Players',
    TRUE,
    'The Serial Killer is a neutral killer who must kill X players to win. After killing X players they leave the game and are declared a winner.',
    'Victims are found stabbed to death.',
    'Alpha Kills',
    'The Serial Killer fails if they target an untargetable-at-home role. If blocked or locked they kill that blocker and their body is found in town square the next morning. The Serial Killer is notified at game start of how many kills are needed to win.',
    NULL,
    'neutral',
    FALSE
  );