# Translation review

A small static web page for native-speaker review of machine translations of English medical exam questions and of
short requests to AI assistants. For each of four translations of an English text, a reviewer answers three
questions: fluency (does it read naturally?), meaning (is the meaning of the English preserved?) and a task check
(for exam questions: is the correct option still correct and the only correct one? for requests: does the
translation ask for the same thing, without making it more or less harmful?). Highlighting the wrong words and a
comment are optional.

- Open `https://oa07610.github.io/esa-review/?lang=<code>` with one of `zh vi hi th fa ur bn ne`.
- Work is saved in the reviewer's browser (localStorage). Nothing is sent anywhere: reviewers press **Export** to
  download a JSON file and send it back. **Resume from a file** loads an export on another device.
- Each block shows the English source and four translations, numbered 1 to 4 in a random order per block.
- `data/<lang>.json` holds the texts. Plain HTML, CSS and JavaScript; no build step and no dependencies apart from
  web fonts.

**Content note:** some requests are deliberately harmful or written to sound harmful (they come from a published
over-refusal benchmark); they are shown so that reviewers can check that translation does not change them.

**Sources of the English texts:** MedMisBench, MedMCQA, and Health-ORSC-Bench (Zhang et al., 2026,
arXiv:2601.17642; CC BY-NC 4.0). The translations are machine translations of those texts, shared for
non-commercial research review.
