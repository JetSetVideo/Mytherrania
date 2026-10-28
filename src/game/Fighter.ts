import { body, type Body } from "../physics/SmashPhysics.ts";
import { createStats, type ClassName, type CombatStats } from "./Stats.ts";
import { weaponForClass, type Weapon } from "./Weapon.ts";
import type { CombatProfile, WeaponSpec } from "../combat/contracts.ts";
import { nameSeed } from "./RaceAppearance.ts";
import { resolveWeapon } from "./weapons/Loadout.ts";
import { toLegacyWeapon } from "./weapons/Adapter.ts";
import { combatProfile } from "./weapons/Profile.ts";
import { defaultHumanoid, type Skeleton } from "./Skeleton.ts";
import { defaultTree, type TreeNode } from "./DecisionTree.ts";
import { applyRaceBonus } from "./Races.ts";
import { applySecondary } from "./SecondaryStats.ts";

export interface Fighter {
  name: string;
  className: ClassName;
  stats: CombatStats;
  weapon: Weapon;
  /** Generated weapon (W06) and its derived combat numbers (W07); absent on the classic path. */
  weaponSpec?: WeaponSpec;
  weaponProfile?: CombatProfile;
  body: Body;
  hp: number;
  damagePercent: number; // Smash-style: rising percent increases knockback taken
  attackCooldown: number;
  stun: number;
  ringedOut: boolean;
  eliminated: boolean;
  skeleton: Skeleton;
  tree: TreeNode;
}

export function createFighter(className: ClassName, name: string, x: number, z: number, radius: number, race?: string, subrace?: string | null, weaponType?: string, birthsign?: string | null, weaponSeed?: number): Fighter {
  const raced = applyRaceBonus(createStats(className), race ?? "human", subrace ?? null, birthsign ?? null);
  // Secondary stats (sub-species + birthsign) feed the combat equations: mastery and
  // versatility raise attack power, haste shortens the interval, resistances add armour,
  // crit raises effective reflex. This is the connection the character sheet needed —
  // without it those stats were preview-only and changed nothing in a fight.
  const stats = applySecondary(raced, subrace ?? null, birthsign ?? null);
  // Weapon: an explicit choice ("random", an archetype, a classic type) gets a GENERATED
  // weapon (W06) with its derived combat profile (W07); no choice keeps the class's classic one.
  const weaponSpec = weaponType ? resolveWeapon(className, weaponType, weaponSeed ?? nameSeed(name)) : undefined;
  const weapon = weaponSpec ? toLegacyWeapon(weaponSpec) : weaponForClass(className);
  return {
    name,
    className,
    stats,
    weapon,
    weaponSpec,
    weaponProfile: weaponSpec ? combatProfile(weaponSpec) : undefined,
    body: body(x, radius, z),
    hp: stats.maxHealth,
    damagePercent: 0,
    attackCooldown: 0,
    stun: 0,
    ringedOut: false,
    eliminated: false,
    skeleton: defaultHumanoid(),
    tree: defaultTree(),
  };
}

// Knockback scales with the target's accumulated damage percent (Smash-style).
export function knockbackPower(attacker: Fighter, target: Fighter): number {
  return attacker.weapon.knockback * (1 + target.damagePercent / 60);
}
