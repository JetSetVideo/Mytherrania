import { scalarComposite, scalarOpCode } from "/Users/macmax/Desktop/Mytherrania/src/graphics/paint/Operators.ts";
const c = scalarOpCode("heightBlend"); let s = 7; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
let comm = 0, over = 0, mono = 0; const w = 0.0005;
for (let i = 0; i < 50000; i++) {
  const b = (r() - 0.5) * 0.01, x = (r() - 0.5) * 0.01, a = r();
  const f = (p: number, q: number, al: number) => scalarComposite(c, p, q, al, w, 0, 0, 0, -0.008, 0.008);
  comm = Math.max(comm, Math.abs(f(b, x, 1) - f(x, b, 1)));
  over = Math.max(over, f(b, x, 1) - Math.max(b, x));
  if (f(b, x + 1e-5, a) < f(b, x, a) - 1e-15 || f(b, x, Math.min(1, a + 0.01)) < f(b, x, a) - 1e-15 && x > b) mono++;
}
console.log(JSON.stringify({ commMaxErr: comm, overshootMax: over, overshootBound: w / 4, monotoneViolations: mono }));
