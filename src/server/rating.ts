// Ratings: Glicko-2 (Glickman, "Example of the Glicko-2 system", 2013), with each
// match one rating period.
//
// A match of several players is scored as every pair of them playing each other:
// the higher final score wins, an equal score is a draw. Someone who left before the
// end loses to everyone who stayed, so walking out of a losing match never protects
// a rating; two who both left draw. Everyone is updated at once from the ratings
// they all had going in.
//
// Bots have fixed ratings with no uncertainty: they are a measured yardstick
// (bot/tournament.ts), so playing them moves you and never them.
//
// What players see is the cautious end of the estimate, rating - 2 * RD: a newcomer
// starts low and rises as the system becomes sure of them.

export interface Rating {
  rating: number;
  rd: number;
  volatility: number;
}

export const INITIAL: Rating = { rating: 1500, rd: 350, volatility: 0.06 };

/** How quickly volatility can change; Glickman suggests 0.3 to 1.2. */
const TAU = 0.5;
const SCALE = 173.7178;
const EPSILON = 1e-6;

/** The rating shown: as low as it plausibly is. */
export function shown(r: Rating): number {
  return r.rating - 2 * r.rd;
}

const g = (phi: number) => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
const expected = (mu: number, muJ: number, phiJ: number) => 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));

/** One player's new rating after a period of games, each against an opponent as
 *  they stood going in, scored 1, 0.5 or 0. */
export function update(me: Rating, games: { opponent: Rating; score: number }[]): Rating {
  if (games.length === 0) return me;
  const mu = (me.rating - 1500) / SCALE;
  const phi = me.rd / SCALE;
  const sigma = me.volatility;

  let vInv = 0;
  let sum = 0;
  for (const { opponent, score } of games) {
    const muJ = (opponent.rating - 1500) / SCALE;
    const phiJ = opponent.rd / SCALE;
    const e = expected(mu, muJ, phiJ);
    vInv += g(phiJ) ** 2 * e * (1 - e);
    sum += g(phiJ) * (score - e);
  }
  const v = 1 / vInv;
  const delta = v * sum;

  // The new volatility, by the Illinois algorithm as the paper sets out.
  const a = Math.log(sigma * sigma);
  const f = (x: number) =>
    (Math.exp(x) * (delta * delta - phi * phi - v - Math.exp(x))) / (2 * (phi * phi + v + Math.exp(x)) ** 2) -
    (x - a) / (TAU * TAU);
  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * TAU) < 0) k++;
    B = a - k * TAU;
  }
  let fA = f(A);
  let fB = f(B);
  while (Math.abs(B - A) > EPSILON) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA /= 2;
    }
    B = C;
    fB = fC;
  }
  const sigmaNew = Math.exp(A / 2);

  const phiStar = Math.sqrt(phi * phi + sigmaNew * sigmaNew);
  const phiNew = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muNew = mu + phiNew * phiNew * sum;
  return {
    rating: muNew * SCALE + 1500,
    rd: Math.min(INITIAL.rd, phiNew * SCALE),
    volatility: sigmaNew,
  };
}

export interface Entrant {
  id: string;
  rating: Rating;
  /** A bot: rated, but never moved. */
  fixed: boolean;
  /** Final score, or null for someone who left before the end. */
  score: number | null;
}

/** Score of a against b, by the rules at the top of this file. */
export function pairScore(a: Entrant, b: Entrant): number {
  if (a.score === null && b.score === null) return 0.5;
  if (a.score === null) return 0;
  if (b.score === null) return 1;
  return a.score > b.score ? 1 : a.score < b.score ? 0 : 0.5;
}

/** Everyone's rating after a match, from where they all stood going in. Bots, and
 *  anyone alone at the table, come out unchanged. */
export function rateMatch(entrants: Entrant[]): Map<string, Rating> {
  const out = new Map<string, Rating>();
  for (const me of entrants) {
    if (me.fixed) {
      out.set(me.id, me.rating);
      continue;
    }
    const games = entrants
      .filter((o) => o !== me)
      .map((o) => ({ opponent: o.rating, score: pairScore(me, o) }));
    out.set(me.id, update(me.rating, games));
  }
  return out;
}
