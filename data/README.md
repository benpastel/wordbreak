# data

Server-side only. Nothing here is served to the browser.

## `modern-words.txt`

Hand-curated additions to the ENABLE base list, which was last revised in 1999 and
so has never heard of `selfie`, `podcast` or `bitcoin`. Merged into
`public/words.txt` by `node scripts/build-words.mjs`, which is idempotent — this
file is the reviewable record of every departure from ENABLE.

Swapping lists was the alternative and a worse one: the free lists that are larger
([YAWL](http://archive.aspell.net/yawl-0.3.2.txt), 264k words) are *more* archaic,
not more current, and the official Scrabble lexicons (NWL, CSW) are copyrighted
compilations that have to be licensed. ENABLE's deep archaic tail is an asset here
anyway — it is what the **most obscure** award feeds on.

Additions clear the same bar as the base list: a-z only, 15 letters or fewer, no
`q`. The build script treats a violation as a hard error rather than a silent drop,
so nothing is quietly lost. Inflections are spelled out rather than generated,
because the game rewards length and a missing plural is a dead end.

## `word-frequency.txt`

Every word of `public/words.txt` that appears at least three times in an
OpenSubtitles frequency corpus, ordered most common first. A word's rank is its
line number; a word missing from the file is rarer than every word in it. This
is what decides the **most obscure** award at the end of a match.

Rebuild with `node scripts/build-frequency.mjs`.

The corpus is from 2018, so the newest of the `modern-words.txt` additions —
`yeet`, `upvote`, `deepfake` — are absent from it and fall through to the
letter-rarity tiebreak in `rarity()`. 206 of the 313 are ranked, including every
word common enough for the award to look wrong on.

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

A one-line definition for every base lemma a playable word can reach — 65,612
entries covering **81.7%** of the dictionary. Shown under the **most obscure**
word at the end of a match; words without an entry simply appear without one.

Two sources, in that order of preference:

- **Princeton WordNet 3.0** — modern and concise, but only reaches about two
  thirds of a Scrabble dictionary. It has never heard of `xebec` or `crocein`.
- **Webster's Unabridged (1913)** — strongest on exactly the archaic and
  technical vocabulary WordNet lacks, which is also what tends to win the award.

WordNet wins ties, including through its irregular-form lists, because `drank`
is the past tense of `drink` long before it is Webster's word for darnel grass.
Webster's cross-reference stubs (`pl. of Wolf.`) are dropped so the word falls
through to its base, where a real definition is waiting, and trailing
attributions (`Sir. T. Elyot.`) are stripped.

Only base lemmas are stored; inflections are resolved at lookup time by the
suffix rules in `scripts/build-definitions.mjs`, duplicated in
`src/server/definitions.ts` and covered by `test/definitions.test.mjs`. Words
those rules cannot derive — irregular plurals and past tenses — are written out
in full, so runtime coverage always equals what the build script reports.

Negating affixes are deliberately never stripped: showing the definition of
`hope` under `hopeless` would be worse than showing none.

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

Remaining entries are from Webster's Unabridged Dictionary (1913), which is in
the public domain, via [ssvivian/WebstersDictionary](https://github.com/ssvivian/WebstersDictionary)
(MIT).
