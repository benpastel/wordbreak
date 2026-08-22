// Trail editing: pressing a letter versus dragging across it.
import { createRequire } from 'node:module';
import { section, check, equal, done } from './harness.mjs';
const S = createRequire(import.meta.url)('../dist/shared/selection.js');

//   1 2 3      C A T
//   4 5 6      S E D
//   7 8 9      R O G
const game = {
  size: 3,
  grid: 'CATSEDROG'.split('').map((letter, i) => ({ id: i + 1, letter })),
  claims: [],
};
const claimed = {
  ...game,
  claims: [{ id: 'x', playerId: 'them', tileIds: [1, 2, 3], word: 'cat', claimedAt: 0, banksAt: 9e9 }],
};

section('pressing');
equal('press on empty starts a trail', S.pressTile(game, [], 5), [5]);
equal('press an adjacent letter extends', S.pressTile(game, [1], 2), [1, 2]);
equal('press the head letter removes it', S.pressTile(game, [1, 2, 3], 3), [1, 2]);
equal('press the head of a one-letter trail clears it', S.pressTile(game, [5], 5), []);
equal('press a non-head letter already held restarts', S.pressTile(game, [1, 2, 3], 2), [2]);
equal('press a non-adjacent letter restarts there', S.pressTile(game, [1], 9), [9]);
equal('press ignores claims entirely', S.pressTile(claimed, [], 1), [1]);

section('dragging');
equal('drag onto an adjacent letter extends', S.dragTile(game, [1], 2), [1, 2]);
equal('drag back over an earlier letter rewinds', S.dragTile(game, [1, 2, 3, 6], 2), [1, 2]);
equal('drag over the head is a no-op', S.dragTile(game, [1, 2], 2), [1, 2]);
equal('drag onto a non-adjacent letter is ignored', S.dragTile(game, [1], 9), [1]);
equal('drag never restarts the trail', S.dragTile(game, [1, 2], 9), [1, 2]);
equal('drag ignores claims entirely', S.dragTile(claimed, [4], 1), [4, 1]);

section('no-op drags keep array identity so React can skip the render');
{
  const sel = [1, 2];
  check('same array when the head is re-entered', S.dragTile(game, sel, 2) === sel);
  check('same array when ignored', S.dragTile(game, sel, 9) === sel);
}

section('press-to-undo, end to end');
{
  let sel = [];
  for (const id of [1, 2, 3]) sel = S.pressTile(game, sel, id);
  equal('traced C-A-T', sel, [1, 2, 3]);
  sel = S.pressTile(game, sel, 3);
  equal('pressing T again drops it', sel, [1, 2]);
  sel = S.pressTile(game, sel, 6);
  equal('a different letter then extends', sel, [1, 2, 6]);
}

done();
