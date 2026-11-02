export {};
// Wave Z swarm board: an append-only message board the lane agents use to talk to each other.
//   deno run -A tools/board.ts post <FROM> <TO> <TYPE> "<message>"   (TYPE: CLAIM READY REVIEW PASS FAIL FIX ASK ANSWER DONE)
//   deno run -A tools/board.ts read [SINCE_N] [--to NAME]             (prints messages after #SINCE_N)
// Messages land in artifacts/wave-z/BOARD.md as "### [Z-n] FROM -> TO | TYPE | UTC" + body. Appends take an
// exclusive lock file so two agents never interleave.
const FILE = "artifacts/wave-z/BOARD.md";
const LOCK = FILE + ".lock";

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  await Deno.mkdir("artifacts/wave-z", { recursive: true });
  for (let i = 0; i < 400; i++) {
    try {
      const f = await Deno.open(LOCK, { createNew: true, write: true });
      f.close();
      try { return await fn(); } finally { await Deno.remove(LOCK).catch(() => {}); }
    } catch (e) {
      if (!(e instanceof Deno.errors.AlreadyExists)) throw e;
      // A stale lock older than 10 s is broken.
      const st = await Deno.stat(LOCK).catch(() => null);
      if (st?.mtime && Date.now() - st.mtime.getTime() > 10_000) await Deno.remove(LOCK).catch(() => {});
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  throw new Error("board lock timeout");
}

async function readAll(): Promise<string> {
  return await Deno.readTextFile(FILE).catch(() => "# Wave Z swarm board\n");
}

const [cmd, ...rest] = Deno.args;
if (cmd === "post") {
  const [from, to, type, ...msg] = rest;
  if (!from || !to || !type || msg.length === 0) throw new Error("usage: post FROM TO TYPE message");
  await withLock(async () => {
    const all = await readAll();
    const n = (all.match(/^### \[Z-\d+\]/gm) ?? []).length + 1;
    const at = new Date().toISOString().slice(0, 16).replace("T", " ");
    await Deno.writeTextFile(FILE, `${all.trimEnd()}\n\n### [Z-${n}] ${from} -> ${to} | ${type} | ${at} UTC\n${msg.join(" ")}\n`);
    console.log(`posted Z-${n}`);
  });
} else if (cmd === "read") {
  const since = Number(rest.find((a) => /^\d+$/.test(a)) ?? 0);
  const toIdx = rest.indexOf("--to");
  const to = toIdx >= 0 ? rest[toIdx + 1] : null;
  const all = await readAll();
  const blocks = all.split(/\n(?=### \[Z-)/).filter((b) => b.startsWith("### [Z-"));
  for (const b of blocks) {
    const m = /^### \[Z-(\d+)\] (\S+) -> (\S+)/.exec(b)!;
    if (Number(m[1]) <= since) continue;
    if (to && m[3] !== to && m[3] !== "ALL") continue;
    console.log(b.trim() + "\n");
  }
} else {
  console.log("usage: post FROM TO TYPE message | read [SINCE] [--to NAME]");
}
