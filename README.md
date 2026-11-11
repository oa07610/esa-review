# Translation review

A small static web page for native-speaker review of machine translations of medical exam questions, using
Error Span Annotation (ESA; Kocmi et al., WMT 2024): reviewers highlight error spans with a severity (minor or
major), then give each translation a score from 0 to 10 and answer whether the correct option is still correct.

- Open `https://oa07610.github.io/esa-review/?lang=<code>` with one of `zh vi hi th fa ur bn ne`.
- Work is saved in the reviewer's browser (localStorage). Nothing is sent anywhere: reviewers press **Export** to
  download a JSON file and send it back. **Resume from a file** loads an export on another device.
- Each block shows the English source and four translations, numbered 1 to 4 in a random order per block.
- `data/<lang>.json` holds the texts. Plain HTML, CSS and JavaScript; no build step and no dependencies apart from
  web fonts.
