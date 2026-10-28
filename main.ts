import { Engine } from "./src/engine/Engine.ts";

const engine = new Engine();

interface MythDiagnostics {
  snapshot(): unknown;
  engine: Engine;
}

(globalThis as unknown as Record<string, unknown>).__MYTHERRANIA__ = {
  snapshot: () => engine.snapshot(),
  engine,
} as MythDiagnostics;