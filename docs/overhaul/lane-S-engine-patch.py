#!/usr/bin/env python3
"""Lane S (V04) integration patch: Engine.ts + TerrainMesh.ts.

Usage:  python3 docs/overhaul/lane-S-engine-patch.py <repo-root>
Each edit is an exact anchor replacement; the script refuses (exit 1) if an anchor is missing
or not unique, and never writes a partially patched file.
"""
import sys
from pathlib import Path

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else ".")

TERRAIN_MESH = [
    (
        """  outsideTriangleBudget?: number;\n""",
        """  outsideTriangleBudget?: number;
  /**
   * Far apron radius of the outside, m (OutsideOptions.farRadius). Default 4 arenaRadius + 40.
   * Lane S (V04) passes the field edge (+ 5 cm) so the biome mesh continues the ground from there.
   */
  outsideFarRadius?: number;
""",
    ),
    (
        """{ baseY, triangleBudget: options.outsideTriangleBudget, paint: options.paint }""",
        """{ baseY, triangleBudget: options.outsideTriangleBudget, paint: options.paint, farRadius: options.outsideFarRadius }""",
    ),
]

ENGINE = [
    # 1. imports
    (
        """import { buildTerrainMesh, type TerrainMeshBuild } from "../graphics/TerrainMesh.ts";\n""",
        """import { buildTerrainMesh, type TerrainMeshBuild } from "../graphics/TerrainMesh.ts";
import { chooseBiome, createSurroundings, fieldNearRadius, type BiomeSurroundings } from "../world/biomes/Biomes.ts";
import { APRON_TUCK, buildSurroundingsMesh, type SurroundingsLight, type SurroundingsMesh } from "../graphics/biomes/SurroundingsMesh.ts";
""",
    ),
    # 2. fields
    (
        """  #terrain: THREE.Group | null = null;\n""",
        """  #terrain: THREE.Group | null = null;
  /**
   * V04 (lane S): what lies around and below the arena. Physics (lane R) reads
   * surfaceAt(x, z, this.#skyTime) - the SAME clock the water shader animates with -
   * plus mediumAt / drag / buoyancy / hazardDps / killPlaneY. Null outside a fight.
   */
  #surroundings: BiomeSurroundings | null = null;
  #surroundingsMesh: SurroundingsMesh | null = null;
  readonly #surAmbient = new THREE.Color();
  readonly #surSun = new THREE.Color();
  /** Reused per-frame light input (no allocation in the loop). */
  readonly #surLight: SurroundingsLight = { sunColor: this.#surSun };
""",
    ),
    # 3. #buildArena: shrink lane E2's flat apron to the field edge when the outside is drawn
    (
        """        paint: { ringHalf: this.#ringHalf(), place: this.#place.id },
      }, this.#terrainMesh);""",
        """        paint: { ringHalf: this.#ringHalf(), place: this.#place.id },
        // V04: the flat apron stops just past the field; the biome mesh continues the ground.
        outsideFarRadius: outsideOn ? fieldNearRadius(field, this.#ringMaxRadius()) + 0.05 : undefined,
      }, this.#terrainMesh);""",
    ),
    # 4. helpers next to #ringHalf
    (
        """  #rebuildTerrain() {\n""",
        """  /** Largest rim radius over 64 bearings, m (the surroundings' ringRadius). */
  #ringMaxRadius(): number {
    let r = 0;
    for (let i = 0; i < 64; i++) r = Math.max(r, ringRadiusAt(this.#arena, (i / 64) * Math.PI * 2));
    return r;
  }

  /**
   * V04 (lane S): choose and build what surrounds the arena (water, magma, clouds, canopy, void,
   * meadow, hills) from the arena + place, replacing the flat void-plane / lowland. Seeded from
   * the terrain field, so a replayed arena gets the same biome. Call after the place is known.
   */
  #buildSurroundings() {
    this.#surroundingsMesh?.dispose();
    this.#surroundingsMesh = null;
    this.#surroundings = null;
    const field = this.#terrainField, terrain = this.#terrainMesh;
    if (!field || !terrain) return;
    const cfg = this.#arena;
    const spec = chooseBiome(cfg, this.#place.id, seededRng((field.seed ^ 0x5eed5) >>> 0));
    const outside = terrain.outside;
    const layout = outside?.surface.layout;
    this.#surroundings = createSurroundings(spec, field, this.#ringMaxRadius(),
      outside && layout ? { near: { radius: layout.outerRadius, floorAt: terrain.floorHeightAt, edgeY: outside.surface.farY } } : {});
    this.#surroundingsMesh = buildSurroundingsMesh(this.#surroundings, {
      rimRadiusAt: (a) => ringRadiusAt(cfg, a),
      rimBottomY: terrain.surface.skirtBottomY,
      innerRadius: layout?.outerRadius,
      // Without the TerrainMesh outsideFarRadius patch the flat apron still overlaps the land: tuck under it.
      apronTuck: layout && layout.farRadius > layout.outerRadius + 1 ? APRON_TUCK : 0,
    });
    this.#scene.add(this.#surroundingsMesh.group);
    this.#scene.traverse((o) => { if (o.name === "void-plane") o.visible = false; });
    if (this.#cleanCapture) this.#surroundingsMesh.group.visible = false;
  }

  #rebuildTerrain() {
""",
    ),
    # 5. #startFight: build once the place (and so the palette/biome table) is known
    (
        """    this.#setWorldTime(now.hour, now.dayOfYear, PLACES[placeIdx]);\n""",
        """    this.#setWorldTime(now.hour, now.dayOfYear, PLACES[placeIdx]);
    this.#buildSurroundings();
""",
    ),
    # 6. per-frame: uniforms only (sun = the key light, ambient = the AmbientLight, both x intensity)
    (
        """    if (!this.#frozen) this.#skyTime += dt;
    this.#applyEnvironment();
""",
        """    if (!this.#frozen) this.#skyTime += dt;
    this.#applyEnvironment();
    if (this.#surroundingsMesh) {
      this.#surAmbient.copy(this.#ambient.color).multiplyScalar(this.#ambient.intensity);
      this.#surSun.copy(this.#sunLight.color).multiplyScalar(this.#sunLight.intensity);
      this.#surLight.zenith = this.#env.zenith;
      this.#surLight.horizon = this.#env.horizon;
      this.#surroundingsMesh.update(this.#skyTime, this.#sunLight.position, this.#surAmbient, this.#surLight);
    }
""",
    ),
    # 7. debugView({clean}): keep the void-plane hidden while surroundings exist; hide them for clean captures
    (
        """      this.#scene.traverse((o) => { if (o.name === "void-plane") o.visible = !opts.clean; });\n""",
        """      this.#scene.traverse((o) => { if (o.name === "void-plane") o.visible = !opts.clean && !this.#surroundingsMesh; });
      if (this.#surroundingsMesh) this.#surroundingsMesh.group.visible = !opts.clean;
""",
    ),
    # 8b. QA: a debugView place change re-chooses the surroundings for the new place
    (
        """    this.#setWorldTime(opts.hour ?? this.#hour, opts.dayOfYear ?? this.#dayOfYear, PLACES[opts.place ?? PLACES.indexOf(this.#place)] ?? this.#place);\n""",
        """    this.#setWorldTime(opts.hour ?? this.#hour, opts.dayOfYear ?? this.#dayOfYear, PLACES[opts.place ?? PLACES.indexOf(this.#place)] ?? this.#place);
    if (opts.place !== undefined && this.#phase === "fight") this.#buildSurroundings();
""",
    ),
    # 8. QA snapshot
    (
        """        outsideGround: this.#arena.outsideGround >= 1, props: this.#arenaState.props.length,\n""",
        """        outsideGround: this.#arena.outsideGround >= 1, props: this.#arenaState.props.length,
        surroundings: this.#surroundings ? {
          kind: this.#surroundings.spec.kind, variant: this.#surroundings.spec.variant,
          agitation: this.#surroundings.spec.agitation, surfaceDrop: this.#surroundings.spec.surfaceDrop,
          killPlaneY: this.#surroundings.killPlaneY, drawCalls: this.#surroundingsMesh?.stats.drawCalls ?? 0,
          triangles: this.#surroundingsMesh?.stats.triangles ?? 0,
        } : null,
""",
    ),
]


def apply(path: Path, edits) -> None:
    text = path.read_text()
    for i, (anchor, replacement) in enumerate(edits, 1):
        n = text.count(anchor)
        if n != 1:
            sys.exit(f"{path}: edit {i}: anchor found {n} times, expected 1:\n{anchor}")
        text = text.replace(anchor, replacement)
    path.write_text(text)
    print(f"patched {path} ({len(edits)} edits)")


apply(ROOT / "src/graphics/TerrainMesh.ts", TERRAIN_MESH)
apply(ROOT / "src/engine/Engine.ts", ENGINE)
