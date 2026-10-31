// Lane I-C tests: base-anchored props (BRIEF §1.7). propBaseOffset must be finite for every
// ObjectKind x 3 polygon details x 4 scales, and every model whose bounding-box min.y is not 0 must
// get a NON-ZERO offset — the table printed here is the list of models that were floating.
import { objectSize, type ObjectKind } from "../src/game/ArenaConfig.ts";
import { propBaseOffset, propGeometry } from "../src/graphics/props/PropModels.ts";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const KINDS: ObjectKind[] = ["pillar", "ramp", "platform", "crate", "rock", "arch", "tree", "gliderPad"];
const DETAILS = [0.6, 1, 2]; // the quality's polygonDetail range (low .. ultra)
const SCALES = [0.5, 0.8, 1.0, 1.5];
const COLOUR: Record<ObjectKind, string> = {
  pillar: "#b9c9c8", ramp: "#a07850", platform: "#7d6a55", crate: "#9a6b3a",
  rock: "#6f7470", arch: "#c9b48a", tree: "#4e7d3a", gliderPad: "#ef7455",
};

Deno.test("propBaseOffset is finite for every kind x detail x scale, and matches -boundingBox.min.y", () => {
  const notAnchored = new Set<ObjectKind>();
  for (const kind of KINDS) {
    const size = objectSize(kind);
    for (const detail of DETAILS) {
      for (const scale of SCALES) {
        const seed = 7 + KINDS.indexOf(kind) * 13 + Math.round(detail * 10) + Math.round(scale * 100);
        const offset = propBaseOffset(kind, size, scale, detail, COLOUR[kind], seed);
        assert(Number.isFinite(offset), `${kind} d=${detail} s=${scale}: offset finite`);
        assert(offset >= 0 && offset <= size.h * scale + 1e-6, `${kind}: offset within [0, h*scale]`);
        // Rebuild once to confirm the offset really is -min.y of the geometry that is drawn.
        const g = propGeometry(kind, size, scale, detail, COLOUR[kind], seed);
        g.computeBoundingBox();
        const minY = g.boundingBox!.min.y;
        g.dispose();
        assert(Math.abs(offset - -minY) < 1e-6, `${kind}: offset == -boundingBox.min.y`);
        if (Math.abs(minY) > 1e-9) {
          notAnchored.add(kind);
          assert(Math.abs(offset) > 1e-9, `${kind}: a non-base-anchored model must get a non-zero offset`);
        }
      }
    }
  }
  // The measurement the parent's live probe will read: which models were NOT base-anchored.
  console.log("propBaseOffset — kinds NOT base-anchored (floating models):", [...notAnchored].sort().join(", ") || "(none)");
  assert(notAnchored.size === KINDS.length, `every kind is centred, not base-anchored (got ${notAnchored.size}/${KINDS.length})`);
});

Deno.test("propBaseOffset per-kind table (scale 1, detail 1) — the float amounts the parent will see", () => {
  const rows: string[] = [];
  for (const kind of KINDS) {
    const size = objectSize(kind);
    const offset = propBaseOffset(kind, size, 1, 1, COLOUR[kind], 7);
    const g = propGeometry(kind, size, 1, 1, COLOUR[kind], 7);
    g.computeBoundingBox();
    const minY = g.boundingBox!.min.y;
    g.dispose();
    rows.push(`${kind.padEnd(10)} h=${size.h}  boundingBox.min.y=${minY.toFixed(4)}  propBaseOffset=${offset.toFixed(4)}`);
  }
  console.log("propBaseOffset table:\n" + rows.join("\n"));
  assert(rows.length === KINDS.length, "a row per kind");
});
