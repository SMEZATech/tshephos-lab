# Standing up Vantly (the commercial brand) — setup

Vantly runs the exact same codebase as Volt — same repo, same `api/`, same every page. What makes
it Vantly instead of Volt is: its own Supabase project (so a paying customer's data never lands in
your own internal SME South Africa org), its own Vercel deployment, and its own domain. The code
side of this is already done and pushed — `volt-auth.js` detects "Vantly" from the hostname and
switches every visible bit of branding automatically. This doc is the account-level setup only.

Budget **25–35 minutes**. Nothing here recurs.

---

## 1. Create the Supabase project

1. Go to <https://supabase.com/dashboard> → **New project**.
2. Name it `vantly` (or similar), pick a region close to your customers, set a strong database
   password (save it somewhere — you won't need it day-to-day, Volt only ever uses the API keys
   below, but Supabase asks for it once).
3. Wait for it to finish provisioning (~2 minutes).

## 2. Run the schema

In the new project: **SQL Editor → New query**. Run these files **in this exact order** — paste
each file's contents, run, then move to the next:

1. `sql/core_schema.sql` — org, membership, projects, the Brain, billing/usage. Must run first;
   the other files reference `org_secret`, which this creates.
2. `sql/api_key.sql` — powers the MCP (AI-tool) connection feature.
3. `sql/ig_queue.sql`
4. `sql/fb_queue.sql`
5. `sql/tiktok_queue.sql`

All five are safe to re-run if you make a mistake (everything is `if not exists`).

## 3. Get your three credentials

**Settings → API** in the new Supabase project. You need:

- **Project URL** — e.g. `https://abcdxyz.supabase.co`
- **`anon` `public` key** — a long JWT starting `eyJ...`
- **`service_role` key** — a second, different JWT. **Never put this one in front-end code or
  send it to me in a way that leaves a paper trail you don't control** — it belongs only in
  Vercel's environment variables (server-side).

## 4. Create the Vercel project

1. <https://vercel.com/new> → **Import** the same GitHub repo this codebase already deploys from
   (`SMEZATech/tshephos-lab`) — as a **second, separate** Vercel project, not a fork of the
   existing one.
2. Before the first deploy, add these **Environment Variables** (Project Settings → Environment
   Variables — or during import, whichever Vercel offers you):

   | Variable | Value |
   |---|---|
   | `SUPABASE_URL` | the Project URL from step 3 |
   | `SUPABASE_SERVICE_KEY` | the `service_role` key from step 3 |
   | `SUPABASE_ANON_KEY` | the `anon` `public` key from step 3 |
   | `ALLOWED_EMAIL_DOMAIN` | *(leave the value empty)* — Volt defaults this to `smesouthafrica.co.za`; an empty value opens sign-up to any email, which is what a commercial product needs |
   | `SECRETS_MASTER_KEY` | a fresh 32-byte base64 key — generate one with the command below, don't reuse Volt's |
   | `GEMINI_API_KEY` | a free key from <https://aistudio.google.com/apikey> — Vantly needs its own; Volt's is tied to Volt's quota |
   | `VOLT_ADMIN_EMAIL` | your email (whichever one you'll sign up to Vantly with) |

   Generate the master key locally, then paste the output:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```

   Everything else (Postiz, Kit, WordPress, other AI providers) is optional — add later, exactly
   like Volt's own setup, only when you actually turn that feature on for Vantly.

3. Deploy. Vercel gives you a `something.vercel.app` URL immediately — **if that URL contains
   "vantly"** (it will, if you named the project `vantly`), the branding already activates on
   that URL, before your real domain is even connected. Good moment to sanity-check sign-up works.

## 5. Connect your domain

1. In the new Vercel project: **Settings → Domains → Add**, type the domain you bought (e.g.
   `vantly.co.za`).
2. Vercel shows you either an **A record** (root domain) or a **CNAME record** (a subdomain like
   `www` or `app`) to add. Go to wherever you bought the domain (its registrar's DNS settings —
   not Vercel) and add exactly the record Vercel showed you.
3. DNS changes can take anywhere from a few minutes to a few hours to propagate. Vercel's Domains
   page shows a status indicator and auto-issues an SSL certificate once it sees the record.
4. Once it goes green, visit the domain — you should see Vantly's own sign-in gate, not Volt's.

**One assumption baked into the code:** brand detection checks whether the hostname *contains* the
word "vantly" (`location.hostname.indexOf("vantly")`). As long as the domain you bought has
"vantly" somewhere in it — `vantly.co.za`, `www.vantly.com`, `app.vantly.io`, all fine — this just
works with zero further code changes. If you ended up with a domain that doesn't literally contain
"vantly", tell me and I'll adjust the one line of detection logic.

## 6. Send me the three values

Once steps 1–4 are done, send me:
- the Supabase **Project URL**
- the Supabase **`anon` `public` key**
- the Vercel deployment's URL (or your connected domain, once live)

I'll drop them into the three placeholder fields already sitting in `volt-auth.js` (`BRANDS.vantly.supabaseUrl` / `.supabaseAnon` / `.apiHost`) and push — Vantly goes fully live with no other code changes. **Don't send me the `service_role` key or `SECRETS_MASTER_KEY`** — those only ever belong in Vercel's own environment variables, never pasted into chat.

---

## Known follow-up, not urgent

`admin.html`'s owner-check (`ADMIN_EMAILS`) is a hardcoded list containing your two existing
addresses — it'll work fine if you sign up to Vantly with one of those same emails, but if you
ever want a *different* email to be Vantly's admin, that list needs a small edit. Flag it when
you get there.
