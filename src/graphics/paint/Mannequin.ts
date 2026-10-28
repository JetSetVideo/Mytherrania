// Mannequin: a coarse, region-labelled humanoid MeshData built from axis-aligned
// ellipsoids, for previewing and testing paint stacks without lane A's body mesh.
// It is NOT one continuous skin (parts overlap); it only has to put every REGION at
// the right height, facing the right way, at a realistic vertex spacing.
//
// Proportions are fractions of stature H from Drillis & Contini (1966): chin 0.870,
// shoulder 0.818, chest 0.720, elbow 0.630, hip 0.530, wrist 0.485, fingertip 0.377,
// knee 0.285, ankle 0.039; shoulder width 0.259, hip width 0.191, foot length 0.152,
// head height 0.130. Frame: metres, +y up, +z forward, +x the character's left, soles on y = 0.

import { type MeshData, REGIONS, type Region } from "../body/contracts.ts";

/** Stature fractions (Drillis & Contini 1966) used to place the parts. */
export const STATURE = {
  chin: 0.870, shoulder: 0.818, chest: 0.720, elbow: 0.630, hip: 0.530, wrist: 0.485,
  fingertip: 0.377, knee: 0.285, ankle: 0.039, shoulderWidth: 0.259, hipWidth: 0.191,
  footLength: 0.152, headHeight: 0.130,
} as const;

/** One ellipsoid part: centre, radii (metres) and the rule that labels its vertices. */
interface Part {
  centre: [number, number, number];
  radii: [number, number, number];
  label: (x: number, y: number, z: number, nx: number, ny: number, nz: number) => Region;
}

const idx = (r: Region) => (REGIONS as readonly string[]).indexOf(r);

/** The part list for a mannequin of stature `height` metres. */
function parts(height: number): Part[] {
  const H = height, S = STATURE;
  const head = S.headHeight * H / 2, headY = H - head;
  const shoulderX = S.shoulderWidth * H / 2, hipX = S.hipWidth * H / 4;
  const limb = (x: number, top: number, bottom: number, r: number, label: Part["label"]): Part => ({
    centre: [x, (top + bottom) / 2 * H, 0], radii: [r * H, (top - bottom) / 2 * H, r * H], label,
  });
  const out: Part[] = [
    { // head: face on the front-lower part, hair on the top-back, scalp elsewhere
      centre: [0, headY, 0], radii: [0.8 * head, head, 0.9 * head],
      label: (_x, y, _z, _nx, ny, nz) => nz > 0.35 && y < headY + 0.45 * head ? "face" : ny > 0.2 || nz < -0.3 ? "hair" : "head",
    },
    { centre: [0, (S.chin + S.shoulder) / 2 * H, 0], radii: [0.03 * H, 0.04 * H, 0.03 * H], label: () => "neck" },
    { centre: [0, (S.shoulder + S.hip + 0.06) / 2 * H, 0], radii: [S.shoulderWidth * H / 2.2, (S.shoulder - S.hip - 0.06) / 2 * H, 0.065 * H], label: () => "torso" },
    { centre: [0, (S.hip + 0.02) * H, 0], radii: [S.hipWidth * H / 2, 0.06 * H, 0.06 * H], label: () => "pelvis" },
  ];
  for (const sx of [1, -1]) {
    out.push(
      { centre: [sx * 0.8 * head, headY, 0], radii: [0.012 * H, 0.03 * H, 0.018 * H], label: () => "ear" },
      limb(sx * shoulderX, S.shoulder, S.elbow, 0.03, () => "upperArm"),
      limb(sx * shoulderX, S.elbow, S.wrist, 0.025, () => "foreArm"),
      limb(sx * shoulderX, S.wrist, S.fingertip, 0.02, (_x, y) => y < (S.fingertip + 0.012) * H ? "nail" : "hand"),
      limb(sx * hipX, S.hip, S.knee, 0.045, () => "thigh"),
      limb(sx * hipX, S.knee, S.ankle, 0.035, () => "shin"),
      {
        centre: [sx * hipX, S.ankle * H / 2, S.footLength * H * 0.25], radii: [0.03 * H, S.ankle * H / 2, S.footLength * H / 2],
        label: (_x, _y, _z, _nx, ny) => ny < -0.5 ? "sole" : "foot",
      },
    );
  }
  return out;
}

/**
 * Build the mannequin. `segments` = longitude steps per ellipsoid (latitude steps are
 * segments / 2 + 1 rings); 32 gives ~3 cm vertex spacing on the torso at H = 1.8 m.
 * Vertex count = parts x (segments + 1) x (segments / 2 + 1).
 */
export function mannequinMesh(height = 1.8, segments = 32): MeshData {
  const ps = parts(height), lon = Math.max(4, Math.floor(segments)), lat = Math.max(2, Math.floor(lon / 2));
  const perPart = (lon + 1) * (lat + 1);
  const positions = new Float32Array(ps.length * perPart * 3);
  const normals = new Float32Array(ps.length * perPart * 3);
  const region = new Uint8Array(ps.length * perPart);
  const indices = new Uint32Array(ps.length * lon * lat * 6);
  let v = 0, t = 0;
  for (const part of ps) {
    const [cx, cy, cz] = part.centre, [a, b, c] = part.radii, first = v;
    for (let j = 0; j <= lat; j++) {
      const theta = Math.PI * j / lat; // 0 at the top pole
      for (let i = 0; i <= lon; i++) {
        const phi = 2 * Math.PI * i / lon;
        const ux = Math.sin(theta) * Math.sin(phi), uy = Math.cos(theta), uz = Math.sin(theta) * Math.cos(phi);
        const x = cx + a * ux, y = cy + b * uy, z = cz + c * uz;
        // Ellipsoid normal: gradient of (x/a)^2 + (y/b)^2 + (z/c)^2, normalised.
        let nx = ux / a, ny = uy / b, nz = uz / c;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len; ny /= len; nz /= len;
        positions.set([x, Math.max(0, y), z], v * 3);
        normals.set([nx, ny, nz], v * 3);
        region[v] = idx(part.label(x, y, z, nx, ny, nz));
        v++;
      }
    }
    for (let j = 0; j < lat; j++) {
      for (let i = 0; i < lon; i++) {
        const p0 = first + j * (lon + 1) + i, p1 = p0 + 1, p2 = p0 + lon + 1, p3 = p2 + 1;
        indices.set([p0, p2, p1, p1, p2, p3], t);
        t += 6;
      }
    }
  }
  return { positions, normals, indices, region };
}
