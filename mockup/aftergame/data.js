// A plausible finished match, shared by the three after-game mockups.
// [second, player, word, index of the claim this one broke]
const LOG = [
  [3, 0, 'TRAIN'], [5, 1, 'SLOT'], [8, 2, 'MATE'], [12, 3, 'RUNE'],
  [15, 2, 'STONE', 1], [19, 1, 'TRAINS', 0], [24, 0, 'OAR'], [28, 3, 'LATER'],
  [33, 0, 'PLANET', 3], [37, 1, 'DUSK'], [41, 2, 'GRID'], [44, 3, 'FROST'],
  [47, 1, 'GRIDS', 10], [52, 0, 'HEAP'], [55, 2, 'CHEAPER', 13], [60, 3, 'QUIP'],
  [64, 1, 'TONE'], [68, 0, 'STONES', 16], [73, 3, 'WREN'], [77, 2, 'LOAF'],
  [80, 0, 'FLOATS', 19], [85, 1, 'ZEST'], [89, 3, 'WRENCH', 18], [93, 2, 'MINT'],
  [98, 0, 'GLEAN'], [102, 1, 'MINTED', 23], [106, 3, 'OXEN'], [111, 2, 'BRAKE'],
  [115, 0, 'SPRITE'], [119, 1, 'BRAKES', 27], [124, 3, 'CAPE'], [128, 2, 'ESCAPED', 30],
  [133, 0, 'ROT'], [137, 1, 'TROVE', 32], [142, 3, 'JINX'], [146, 2, 'ORBIT'],
  [151, 0, 'HABIT'], [155, 1, 'AWL'], [160, 3, 'SOLVENT'], [163, 2, 'MOTH'],
  [168, 0, 'MOTHER', 39], [172, 1, 'SPLINTER', 38], [178, 2, 'DIG'], [182, 3, 'GUST'],
  [186, 0, 'DIGEST', 42], [191, 1, 'NOOK'], [195, 2, 'QUOTE'], [200, 3, 'PATIENT'],
  [205, 0, 'LAMP'], [209, 1, 'PALM'], [213, 2, 'SAMPLE', 48], [218, 3, 'PALMS', 49],
  [223, 0, 'CREST'], [228, 1, 'RAIN'], [232, 2, 'TRAINED', 53], [236, 3, 'FERN'],
  [241, 0, 'INFERNO', 55], [245, 1, 'DART'], [250, 2, 'HOP'], [254, 3, 'SHOP', 58],
  [258, 0, 'VOW'], [262, 1, 'BASIL'], [267, 2, 'TOWER'], [271, 3, 'TOWERS', 62],
  [276, 0, 'YEARN'], [280, 1, 'PLAY'], [284, 2, 'DEW'], [288, 0, 'REPLAY', 65],
  [292, 1, 'MUD'], [296, 3, 'ECHO'],
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
