#!/usr/bin/env python3
# Lane R (V02 walls, V03 ring-out + articulated ragdoll): the Engine.ts integration patch.
# Every hunk is (anchor text that must occur EXACTLY once, replacement). Run from the repo root:
#   python3 docs/overhaul/lane-R-engine.patch.py [path/to/Engine.ts]
# It refuses to write if any anchor is missing or ambiguous (nothing is changed then).
# Verified by the lane on a scratch copy of the tree at a7fc002: `deno check` clean (see lane-R.md).
import sys

path = sys.argv[1] if len(sys.argv) > 1 else "src/engine/Engine.ts"
src = open(path, encoding="utf-8").read()

HUNKS = [
# 1. Imports: wall polygon + footprint, ring-out rule, ragdoll; the particle ragdoll goes.
("""import { edgeDistance, outline, stepArenaBody, type ArenaState } from "../physics/ArenaPhysics.ts";""",
 """import { edgeDistance, footprintRadius, outline, stepArenaBody, type ArenaState } from "../physics/ArenaPhysics.ts";
import { WALL_THICKNESS, wallPolygonOf } from "../physics/WallCollision.ts";
import { checkRingOut, ringOutLoser, trackExit, type ExitClock, type RingOutCandidate } from "../game/RingOut.ts";
import { RagdollDriver } from "../physics/ragdoll/RigBinding.ts";
import { arenaWorld, type RagdollWorld } from "../physics/ragdoll/RagdollWorld.ts";
import type { RingOutEvent } from "../world/biomes/contracts.ts";"""),
("""import { createRagdoll, ragdollCentre, stepRagdoll, type Ragdoll } from "../game/Ragdoll.ts";
""", ""),
("""import { bodyFromStats, closingSpeed, fallDamage, physicsMultiplier, resolveImpact, type Body } from "../game/Physics.ts";""",
 """import { bodyFromStats, closingSpeed, physicsMultiplier, resolveImpact, type Body } from "../game/Physics.ts";"""),
# 2. The end reason and the follow time.
("""type MatchEndReason = "ko" | "forfeit";""",
 """type MatchEndReason = "ko" | "forfeit" | "ringout";
/** Seconds the camera follows a ringed-out body before the result screen (V03). */
const RING_OUT_FOLLOW_SECONDS = 2;
/** Reused camera target for the ring-out follow (no per-frame allocation). */
const RING_CAM = new THREE.Vector3();"""),
# 3. State: ragdoll drivers per rig, the active set, the fall world, footprints, exit clocks, last blows.
("""  /** Ragdoll meshes: one sphere per node, shown while a body tumbles. */
  #ragdollMeshes = new Map<Fighter, THREE.Group>();""",
 """  /** Articulated ragdolls of the real rigs (V03), built once per rig; active ones own the bones. */
  #ragdollDrivers = new Map<Fighter, RagdollDriver>();
  /** Fighters whose bones the ragdoll owns (ring-out eliminated). */
  #ragdolled = new Set<Fighter>();
  /** What a ragdoll falls through: the ring platform, the wall, the surroundings (per match). */
  #ragdollWorld: RagdollWorld | null = null;
  /** Wall footprint radius per fighter, from its hitboxes (V02), m. */
  #footprint = new Map<Fighter, number>();
  /** When each body's centre left the outline (ring-out tie-break), s of match time. */
  #exitClocks = new Map<Fighter, ExitClock>();
  /** The last blow each fighter took: impulse (N·s) at a world point — the ragdoll's spin. */
  #lastImpact = new Map<Fighter, { point: [number, number, number]; impulse: [number, number, number] }>();
  /** Ring-out follow: the falling fighter, seconds left before the result screen, and the screen. */
  #ringOutFollow: { f: Fighter; until: number; show: () => void } | null = null;"""),
("""  #ragdolls = new Map<Fighter, Ragdoll>();
""", ""),
# 4. Rigs rebuilt: drop the old drivers (their bones are gone).
("""    this.#auras.clear();
    this.#rigs.clear();""",
 """    this.#auras.clear();
    this.#rigs.clear();
    this.#ragdollDrivers.clear();
    this.#ragdolled.clear();"""),
# 5. Per rig: the articulated ragdoll (capsules = the combat hitboxes, or a fit for a classic
#    weapon; hitboxesFromPlan caches per plan) and the wall footprint (bind-pose capsules).
("""      this.#armCombat(f, rig);""",
 """      this.#armCombat(f, rig);
      {
        const mass = this.#bodyOf(f).parts.reduce((s, q) => s + q.mass, 0);
        const boxes = this.#hitboxes.get(f) ?? hitboxesFromPlan(rig.plan, { mass });
        this.#footprint.set(f, footprintRadius(boxes.boxes));
        this.#ragdollDrivers.set(f, new RagdollDriver(rig, boxes, f.skeleton.limits()));
      }"""),
# 6. Walking into the wall is a lean (slide), never a blow.
("""      integrity: 1,
      props: placeObjects(cfg, arenaRng),
    };""",
 """      integrity: 1,
      props: placeObjects(cfg, arenaRng),
      // V02: a new wall contact slower than a brisk walk is a lean that slides, not a blow.
      wallImpactSpeed: MOVE_SPEED * 1.05,
    };"""),
# 7. Draw the wall (and floor) on the polygon the physics collides with: exact corners for the
#    regular shapes and the diamond; curves keep the 96-point outline (chord gap ≤ R·π²/(2·96²)).
("""    const pts = outline(cfg, 96);""",
 """    const wallPoly = wallPolygonOf(cfg);
    const pts = wallPoly.n <= 8 ? Array.from({ length: wallPoly.n }, (_, i) => ({ x: wallPoly.ax[i], z: wallPoly.az[i] })) : outline(cfg, 96);"""),
("""new THREE.BoxGeometry(len + 0.05, wallSpan, 0.35)""",
 """new THREE.BoxGeometry(len + 0.05, wallSpan, WALL_THICKNESS)"""),
# 8. Match start: fresh ring-out state; any running ragdoll hands its bones back.
("""    // Death is the only victory condition now: no ring-out, no clock, no hill.""",
 """    // Victory: death, or a RING-OUT (V03: ejected = eliminated). No clock, no hill."""),
("""    for (const m of [this.#fog, this.#senseRanges, this.#statuses, this.#ragdolls, this.#coins, this.#distractions, this.#velocity, this.#statusTally, this.#lastSeen, this.#sensedBy]) m.clear();
    for (const g of this.#ragdollMeshes.values()) this.#scene.remove(g);
    this.#ragdollMeshes.clear();""",
 """    for (const m of [this.#fog, this.#senseRanges, this.#statuses, this.#exitClocks, this.#lastImpact, this.#coins, this.#distractions, this.#velocity, this.#statusTally, this.#lastSeen, this.#sensedBy]) m.clear();
    for (const f of this.#ragdolled) this.#ragdollDrivers.get(f)?.stop();
    this.#ragdolled.clear();
    this.#ragdollWorld = null;
    this.#ringOutFollow = null;"""),
# 9. The particle-ragdoll tumble on hard knockback is retired (the real body tumbles on ring-out).
("""      // Ragdoll: a body tumbles when it is thrown hard — knockback faster than 7 m/s
      // (a heavy skill or a wall rebound) or a landing off the ring. It plays until the
      // Verlet body settles, and the rig is hidden while the ragdoll mesh shows.
      if (Math.hypot(f.body.vx, f.body.vz) > 7) this.#throwRagdoll(f, 3);
      const rd = this.#ragdolls.get(f);
      if (rd) {
        stepRagdoll(rd, dt, Math.max(0, f.body.y - f.body.radius));
        this.#drawRagdoll(f, rd);
        if (rd.settled || rd.age > 2.5) {
          this.#ragdolls.delete(f);
          const g = this.#ragdollMeshes.get(f);
          if (g) { this.#scene.remove(g); this.#ragdollMeshes.delete(f); }
        }
      }
""", ""),
("""  /** Ragdoll mesh: one sphere per node, in the fighter's body colour; the rig hides. */
  #drawRagdoll(f: Fighter, rd: Ragdoll) {
    let g = this.#ragdollMeshes.get(f);
    if (!g) {
      g = new THREE.Group();
      g.name = "ragdoll";
      const colour = (f === this.#player ? this.#playerProfile : this.#opponentProfile).appearance.body;
      for (const n of rd.nodes) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(n.radius, 12, 8), new THREE.MeshLambertMaterial({ color: colour }));
        s.castShadow = true;
        g.add(s);
      }
      this.#scene.add(g);
      this.#ragdollMeshes.set(f, g);
    }
    rd.nodes.forEach((n, i) => g!.children[i].position.set(n.x, n.y, n.z));
  }

""", ""),
# 10. The arm/body guards never touch bones the ragdoll owns.
("""    if (!this.#ragdolls.has(f)) guard.solve(f.skeleton); // also refreshes f's own hitboxes""",
 """    if (!this.#ragdolled.has(f)) guard.solve(f.skeleton); // also refreshes f's own hitboxes"""),
("""    if (body && depth && !this.#ragdolls.has(f) && !this.#ragdolls.has(other)) {""",
 """    if (body && depth && !this.#ragdolled.has(f) && !this.#ragdolled.has(other)) {"""),
# 11. Remember the last blow (impulse at the contact point) for the ragdoll's spin.
("""    if (imp && contact) this.#recordContact(attacker, contact, imp.outcome, dmg, knock, skill, imp.notes[2] ?? "");""",
 """    if (imp && contact) this.#recordContact(attacker, contact, imp.outcome, dmg, knock, skill, imp.notes[2] ?? "");
    if (imp && contact) {
      this.#lastImpact.set(defender, {
        point: [contact.point[0], contact.point[1], contact.point[2]],
        impulse: [imp.knockback[0], imp.knockback[1], imp.knockback[2]],
      });
    }"""),
# 12. Landing outside / return-to-ring / the particle throw go; ring-out + the ragdoll start come in.
("""  /**
   * A body lands on the solid outside ground. Fall damage from the landing speed:
   *   D = fallDamage(body, v) · DAMAGE_SCALE      (the drop's ½mv²·g/T, in HP units)
   * so a ring-out is a real cost (about 0.5–3% of HP), not a free reset. It then
   * walks back: the body is returned to the ring after a 1.5 s ragdoll tumble.
   * The truce protects too — no fall damage before it lifts.
   */
  #landOutside(f: Fighter, speed: number) {
    if (canAttack(this.#sinceStart, this.#timing)) {
      const fall = fallDamage(this.#bodyOf(f), speed) * DAMAGE_SCALE;
      f.hp -= fall;
      f.damagePercent += (fall / DAMAGE_SCALE) * 0.4;
    }
    this.#throwRagdoll(f, 1.6);
    this.#returnToRing(f);
  }

  /** Put a body back inside the ring, 2 m in from the edge at a random bearing. */
  #returnToRing(f: Fighter) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.max(0.5, ringRadiusAt(this.#arena, a) - 2);
    f.body.x = Math.cos(a) * r;
    f.body.z = Math.sin(a) * r;
    f.body.y = 0.6;
    f.body.vx = 0; f.body.vy = 0; f.body.vz = 0;
    f.ringedOut = false;
    const v = this.#velocity.get(f);
    if (v) { v.px = f.body.x; v.pz = f.body.z; v.x = 0; v.z = 0; }
  }

  /** Start a ragdoll tumble from the fighter's current position and velocity. */
  #throwRagdoll(f: Fighter, upward: number) {
    if (this.#ragdolls.has(f)) return;
    const v = this.#velocity.get(f);
    this.#ragdolls.set(f, createRagdoll({
      x: f.body.x, y: Math.max(0.2, f.body.y), z: f.body.z, height: 1.8,
      vx: (v?.x ?? 0) + f.body.vx, vy: upward, vz: (v?.z ?? 0) + f.body.vz,
    }));
  }
""",
 """  /**
   * V03: `f` was ejected — ELIMINATED. Its bones go to the articulated ragdoll and the other
   * fighter wins by "ringout"; the result screen waits while the camera follows the fall.
   */
  #ringOut(f: Fighter, ev: RingOutEvent): void {
    if (this.#winner) return;
    this.#startRagdoll(f);
    this.#log.record({ kind: "ring-out", from: f.name, to: this.#otherOf(f).name, x: ev.x, z: ev.z, reason: ev.medium }, performance.now());
    this.#endMatch(f === this.#player ? "opponent" : "player", "ringout");
  }

  /**
   * Hand f's bones to its articulated ragdoll, seeded from the rig's current pose, the body's
   * velocity (knockback + measured walk) and the last blow's moment, with muscle tone from
   * everything the fighter is right now: HP, stamina, damage meter, strength, statuses.
   */
  #startRagdoll(f: Fighter): void {
    const d = this.#ragdollDrivers.get(f);
    if (!d || this.#ragdolled.has(f)) return;
    const res = this.#resources.get(f), st = this.#statuses.get(f), v = this.#velocity.get(f);
    this.#ragdollWorld ??= arenaWorld(this.#arenaState, null /* lane S: this.#surroundings */);
    d.start({
      condition: {
        hpFraction: Math.max(0, f.hp / f.stats.maxHealth),
        staminaFraction: res ? res.stamina.current / Math.max(1e-6, res.stamina.max) : 1,
        damagePercent: f.damagePercent,
        strength: f.stats.strength,
        statuses: st ? st.active.map((a) => a.name) : [],
      },
      velocity: [f.body.vx + (v?.x ?? 0), f.body.vy, f.body.vz + (v?.z ?? 0)],
      impact: this.#lastImpact.get(f),
    });
    this.#ragdolled.add(f);
  }
"""),
# 13. No more return-to-ring from the void: a ring-out ends the match (detected in the physics loop).
("""    // A ring-out is NOT an ending. With solid outside ground the body lands there
    // (#landOutside). Over a void it falls to the floor plane, takes the same fall
    // damage, and is returned. Only losing every life point ends a match.
    for (const f of [p, o]) {
      if (f.body.y < RING_OUT_FLOOR) {
        const impactSpeed = Math.sqrt(2 * 24 * Math.abs(RING_OUT_FLOOR)) + Math.abs(f.body.vy ?? 0) * 0.2;
        if (canAttack(this.#sinceStart, this.#timing)) {
          const fall = fallDamage(this.#bodyOf(f), impactSpeed) * DAMAGE_SCALE;
          f.hp -= fall;
          f.damagePercent += (fall / DAMAGE_SCALE) * 0.4;
        }
        this.#flashTime = Math.max(this.#flashTime, 0.12);
        this.#returnToRing(f);
      }
    }
""",
 """    // A ring-out IS an ending (V03): the physics loop calls #ringOut, which ends the match.
"""),
# 14. The result screen: ring-out wording, AI adaptation for any fought result, delayed screen.
("""        if (brain && reason === "ko") brain.adapt(won, prof.winRate(), prof.telemetry.digest());""",
 """        if (brain && reason !== "forfeit") brain.adapt(won, prof.winRate(), prof.telemetry.digest());"""),
("""      const how = reason === "forfeit"
        ? `${l.name} gave up against ${w.name} (${w.className}) after ${this.#elapsed.toFixed(1)}s`
        : `${w.name} (${w.className}) beat ${l.name} (${l.className}) by knockout in ${this.#elapsed.toFixed(1)}s`;
      this.#menu.show("victory", { winner: this.#winner, result: { title, detail: `${how} — ${this.#place.name}, ${this.#env.phase}` } });""",
 """      const how = reason === "forfeit"
        ? `${l.name} gave up against ${w.name} (${w.className}) after ${this.#elapsed.toFixed(1)}s`
        : reason === "ringout"
        ? `${w.name} (${w.className}) threw ${l.name} (${l.className}) out of the arena in ${this.#elapsed.toFixed(1)}s`
        : `${w.name} (${w.className}) beat ${l.name} (${l.className}) by knockout in ${this.#elapsed.toFixed(1)}s`;
      const winnerNow = this.#winner;
      const show = () => this.#menu.show("victory", { winner: winnerNow, result: { title, detail: `${how} — ${this.#place.name}, ${this.#env.phase}` } });
      // V03: a ring-out first lets the camera follow the falling body.
      if (reason === "ringout") this.#ringOutFollow = { f: l, until: RING_OUT_FOLLOW_SECONDS, show };
      else show();"""),
# 15. The follow clock (the world keeps running under the result overlay).
("""    this.#flashTime = Math.max(0, this.#flashTime - dt);
    if (this.#phase === "fight" && !this.#winner) this.#sinceStart += dt;""",
 """    this.#flashTime = Math.max(0, this.#flashTime - dt);
    if (this.#ringOutFollow && this.#ringOutFollow.until > 0) {
      this.#ringOutFollow.until -= dt;
      if (this.#ringOutFollow.until <= 0) this.#ringOutFollow.show();
    }
    if (this.#phase === "fight" && !this.#winner) this.#sinceStart += dt;"""),
# 16. The arena physics loop: footprint radius on the wall, eliminated bodies skipped, ring-out rule.
("""    for (const f of [p, o]) {
      if (this.#frozen) { f.ringedOut = false; continue; }
      if (this.#paused) continue;
      const v = this.#velocity.get(f);
      const a = Math.atan2(f.body.z, f.body.x);
      const outward = v ? v.x * Math.cos(a) + v.z * Math.sin(a) : 0;
      const step = stepArenaBody(f.body, this.#bodyOf(f), dt, this.#arenaState, outward, v ? { x: v.px, z: v.pz } : undefined);""",
 """    const ringOuts: (RingOutCandidate | null)[] = [null, null];
    for (const f of [p, o]) {
      if (this.#frozen) { f.ringedOut = false; continue; }
      if (this.#paused) continue;
      if (this.#ragdolled.has(f)) continue; // the ragdoll owns this body (rig loop)
      const v = this.#velocity.get(f);
      const a = Math.atan2(f.body.z, f.body.x);
      const outward = v ? v.x * Math.cos(a) + v.z * Math.sin(a) : 0;
      const step = stepArenaBody(f.body, this.#bodyOf(f), dt, this.#arenaState, outward, v ? { x: v.px, z: v.pz } : undefined, this.#footprint.get(f) ?? f.body.radius);"""),
("""      if (step.landedOutside > 0) this.#landOutside(f, step.landedOutside);
      f.ringedOut = !step.onRing;
    }
    for (const b of [p.body, o.body]) if (b.y < RING_OUT_FLOOR - 1.5) { b.y = RING_OUT_FLOOR - 1.5; b.vy = 0; b.vx *= 0.5; b.vz *= 0.5; }""",
 """      f.ringedOut = !step.onRing;
      // V03 ring-out = elimination (src/game/RingOut.ts): beyond the outline by a footprint and
      // dropped a body height below the rim or touching the world outside; a wall that held
      // never counts. Any time during the fight (the truce does not suspend falling off).
      let clock = this.#exitClocks.get(f);
      if (!clock) { clock = { exitTime: null }; this.#exitClocks.set(f, clock); }
      trackExit(clock, this.#arena, f.body.x, f.body.z, this.#elapsed);
      if (this.#phase === "fight" && !this.#winner) {
        const out = Math.max(1e-6, Math.hypot(f.body.x, f.body.z));
        const rim = ringRadiusAt(this.#arena, Math.atan2(f.body.z, f.body.x)) / out * 0.98;
        const rimY = this.#arenaState.floorAt ? this.#arenaState.floorAt(f.body.x * rim, f.body.z * rim) : 0;
        const prof = f === p ? this.#playerProfile : this.#opponentProfile;
        const ev = checkRingOut(this.#arena, {
          fighter: f === p ? "player" : "opponent",
          x: f.body.x, y: f.body.y, z: f.body.z,
          vx: f.body.vx + (v?.x ?? 0), vy: f.body.vy, vz: f.body.vz + (v?.z ?? 0),
          radius: this.#footprint.get(f) ?? f.body.radius, bottomY: f.body.y - f.body.radius,
          bodyHeight: prof.appearance.height, rimY,
          wallStopped: step.wallContact && !step.wall?.breached, time: this.#elapsed,
        }, null /* lane S: this.#surroundings */);
        if (ev) ringOuts[f === p ? 0 : 1] = { event: ev, exitTime: clock.exitTime, hpFraction: Math.max(0, f.hp / f.stats.maxHealth) };
      }
    }
    {
      const loser = ringOutLoser(ringOuts[0], ringOuts[1]);
      if (loser) this.#ringOut(loser === "player" ? p : o, (loser === "player" ? ringOuts[0] : ringOuts[1])!.event);
    }
    for (const f of [p, o]) {
      const b = f.body;
      if (!this.#ragdolled.has(f) && b.y < RING_OUT_FLOOR - 1.5) { b.y = RING_OUT_FLOOR - 1.5; b.vy = 0; b.vx *= 0.5; b.vz *= 0.5; }
    }"""),
# 17. Body–body push: never against a ragdoll (it is outside the ring anyway).
("""      const sd = Math.hypot(sx, sz) || 1e-3, minD = Math.min(BODY_SPACING, p.body.radius + o.body.radius);
      if (sd < minD) {""",
 """      const sd = Math.hypot(sx, sz) || 1e-3, minD = Math.min(BODY_SPACING, p.body.radius + o.body.radius);
      if (sd < minD && !this.#ragdolled.has(p) && !this.#ragdolled.has(o)) {"""),
# 18. The Animator/Skeleton stop driving a ragdolled body; the ragdoll poses the real bones.
("""    this.#updatePose(p, this.#anim.get(p)!, dt);
    this.#updatePose(o, this.#anim.get(o)!, dt);
    for (const [f, rig] of this.#rigs) {""",
 """    if (!this.#ragdolled.has(p)) this.#updatePose(p, this.#anim.get(p)!, dt);
    if (!this.#ragdolled.has(o)) this.#updatePose(o, this.#anim.get(o)!, dt);
    for (const [f, rig] of this.#rigs) {
      // V03: an eliminated body belongs to its ragdoll — step it, write the real bones, keep the
      // kinematic body (aura, minimap, camera) on its centre of mass. No Skeleton/Animator, pose
      // gate, grip or rig.update while the ragdoll owns the bones.
      if (this.#ragdolled.has(f)) {
        const d = this.#ragdollDrivers.get(f)!;
        if (this.#ragdollWorld) {
          this.#ragdollWorld.time = this.#skyTime;
          if (!this.#paused && !this.#frozen) d.update(dt, this.#ragdollWorld);
        }
        const c = d.ragdoll.centreOfMass();
        f.body.x = c[0]; f.body.y = c[1]; f.body.z = c[2];
        f.body.vx = 0; f.body.vy = 0; f.body.vz = 0;
        const aura = this.#auras.get(f);
        if (aura) { aura.position.x = c[0]; aura.position.z = c[2]; }
        rig.group.visible = !(this.#cleanCapture && f !== p);
        continue;
      }"""),
("""        && !(this.#cleanCapture && f !== p)
        // While a ragdoll tumbles, the ragdoll mesh IS the body: hide the rig.
        && !this.#ragdolls.has(f);
      // The aura follows the tumbling body's centre, so the state ring stays under it.
      const rdc = this.#ragdolls.get(f);
      const centre = rdc ? ragdollCentre(rdc) : null;""",
 """        && !(this.#cleanCapture && f !== p);"""),
("""        aura.position.x = centre ? centre.x : f.body.x;
        aura.position.z = centre ? centre.z : f.body.z;""",
 """        aura.position.x = f.body.x;
        aura.position.z = f.body.z;"""),
# 19. The ring-out follow camera (eased; the subject is the falling body's centre of mass).
("""    // Inspection camera: orbit the player so the weapon and pose can be seen from""",
 """    // V03: the ring-out follow — while the eliminated body falls, the perspective camera sits on
    // the ring side of it, above, and looks at its centre of mass (eased: no cut).
    if (this.#ringOutFollow && cam instanceof THREE.PerspectiveCamera && !this.#orbitView) {
      const c = this.#ragdollDrivers.get(this.#ringOutFollow.f)?.ragdoll.centreOfMass();
      if (c) {
        const out = Math.hypot(c[0], c[2]) || 1;
        RING_CAM.set(c[0] - (c[0] / out) * 4.5, c[1] + 3.2, c[2] - (c[2] / out) * 4.5);
        cam.position.lerp(RING_CAM, 1 - Math.exp(-4 * dt));
        cam.lookAt(c[0], c[1], c[2]);
      }
    }
    // Inspection camera: orbit the player so the weapon and pose can be seen from"""),
# 20. QA hooks.
("""      this.#throwRagdoll(o, 5);""", """      this.#startRagdoll(o);"""),
("""            ragdoll: this.#ragdolls.has(f),""", """            ragdoll: this.#ragdolled.has(f),
            ragdollMs: this.#ragdolled.has(f) ? +(this.#ragdollDrivers.get(f)?.ragdoll.report.ms ?? 0).toFixed(3) : 0,"""),
]

missing = []
for anchor, _ in HUNKS:
    n = src.count(anchor)
    if n != 1:
        missing.append((n, anchor.splitlines()[0][:100]))
if missing:
    for n, a in missing:
        print(f"anchor found {n}x (need 1): {a}")
    sys.exit(1)
for anchor, repl in HUNKS:
    n = src.count(anchor)
    if n != 1:
        print(f"anchor became ambiguous ({n}x) while applying: {anchor.splitlines()[0][:100]}")
        sys.exit(1)
    src = src.replace(anchor, repl, 1)
open(path, "w", encoding="utf-8").write(src)
print(f"lane R: {len(HUNKS)} hunks applied to {path}")
