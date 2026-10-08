// Every dial a bot has, as a function of one difficulty from 0 (extremely easy) to 1
// (extremely hard). Tuning means editing the anchor table below, not the brain.
//
// Each knob is pinned at five points — 0, ¼, ½, ¾ and 1 — and runs between them
// geometrically, since most of these are rates and durations where "twice as fast"
// is the step that feels even, not "200ms faster". The ends are deliberately far
// from the middle three: those cover the human range in gentle steps, so the slider
// is useful for picking a fair opponent, and the ends are there for trivial and
// impossible.

/** Values at difficulty 0, 0.25, 0.5, 0.75 and 1. */
type Anchor = [number, number, number, number, number];

const ANCHORS = {
  // --- spotting -----------------------------------------------------------------
  /** Median ms to spot one particular 3-letter word that is common, reads forwards
   *  and sits in focus. Every other word is this, scaled by the factors below. */
  spot3Ms: [20_000, 6_000, 3_500, 2_000, 400],
  /** Multiplier on that median per letter beyond three. Above 1 long words hide;
   *  below 1 they jump out, which is what makes the hardest bot reach for them. */
  perLetter: [4, 2.4, 1.9, 1.5, 0.85],
  /** Two-letter words are not what people look for, so they run this many times
   *  slower than a three-letter word rather than faster. */
  twoLetter: [3, 4, 5, 7, 12],
  /** How much path shape matters: the exponent on the per-step direction costs. At
   *  the top a backwards zig-zag is barely harder than a straight line. */
  shape: [3, 1.8, 1.2, 0.8, 0.15],
  /** How much rarity slows spotting, as an exponent on rank. */
  rarity: [0.35, 0.22, 0.15, 0.1, 0.04],

  // --- vocabulary ----------------------------------------------------------------
  /** Corpus rank at which the bot knows half the words. Below it knows most, above
   *  it fewer and fewer. */
  vocabRank: [1_500, 10_000, 25_000, 45_000, 120_000],
  /** Chance of knowing a short word that is not on the everyday list anyway. */
  oddShort: [0, 0, 0, 0.002, 0.02],

  // --- attention -----------------------------------------------------------------
  /** Radius of the patch in focus, in cells. Words outside it slow down with
   *  distance, by a factor of e every `focusFalloff` cells. */
  focusRadius: [0.8, 1.2, 1.5, 2, 6],
  focusFalloff: [0.5, 0.8, 1, 1.4, 3],
  /** Cells per √second the focus wanders while searching. */
  drift: [0.5, 0.6, 0.7, 0.8, 1],
  /** Chance that someone else's new claim pulls the focus to it. */
  attend: [0.15, 0.35, 0.5, 0.6, 0.9],
  /** How long a freshly reseeded tile goes half-unseen. */
  freshMs: [4_000, 2_200, 1_500, 1_000, 200],
  /** How long someone else's new claim takes to read before a longer word through
   *  it can come to mind. */
  newClaimMs: [5_000, 3_500, 2_500, 1_800, 400],
  /** Share of a half-spotted word's progress kept into the next search. */
  memory: [0.15, 0.35, 0.5, 0.65, 0.9],

  // --- claims --------------------------------------------------------------------
  /** Pull towards words that break someone else's claim. Under 1 the bot shies away
   *  from coloured tiles; over 1 it hunts them. */
  breakPull: [0.4, 0.9, 1.3, 1.7, 3],
  /** Extra pull as that claim nears banking: pull × (1 + urgency × fill). */
  urgency: [0, 0.6, 1, 1.5, 3],
  /** Pull towards words that run through its own claim — extending it. */
  ownPull: [0.5, 0.5, 0.45, 0.4, 0.3],
  /** Reluctance to break its own claim the closer that claim is to banking, as an
   *  exponent on the share of the hold still to run. A beginner does not notice;
   *  a strong player will not throw away a claim that is nearly in. */
  ownAversion: [0, 1, 2, 3, 6],

  // --- hands ---------------------------------------------------------------------
  /** Pause after a claim before looking at the board again. */
  reorientMs: [1_400, 800, 500, 350, 120],
  /** Pause between spotting a word and starting to select it. */
  hesitateMs: [700, 420, 300, 200, 80],
  /** Selecting each tile. */
  perTileMs: [220, 170, 140, 110, 70],
} satisfies Record<string, Anchor>;

export type Knobs = { [K in keyof typeof ANCHORS]: number };

function interpolate(anchor: Anchor, d: number): number {
  const seg = Math.min(3, Math.floor(d * 4));
  const t = d * 4 - seg;
  const a = anchor[seg];
  const b = anchor[seg + 1];
  // A zero has no ratio to run along, so a segment touching one goes in a line.
  return a > 0 && b > 0 ? a * (b / a) ** t : a + (b - a) * t;
}

export function knobsFor(difficulty: number): Knobs {
  const d = Math.max(0, Math.min(1, difficulty));
  const out = {} as Knobs;
  for (const k of Object.keys(ANCHORS) as (keyof Knobs)[]) out[k] = interpolate(ANCHORS[k], d);
  return out;
}

/** Fixed for every bot: shortest and longest words it will look for. One-letter
 *  words are legal but nobody plays them; past ten the search costs more than the
 *  words are ever found. */
export const MIN_LEN = 2;
export const MAX_LEN = 10;
