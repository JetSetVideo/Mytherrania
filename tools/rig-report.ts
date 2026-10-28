// Rig and animation report: the animation envelope of every class power (sin/cos/tan
// tensor bounds, sweep, prime joint) plus the standard reference bodies the physics and
// the tests share. A design/QA deliverable: it prints the numbers that
// docs/SPEC.md §4.2.4 and §3.1 describe, straight from the code.
//   deno run -A tools/rig-report.ts
import { allTensors } from "../src/game/AnimTensor.ts";
import { REFERENCE_BODIES, density, totalMass } from "../src/game/Physics.ts";

console.log("=== animation envelopes (per class power) ===");
console.log("class         kind     prime joint   travel°  maxVel   cos[min,max]      sin[min,max]      tan[min,max]");
for (const t of allTensors()) {
  const prime = t.joints.find((j) => j.joint === t.primeJoint) ?? t.joints[0];
  const deg = (r: number) => (r * 180 / Math.PI);
  console.log(
    `${t.className.padEnd(13)} ${t.kind.padEnd(8)} ${String(t.primeJoint).padEnd(13)} ` +
      `${deg(t.maxTravel).toFixed(1).padStart(6)}  ${prime.maxVel.toFixed(2).padStart(6)}   ` +
      `[${prime.minCos.toFixed(2)}, ${prime.maxCos.toFixed(2)}]`.padEnd(18) +
      `[${prime.minSin.toFixed(2)}, ${prime.maxSin.toFixed(2)}]`.padEnd(18) +
      `[${prime.minTan.toFixed(2)}, ${prime.maxTan.toFixed(2)}]`,
  );
}

console.log("\n=== reference bodies (shared by physics and tests) ===");
console.log("body          mass kg   density kg/m³   armour");
for (const [name, body] of Object.entries(REFERENCE_BODIES)) {
  console.log(`${name.padEnd(13)} ${totalMass(body).toFixed(1).padStart(7)}   ${density(body).toFixed(1).padStart(12)}   ${body.material.armour.toFixed(2)}`);
}
