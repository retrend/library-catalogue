# Library Catalogue (draft)

Static site for the Library Scout catalogue: ranked skills, plugins, templates and agents for online marketing, social media and video editing. No framework. Accounts are optional and use Supabase.

**This copy (`library-site-accounts`) adds optional accounts. It is NOT deployed.** Local preview only, on http://127.0.0.1:8770/. The live site at https://retrend.github.io/library-catalogue/ does not have accounts yet.

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

## Optional accounts (Supabase)

The site works fully signed out. Signing in adds:

- **☆ Save** on every card (catalogue and recommender results). Saved tools get **★ Saved**.
- **Save this search** next to the filters (and in the recommender once it has results). It stores the search text, type/need/licence/tag filters, sort and the recommender prompt, under a name you pick (defaults to the search text).
- **My library** drawer: saved searches (click to restore the exact view, Delete) and saved tools (source link, Draft into skill copy, Remove).
- **Saved only** chip to show only saved tools.

Signed out, clicking Save or Save this search opens the sign-in box with a short note. Nothing is queued.

Sign-in options: email + password (sign up / sign in), **Email me a magic link**, and **Continue with Google** (hidden until `GOOGLE_ENABLED: true` in `config.js`).

### Files

| File | What it does |
| --- | --- |
| `config.js` | Project URL, publishable key (public by design), `GOOGLE_ENABLED` flag |
| `account.js` | Auth modal, save toggles, saved searches, My library, error messages |
| `vendor/supabase.js` | `@supabase/supabase-js` 2.118.0 UMD bundle, copied from npm (no CDN). MIT, licence in `vendor/` |
| `supabase/migrations/…sql` | The schema as applied (record only) |
| `app.js` | Two small hooks: `hooks.isSaved` for the Saved only filter and `refresh()` |

`vendor/supabase.js` is loaded only when someone clicks **Sign in**, when a saved session (`sb-siykjgwzpwxtjzdorfsl-auth-token…` in localStorage) exists, or on the sign-in redirect (`?code=`). Signed-out visitors make no Supabase requests. The client uses PKCE, so the sign-in redirect comes back as `?code=…` and never clobbers the `#q=…` view hash; the code is removed from the URL afterwards.

Only the **publishable** key is in the front end. No secret or service_role key is used anywhere.

### Database

Project `siykjgwzpwxtjzdorfsl` (library-catalogue, ap-southeast-2, free plan).

- `public.saved_searches`: `id uuid pk`, `user_id uuid default auth.uid()` → `auth.users` on delete cascade, `label` (1–120 chars), `query` (≤500), `filters jsonb` (object, ≤2 KB), `prompt` (≤2000), `created_at`.
- `public.saved_entries`: pk `(user_id, entry_id)`, `entry_id` (1–200), `name` (≤300), `source_url` (http(s) only, ≤2048), `created_at`.
- RLS on both. Owner-only select/insert/update/delete for `authenticated`, all `(select auth.uid()) = user_id`, with `with check` on insert/update.
- `anon` has no grants at all (the API returns 401 / 42501).
- Per-user caps by trigger (`private.enforce_row_cap`, invoker rights, in an unexposed schema): 200 saved searches, 1,000 saved tools. The front end shows a plain message when a cap is hit.

### What Steven needs to do in the Supabase dashboard

The Supabase MCP connector can't change Auth settings (it has no tool for them), so these are manual.

1. **Site URL and redirect allow-list.** Dashboard → Authentication → URL Configuration:
   - Site URL: `https://retrend.github.io/library-catalogue/`
   - Redirect URLs: add `https://retrend.github.io/library-catalogue/` and `http://127.0.0.1:8770/`
   Until this is done, confirmation and magic-link emails point at `http://localhost:3000`.
2. **Email delivery.** Without custom SMTP, Supabase only sends auth emails to members of the Supabase org team, and only a few per hour. Everyone else gets "Email address not authorized". So email sign-up and magic links work for Steven's own address only until custom SMTP is set (Authentication → Emails → SMTP Settings; e.g. Resend, Postmark, Brevo). Password sign-in for an already-confirmed account doesn't need email.
3. **Google sign-in (optional).**
   1. Google Cloud console → APIs & Services → OAuth consent screen: set it up (External, app name, support email, add the `…/auth/userinfo.email`, `…/auth/userinfo.profile` and `openid` scopes).
   2. APIs & Services → Credentials → Create credentials → OAuth client ID → **Web application**.
      - Authorised JavaScript origins: `https://retrend.github.io` (and `http://127.0.0.1:8770` for testing)
      - Authorised redirect URIs: `https://siykjgwzpwxtjzdorfsl.supabase.co/auth/v1/callback`
   3. Copy the Client ID and Client secret.
   4. Supabase dashboard → Authentication → Sign In / Providers → **Google**: turn on, paste Client ID and Client secret, save. (The secret goes into Supabase only, never into this repo.)
   5. In `config.js` set `GOOGLE_ENABLED: true` and redeploy.

### Tests

```sh
NODE_PATH=/tmp/jsdom-test/node_modules node test/site.test.cjs /tmp/library-site-test/data.json   # catalogue (unchanged)
NODE_PATH=/tmp/jsdom-test/node_modules node test/recommend.test.cjs                                 # recommender (unchanged)
NODE_PATH=/tmp/jsdom-test/node_modules node test/account.test.cjs                                   # accounts, mocked Supabase client
node test/live-anon.check.cjs                                                                       # live project, public key only: anon can't read or write
```

`account.test.cjs` covers: zero Supabase requests while signed out (including Save clicks), lazy load on Sign in, Google flag, save/unsave, saved search restore (query, filters, sort, prompt), Saved only, My library actions, sign out, stored-session restore, `?code=` cleanup, sign-up/magic-link/password errors, offline, rate limit, row caps, escaping, and that the token is never shown or logged.

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
./serve.sh          # http://127.0.0.1:8770/  (./serve.sh 8769 for another port)
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

## Publishing

Live repo: `retrend/library-catalogue` (GitHub Pages from `main` / root), https://retrend.github.io/library-catalogue/.
The accounts work in this copy is not merged or pushed. Merge and publish only after Steven says yes, and after the Site URL step above.
