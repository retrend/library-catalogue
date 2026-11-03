# Library Catalogue (draft)

Static site for the Library Scout catalogue: ranked skills, plugins, templates and agents for online marketing, social media and video editing. No framework, no API calls.

**Status: NOT deployed.** Local preview only. Publishing needs Steven's yes.

## Describe your project (recommender)

A box above the catalogue: type what you're making ("I'm launching a podcast and need clips, captions and a posting plan"), press **Recommend tools** or Ctrl/⌘+Enter, and get:

- **Best overall**: the top 8 tools for the whole description
- **By need**: the 1–3 needs the project touches (from each entry's first tag), with the top 3 tools in each
- a **Why** line per tool: the prompt words it matched (with the related word, if it matched through a synonym) and its `use_when`, quoted as is
- **Copy shortlist**: plain text list of names and links
- the prompt is kept in the URL hash as `p=...`, so a plan can be shared or reloaded; it sits alongside the normal search/filter hash keys

All in `recommend.js`, in the browser, with no API key and no network calls beyond `data.json`. How it ranks:

1. Tokenise the prompt, drop stopwords, light stemming (clips/clip, posting/post).
2. Expand words through intent groups (shorts ↔ reels/vertical, clips ↔ cut/highlights, captions ↔ subtitles/transcripts, seo ↔ ranking/serp, ads ↔ paid/ppc, newsletter ↔ email, outreach ↔ cold/prospecting, photos ↔ retouch/raw/lightroom, venue ↔ club/golf/restaurant, tracking ↔ utm/attribution, …) at lower weight. Broad words such as "campaign", "promote" and "marketing" count at low weight so they don't pull in one need.
3. BM25F-style score over name, need tag (weighted highest), other tags, summary and use_when.
4. Multiply by a rank boost (up to +35% for the top of the catalogue) and by how much of the prompt the entry covers.
5. Infer needs from the needs of the top 30 results plus needs the prompt names outright; keep up to 3.

Semantic matching (MiniLM embeddings) was tried and left out: on test prompts it barely changed the top results, and it would mean a 23 MB model download from a CDN. Keyword mode is the only mode.

## Rebuild

```sh
python3 build_site.py                      # reads /workspace/library-catalog/catalog.jsonl, writes data.json
LIBRARY_CATALOG=/path/to/catalog.jsonl python3 build_site.py
```

The build is read-only over the catalogue and idempotent (data.json is only rewritten when its content changes; no build timestamp). It:

- never writes the `notes` field
- leaves out entries with `status: skip` (count only)
- leaves out any entry that trips the secrets / personal-details scan (keys, tokens, emails, phone numbers) and prints `EXCLUDED <id>`
- only keeps `http(s)` source URLs as links
- skips blank or malformed lines and reports them

## Preview

```sh
./serve.sh          # http://127.0.0.1:8767/  (./serve.sh 8769 for another port)
```

## Test

```sh
NODE_PATH=/tmp/jsdom-test/node_modules node test/site.test.cjs /tmp/library-site-test/data.json
```

Recommender tests run against the real `data.json` and print the top 5 for six prompts:

```sh
NODE_PATH=/tmp/jsdom-test/node_modules node test/recommend.test.cjs
```

The site test data is a temp catalogue of fake SAMPLE entries, built with
`LIBRARY_CATALOG=/tmp/library-site-test/catalog.jsonl LIBRARY_SITE_OUT=/tmp/library-site-test/data.json python3 build_site.py`.

## Publishing later (not done)

Suggested: a new public repo `retrend/library-catalogue` with GitHub Pages from `main` / root.
Publish `index.html`, `styles.css`, `app.js`, `recommend.js`, `data.json` (plus this README if wanted).
Site would be at https://retrend.github.io/library-catalogue/.
