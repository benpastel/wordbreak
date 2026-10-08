// Seeded randomness, so a bot's choices can be replayed in the simulator and a bot
// keeps the same vocabulary for as long as it exists.

export type Rng = () => number;

/** mulberry32: small, fast, and good enough for game behaviour. */
export function seeded(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stable value in [0, 1) for this seed and string — the same answer every time. */
export function hash01(seed: number, s: string): number {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // One more mix so similar strings do not land on similar values.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** Standard normal, by Box–Muller. */
export function normal(rng: Rng): number {
  const u = Math.max(rng(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/** A positive multiplier centred on 1, for jittering durations. */
export function jitter(rng: Rng, sigma: number): number {
  return Math.exp(normal(rng) * sigma - (sigma * sigma) / 2);
}
