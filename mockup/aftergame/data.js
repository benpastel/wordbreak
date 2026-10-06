// A plausible finished match, shared by the three after-game mockups.
// [second, player, word, index of the claim this one broke]
const LOG = [
  [0, 0, 'WEB'], [1, 0, 'EL'], [1, 3, 'LID'], [3, 0, 'OR'], [3, 1, 'JAM', 1],
  [3, 2, 'OAR'], [5, 2, 'ON'], [5, 3, 'O'], [6, 0, 'AS'], [7, 2, 'RAT', 8],
  [8, 0, 'PAN'], [8, 3, 'TEA', 7], [9, 2, 'OAK', 3], [10, 2, 'NO'], [11, 0, 'ON'],
  [12, 3, 'WEB', 14], [13, 1, 'FOX'], [16, 3, 'O'], [19, 3, 'SEA'], [23, 3, 'OF', 17],
  [24, 2, 'I'], [25, 0, 'O'], [25, 1, 'YE', 20], [33, 2, 'MOB', 19], [46, 0, 'US'],
  [47, 1, 'OAK'], [48, 3, 'MOB', 21], [50, 3, 'STONE'], [51, 2, 'I'], [54, 3, 'AWL'],
  [55, 0, 'FLOATS', 25], [57, 3, 'HOP', 24], [58, 0, 'UP'], [59, 2, 'I'], [61, 0, 'O'],
  [63, 0, 'DEW'], [65, 3, 'DUSK'], [66, 0, 'HOP'], [67, 1, 'IS'], [70, 1, 'A'],
  [73, 3, 'YE', 39], [76, 0, 'OX'], [77, 2, 'IN'], [86, 2, 'WE'], [87, 2, 'VOW', 41],
  [90, 2, 'OF'], [92, 1, 'HOP', 43], [92, 3, 'I'], [93, 2, 'EAT'], [95, 2, 'HUT'],
  [96, 0, 'I'], [97, 2, 'TIN'], [98, 0, 'WEB', 45], [101, 0, 'CHEAPER'], [110, 3, 'YE'],
  [111, 3, 'BAT', 47], [113, 3, 'OR'], [114, 2, 'IT'], [119, 0, 'GUST', 54], [120, 2, 'NO'],
  [123, 1, 'O'], [128, 1, 'ROT'], [132, 0, 'O'], [133, 1, 'BRAKE'], [133, 2, 'WEB'],
  [135, 1, 'NET', 59], [138, 2, 'PATIENT'], [138, 3, 'TO'], [139, 0, 'O'], [139, 1, 'LAMP'],
  [142, 1, 'IN'], [144, 1, 'HOP'], [147, 1, 'DIG'], [149, 1, 'RUG'], [158, 2, 'IS', 68],
  [161, 0, 'DEW'], [164, 3, 'PAN', 74], [167, 2, 'RAT'], [169, 2, 'ORE'], [172, 2, 'GO'],
  [173, 0, 'A'], [174, 2, 'WE'], [176, 0, 'A'], [176, 2, 'AWL'], [179, 0, 'HEAP'],
  [179, 2, 'SO', 80], [179, 3, 'FLOATS'], [180, 2, 'ARE'], [181, 1, 'EAT', 85], [183, 0, 'NO'],
  [183, 2, 'US'], [184, 2, 'MOB', 89], [185, 0, 'POT', 90], [186, 0, 'AT'], [187, 2, 'AWL', 82],
  [189, 0, 'ON'], [189, 2, 'OF'], [190, 2, 'ICE', 79], [192, 2, 'I'], [192, 3, 'ORE'],
  [193, 0, 'UP'], [197, 1, 'ICE'], [206, 2, 'AT'], [208, 3, 'LAMP'], [212, 0, 'BAT'],
  [213, 3, 'O'], [214, 1, 'NOOK', 105], [214, 3, 'DUSK'], [217, 3, 'NOOK'], [219, 3, 'A'],
  [221, 2, 'GLEAN'], [227, 2, 'NET'], [229, 0, 'RAT'], [229, 3, 'O'], [233, 3, 'MUD'],
  [234, 3, 'RAT'], [235, 1, 'NO', 113], [236, 3, 'NO'], [240, 3, 'ARE', 116], [245, 0, 'WREN'],
  [245, 2, 'ICE'], [249, 1, 'LID'], [254, 1, 'SPLINTER'], [256, 1, 'ROT'], [259, 1, 'ME'],
  [260, 0, 'A'], [262, 1, 'NOOK'], [262, 2, 'BAT'], [263, 2, 'A'], [263, 3, 'LAMP'],
  [266, 2, 'I'], [271, 1, 'BRAKE'], [275, 1, 'ON'], [279, 1, 'AN', 130], [282, 2, 'ZIP'],
  [283, 1, 'TIN', 124], [285, 0, 'HOP'], [286, 1, 'A'], [287, 3, 'A'], [288, 1, 'I'],
  [291, 1, 'IS', 138], [293, 2, 'IN'], [294, 1, 'BE', 137], [297, 1, 'FOX', 132], [297, 3, 'LID', 142],
];

const GAME = (() => {
  const size = 6, holdS = 25, lengthS = 300;
  const players = [
    { name: 'benji', color: 0 },
    { name: 'mara', color: 1 },
    { name: 'oz', color: 2 },
    { name: 'tess', color: 3 },
  ];
  const claims = LOG.map(([at, p, word, broke], i) => ({
    i, at, p, word, broke: broke ?? null, end: Math.min(at + holdS, lengthS),
    brokenBy: null, path: null,
  }));
  for (const c of claims) {
    if (c.broke === null) continue;
    const v = claims[c.broke];
    console.assert(c.word.length > v.word.length && c.at > v.at && c.at < v.at + holdS, c.word);
    v.end = c.at;
    v.brokenBy = c.i;
  }
  for (const c of claims) if (c.brokenBy === null) players[c.p].score = (players[c.p].score ?? 0) + c.word.length;

  // Paths: self-avoiding king-move walks that stay off tiles other live claims
  // hold, and a breaker always passes through a tile of the word it broke.
  let s = 7;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const nbrs = (k) => {
    const r = Math.floor(k / size), q = k % size, out = [];
    for (let dr = -1; dr <= 1; dr++) for (let dq = -1; dq <= 1; dq++) {
      const R = r + dr, Q = q + dq;
      if ((dr || dq) && R >= 0 && R < size && Q >= 0 && Q < size) out.push(R * size + Q);
    }
    return out;
  };
  const walk = (len, blocked, mustHit) => {
    const starts = shuffle([...Array(size * size).keys()]);
    const go = (path) => {
      if (path.length === len) return mustHit === null || path.some((k) => mustHit.includes(k)) ? path : null;
      for (const n of shuffle(nbrs(path[path.length - 1]))) {
        if (path.includes(n) || blocked.has(n)) continue;
        const r = go([...path, n]);
        if (r) return r;
      }
      return null;
    };
    for (const st of starts) {
      if (blocked.has(st)) continue;
      const r = go([st]);
      if (r) return r;
    }
    return null;
  };
  for (const c of claims) {
    const live = claims.filter((o) => o.path && o.at < c.at && o.end > c.at && o.i !== c.broke);
    const blocked = new Set(live.flatMap((o) => o.path));
    const mustHit = c.broke === null ? null : claims[c.broke].path;
    c.path = walk(c.word.length, blocked, mustHit) ?? walk(c.word.length, new Set(), mustHit);
  }
  return { size, holdS, lengthS, players, claims };
})();
