// Who a bot is called: lesser-known poets and writers of the 1800s, short enough to
// sit in a score row.

export const BOT_NAMES = [
  'Adelaide Procter',
  'Dora Greenwell',
  'Jean Ingelow',
  'Mathilde Blind',
  'Amy Levy',
  'Augusta Webster',
  'Menella Smedley',
  'Sydney Dobell',
  'Ebenezer Elliott',
  'Toru Dutt',
  'Sarah Piatt',
  'Celia Thaxter',
  'Henry Timrod',
  'Philip Marston',
  'Michael Field',
  'Lizette Reese',
  'Jones Very',
  'Thomas Chivers',
  'Ina Coolbrith',
  'Eliza Cook',
  'Letitia Landon',
  'George Darley',
  'Thomas Beddoes',
  'Edith Thomas',
  'William Barnes',
  'Frances Harper',
  'Alice Meynell',
  'Richard Dixon',
];

/** A name nobody at the table already has. */
export function botName(taken: Set<string>, rand: () => number = Math.random): string {
  const free = BOT_NAMES.filter((n) => !taken.has(n.toLowerCase()));
  const pool = free.length ? free : BOT_NAMES;
  return pool[Math.floor(rand() * pool.length)];
}
