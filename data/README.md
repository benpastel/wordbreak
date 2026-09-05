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
