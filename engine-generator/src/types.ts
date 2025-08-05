export interface Role {
  id: number;
  name: string;
  team: 'Town' | 'Wolf' | 'Neutral';
  targets: string;
  moves: boolean;
  description: string;
  framerInteraction?: string;
  specialProperties?: string[];
  immunities?: string;
  standardResultsFlavor?: string | Record<string, string>;
  healFlavor?: string;
  hasCharges?: boolean;
  defaultCharges?: number;
  inWolfChat?: boolean;
  inputRequirements: InputRequirement;
}

export interface InputRequirement {
  type: 'none' | 'player_dropdown' | 'two_player_dropdown' | 'dead_player_dropdown' | 'role_dropdown' | 'alert_toggle' | 'arsonist_action';
  description: string;
  validation: string;
}

export interface Player {
  id: number;
  username: string;
  status: 'alive' | 'dead';
  role: string;
  team: string;
  isWolf: boolean;
  isFramed: boolean;
  framedNight?: number;
  chargesLeft?: number;
  actionNotes?: string;
  isJailed?: boolean;
  isLocked?: boolean;
  isDoused?: boolean;
  isInfected?: boolean;
  isCarrier?: boolean;
  infectionDay?: number;
  hypnotizedBy?: string;
  hypnotizedUntil?: number;
  auraseerBall?: boolean;
  trackerOn?: string;
  beingTrackedBy?: string;
  visitedBy?: string[];
  visited?: string[];
  killedBy?: string;
  killFlavor?: string;
  bodyLocation?: string;
  conversionProgress?: number;
  conversionTarget?: string;
  dousedPlayers?: string[];
  infectedPlayers?: string[];
  carrierCount?: number;
  killCount?: number;
  townKillCount?: number;
  winCondition?: string;
  winConditionProgress?: number;
  moves?: boolean;
  isEscorted?: boolean;
  isConsorted?: boolean;
}

export interface NightAction {
  playerId: number;
  action: string;
  target?: string;
  secondaryTarget?: string;
  actionType?: 'douse' | 'light' | 'alert' | 'visit' | 'investigate' | 'block' | 'kill' | 'heal' | 'frame' | 'track' | 'match' | 'dig' | 'rob' | 'infect' | 'hypnotize' | 'eat' | 'stalk' | 'patrol' | 'lock' | 'jail' | 'escort' | 'consort' | 'lookout' | 'veteran' | 'seer' | 'bartender' | 'gravedigger' | 'graverobber' | 'clairvoyant' | 'bloodhound' | 'framer' | 'glutton' | 'hypnotist' | 'lone_wolf' | 'turncoat' | 'wolf' | 'alpha_wolf' | 'arsonist' | 'jester' | 'murderer' | 'orphan' | 'plague_bringer' | 'serial_killer' | 'couple' | 'doctor' | 'escort' | 'hunter' | 'jailkeeper' | 'knight' | 'locksmith' | 'lookout' | 'matchmaker' | 'mayor' | 'patrolman' | 'seer' | 'sleepwalker' | 'veteran' | 'villager';
}

export interface GameState {
  gameId: number;
  nightNumber: number;
  players: Player[];
  roles: Role[];
  gameMeta: GameMeta[];
  orderOfOperations: OrderOfOperation[];
  rules: GameRules;
}

export interface GameMeta {
  gameId: number;
  userId: string;
  night: number;
  metaData: Record<string, any>;
}

export interface OrderOfOperation {
  name: string;
  description: string;
  roles: string[];
  action: string;
}

export interface GameRules {
  orderOfOperations: OrderOfOperation[];
  rampageMechanics: RampageMechanics;
  homeTargeting: HomeTargeting;
  framingEffects: Record<string, string>;
  blockNotifications: BlockNotifications;
  blockEffects: BlockEffects;
  bodyPlacement: BodyPlacement;
  reTargetingSamePlayer: ReTargetingSamePlayer;
  bartenderResultPool: BartenderResultPool;
  conversionRoles: ConversionRoles;
}

export interface RampageMechanics {
  rampageableRoles: string[];
  nonRampageableRoles: string[];
  rampageRules: {
    targetDiesAtOwnHome: boolean;
    rampagedDiesAtTargetHome: boolean;
    escortEdgeCase: string;
  };
}

export interface HomeTargeting {
  cannotBeTargetedAtHome: string[];
  framerException: string;
}

export interface BlockNotifications {
  movingRolesOnly: string[];
  allPlayers: string[];
  exceptions: Record<string, string>;
}

export interface BlockEffects {
  movementBased: string[];
  allActionsExceptSeer: string[];
}

export interface BodyPlacement {
  defaultLocation: string;
  rampagedBodies: string;
  blockedKillerBodies: string;
  killFlavors: Record<string, string>;
}

export interface ReTargetingSamePlayer {
  allowedFor: string[];
  allowedWhen: string;
}

export interface BartenderResultPool {
  includes: string;
  excludes: string[];
  bartenderCanAppear: string;
  repeatVisits: string;
}

export interface ConversionRoles {
  convertAtDayStart: boolean;
  chargeInheritance: string;
  killCountRoles: string;
  digInheritances: Record<string, string>;
  themeSwap: string;
}

export interface NightActionResult {
  deaths: Death[];
  results: PlayerResult[];
  explanation: string;
}

export interface Death {
  player: string;
  cause: string;
  killer?: string;
  location?: string;
  flavor?: string;
}

export interface PlayerResult {
  player: string;
  resultMessage: string;
  additionalInfo?: Record<string, any>;
}

export interface RoleInputRequirement {
  roleId: number;
  roleName: string;
  inputType: string;
  description: string;
  validation: string;
  options?: string[];
  multiSelect?: boolean;
  allowNone?: boolean;
}

export interface GameEngineConfig {
  rulesPath: string;
  rolesPath: string;
  databasePath?: string;
} 