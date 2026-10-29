// Volt — SMESA 2026 mailers (gated; see index.js). © 2026 Tshepho Joel.
//
// Ported from rebrand-2026/emails/build_emails.py (the approved source). r26Email below is
// stringified and evaluated by email.html after /api/rebrand answers 200; it returns:
//   templates — five NEW registry keys (t26tuesday, t26funding, t26thursday, t26solutions, t26friday).
//               Existing keys are persisted in drafts and are never renamed.
//   starters  — each mailer's body as reorderable sections (every top-level block carries data-s26)
//   sections  — the 2026 section library, each with sample content, for "Add a 2026 section"
//
// Email rules held here: inline styles only (the <style> block is resets + phone stacking), tables
// for layout with bgcolor under every gradient, VML buttons for Outlook, PNG logos, stacks that fall
// back to Helvetica/Arial, CI-legal neutrals only, orange never small text, Kit merge tags verbatim.
// No `border-collapse:collapse !important` in the reset — it kills rounded card borders.

export function emailSource() {
  return "return (" + r26Email.toString() + ")(ctx);";
}

function r26Email(ctx) {
  "use strict";
  const A = ctx.assets || {};
  const J = "'Plus Jakarta Sans',Helvetica,Arial,sans-serif";
  const I = "Inter,Helvetica,Arial,sans-serif";
  const RED = "#DC183C", TINT = "#FDECEF", ORANGE = "#FF9900", NAVY = "#0C1F31", INK = "#121A21", MUTED = "#6A7581";
  const BORDER = "#E7EBEF", SLATE = "#F0F5F9", GREEN = "#29A37A", GREEN_T = "#E4F5EE", AMBER = "#AE6B0A", AMBER_T = "#FFF1E0";
  const HERO = "linear-gradient(115deg,#0C1F31 0%,#0C1F31 52%,#2b1626 80%,#5e1a2c 115%)";
  const ACCENT = "linear-gradient(135deg,#DC183C 0%,#FF9900 100%)";
  const WARM = "linear-gradient(135deg,#FFF8EE 0%,#FDEFF2 100%)";
  const SITE = "https://smesouthafrica.co.za";
  const PH = "https://placehold.co/520x273/F0F5F9/6A7581?text=Article+image";

  // ------------------------------------------------------------------ type + furniture
  const p = (t, size, color, weight, mb, lh, align) => `<p style="margin:0 0 ${mb == null ? 16 : mb}px 0;font-family:${I};font-size:${size || 16}px;line-height:${lh || 1.65};color:${color || INK};font-weight:${weight || 400};text-align:${align || "left"};">${t}</p>`;
  const eyebrow = (t, color, mb, align) => `<p style="margin:0 0 ${mb == null ? 10 : mb}px 0;font-family:${J};font-size:11px;line-height:14px;font-weight:800;letter-spacing:1.6px;text-transform:uppercase;color:${color || RED};text-align:${align || "left"};">${t}</p>`;
  const h2 = (t, mb, size, color) => `<h2 class="h2m" style="margin:0 0 ${mb == null ? 12 : mb}px 0;font-family:${J};font-size:${size || 24}px;line-height:1.22;font-weight:800;letter-spacing:-0.4px;color:${color || INK};">${t}</h2>`;
  const link = (t, url, color) => `<a href="${url}" target="_blank" style="color:${color || RED};font-weight:700;text-decoration:none;border-bottom:1px solid rgba(220,24,60,0.3);">${t}</a>`;
  const divider = (m) => `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin:${m == null ? 28 : m}px 0;"><tr><td height="1" bgcolor="${BORDER}" style="height:1px;font-size:0;line-height:0;background:${BORDER};">&nbsp;</td></tr></table>`;
  const image = (src, alt, url, mb) => {
    let tag = `<img src="${src}" width="520" alt="${alt}" style="display:block;width:100%;max-width:520px;height:auto;border:0;border-radius:12px;">`;
    if (url) tag = `<a href="${url}" target="_blank" style="text-decoration:none;border:0;">${tag}</a>`;
    return `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin:0 0 ${mb == null ? 18 : mb}px 0;"><tr><td style="padding:0;line-height:0;font-size:0;">${tag}</td></tr></table>`;
  };
  const related = (title, url) => `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin:4px 0 6px 0;"><tr>
<td width="4" bgcolor="${RED}" style="width:4px;background:${RED};border-radius:12px 0 0 12px;font-size:0;">&nbsp;</td>
<td bgcolor="${SLATE}" style="background:${SLATE};padding:14px 18px;border-radius:0 12px 12px 0;">
${eyebrow("Related reading", MUTED, 4)}
<a href="${url}" target="_blank" style="font-family:${J};font-size:15px;line-height:1.4;font-weight:700;color:${INK};text-decoration:none;">${title} &rarr;</a>
</td></tr></table>`;
  const seriesPill = (t, bg, fg) => `<table role="presentation" border="0" cellspacing="0" cellpadding="0" style="margin:0;"><tr><td bgcolor="${bg || RED}" style="background:${bg || RED};border-radius:8px;padding:7px 11px;font-family:${J};font-size:11px;line-height:12px;font-weight:800;letter-spacing:1.6px;text-transform:uppercase;color:${fg || "#FFFFFF"};">${t}</td></tr></table>`;
  // Bulletproof button. 'accent' is the CI's red→orange, reserved for the ONE hero CTA per email.
  function button(label, url, kind, align, mt, mb, vmlW) {
    kind = kind || "primary";
    const bg = { primary: RED, accent: RED, navy: NAVY, light: "#FFFFFF" }[kind];
    const fg = kind === "light" ? NAVY : "#FFFFFF";
    const grad = kind === "accent" ? `background-image:${ACCENT};` : "";
    const shadow = kind === "accent" ? "box-shadow:0 8px 20px -8px rgba(220,24,60,0.55);" : "";
    const side = align === "center" ? "auto" : "0";
    return `<table role="presentation" class="btn-full" border="0" cellspacing="0" cellpadding="0" align="${align || "left"}" style="margin:${mt == null ? 6 : mt}px ${side} ${mb == null ? 6 : mb}px ${side};"><tr><td align="center" bgcolor="${bg}" style="border-radius:12px;background:${bg};${grad}${shadow}">
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${url}" style="height:50px;v-text-anchor:middle;width:${vmlW || 260}px;" arcsize="24%" stroke="f" fillcolor="${bg}"><center style="color:${fg};font-family:Arial,sans-serif;font-size:15px;font-weight:bold;">${label}</center></v:roundrect><![endif]-->
<!--[if !mso]><!--><a href="${url}" target="_blank" style="display:inline-block;padding:16px 28px;font-family:${J};font-size:15px;line-height:18px;font-weight:800;color:${fg};text-decoration:none;border-radius:12px;">${label}</a><!--<![endif]-->
</td></tr></table><div style="clear:both;line-height:0;font-size:0;">&nbsp;</div>`;
  }
  function checkRows(items, mark, fg, bg) {
    const marks = Array.isArray(mark) ? mark : items.map(() => mark || "&#10003;");
    fg = fg || GREEN; bg = bg || GREEN_T;
    return `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">` + items.map((t, i) => `<tr><td width="34" valign="top" style="padding:2px 0 12px 0;"><table role="presentation" border="0" cellspacing="0" cellpadding="0"><tr><td width="24" height="24" align="center" valign="middle" bgcolor="${bg}" style="width:24px;height:24px;border-radius:7px;background:${bg};font-family:${J};font-size:13px;font-weight:800;color:${fg};">${marks[i]}</td></tr></table></td>
<td valign="top" style="padding:0 0 12px 0;font-family:${I};font-size:15px;line-height:1.6;color:${INK};">${t}</td></tr>`).join("") + `</table>`;
  }
  const card = (inner, extra) => `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin:30px 0 0 0;border:1px solid ${BORDER};border-radius:16px;border-collapse:separate;${extra || ""}">${inner}</table>`;
  // A reorderable unit. data-s26 is how the section panel finds, moves and removes it.
  const S = (key, html) => `<div data-s26="${key}">${html}</div>`;

  // ------------------------------------------------------------------ the section library
  const SEC = {
    article: (o) => S("article", divider() + eyebrow(o.eyebrow) + h2(o.title) + (o.img ? image(o.img, o.title) : "") + o.body.map((t) => p(t)).join("") + (o.rr ? related(o.rr[0], o.rr[1]) : "")),
    webinar: (o) => S("webinar", card(`<tr>
<td class="stack" width="112" valign="top" bgcolor="${SLATE}" style="background:${SLATE};border-radius:16px 0 0 16px;padding:22px 0;text-align:center;">
<p style="margin:0;font-family:${J};font-size:34px;line-height:36px;font-weight:800;color:${INK};">${o.day}</p>
<p style="margin:4px 0 0 0;font-family:${J};font-size:11px;line-height:14px;font-weight:800;letter-spacing:1.6px;color:${MUTED};">${o.when}</p></td>
<td class="stack" valign="top" style="padding:22px 24px;">
${eyebrow("&#9679;&nbsp; Live webinar", RED, 10)}
<p style="margin:0 0 6px 0;font-family:${J};font-size:19px;line-height:1.3;font-weight:800;color:${INK};">${o.title}</p>
<p style="margin:0 0 14px 0;font-family:${I};font-size:14px;line-height:1.6;color:${MUTED};">${o.desc}</p>
${button(o.btn, o.url, "navy", "left", 0, 0, 200)}
</td></tr>`)),
    sponsored: (o) => S("sponsored", card(`<tr><td style="padding:26px 26px 22px 26px;">
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin:0 0 14px 0;"><tr>
<td style="font-family:${J};font-size:11px;line-height:14px;font-weight:800;letter-spacing:1.6px;text-transform:uppercase;color:${MUTED};">In partnership with ${o.brand}</td>
<td align="right"><table role="presentation" border="0" cellspacing="0" cellpadding="0"><tr><td bgcolor="${SLATE}" style="background:${SLATE};border:1px solid ${BORDER};border-radius:6px;padding:4px 8px;font-family:${J};font-size:10px;line-height:12px;font-weight:700;letter-spacing:1px;color:${MUTED};">SPONSORED</td></tr></table></td>
</tr></table>
${h2(o.title, 12, 21)}
${p(o.body, 15)}
${checkRows(o.steps, o.steps.map((_, i) => String(i + 1)), RED, TINT)}
${button(o.btn, o.url, "primary", "left", 8, 0, 280)}
</td></tr>`)),
    checklist: (o) => S("checklist", divider() + eyebrow(o.eyebrow || "Save this") + h2(o.title) + `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin:6px 0 0 0;"><tr>
<td class="stack stack-gap" width="50%" valign="top" style="padding:0 10px 0 0;"><p style="margin:0 0 12px 0;font-family:${J};font-size:14px;font-weight:800;color:${GREEN};">Do</p>${checkRows(o.dos)}</td>
<td class="stack" width="50%" valign="top" style="padding:0 0 0 10px;"><p style="margin:0 0 12px 0;font-family:${J};font-size:14px;font-weight:800;color:${RED};">Avoid</p>${checkRows(o.donts, "&#10005;", RED, TINT)}</td>
</tr></table>` + (o.note ? p(o.note, 14, MUTED, 400, 0) : "")),
    resources: (o) => S("resources", `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin:30px 0 4px 0;border-radius:16px;border-collapse:separate;"><tr><td bgcolor="${NAVY}" style="background:${NAVY};background-image:${HERO};border-radius:16px;padding:30px 28px;">
${eyebrow(o.eyebrow || "Resources Library", ORANGE)}
<p style="margin:0 0 8px 0;font-family:${J};font-size:23px;line-height:1.25;font-weight:800;color:#FFFFFF;">${o.title}</p>
<p style="margin:0 0 18px 0;font-family:${I};font-size:15px;line-height:1.6;color:rgba(255,255,255,0.75);">${o.body}</p>
<table role="presentation" border="0" cellspacing="0" cellpadding="0" style="margin:0 0 10px 0;"><tr>${o.chips.map((c) => `<td style="padding:0 6px 8px 0;"><table role="presentation" border="0" cellspacing="0" cellpadding="0"><tr><td bgcolor="#FFFFFF" style="background:#FFFFFF;border-radius:999px;padding:8px 14px;"><a href="${c[1]}" target="_blank" style="font-family:${J};font-size:12px;line-height:14px;font-weight:800;color:${NAVY};text-decoration:none;">${c[0]}</a></td></tr></table></td>`).join("")}</tr></table>
${button(o.btn, o.url, "accent", "left", 4, 0, 250)}
</td></tr></table>`),
    pullline: (o) => S("pullline", `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin:4px 0 6px 0;"><tr><td bgcolor="${TINT}" style="background:${TINT};border-radius:12px;padding:16px 20px;font-family:${J};font-size:17px;line-height:1.4;font-weight:800;color:${RED};">${o.text}</td></tr></table>`),
    step: (o) => S("step", divider(o.first ? 28 : 6) + `<table role="presentation" border="0" cellspacing="0" cellpadding="0" style="margin:0 0 12px 0;"><tr>
<td valign="middle" style="padding:0 14px 0 0;"><table role="presentation" border="0" cellspacing="0" cellpadding="0"><tr><td width="40" height="40" align="center" valign="middle" bgcolor="${RED}" style="width:40px;height:40px;border-radius:12px;background:${RED};background-image:${ACCENT};font-family:${J};font-size:15px;font-weight:800;color:#FFFFFF;">0${o.n}</td></tr></table></td>
<td valign="middle" style="padding:0;"><p style="margin:0 0 2px 0;font-family:${J};font-size:11px;line-height:12px;font-weight:800;letter-spacing:1.6px;text-transform:uppercase;color:${MUTED};">Step ${["one", "two", "three", "four", "five"][o.n - 1] || o.n}</p>
<h2 class="h2m" style="margin:0;font-family:${J};font-size:22px;line-height:1.25;font-weight:800;letter-spacing:-0.4px;color:${INK};">${o.title}</h2></td>
</tr></table>` + o.body.map((t) => p(t)).join("") + (o.card ? articleCard(o.card) : "")),
    articlecard: (o) => S("articlecard", articleCard(o)),
    apply: (o) => S("apply", `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin:10px 0 0 0;border-radius:16px;border-collapse:separate;"><tr><td bgcolor="${NAVY}" style="background:${NAVY};background-image:${HERO};border-radius:16px;padding:30px 28px;">
${eyebrow(o.eyebrow || "SME Funding", ORANGE)}
<p style="margin:0 0 10px 0;font-family:${J};font-size:25px;line-height:1.2;font-weight:800;color:#FFFFFF;">${o.title}</p>
<p style="margin:0 0 20px 0;font-family:${I};font-size:15px;line-height:1.6;color:rgba(255,255,255,0.75);">${o.body}</p>
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin:0 0 20px 0;"><tr>${o.trust.map((t) => `<td class="stack stack-gap" width="33%" valign="top" style="padding:0 8px 0 0;"><p style="margin:0 0 2px 0;font-family:${J};font-size:20px;line-height:24px;font-weight:800;color:#FFFFFF;">${t[0]}</p><p style="margin:0;font-family:${I};font-size:12px;line-height:1.5;color:rgba(255,255,255,0.6);">${t[1]}</p></td>`).join("")}</tr></table>
${button(o.btn, o.url, "accent", "left", 0, 0, 290)}
</td></tr></table>`),
    checks: (o) => S("checks", divider() + eyebrow(o.eyebrow) + h2(o.title) + checkRows(o.items) + (o.close ? p("<strong>" + o.close + "</strong>", 16, INK, 400, 22) : "")),
    resource: (o) => S("resource", card(`<tr><td style="padding:24px 24px 0 24px;">
<table role="presentation" border="0" cellspacing="0" cellpadding="0" style="margin:0 0 14px 0;"><tr><td bgcolor="${GREEN_T}" style="background:${GREEN_T};border-radius:6px;padding:6px 9px;font-family:${J};font-size:11px;line-height:12px;font-weight:800;letter-spacing:1.4px;color:${GREEN};">${o.kind || "TEMPLATE"}</td></tr></table>
<p style="margin:0 0 8px 0;font-family:${J};font-size:20px;line-height:1.3;font-weight:800;color:${INK};">${o.title}</p>
<p style="margin:0 0 18px 0;font-family:${I};font-size:15px;line-height:1.6;color:${MUTED};">${o.body}</p>
</td></tr><tr><td style="padding:0 24px;"><table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0"><tr><td style="border-top:1px solid ${BORDER};padding:14px 0 18px 0;">
<a href="${o.url}" target="_blank" style="font-family:${J};font-size:15px;font-weight:800;color:${RED};text-decoration:none;">&#8595;&nbsp; Download Now</a>
</td><td align="right" style="border-top:1px solid ${BORDER};padding:14px 0 18px 0;font-family:${I};font-size:12px;color:${MUTED};">${o.meta || "Free"}</td></tr></table></td></tr>`)),
    tools: (o) => S("tools", divider() + eyebrow(o.eyebrow || "Tools") + h2(o.title) + (o.intro ? p(o.intro) : "") + `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin:6px 0 0 0;">` +
      o.items.map((t, i) => { const c = [[TINT, RED], [GREEN_T, GREEN], [AMBER_T, AMBER]][i % 3]; return `<tr><td width="56" valign="top" style="padding:0 0 16px 0;"><table role="presentation" border="0" cellspacing="0" cellpadding="0"><tr><td width="42" height="42" align="center" valign="middle" bgcolor="${c[0]}" style="width:42px;height:42px;border-radius:12px;background:${c[0]};font-family:${J};font-size:18px;font-weight:800;color:${c[1]};">${t[0]}</td></tr></table></td>
<td valign="top" style="padding:0 0 16px 0;"><p style="margin:0 0 3px 0;font-family:${J};font-size:16px;line-height:1.35;font-weight:800;"><a href="${t[2]}" target="_blank" style="color:${INK};text-decoration:none;">${t[1]} &rarr;</a></p><p style="margin:0;font-family:${I};font-size:14px;line-height:1.55;color:${MUTED};">${t[3]}</p></td></tr>`; }).join("") + `</table>`),
    product: (o) => S("product", `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin:22px 0 4px 0;border:1px solid ${BORDER};border-radius:16px;overflow:hidden;border-collapse:separate;"><tr>
<td class="stack" width="56%" valign="middle" style="padding:26px 24px 24px 26px;">
${eyebrow(o.eyebrow || "SME Funding", RED, 8)}
<p class="big-m" style="margin:0 0 8px 0;font-family:${J};font-size:34px;line-height:36px;font-weight:800;letter-spacing:-1px;color:${INK};">${o.title}</p>
<p style="margin:0 0 16px 0;font-family:${I};font-size:15px;line-height:1.55;color:${MUTED};">${o.body}</p>
${button(o.btn, o.url, "primary", "left", 0, 0, 170)}
</td>
<td class="stack" width="44%" valign="middle" align="center" bgcolor="${NAVY}" style="background:${NAVY};background-image:${HERO};padding:24px 18px;text-align:center;">
<p style="margin:0;font-family:${I};font-size:13px;line-height:18px;color:rgba(255,255,255,0.6);">Access from</p>
<p style="margin:0 0 6px 0;font-family:${J};font-size:28px;line-height:32px;font-weight:800;color:#FFFFFF;">${o.from}</p>
<p style="margin:0;font-family:${I};font-size:13px;line-height:18px;color:rgba(255,255,255,0.6);">up to</p>
<p style="margin:0 0 14px 0;font-family:${J};font-size:28px;line-height:32px;font-weight:800;color:${ORANGE};">${o.to}</p>
<table role="presentation" border="0" cellspacing="0" cellpadding="0" align="center"><tr><td bgcolor="#FFFFFF" style="background:#FFFFFF;border-radius:10px;padding:8px 12px;font-family:${J};font-size:12px;line-height:14px;font-weight:800;color:${NAVY};">${o.note || "No commitment to apply"}</td></tr></table>
</td></tr></table>`),
    deal: (o) => S("deal", `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin:16px 0 0 0;border-radius:18px;border-collapse:separate;"><tr><td bgcolor="${RED}" style="background:${RED};background-image:${ACCENT};border-radius:18px;padding:3px;">
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="border-radius:16px;border-collapse:separate;"><tr><td bgcolor="#FFFFFF" style="background:#FFFFFF;border-radius:16px;padding:26px 26px 22px 26px;">
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0"><tr>
<td valign="top">${seriesPill("&#9733; Deal of the month", RED)}</td>
<td align="right" valign="top" class="hide-m"><p style="margin:0;font-family:${J};font-size:11px;font-weight:800;letter-spacing:1.4px;color:${MUTED};">${o.cat}</p></td></tr></table>
<p class="big-m" style="margin:18px 0 4px 0;font-family:${J};font-size:56px;line-height:56px;font-weight:800;letter-spacing:-2px;color:${RED};">${o.big}</p>
<p style="margin:0 0 12px 0;font-family:${J};font-size:21px;line-height:1.3;font-weight:800;color:${INK};">${o.title}</p>
<p style="margin:0 0 6px 0;font-family:${I};font-size:15px;line-height:1.6;color:${INK};">${o.body}</p>
${button(o.btn, o.url, "accent", "left", 12, 4, 200)}
<p style="margin:10px 0 0 0;font-family:${I};font-size:12px;line-height:1.5;color:${MUTED};">${o.fine}</p>
</td></tr></table></td></tr></table>`),
    deals: (o) => {
      const cell = (d, side) => `<td class="stack stack-gap" width="50%" valign="top" style="${side === "l" ? "padding:0 7px 14px 0;" : "padding:0 0 14px 7px;"}"><table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="border:1px solid ${BORDER};border-radius:16px;border-collapse:separate;"><tr><td style="padding:18px 18px 16px 18px;">
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin:0 0 12px 0;"><tr><td width="40" height="40" align="center" valign="middle" bgcolor="${d[1]}" style="width:40px;height:40px;border-radius:12px;background:${d[1]};font-size:19px;line-height:40px;">${d[0]}</td>
<td align="right" valign="middle" style="font-family:${J};font-size:10px;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;color:${MUTED};">${d[2]}</td></tr></table>
<p style="margin:0 0 6px 0;font-family:${J};font-size:16px;line-height:1.3;font-weight:800;color:${INK};">${d[3]}</p>
<p style="margin:0 0 12px 0;font-family:${I};font-size:13.5px;line-height:1.55;color:${MUTED};">${d[4]}</p>
<a href="${d[6]}" target="_blank" style="font-family:${J};font-size:14px;font-weight:800;color:${RED};text-decoration:none;">${d[5]} &rarr;</a>
</td></tr></table></td>`;
      let grid = ""; for (let i = 0; i < o.items.length; i += 2) grid += `<tr>${cell(o.items[i], "l")}${o.items[i + 1] ? cell(o.items[i + 1], "r") : '<td class="stack" width="50%"></td>'}</tr>`;
      return S("deals", divider() + eyebrow(o.eyebrow || "More deals") + h2(o.title) + (o.intro ? p(o.intro, 15, MUTED) : "") + `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin:6px 0 0 0;">${grid}</table>` + (o.fine ? p(o.fine, 12, MUTED, 400, 0) : ""));
    },
    questions: (o) => S("questions", divider() + eyebrow(o.eyebrow || "Before you buy") + h2(o.title) + `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin:8px 0 6px 0;">` +
      o.items.map((q, i) => `<tr><td width="52" valign="top" style="padding:0 0 14px 0;"><p style="margin:0;font-family:${J};font-size:28px;line-height:30px;font-weight:800;color:${RED};">0${i + 1}</p></td>
<td valign="top" style="padding:2px 0 14px 0;font-family:${I};font-size:15px;line-height:1.6;color:${INK};"><strong style="font-family:${J};">${q[0]}</strong> ${q[1]}</td></tr>`).join("") + `</table>` + (o.btn ? button(o.btn, o.url, "navy", "center", 6, 4, 260) : "")),
    community: (o) => S("community", divider() + eyebrow(o.eyebrow || "Also new this week") + h2(o.title) + `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin:8px 0 0 0;">` +
      o.items.map((f) => { const c = { ASK: [RED, TINT], SHARE: [AMBER, AMBER_T], WIN: [GREEN, GREEN_T], NEW: [GREEN, GREEN_T] }[f[0]] || [RED, TINT]; return `<tr><td width="58" valign="top" style="padding:0 0 18px 0;"><table role="presentation" border="0" cellspacing="0" cellpadding="0"><tr><td width="44" height="44" align="center" valign="middle" bgcolor="${c[1]}" style="width:44px;height:44px;border-radius:12px;background:${c[1]};font-size:20px;line-height:44px;">${f[1]}</td></tr></table></td>
<td valign="top" style="padding:0 0 18px 0;"><p style="margin:0 0 3px 0;font-family:${J};font-size:10px;line-height:12px;font-weight:800;letter-spacing:1.6px;color:${c[0]};">&#9679; ${f[0]}</p>
<p style="margin:0 0 4px 0;font-family:${J};font-size:17px;line-height:1.3;font-weight:800;color:${INK};">${f[2]}</p><p style="margin:0;font-family:${I};font-size:14.5px;line-height:1.6;color:${MUTED};">${f[3]}</p></td></tr>`; }).join("") + `</table>`),
    nudge: (o) => S("nudge", `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin:4px 0 0 0;border:1px solid ${BORDER};border-left:4px solid ${RED};border-radius:12px;border-collapse:separate;"><tr><td style="padding:16px 20px;">
<p style="margin:0 0 4px 0;font-family:${J};font-size:15px;line-height:1.35;font-weight:800;color:${INK};">${o.title}</p>
<p style="margin:0;font-family:${I};font-size:14px;line-height:1.6;color:${MUTED};">${o.body}</p></td></tr></table>`),
    weekend: (o) => S("weekend", `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin:28px 0 22px 0;border-radius:16px;border-collapse:separate;"><tr><td bgcolor="#FFF8EE" style="background:#FFF8EE;background-image:${WARM};border-radius:16px;padding:24px 24px 14px 24px;">
${eyebrow(o.eyebrow || "Three minutes this weekend", AMBER)}
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin:4px 0 0 0;">${o.items.map((t, i) => `<tr><td width="40" valign="top" style="padding:0 0 12px 0;"><table role="presentation" border="0" cellspacing="0" cellpadding="0"><tr><td width="26" height="26" align="center" valign="middle" style="width:26px;height:26px;border:2px solid ${RED};border-radius:8px;font-family:${J};font-size:12px;font-weight:800;color:${RED};">${i + 1}</td></tr></table></td>
<td valign="top" style="padding:3px 0 12px 0;font-family:${I};font-size:15px;line-height:1.55;color:${INK};">${t}</td></tr>`).join("")}</table>
</td></tr></table>` + (o.btn ? button(o.btn, o.url, "navy", "center", 0, 22, 200) : "")),
    reply: (o) => S("reply", `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin:0 0 26px 0;border:1px solid ${BORDER};border-radius:16px;border-collapse:separate;"><tr><td style="padding:20px 22px;">
<p style="margin:0 0 4px 0;font-family:${J};font-size:16px;line-height:1.35;font-weight:800;color:${INK};">${o.title}</p>
<p style="margin:0;font-family:${I};font-size:14.5px;line-height:1.6;color:${MUTED};">${o.body}</p></td></tr></table>`),
    note: (o) => S("note", `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin:2px 0 18px 0;"><tr><td bgcolor="${SLATE}" style="background:${SLATE};border-radius:12px;padding:14px 18px;font-family:${I};font-size:14px;line-height:1.6;color:${INK};">${o.text}</td></tr></table>`),
    cta: (o) => S("cta", button(o.btn, o.url, o.kind || "accent", o.align || "left", o.mt == null ? 0 : o.mt, o.mb == null ? 0 : o.mb, o.w || 220)),
    text: (o) => S("text", o.paras.map((t, i) => p(t, 16, INK, 400, i === o.paras.length - 1 && o.last0 ? 0 : 16)).join("")),
    signoff: (o) => S("signoff", `<table role="presentation" border="0" cellspacing="0" cellpadding="0" style="margin:6px 0 4px 0;"><tr>
<td valign="middle" style="padding:0 14px 0 0;"><table role="presentation" border="0" cellspacing="0" cellpadding="0"><tr><td width="44" height="44" align="center" valign="middle" bgcolor="${RED}" style="width:44px;height:44px;border-radius:22px;background:${RED};background-image:${ACCENT};font-family:${J};font-size:15px;font-weight:800;color:#FFFFFF;">${o.initials || "SA"}</td></tr></table></td>
<td valign="middle" style="padding:0;"><p style="margin:0;font-family:${I};font-size:15px;line-height:1.5;color:${MUTED};">${o.line}</p><p style="margin:0;font-family:${J};font-size:15px;line-height:1.5;font-weight:800;color:${INK};">${o.team}</p></td>
</tr></table>`),
  };
  function articleCard(o) {
    return `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin:6px 0 22px 0;border:1px solid ${BORDER};border-radius:16px;overflow:hidden;border-collapse:separate;">
<tr><td style="padding:0;line-height:0;font-size:0;"><a href="${o.url}" target="_blank" style="border:0;"><img src="${o.img || PH}" width="518" alt="${o.title}" style="display:block;width:100%;max-width:518px;height:auto;border:0;"></a></td></tr>
<tr><td style="padding:18px 22px 20px 22px;">
${eyebrow(o.kicker, RED, 8)}
<p style="margin:0 0 8px 0;font-family:${J};font-size:18px;line-height:1.3;font-weight:800;color:${INK};"><a href="${o.url}" target="_blank" style="color:${INK};text-decoration:none;">${o.title}</a></p>
<p style="margin:0 0 14px 0;font-family:${I};font-size:14px;line-height:1.6;color:${MUTED};">${o.summary}</p>
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0"><tr><td style="border-top:1px solid ${BORDER};padding:12px 0 0 0;"><a href="${o.url}" target="_blank" style="font-family:${J};font-size:14px;font-weight:800;color:${RED};text-decoration:none;">Read the article &rarr;</a></td></tr></table>
</td></tr></table>`;
  }

  // ------------------------------------------------------------------ shell: masthead + footer
  const SOCIAL = [["Instagram", "https://www.instagram.com/sme_za/"], ["Facebook", "https://www.facebook.com/SMESouthAfrica"],
    ["LinkedIn", "https://www.linkedin.com/company/18100109/"], ["WhatsApp", "https://whatsapp.com/channel/0029VafRQykBA1etEjbSak3J"],
    ["YouTube", "https://www.youtube.com/@SMESouthAfricaOfficial"]];
  const RESET = `<style>
body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%} table,td{mso-table-lspace:0pt;mso-table-rspace:0pt}
img{-ms-interpolation-mode:bicubic;border:0;outline:none;text-decoration:none} table{border-collapse:collapse}
a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important} u+#body a{color:inherit!important;text-decoration:none!important}
@media only screen and (max-width:620px){
 .wrap{width:100%!important;border-radius:0!important;border:0!important}
 .px{padding-left:22px!important;padding-right:22px!important}
 .stack{display:block!important;width:100%!important;max-width:100%!important;box-sizing:border-box!important}
 .stack-gap{padding:0 0 12px 0!important}
 .btn-full,.btn-full a{display:block!important;width:100%!important;box-sizing:border-box!important;text-align:center!important}
 .h1m{font-size:27px!important;line-height:33px!important}
 .h2m{font-size:21px!important;line-height:27px!important}
 .big-m{font-size:44px!important;line-height:46px!important}
 .hide-m{display:none!important;max-height:0!important;overflow:hidden!important}
}
</style>`;
  function top(t) {
    const m = Object.assign({}, t.mast, (ctx.mast && ctx.mast()) || {});
    const pill = t.pill ? seriesPill(t.pill[0], t.pill[1]) : "";
    const right = pill ? `<td align="right" valign="middle" style="padding:0;">${pill}</td>`
      : `<td align="right" valign="middle" style="padding:0;font-family:${J};font-size:11px;line-height:14px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:rgba(255,255,255,0.55);">${m.date || ""}</td>`;
    const logo = t.funding ? A.fundingReversed : A.logoReversed, lw = t.funding ? 150 : 168;
    return `<div id="body" style="background-color:${SLATE};padding:28px 10px 36px 10px;">
<!--[if !mso]><!--><link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet"><!--<![endif]-->
${RESET}
<!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table class="wrap" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto;background:#FFFFFF;border:1px solid ${BORDER};border-radius:16px;overflow:hidden;border-collapse:separate;">
<tr><td class="px" bgcolor="${NAVY}" style="background:${NAVY};background-image:${HERO};padding:30px 40px 36px 40px;">
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0"><tr>
<td align="left" valign="middle" style="padding:0;"><a href="${SITE}" target="_blank" style="border:0;text-decoration:none;"><img src="${logo}" width="${lw}" alt="${t.funding ? "SME Funding" : "SME South Africa"}" style="display:block;width:${lw}px;max-width:100%;height:auto;border:0;"></a></td>
${right}
</tr></table>
<p style="margin:34px 0 10px 0;font-family:${J};font-size:11px;line-height:14px;font-weight:800;letter-spacing:1.8px;text-transform:uppercase;color:${ORANGE};">${m.series || ""}</p>
<h1 class="h1m" style="margin:0 0 12px 0;font-family:${J};font-size:32px;line-height:38px;font-weight:800;letter-spacing:-0.8px;color:#FFFFFF;">${m.title || ""}</h1>
<p style="margin:0;font-family:${I};font-size:16px;line-height:1.6;color:rgba(255,255,255,0.75);">${m.sub || ""}</p>
</td></tr>
<tr><td height="4" bgcolor="${t.rule}" style="height:4px;font-size:0;line-height:0;background:${t.rule};">&nbsp;</td></tr>
<tr><td class="px" style="padding:34px 40px 34px 40px;">
<p style="margin-top: 0; font-weight: 600;">Hi {{ subscriber.first_name | default: "there" }},</p>
`;
  }
  function bottom(t) {
    const soc = SOCIAL.map((s) => `<a href="${s[1]}" target="_blank" style="color:#FFFFFF;text-decoration:none;font-weight:600;">${s[0]}</a>`).join('<span style="color:rgba(255,255,255,0.3);">&nbsp;&middot;&nbsp;</span>');
    const col = (head, items) => `<td class="stack stack-gap" width="33%" valign="top" style="padding:0 10px 0 0;"><p style="margin:0 0 8px 0;font-family:${J};font-size:11px;line-height:14px;font-weight:800;letter-spacing:1.6px;text-transform:uppercase;color:${ORANGE};">${head}</p>${items.map((i) => `<a href="${i[1]}" target="_blank" style="display:block;color:rgba(255,255,255,0.75);text-decoration:none;font-family:${I};font-size:13px;line-height:24px;">${i[0]}</a>`).join("")}</td>`;
    const cols = col("Platform", [["My Business", SITE + "/workspace/"], ["Funding Portal", SITE + "/sme-funding/"], ["Resources Library", SITE + "/sme-resources/"]]) +
      col("Insights", [["All Insights", SITE + "/insights/"], ["Founder Focus", SITE + "/founder-focus/"], ["Funding Summit", SITE + "/summit/"]]) +
      col("Community", [["Community Forum", SITE + "/sme-hub/"], ["Events &amp; Webinars", SITE + "/events/"], ["Podcast", SITE + "/podcast/"]]);
    return `
</td></tr>
<tr><td class="px" bgcolor="${NAVY}" style="background:${NAVY};padding:34px 40px 30px 40px;">
<img src="${A.logoReversed}" width="140" alt="SME South Africa" style="display:block;width:140px;height:auto;border:0;margin:0 0 14px 0;">
<p style="margin:0 0 18px 0;font-family:${I};font-size:13px;line-height:1.6;color:rgba(255,255,255,0.75);">A community for South African SME owners, connecting founders with funding, events, and the tools to scale.</p>
<p style="margin:0 0 24px 0;font-family:${I};font-size:13px;line-height:1.6;">${soc}</p>
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0"><tr>${cols}</tr></table>
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin:22px 0 0 0;"><tr><td height="1" bgcolor="#22344A" style="height:1px;font-size:0;line-height:0;background:#22344A;">&nbsp;</td></tr></table>
<p style="margin:16px 0 6px 0;font-family:${I};font-size:12px;line-height:1.6;color:rgba(255,255,255,0.55);">SME South Africa &middot; Building 2, 1st Floor, Clearwater Office Park, Strubens Valley, Roodepoort &middot; 011 704 2641 &middot; <a href="mailto:info@smesouthafrica.co.za" style="color:rgba(255,255,255,0.75);text-decoration:none;">info@smesouthafrica.co.za</a></p>
<p style="margin:0;font-family:${I};font-size:12px;line-height:1.6;color:rgba(255,255,255,0.55);">${t.reason} ${t.optdown} <a href="{{ unsubscribe_url }}" style="color:rgba(255,255,255,0.75);text-decoration:underline;">Unsubscribe</a> &middot; <a href="{{ subscriber_preferences_url }}" style="color:rgba(255,255,255,0.75);text-decoration:underline;">Preferences</a></p>
<p style="margin:12px 0 0 0;font-family:${I};font-size:11px;line-height:1.5;color:rgba(255,255,255,0.3);">&copy; 2026 SME South Africa. All rights reserved.</p>
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</div>`;
  }
  const DIGEST = `Too many emails? <a href="mailto:info@smesouthafrica.co.za?subject=Send%20me%20the%20monthly%20digest%20instead" style="color:rgba(255,255,255,0.75);text-decoration:underline;">Get just the monthly digest</a> &middot;`;

  // ------------------------------------------------------------------ the five mailers
  const MAILERS = {
    t26tuesday: { label: "Tuesday Brief · 2026", rule: RED,
      mast: { series: "The Tuesday Brief", date: "27 Oct 2026", title: "Side hustles to start before the year ends", sub: "Turn a skill you already have into extra income, and the five-step checklist to launch it this week." },
      reason: "You&rsquo;re receiving the Tuesday Brief because you subscribed to SME South Africa.", optdown: DIGEST,
      starter: () => [
        SEC.text({ paras: ["As the year draws to a close, many people are looking for ways to earn extra income and prepare financially for the months ahead. A side hustle can turn an existing talent, hobby or idea into an extra income stream, even with limited resources.",
          "In this brief: services you can sell this month, products in demand for the festive season, and a launch checklist to keep you honest."], last0: true }),
        SEC.article({ eyebrow: "01 &middot; Services", title: "Turn your skills into extra income", img: "https://smesouthafrica.co.za/wp-content/uploads/2026/10/data-1.png",
          body: ["Tutoring, graphic design, writing, photography or sewing: if you can deliver it well, someone is paying for it. As the year ends, individuals and businesses need help with events, promotional material and short-term projects.",
            `Price on the time, effort and costs involved. Share examples of your work, promote within your network and use early projects to build your portfolio and ${link("gain referrals", SITE + "/customer-referrals-can-boost-business-sales-heres-how-you-can-start-getting-them-2/")}.`],
          rr: ["Is an exam preparation business your next side hustle?", SITE + "/is-an-exam-preparation-business-your-next-side-hustle/"] }),
        SEC.article({ eyebrow: "02 &middot; Products", title: "Start a side hustle with products in demand",
          body: ["Handmade gifts, accessories, baked goods and personalised items sell well before year-end celebrations. Research what people in your area are buying, compare competitors&rsquo; prices and look for the gap.",
            `Before buying stock, work out production, packaging and delivery costs. Take pre-orders or sell a small batch first to test demand, then ${link("manage your budget", SITE + "/what-should-your-business-budget-look-like/")} around what actually sells.`],
          rr: ["Turn a hobby into a side hustle", SITE + "/turn-a-hobby-into-a-side-hustle/"] }),
        SEC.webinar({ day: "29", when: "OCT &middot; THU", title: "Business Compliance Essentials", desc: "The legal and regulatory requirements your business must meet to operate with confidence. 11:00 to 12:00, online.", btn: "Register free &rarr;", url: "https://luma.com/wxyfi4ek" }),
        SEC.sponsored({ brand: "Amazon&#8203;.co&#8203;.za", title: 'Grow your business by selling on <span style="white-space:nowrap;">Amazon&#8203;.co&#8203;.za</span>',
          body: "Amazon South Africa gives entrepreneurs a high-traffic channel where customers are already shopping. With Black Friday and the festive season close, it is the cheapest way to put your products in front of buyers ready to spend.",
          steps: ["Register a professional seller account (R1/month until 31 March 2027).", "Fill in your details using your business documents.", "List your products and go live before Black Friday."],
          btn: "Explore selling on Amazon &rarr;", url: "https://sellercentral.amazon.co.za/welcome?ld=SOA_ZA_PR" }),
        SEC.checklist({ title: "Your 5-step side hustle launch checklist",
          dos: ["Pick one skill or product to start with.", "Work out costs and price with profit built in.", "Tell 10 people (WhatsApp status, groups, friends).", "Land your first customer and ask for feedback.", "Keep income and expense records from day one."],
          donts: ["Underpricing your work.", "Over-buying stock before testing demand.", "Mixing personal and business money.", "Waiting until it&rsquo;s perfect to launch."],
          note: "<strong>Before you start earning:</strong> check whether you need to register your business and keep records for tax." }),
        SEC.resources({ title: "Business templates, ready to use", body: "Free for members: the paperwork every side hustle needs on day one.",
          chips: [["Invoices", SITE + "/sme-resource/business-invoice-template/"], ["Price lists", SITE + "/sme-resource/how-to-calculate-how-much-to-charge-for-your-services-pdf/"], ["Budgets", SITE + "/sme-resource/calculate-a-business-budget-template/"], ["Plans", SITE + "/sme-resource/business-plan-template-for-small-businesses/"], ["+ More", SITE + "/sme-resources/"]],
          btn: "Explore the templates &rarr;", url: SITE + "/sme-resources/" }),
      ] },
    t26funding: { label: "SME Funding Weekly · 2026", rule: GREEN, funding: true, pill: ["Funding Weekly", GREEN],
      mast: { series: "&#9889; This week&rsquo;s funding brief", title: "Is old debt eating into your December?", sub: "Three checks before you borrow for the festive season, then one application to get matched with the right funder." },
      reason: "You&rsquo;re receiving SME Funding Weekly because you asked for funding updates.",
      optdown: 'Not looking for funding right now? <a href="{{ unsubscribe_url }}" style="color:rgba(255,255,255,0.75);text-decoration:underline;">Leave just this list</a> &middot;',
      starter: () => {
        const U = "?utm_source=kit&amp;utm_medium=email&amp;utm_campaign=wed-28oct";
        return [
          SEC.text({ paras: ["The last two months of the year show how healthy a small business really is with money. Orders pick up, suppliers want paying upfront, and January&rsquo;s quiet weeks are already in sight. Before you look for new money, check the money you already owe."] }),
          SEC.pullline({ text: "Fix what you owe, know what you earn, then fund what grows." }),
          SEC.step({ n: 1, first: true, title: "Look again at the debt you already carry", body: ["A loan taken out in a rush two years ago keeps running at the same rate, even though the business is stronger today. Refinancing replaces it with a better deal: a lower rate, a longer term, or one payment instead of several.", "<strong>Try this today:</strong> list every loan, card and facility with its instalment and balance. If one costs far more than the rest, or ends just before your busiest months, refinance it before December."],
            card: { img: "https://smesouthafrica.co.za/wp-content/uploads/2026/10/Refinancing-for-SMEs--768x403.jpg", kicker: "Funding &middot; 14 October", title: "Refinancing for South African SMEs", summary: "Why so many owners avoid asking for better terms, and how refinancing lowers what you pay on money you already owe.", url: SITE + "/refinancing-for-south-african-smes/" + U } }),
          SEC.step({ n: 2, title: "Know your real sales figure", body: ["If you sell on a marketplace, the amount that lands in your account is not your sales figure. Fees, returns and money the platform still holds all sit in between, and funders read your bank statements closely."],
            card: { img: "https://smesouthafrica.co.za/wp-content/uploads/2026/10/That-marketplace-deposit-It-isnt-your-sales-figure-768x403.jpg", kicker: "Money &middot; 20 October", title: "That marketplace deposit? It isn&rsquo;t your sales figure", summary: "How online sellers can make sense of payouts, deductions and the money still sitting with the platform.", url: SITE + "/that-marketplace-deposit-it-isnt-your-sales-figure/" + U } }),
          SEC.step({ n: 3, title: "Choose money that fits your stage", body: ["A shop buying December stock needs something quick and short. A business with steady profits and a clear expansion plan may be ready for larger, longer funding. Our writers covered both ends this month."],
            card: { img: "https://smesouthafrica.co.za/wp-content/uploads/2026/10/Mezzaning-funding-for-SMEs--768x403.jpg", kicker: "Growth funding &middot; 16 October", title: "How high-growth SMEs can attract mezzanine financing", summary: "What mezzanine finance is, when it makes sense, and what funders look for before they say yes.", url: SITE + "/how-high-growth-smes-can-attract-mezzanine-financing/" + U } }),
          SEC.apply({ title: "Apply once. Get matched.", body: "If step one showed a gap between now and February, skip going lender to lender. One short application and our funding team matches you with the funders most likely to say yes.",
            trust: [["5 min", "on your phone"], ["1 form", "shared once"], ["Matched", "to funders that fit"]], btn: "Apply once on SME Funding &rarr;", url: SITE + "/sme-funding/apply/" + U }),
          SEC.checks({ eyebrow: "Before you apply", title: "A five-minute checklist", items: [
            "<strong>Know the exact amount.</strong> Work it out from real numbers, like last December&rsquo;s sales on your best sellers at supplier prices.",
            "<strong>Know what it&rsquo;s for.</strong> One clear purpose is easier to approve than a general cash injection.",
            "<strong>Know when it comes back.</strong> Pick a term that ends after your sales land, not before.",
            "<strong>Have three months of statements ready</strong>, with business and personal spending in separate accounts.",
            `<strong>Guard your accounts.</strong> No real funder asks for your PIN or a one-time password. ${link("How SMEs can combat fraud", SITE + "/fraud-remains-a-concern-but-heres-how-smes-can-combat-it/" + U)}.`],
            close: "Sort out the old debt now and December gets cheaper. Leave it, and January pays for both." }),
          SEC.signoff({ line: "Warm regards,", team: "The SME Funding Team", initials: "SF" }),
        ];
      } },
    t26thursday: { label: "Thursday Toolkit · 2026", rule: ORANGE,
      mast: { series: "The Thursday Toolkit", date: "29 Oct 2026", title: "Are you charging enough?", sub: "Find the sales you need to cover your costs, price on value, and the tools that show you whether it&rsquo;s working." },
      reason: "You&rsquo;re receiving the Thursday Toolkit because you subscribed to SME South Africa.", optdown: DIGEST,
      starter: () => [
        SEC.text({ paras: ["The right price decides how much your business earns and whether it lasts. As the festive season approaches, customer demand, supplier costs and spending habits all shift, so now is the time to review what you charge."], last0: true }),
        SEC.article({ eyebrow: "01 &middot; Break-even", title: "Understand how much you need to sell", img: "https://smesouthafrica.co.za/wp-content/uploads/2026/10/Pricing.png",
          body: [`Making sales does not always mean making a profit. ${link("Break-even analysis", SITE + "/sme-resource/how-to-calculate-your-breakeven-point-pdf/")} tells you how many products or hours you must sell to cover fixed and variable costs, so you can set targets that mean something.`,
            "With festive shopping close, use your break-even point to plan stock, prepare for demand, and check whether seasonal promotions still leave a profit."],
          rr: ["Explaining the break-even analysis", SITE + "/explaining-the-break-even-analysis/"] }),
        SEC.article({ eyebrow: "02 &middot; Value pricing", title: "Price your services by their value",
          body: ["Pricing doesn&rsquo;t have to follow the hours. Experience, specialised skill and the results you deliver all shape what customers will pay: a consultant who solves a complex problem delivers more than the meeting time.",
            `Decide whether hourly rates, fixed fees or packages suit your ${link("business model", SITE + "/innovative-business-models-for-smes-in-south-africa/")}, and make sure customers can see exactly what they get.`],
          rr: ["Are you charging per hour? Consider the value pricing model", SITE + "/are-you-charging-per-hour-why-you-should-consider-the-value-pricing-model/"] }),
        SEC.resource({ title: "Break-Even Point Calculation Template", body: "Plug in your costs and prices to see your sales target, and the day your business starts making money.", url: SITE + "/sme-resource/how-to-calculate-your-breakeven-point-pdf/", meta: "Free &middot; Excel" }),
        SEC.tools({ title: "Tools that show you if your prices work", intro: "A clear view of costs, sales and stock is where good pricing starts. Three worth considering:", items: [
          ["R", "Accounting software", SITE + "/sme-review/top-accounting-software-for-small-businesses-in-south-africa/", "Track income, expenses and profit, so you know what you earn after costs."],
          ["&#9636;", "Point-of-sale systems", SITE + "/sme-review/top-pos-systems-for-small-businesses/", "Record every sale and spot your best sellers during the festive rush."],
          ["&#9638;", "Inventory management", SITE + "/inventory-management-best-practices-for-smes/", "Catch slow-moving stock before it ties up the cash you need in December."]] }),
        SEC.product({ title: "Inventory Finance", body: "Stock up for December without draining your cash flow.", btn: "Apply now &rarr;", url: SITE + "/sme-funding/inventory-finance/", from: "R10,000", to: "R5 million" }),
      ] },
    t26solutions: { label: "SME Solutions · deals (2026)", rule: RED,
      mast: { series: "SME Solutions &middot; October deals", date: "Month-end", title: "The best business deals this month", sub: "Hand-picked offers from our solution partners, chosen to get you ready for the festive season while prices are good." },
      reason: "You&rsquo;re receiving SME Solutions because you subscribed to partner offers from SME South Africa.", optdown: "Have a question about a deal? Hit reply, we&rsquo;ll help. &middot;",
      starter: () => [
        SEC.text({ paras: ["Every month we go through the offers our solution partners are running and pick the ones worth your money. October&rsquo;s list has one goal: get your business festive-ready while you still have time to set things up."], last0: true }),
        SEC.deal({ cat: "ACCOUNTING", big: "80% off", title: "Cloud accounting for your first 3 months", body: "Send invoices with a pay-now button, see your profit every week and have your books funder-ready in two clicks, at a fraction of the price until the new year.",
          btn: "Claim 80% off &rarr;", url: SITE + "/go/xero/?s=kit-deals-oct", fine: "Offer set by the provider and may change. Check the price when you sign up." }),
        SEC.deals({ title: "More deals worth grabbing", intro: "Each one fixes a festive-season problem: taking payments, selling online, reaching customers and funding the rush.", items: [
          ["&#128179;", TINT, "Payments", "Card machine from R699 once-off", "No contract, no monthly rental and no settlement fees. Pairs with your phone.", "Get a card machine", SITE + "/go/yoco/?s=kit-deals-oct"],
          ["&#128722;", GREEN_T, "Online store", "3 days free, then US$1/month", "For your first three months. Build your store and take orders before you commit.", "Start your store", SITE + "/go/shopify-ecommerce-review/?s=kit-deals-oct"],
          ["&#9993;&#65039;", AMBER_T, "Email marketing", "Free forever plan", "No credit card needed. Build your list and send your festive campaign for free.", "Start free", SITE + "/go/brevo/?s=kit-deals-oct"],
          ["&#129309;", SLATE, "CRM", "Free for small teams", "Every lead, quote and customer in one place, so no enquiry gets missed.", "Get the free CRM", SITE + "/go/hubspot/?s=kit-deals-oct"],
          ["&#128202;", SLATE, "Accounting", "30 days free", "Prefer a different system? Try this one free for a month before you decide.", "Start your free trial", SITE + "/go/sage/?s=kit-deals-oct"],
          ["&#128176;", GREEN_T, "Working capital", "Up to R5 million", "Money in as little as 24 hours. No monthly admin fees; pay only for what you use.", "See what you qualify for", SITE + "/go/lula/?s=kit-deals-oct"]],
          fine: "All offers are set by the providers, were checked on 28 September 2026 and may change without notice." }),
        SEC.questions({ title: "A deal is only a deal if it solves a real problem", items: [
          ["Will it save me time every week?", "If yes, it pays for itself in hours you get back."],
          ["Will I still be happy paying in six months?", "Look at the full price after the offer ends."],
          ["Can I set it up before the busy season?", "A tool you learn in December is a tool you won&rsquo;t use."]],
          btn: "Compare all solutions &rarr;", url: SITE + "/sme-reviews/?utm_source=kit&amp;utm_medium=email&amp;utm_campaign=deals-oct" }),
      ] },
    t26friday: { label: "Community Friday · 2026", rule: GREEN, pill: ["Community Friday", GREEN],
      mast: { series: "This week in your community", title: 'Friends and family might forget your birthday. <span style="color:#FF9900;">We won&rsquo;t.</span>', sub: "Running a business means the days blur together. We&rsquo;ll remember for you, plus five new things in your community this week." },
      reason: "You&rsquo;re receiving this because you&rsquo;re a member of the SME South Africa community.", optdown: "",
      starter: () => [
        SEC.text({ paras: ["Last Friday we showed you a faster Hub, the member directory and your own app. This week the community got more personal, starting with the one day a year that should be about you.",
          "Add your birthday to your profile and, on the day, SME South Africa will be first to wish you well. Your connections get a gentle nudge too, so your network shows up for you, not just your inbox."] }),
        SEC.note({ text: `&#128274;&nbsp; <strong style="font-family:${J};">Your date stays private.</strong> Nobody can see your birthday or age on your profile.` }),
        SEC.cta({ btn: "Add my birthday &rarr;", url: SITE + "/members/me/profile/edit/", kind: "accent", w: 210 }),
        SEC.community({ title: "Five things that changed in your community", items: [
          ["ASK", "&#128172;", "See who reacted to your post", "Tap the reactions under any post to see exactly who liked or loved it. Every name is a warm introduction waiting to happen."],
          ["SHARE", "&#8617;", "Reply without leaving your feed", "Comments open inside the feed. Not interested in a post? Hide it and tell us why, and your feed learns."],
          ["NEW", "&#10024;", "A fresher feed", "No more seeing the same post again and again: your connections plus new voices, always moving."],
          ["NEW", "&#128276;", "Never miss an event or resource", "Notifications now flag new events and resources, each with its own tab to find later."],
          ["WIN", "&#127908;", "Summit talks, with the slides", `Speaker profiles now show their talks: watch, then download the slides free with membership. Start at ${link("our speakers page", SITE + "/speakers/")}.`]] }),
        SEC.nudge({ title: "Funding in one application", body: `About five minutes on your phone; your details fill in when you&rsquo;re signed in. ${link("Start your application", SITE + "/sme-funding/apply/")}.` }),
        SEC.weekend({ items: ["Add your birthday, so we can celebrate you.", "Open your last post and thank the people who reacted.", "Watch one summit talk and grab the slides."], btn: "Open my Hub &rarr;", url: SITE + "/sme-hub/" }),
        SEC.reply({ title: "What should we build next?", body: "Hit reply and tell us. We read every message, and many of this week&rsquo;s changes started with a note from a member." }),
        SEC.signoff({ line: "Have a good weekend,", team: "The SME South Africa team", initials: "SA" }),
      ] },
  };

  // The section library offered in the builder (sample content = the approved mailers' own).
  const LIBRARY = [
    ["text", "Paragraphs", () => SEC.text({ paras: ["Write your opening here. Bare paragraphs pick up the 2026 type automatically."] })],
    ["article", "Article section + related reading", () => MAILERS.t26tuesday.starter()[1]],
    ["step", "Step header + article card", () => MAILERS.t26funding.starter()[2]],
    ["articlecard", "Article card", () => SEC.articlecard({ kicker: "Insights &middot; this week", title: "Article title", summary: "One or two lines on why it is worth the click.", url: SITE + "/" })],
    ["webinar", "Webinar card", () => MAILERS.t26tuesday.starter()[3]],
    ["sponsored", "Sponsored block", () => MAILERS.t26tuesday.starter()[4]],
    ["checklist", "Do / avoid checklist", () => MAILERS.t26tuesday.starter()[5]],
    ["checks", "Tick list", () => MAILERS.t26funding.starter()[6]],
    ["resources", "Resources band", () => MAILERS.t26tuesday.starter()[6]],
    ["apply", "Apply band (SME Funding)", () => MAILERS.t26funding.starter()[5]],
    ["resource", "Resource card", () => MAILERS.t26thursday.starter()[3]],
    ["tools", "Tools list", () => MAILERS.t26thursday.starter()[4]],
    ["product", "Product split banner", () => MAILERS.t26thursday.starter()[5]],
    ["deal", "Deal of the month", () => MAILERS.t26solutions.starter()[1]],
    ["deals", "Deal grid", () => MAILERS.t26solutions.starter()[2]],
    ["questions", "Numbered questions", () => MAILERS.t26solutions.starter()[3]],
    ["community", "Community feature rows", () => MAILERS.t26friday.starter()[3]],
    ["weekend", "Weekend task box", () => MAILERS.t26friday.starter()[5]],
    ["reply", "Reply card", () => MAILERS.t26friday.starter()[6]],
    ["signoff", "Sign-off", () => SEC.signoff({ line: "Warm regards,", team: "The SME South Africa team", initials: "SA" })],
  ];

  const templates = {}, starters = {};
  Object.keys(MAILERS).forEach((k) => {
    const t = MAILERS[k];
    templates[k] = { label: t.label, r26: true, typo: ctx.typo, mast: t.mast, top: () => top(t), bottom: () => bottom(t) };
    starters[k] = () => t.starter().join("\n");
  });
  return { templates, starters, sections: LIBRARY.map((x) => ({ key: x[0], label: x[1], html: x[2] })) };
}
