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
2. Fill in **App details** (name it something like `Volt Publisher`, any contact email).
3. **Use cases** step: filter to **Content management** (or search "Instagram") and select
   **"Manage messaging and content on Instagram."** That is the one use case that covers
   publishing — don't add Marketing API, WhatsApp, Threads, etc., you don't need them.
4. **Business** step: connect a Business Portfolio (create one on the spot if you don't have one —
   any name is fine). You do **not** need to complete Business *Verification* (the ID-document
   flow) — that is only required for apps that publish to accounts they don't own. This app only
   ever publishes to your own account, which stays at Standard Access with no review needed.
5. **Requirements** step: should show green checks if step 1 above (professional account + linked
   Page) is already done. A red "not connected" here means go back and finish step 1 first.
6. **Overview** → **Finish**. Leave the app in **Development** mode — it never needs to go Live.

Note the **App ID** and **App Secret** from *App settings → Basic* — step 4 below uses them.

---

## 3. Get a token with the right permissions

1. Open the **Graph API Explorer**: <https://developers.facebook.com/tools/explorer>
2. Top right: pick your app in **Meta App**.
3. Click **Generate Access Token** and sign in / grant access.
4. In **Permissions**, add all six:
   - `instagram_basic`
   - `instagram_content_publish`
   - `pages_show_list`
   - `pages_read_engagement`
   - `instagram_manage_insights` — optional for publishing, but **required for the reporting on the
     Stats page** to show reach and profile-view trends. Without it, Stats still works — likes,
     comments and follower count don't need this permission at all — it just won't have those two
     numbers, and says so plainly rather than silently omitting them.
   - `pages_manage_posts` — optional for Instagram, but **required to also post to your Facebook
     Page** from the same connection (see "Facebook Page posting" below). Skip it if you only want
     Instagram; add it (and reconnect) any time later if you change your mind.
5. Click **Generate Access Token** again so the token actually carries those scopes.
6. Copy the token.

> If Instagram doesn't appear in the account picker, go back to step 1 — the Page link is missing.

> **Already connected without `instagram_manage_insights`?** Repeat steps 1–6 with it added, then
> paste the new token into Admin → Connections → Reconnect — it overwrites the
> stored one, nothing else needs to change.

---

## 4. Make the token last

The Explorer gives you a token that dies in about an hour. Two clicks fix it:

1. Open the **Access Token Debugger**: <https://developers.facebook.com/tools/debug/accesstoken>
2. Paste the token → **Debug** → **Extend Access Token** (bottom of the page).
3. Copy the extended (~60 day) token.

**You do not need to repeat this every 60 days.** When you paste this token into Volt, Volt reads
your Pages, finds the Instagram account, and stores the **Page** access token instead — Page tokens
derived from a long-lived user token do not expire. Volt shows you which one it kept
("token does not expire") on the Admin → Connections card.

---

## 5. Tell Volt

### 5a. Create the queue table(s)

Supabase → **SQL Editor** → paste and run [`sql/ig_queue.sql`](sql/ig_queue.sql). If you're also
setting up Facebook Page posting (below), run [`sql/fb_queue.sql`](sql/fb_queue.sql) too — it's a
separate small table, not an Instagram dependency, so skip it if you only want Instagram for now.

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
never go out — Admin → Connections says so in red when it detects this.

### 5d. Connect

Open **Volt → Admin → Connections**. Paste the token from step 4 → **Connect**. (Admin is owner-only — this is a one-time setup, done once by whoever owns the Meta app, not something every teammate needs to see.)

It should immediately show `@yourhandle`, your follower count, `0/100 posts used today`, and
`token does not expire`.

---

## Using it

1. **Studio** → make a design → **✨ Send Story → Instagram** (or **Send to Scheduler** for a feed
   graphic) — the image lands in the composer automatically the next time it opens, no library to
   dig through.
2. **Schedule** → **+ New post**
3. Select the **✨ @yourhandle** chip under *Publish to*
4. Post type **✨ Story**
5. **⚡ Post now**, or **🗓️ Schedule** for a time

A story needs no caption — Volt won't ask for one. Whatever is in the composer is for the feed
post; on a story the image is the message.

Volt converts story images to **JPEG** automatically. Instagram rejects PNG for stories, which is
the single most common reason a story "just doesn't post" elsewhere.

---

## Reporting

The **Stats** page treats this connection as just another channel — your `@handle (direct)` shows
up in the same channel picker as any Postiz-connected platform, with the identical dashboard, top
posts and best-time-to-post chart. Two tiers, deliberately:

- **Likes, comments, follower count, total posts** — work from the moment you connect. No extra
  permission.
- **Reach and profile-view trends** — need `instagram_manage_insights` (see step 3 above). Without
  it, the report says so directly instead of a KPI card just quietly never appearing.

Every post Stats reads is also logged into **Volt Brain** — the same table Postiz's own top-posts
action writes into — so Studio's Strategy Proxy gets stronger from real Instagram outcomes
regardless of which of the two publishing paths posted them.

---

## Facebook Page posting

Not a second integration — **the same Meta app, the same connected Page, the same token.**
Facebook Page posting only ever needed one more scope (`pages_manage_posts`, see step 3), because
LinkedIn-style partner gating turned out NOT to apply here: posting to a Page you administer is
Standard Access, self-serve, exactly like Instagram's own publishing permission.

**If you already connected Instagram before adding `pages_manage_posts`:** repeat step 3 with it
added, then Admin → Connections → Reconnect with the new token. There's no separate
"Connect Facebook" button — once the scope is on the connection, a **📘 Facebook Page** chip
appears under *Publish to* automatically.

What it can do today: **feed posts** (text), **photo posts** (image + optional caption), and
**photo Stories** — a photo uploaded unpublished then handed to `/{page}/photo_stories`, Meta's own
Page Stories API. A caption is optional on a photo post; a caption is required on a text-only post
(there has to be something to say); a Story carries no caption at all (Facebook's Story API has no
text-overlay field). There's still no Facebook **Reel** support in this build — that's a chunked
video-upload flow, a materially bigger job than the two photo-based paths above, and picking Reel
as the post type with Facebook selected is refused with a clear message rather than quietly posting
something else.

Scheduling works the same way as Instagram — same drain cron (`.github/workflows/ig-drain.yml` now
loops over both `instagram` and `facebook` each run), same atomic per-row claim, same three-attempt
retry before a row shows as *Failed* with Facebook's own error text.

**No fixed daily post cap** the way Instagram has an explicit 100/24h — Meta's own docs describe an
engagement-scaled formula instead, plus an undisclosed anti-spam layer, so there's nothing honest to
show as a quota number here the way the Instagram card does.

---

## Limits and gotchas

- **100 API posts per rolling 24 hours**, stories included. The card shows your usage.
- **Scheduled posts publish at or after their time**, never before. GitHub's cron is a 5-minute
  floor and can run late under load.
- **A failed scheduled post retries twice**, then shows as *Failed* on the Schedule calendar with
  Instagram's own reason. It is never silently dropped.
- **Reels need a public video URL** and take longer to process; Volt waits up to 40 seconds.
- Volt validates the image **when you schedule**, not at 6am the next morning — a bad URL is
  refused while you are still looking at the screen.

## If something breaks

Admin → Connections shows Instagram's own error text when a connection fails. The two you are most likely to see:

| Message | Fix |
|---|---|
| *No Instagram Business account is attached to any Page…* | Volt checks `/me/accounts` first, then walks your Business Portfolios (`/me/businesses` → each one's owned/client Pages) — most real accounts are set up this second way, so this should resolve on its own. If it still can't find it: confirm in Meta Business Suite that the Page really has an Instagram account under **Page Settings → Linked accounts** (this is a different toggle from Instagram's own "Connect a Facebook Page"), and that the account is Business/Creator. As a last resort, paste the numeric Instagram account ID directly into the optional field under the token box in Admin → Connections — find it via Graph API Explorer: query your Page's `id` with `fields=instagram_business_account` and use the `id` inside that object. |
| *Instagram only accepts JPEG for stories* | Shouldn't happen (Volt converts), but re-send from Studio if it does |
| *The 24-hour publishing limit is used up* | Wait — it is a rolling window |
| *Please sign in* / 401 | Your token was revoked or the app was switched to Live mode without review; redo steps 3–4 |

**A note on the app-creation wizard, since it changed recently:** the "Use cases" step now has a
sub-choice between **"API setup with Instagram login"** (a newer, Page-free flow) and **"API setup
with Facebook login"** (the classic Page-based one this guide is written for). If your app defaults
to the Instagram-login tab, switch to the Facebook-login one — that's the one whose permission names
(`pages_show_list`, `instagram_content_publish`, etc.) match everything above. In the Graph API
Explorer itself, watch the domain dropdown next to `graph.` at the top: it can silently flip from
`.facebook.com` to `.instagram.com` when certain permissions are picked, taking you into the other
flow without any obvious signal beyond the button relabelling to "Generate **Instagram** Access
Token." If you see that, switch the dropdown back to `.facebook.com`.

**Also:** checking a permission box in Explorer only affects the *next* token — it does not
retroactively apply to whatever token is already sitting in the Access Token field. After adding a
permission, always click **Generate Access Token** again before using or copying the token, and
sanity-check the "Access Token Info" panel actually lists all the scopes you expect.
