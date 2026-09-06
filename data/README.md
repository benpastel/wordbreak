# data

Server-side only. Nothing here is served to the browser.

## `word-frequency.txt`

Every word of `public/words.txt` that appears at least three times in an
OpenSubtitles frequency corpus, ordered most common first. A word's rank is its
line number; a word missing from the file is rarer than every word in it. This
is what decides the **most obscure** award at the end of a match.

Rebuild with `node scripts/build-frequency.mjs`.

Conversational English was chosen deliberately over news or books: the award is
really asking "would an ordinary person know this word", and film dialogue
answers that better. A news corpus of comparable size has never seen `zephyr`,
`aardvark`, `vex` or `jazzy`, all of which turn up on a game board constantly.

### Attribution

Derived from [FrequencyWords](https://github.com/hermitdave/FrequencyWords) by
Hermit Dave, built from the [OpenSubtitles2018](https://opus.nlpl.eu/OpenSubtitles2018.php)
corpus. That project's content is licensed
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), and this
filtered and reordered derivative is published under the same licence.

## `definitions.txt`

A one-line definition for every WordNet base lemma that a playable word can reach.
Inflected forms are resolved at lookup time by the same suffix rules the build
script uses, so `CATS` finds the definition of `CAT` without storing its own copy —
that halves the file for identical coverage. 53,658 lemmas cover 62% of the
dictionary. Shown under the **most obscure** word at the end of a match; words
without an entry simply appear without one.

Rebuild with `node scripts/build-definitions.mjs`.

### Attribution

From [Princeton WordNet 3.0](https://wordnet.princeton.edu/), used under the
[WordNet licence](https://opensource.org/license/wordnet) (OSI-approved,
BSD-style, commercial use permitted).

> WordNet 3.0 Copyright 2006 by Princeton University. All rights reserved.
>
> Permission to use, copy, modify and distribute this software and database and
> its documentation for any purpose and without fee or royalty is hereby granted,
> provided that you agree to comply with the following copyright notice and
> statements, including the disclaimer, and that the same appear on ALL copies of
> the software, database and documentation, including modifications that you make
> for internal use or for distribution.
>
> THE SOFTWARE AND DATABASE IS PROVIDED "AS IS" AND PRINCETON UNIVERSITY MAKES NO
> REPRESENTATIONS OR WARRANTIES, EXPRESS OR IMPLIED.
