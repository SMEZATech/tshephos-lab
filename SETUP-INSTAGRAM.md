# Publishing Instagram stories from Volt — setup

Volt now publishes stories, feed posts and reels straight to Instagram through Meta's own Content
Publishing API. It costs nothing. But Meta will not hand out a publishing token to software — only
to a person logged into a Meta account — so these steps have to be done by you, once.

Budget **20–30 minutes**. Nothing here recurs except step 5, and only if you skip 5c.

You do **NOT** need Meta App Review. App Review is for publishing on behalf of *other people's*
accounts. Publishing to your own account with your own app in Development mode is allowed, which is
exactly what this is.

---

## 1. Make sure the account is a professional one

In the Instagram app: **Settings → Account type and tools → Switch to professional account**
→ choose **Business** (Creator also works).

Then link it to a Facebook Page: **Settings → Business tools and controls → Connect a Facebook Page**.

A story cannot be published by API from a Personal account, and no token will fix that.

---

## 2. Create a Meta app

1. Go to <https://developers.facebook.com/apps> → **Create app**
2. Use case: **Other** → app type: **Business**
3. Name it something like `Volt Publisher`. Leave it in **Development** mode.
4. On the app dashboard, add the **Instagram** product (or just use the Graph API Explorer below —
   the product page is not strictly required for a Dev-mode app).

Note the **App ID** and **App Secret** from *App settings → Basic* — step 4 uses them.

---

## 3. Get a token with the right permissions

1. Open the **Graph API Explorer**: <https://developers.facebook.com/tools/explorer>
2. Top right: pick your app in **Meta App**.
3. Click **Generate Access Token** and sign in / grant access.
4. In **Permissions**, add all four:
   - `instagram_basic`
   - `instagram_content_publish`
   - `pages_show_list`
   - `pages_read_engagement`
5. Click **Generate Access Token** again so the token actually carries those scopes.
6. Copy the token.

> If Instagram doesn't appear in the account picker, go back to step 1 — the Page link is missing.

---

## 4. Make the token last

The Explorer gives you a token that dies in about an hour. Two clicks fix it:

1. Open the **Access Token Debugger**: <https://developers.facebook.com/tools/debug/accesstoken>
2. Paste the token → **Debug** → **Extend Access Token** (bottom of the page).
3. Copy the extended (~60 day) token.

**You do not need to repeat this every 60 days.** When you paste this token into Volt, Volt reads
your Pages, finds the Instagram account, and stores the **Page** access token instead — Page tokens
derived from a long-lived user token do not expire. Volt shows you which one it kept
("token does not expire") on the Schedule page.

---

## 5. Tell Volt

### 5a. Create the queue table

Supabase → **SQL Editor** → paste and run [`sql/ig_queue.sql`](sql/ig_queue.sql) from this repo.

### 5b. Add two environment variables in Vercel

*Project → Settings → Environment Variables*, then **redeploy**:

| Name | Value |
|---|---|
| `CRON_SECRET` | any long random string — this is what lets the scheduler publish |
| `IG_API_VERSION` | *(optional)* defaults to `v23.0`; bump if Meta retires it |

Optional, only to see token expiry in the UI:

| `FB_APP_ID` | your app ID from step 2 |
| `FB_APP_SECRET` | your app secret from step 2 |

`SECRETS_MASTER_KEY` must already be set (it encrypts every org secret). If it isn't, Volt will
tell you when you press Connect rather than silently failing.

### 5c. Add the same secret to GitHub

*Repo → Settings → Secrets and variables → Actions → New repository secret*

| Name | Value |
|---|---|
| `CRON_SECRET` | **the exact same string** as in Vercel |

This is what makes **scheduled** posting work. `.github/workflows/ig-drain.yml` runs every 5
minutes and publishes anything due. Skip this and "Post now" still works, but scheduled stories
never go out — the Schedule page says so in red when it detects this.

### 5d. Connect

Open **Volt → Schedule**. The Instagram card is at the top. Paste the token from step 4 → **Connect**.

It should immediately show `@yourhandle`, your follower count, `0/100 posts used today`, and
`token does not expire`.

---

## Using it

1. **Studio** → make a design → **Story (9:16)** → **Send to Scheduler**
2. **Schedule** → pick the graphic from the library
3. Select the **✨ @yourhandle** chip under *Publish to*
4. Post type **✨ Story**
5. **⚡ Post now**, or **🗓️ Schedule** for a time

A story needs no caption — Volt won't ask for one. Whatever is in the composer is for the feed
post; on a story the image is the message.

Volt converts story images to **JPEG** automatically. Instagram rejects PNG for stories, which is
the single most common reason a story "just doesn't post" elsewhere.

---

## Limits and gotchas

- **100 API posts per rolling 24 hours**, stories included. The card shows your usage.
- **Scheduled posts publish at or after their time**, never before. GitHub's cron is a 5-minute
  floor and can run late under load.
- **A failed scheduled post retries twice**, then shows as *Failed* on the Schedule page with
  Instagram's own reason. It is never silently dropped.
- **Reels need a public video URL** and take longer to process; Volt waits up to 40 seconds.
- Volt validates the image **when you schedule**, not at 6am the next morning — a bad URL is
  refused while you are still looking at the screen.

## If something breaks

The Schedule page shows Instagram's own error text. The two you are most likely to see:

| Message | Fix |
|---|---|
| *No Instagram Business account is attached to any Page…* | Step 1 — link the Page, and check the account is Business/Creator |
| *Instagram only accepts JPEG for stories* | Shouldn't happen (Volt converts), but re-send from Studio if it does |
| *The 24-hour publishing limit is used up* | Wait — it is a rolling window |
| *Please sign in* / 401 | Your token was revoked or the app was switched to Live mode without review; redo steps 3–4 |
