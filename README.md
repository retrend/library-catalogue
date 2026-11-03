# Library Catalogue (draft)

Static site for the Library Scout catalogue: ranked skills, plugins, templates and agents for online marketing, social media and video editing. No framework, no API calls.

**Status: NOT deployed.** Local preview only. Publishing needs Steven's yes.

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
./serve.sh          # http://127.0.0.1:8767/
```

## Test

```sh
NODE_PATH=/tmp/jsdom-test/node_modules node test/site.test.cjs /tmp/library-site-test/data.json
```

The test data is a temp catalogue of fake SAMPLE entries, built with
`LIBRARY_CATALOG=/tmp/library-site-test/catalog.jsonl LIBRARY_SITE_OUT=/tmp/library-site-test/data.json python3 build_site.py`.

## Publishing later (not done)

Suggested: a new public repo `retrend/library-catalogue` with GitHub Pages from `main` / root.
Publish `index.html`, `styles.css`, `app.js`, `data.json` (plus this README if wanted).
Site would be at https://retrend.github.io/library-catalogue/.
