# Publishing to TikTok from Volt — setup

Volt now publishes video straight to TikTok through TikTok's own Content Posting API. It costs
nothing. Unlike Instagram/Facebook, TikTok has no equivalent of Meta's Graph API Explorer — Volt
itself is the OAuth client, so a few one-time steps happen in TikTok's own developer portal before
the first video goes out, and a review step happens before posts can go **public**.

Budget **30–45 minutes** for setup, then TikTok's own review runs in the background — commonly
**2–4 weeks**, sometimes faster. Nothing here recurs after this one-time setup.

**Read this before you start:** every video posted before TikTok approves the app is forced
**private (visible only to your own account)**. There is no setting to override this — it is
TikTok's own anti-abuse rule for unaudited apps, not a Volt limitation. "Post now" and scheduling
both work today; they just publish privately until the review clears.

---

## 1. A live privacy policy and terms-of-service page

TikTok requires both URLs before it will even save your app's configuration — this has to exist
**first**. If SME South Africa's main site (`smesouthafrica.co.za`) already has these, use those
URLs. If not, they need to go up before step 2.

---

## 2. Create a TikTok developer app

1. Go to <https://developers.tiktok.com/> → sign in → **Manage apps** → **Create an app**.
2. Fill in the app name (e.g. `Volt Publisher`), your privacy policy URL and terms-of-service URL
   from step 1, and a category.
3. Add two products to the app: **Login Kit** and **Content Posting API**. Inside Content Posting
   API's settings, enable **Direct Post**.
4. Under **Login Kit → Redirect URI**, add exactly:
   ```
   https://tshephos-lab.vercel.app/api/tiktok
   ```
   Exact match, `https`, no trailing slash, no query string — TikTok appends its own `?code=...`
   when it redirects back.
5. Request scopes **`user.info.basic`** and **`video.publish`** on the app. Both need TikTok's
   approval before any real (non-sandbox) TikTok account can grant them — this is the review this
   guide keeps mentioning. Submitting the request here is what starts that clock, so do this now
   even though you'll be testing in Sandbox in the meantime.

Note the **Client Key** and **Client Secret** from the app's Basic Information page — step 4 below
needs them.

---

## 3. Verify the domain that hosts Volt's videos (for scheduled + direct posting)

Volt hands TikTok a public URL to fetch the video from (the same pattern as Instagram's stories) —
TikTok requires the domain serving that URL to be verified once.

1. In the app dashboard, find **Verified Domains** (under Content Posting API or app settings).
2. Add the domain Volt's exported videos are actually hosted on (check an export's URL in Studio/
   Video — it's your Supabase storage domain or `tshephos-lab.vercel.app`, whichever one appears
   in the link).
3. Verify it with either the DNS TXT record option or the file-upload option TikTok offers —
   whichever is easier to do on that domain.

---

## 4. Add yourself as a Sandbox tester (needed before the app is approved)

Until TikTok approves the app, only TikTok accounts you've explicitly whitelisted can complete
sign-in with it at all — including your own.

1. In the app dashboard, open **Sandbox** → **Target users** → **Add account**.
2. Log in with the TikTok account SME South Africa will actually post from, and accept the
   Developer Terms of Service when prompted.
3. That account can now connect in step 5. Add any other TikTok accounts you want to test with the
   same way (up to 10 per sandbox).

---

## 5. Add environment variables in Vercel

*Project → Settings → Environment Variables*, then **redeploy**:

| Name | Value |
|---|---|
| `TIKTOK_CLIENT_KEY` | from step 2 |
| `TIKTOK_CLIENT_SECRET` | from step 2 |
| `TIKTOK_REDIRECT_URI` | *(optional)* only set this if you're not using the default `https://tshephos-lab.vercel.app/api/tiktok` — it must match step 2.4 exactly either way |

`SECRETS_MASTER_KEY` and `CRON_SECRET` must already be set (Instagram's setup covers both) — TikTok
reuses them rather than needing its own.

---

## 6. Create the queue table

Supabase → **SQL Editor** → paste and run [`sql/tiktok_queue.sql`](sql/tiktok_queue.sql).

---

## 7. Connect

Open **Volt → Admin**. Under **🎵 TikTok**, click **Connect with TikTok** — this sends you to
TikTok's own sign-in and consent screen (the account must be one added as a Sandbox tester in step
4, until the app is approved). Approve access and you're returned to Admin, connected.

---

## Using it

**Schedule** → **+ New post** → pick a video → select the **🎵 TikTok** chip under *Publish to* →
**⚡ Post now**, or **🗓️ Schedule** for a time. TikTok is video-only — there's no image-post
option, and no Feed/Story/Reel distinction the way Instagram has one.

Until the app is approved, every post lands **private** — the chip says "private only" and the
success message repeats it after posting, so it's never a silent surprise.

---

## What "approved" changes

Nothing on Volt's side — the exact same Connect and Post now flow. TikTok simply stops forcing
`SELF_ONLY` and lets Volt use whichever privacy level TikTok's `creator_info` call reports as
available for that account (public, friends, or private, depending on what the account itself
allows). Admin → TikTok's pill switches from *Private only* to *Connected* once that happens — no
reconnect needed.

## Limits and gotchas

- **~15 posts per TikTok account per rolling 24 hours** (TikTok's own documented figure).
- Before approval: **max 5 accounts** can authorize the app in any 24-hour window, and only
  accounts added as Sandbox testers (step 4) can sign in at all.
- **Refresh tokens rotate.** Every time Volt refreshes the connection behind the scenes, TikTok
  issues a brand-new refresh token — Volt stores the new one automatically each time. This is
  invisible day-to-day; it only matters if you're ever debugging the stored credential directly.
- A refresh token is valid **365 days** from last use — an org that never refreshes (no TikTok
  activity at all, including the background check Admin does) for a full year would need to
  reconnect. Normal use keeps it alive indefinitely.
- **A failed scheduled post retries twice**, then shows as *Failed* on the Schedule calendar with
  TikTok's own reason, same as Instagram/Facebook.
- TikTok's own processing of an accepted video can outlast the 5-minute drain window — "Published"
  on Volt's side means TikTok *accepted* the video (issued a `publish_id`), not that it has
  necessarily finished going live yet.

## If something breaks

| Message | Fix |
|---|---|
| *That connection link expired — try Connect again* | The sign-in took too long (the link is only valid for 10 minutes) — just click Connect again. |
| *TikTok isn't configured yet* | `TIKTOK_CLIENT_KEY` isn't set in Vercel — finish step 5. |
| Sign-in page says the account can't use this app | That TikTok account hasn't been added as a Sandbox tester yet (step 4) — required until the app is approved. |
| A post publishes but is private and you expected public | Normal until TikTok approves the `video.publish` scope for production (step 2.5) — check the app's review status in the TikTok developer portal. |
