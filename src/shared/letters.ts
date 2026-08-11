// Letter frequencies taken from the aggregate face distribution of the classic
// 16 Boggle dice, which is tuned so a whole board stays playable. Q is dropped
// entirely: a bare Q is nearly unusable, and a Qu tile that counts as two letters
// would complicate every length comparison in the rules for one face in ~95.

const WEIGHTS: Record<string, number> = {
  A: 6, B: 2, C: 2, D: 3, E: 11, F: 2, G: 2, H: 5, I: 6,
  J: 1, K: 1, L: 4, M: 2, N: 6, O: 7, P: 2, R: 5, S: 6,
  T: 9, U: 2, V: 2, W: 3, X: 1, Y: 3, Z: 1,
};

const VOWELS = new Set(['A', 'E', 'I', 'O', 'U']);

const BAG: string[] = [];
for (const [letter, n] of Object.entries(WEIGHTS)) {
  for (let i = 0; i < n; i++) BAG.push(letter);
}

const VOWEL_BAG = BAG.filter((l) => VOWELS.has(l));
const CONSONANT_BAG = BAG.filter((l) => !VOWELS.has(l));

function pick(bag: string[]): string {
  return bag[Math.floor(Math.random() * bag.length)];
}

export function randomLetter(): string {
  return pick(BAG);
}

/** Share of the board that should be vowels before we stop forcing them. Boggle
 *  dice self-balance because you roll the whole set at once; we replace tiles one
 *  at a time, so without a floor a board can drift into unplayable consonant mush. */
const MIN_VOWEL_RATIO = 0.28;
const MAX_VOWEL_RATIO = 0.55;

/** Draw a replacement letter, nudging toward a playable vowel balance.
 *  `others` is every letter that will remain on the board around it. */
export function drawLetter(others: string[]): string {
  if (others.length === 0) return randomLetter();
  const vowels = others.filter((l) => VOWELS.has(l)).length;
  const ratio = vowels / others.length;
  if (ratio < MIN_VOWEL_RATIO) return pick(VOWEL_BAG);
  if (ratio > MAX_VOWEL_RATIO) return pick(CONSONANT_BAG);
  return randomLetter();
}
