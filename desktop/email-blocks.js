// Volt — email section builders + typography. © 2026 Tshepho Joel.
//
// Extracted from email.html so it can be TESTED DIRECTLY. Every check of this code used to have to
// regex the functions back out of a 2,500-line HTML file, which is brittle and meant the tests
// broke for reasons that had nothing to do with the email.
//
// Loaded as a plain classic script BEFORE email.html's own script, so its declarations are in
// scope for it. Deliberately not an ES module: the desktop app's offline fallback runs from
// file://, where module scripts are blocked by CORS but classic scripts load fine.
//
// RULES THAT LIVE HERE (see also the comments inline):
//  - a section is either fully inline-styled OR uses bare <p>/<h2>, which inlineBaseTypography()
//    normalises. Never rely on the shell's <style> block for anything that must survive the send.
//  - never hand-write a font fallback chain; use FAM_HEAD / FAM_BODY.
//  - assemble() must end with normalizeFontStacks(ensureFontFamily(...)) over the WHOLE email.

const esc = s => String(s==null?'':s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

const escAttr = s => String(s==null?'':s).replace(/"/g,'&quot;');

const HR = `<hr style="border: 0; border-top: 2px dashed #e2e8f0; margin: 25px 0;">`;

function mdLinks(t){
  return esc(String(t||'')).replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank">$1</a>');
}

function contentBlock(p){
  const paras = String(p.body||'').split(/\n\s*\n/).map(s=>s.trim()).filter(Boolean)
    .map(t => `<p>${mdLinks(t).replace(/\n/g,'<br>')}</p>`).join('');
  const img = p.image ? `<img src="${escAttr(p.image)}" alt="${escAttr(p.heading||'')}" class="newsletter-image">` : '';
  const rr = (p.rrTitle && p.rrLink) ? `<div class="related-reading"><span>📚 Related Reading:</span> <a href="${escAttr(p.rrLink)}" target="_blank" class="related-link">${esc(p.rrTitle)}</a></div>` : '';
  return `
                ${HR}
                ${p.heading ? `<h2>${esc(p.heading)}</h2>` : ''}
                ${img}
                ${paras}
                ${rr}`;
}

function webinarBlock(p){
  return `
                ${HR}
                <table data-volt="webinar" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border: 1px solid #e2e8f0; border-left: 4px solid #0a2c3d; border-radius: 8px; margin: 0 0 25px 0; box-shadow: 0 4px 12px rgba(0,0,0,0.04);">
                    <tr><td class="webinar-banner-td" style="padding: 25px;">
                        <p style="margin: 0 0 8px 0; font-family: 'Oswald', sans-serif; font-size: 11px; color: #9c1c1f; font-weight: 700; text-transform: uppercase; letter-spacing: 2px;">🔴 Live Webinar</p>
                        <h2 class="webinar-title" style="margin: 0 0 8px 0; font-size: 20px;">${esc(p.title)}</h2>
                        ${p.desc ? `<p style="margin: 0 0 15px 0; font-size: 14px;">${esc(p.desc)}</p>` : ''}
                        ${p.date ? `<table border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 20px;"><tr><td style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 12px;"><p style="margin: 0; font-family: 'Roboto', sans-serif; font-size: 13px; color: #0a2c3d; font-weight: 700;">${esc(p.date)}</p></td></tr></table>` : ''}
                        <table border="0" cellspacing="0" cellpadding="0"><tr><td align="center" style="border-radius: 6px; background-color: #0a2c3d;"><a href="${escAttr(p.link)}" target="_blank" style="font-size: 13px; font-family: 'Oswald', sans-serif; font-weight: 700; color: #ffffff !important; text-decoration: none; padding: 12px 24px; border-radius: 6px; display: inline-block; text-transform: uppercase; letter-spacing: 1px; border: none;">${esc(p.btn || 'Register Now')}</a></td></tr></table>
                    </td></tr>
                </table>`;
}

function resourceBlock(p){
  return `
                ${HR}
                <table data-volt="resource" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border: 2px dashed #9c1c1f; border-radius: 12px; margin: 30px 0; box-shadow: 0 8px 20px rgba(156,28,31,0.08); overflow: hidden;">
                    <tr><td style="padding: 35px 25px; text-align: center; background-image: radial-gradient(circle at 50% 0%, rgba(156,28,31,0.04) 0%, transparent 70%);">
                        <p style="margin: 0 0 10px 0; font-family: 'Oswald', sans-serif; font-size: 12px; color: #9c1c1f; font-weight: 700; text-transform: uppercase; letter-spacing: 2px;">SME RESOURCE</p>
                        <h3 style="margin: 0 0 15px 0; font-family: 'Oswald', sans-serif; font-size: 24px; color: #0a2c3d; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 900; line-height: 1.2;">${esc(p.title)}</h3>
                        ${p.desc ? `<p style="font-family: 'Roboto', sans-serif; font-size: 15px; color: #444444; line-height: 1.6; margin: 0 auto 25px auto; max-width: 450px;">${esc(p.desc)}</p>` : ''}
                        <table border="0" cellspacing="0" cellpadding="0" align="center" style="margin: 0 auto;"><tr><td align="center" style="border-radius: 6px; background-color: #9c1c1f; box-shadow: 0 5px 12px rgba(156,28,31,0.25);"><a href="${escAttr(p.link)}" target="_blank" style="font-size: 14px; font-family: 'Oswald', sans-serif; font-weight: 700; color: #ffffff !important; text-decoration: none; padding: 15px 30px; border-radius: 6px; display: inline-block; text-transform: uppercase; letter-spacing: 1.5px; border: none;">${esc(p.btn || 'DOWNLOAD NOW')}</a></td></tr></table>
                    </td></tr>
                </table>`;
}

function podcastBlock(p){
  // Guest / episode thumbnail (140px), or a branded fallback tile.
  const cover = p.cover
    ? `<img src="${escAttr(p.cover)}" width="140" alt="${escAttr(p.guest||'Guest')}" style="display:block;width:140px;height:auto;border-radius:12px;box-shadow:0 8px 20px rgba(0,0,0,0.4);border:1px solid #334155;background-color:#1e293b;">`
    : `<table border="0" cellspacing="0" cellpadding="0" style="width:140px;height:140px;background-color:#1e293b;border-radius:12px;border:1px solid #334155;box-shadow:0 8px 20px rgba(0,0,0,0.4);"><tr><td align="center" valign="middle" style="font-size:52px;line-height:1;">🎙️</td></tr></table>`;
  const guest = p.guest ? `<p style="margin:0 0 6px 0;font-family:'Roboto',sans-serif;font-size:13px;color:#ffb1b1;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Guest: ${p.guestLink ? `<a href="${escAttr(p.guestLink)}" target="_blank" style="color:#ffb1b1 !important;text-decoration:none;border:none;">${esc(p.guest)}</a>` : esc(p.guest)}</p>` : '';
  const icon = (u,a) => `<img src="${u}" width="16" alt="${a}" style="vertical-align:middle;margin-right:4px;border:none;display:inline;">`;
  const plat = [];
  if(p.spotify) plat.push(`<a href="${escAttr(p.spotify)}" target="_blank" style="color:#cbd5e1 !important;text-decoration:none;border:none;font-weight:600;">${icon('https://img.icons8.com/fluency/48/spotify.png','Spotify')}Spotify</a>`);
  if(p.apple) plat.push(`<a href="${escAttr(p.apple)}" target="_blank" style="color:#cbd5e1 !important;text-decoration:none;border:none;font-weight:600;">${icon('https://img.icons8.com/ios-filled/50/FFFFFF/mac-os.png','Apple Podcasts')}Apple</a>`);
  if(p.youtube) plat.push(`<a href="${escAttr(p.youtube)}" target="_blank" style="color:#cbd5e1 !important;text-decoration:none;border:none;font-weight:600;">${icon('https://img.icons8.com/color/48/youtube-play.png','YouTube')}YouTube</a>`);
  const platRow = plat.length ? `<table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-top:25px;border-top:1px solid #1e293b;"><tr><td style="padding-top:20px;font-family:'Roboto',sans-serif;font-size:13px;color:#64748b;">Available on: &nbsp;&nbsp;${plat.join(' &nbsp;&nbsp;|&nbsp;&nbsp; ')}</td></tr></table>` : '';
  // ---- Bulletproof "Play Episode" button ----
  // Outlook (Word engine) ignores border-radius/box-shadow and mangles padding on <a>, which is why
  // this used to render as a squashed outline. VML gives Outlook a real rounded pill; every other
  // client gets the table button. Renders ONLY when there's a link — never ship a dead button.
  const btnLabel = String(p.btn || '▶ Play Episode').trim() || '▶ Play Episode';
  const epLink = String(p.link || '').trim();
  const vmlW = Math.min(320, Math.max(170, btnLabel.replace(/[^\x20-\x7E]/g, '').length * 11 + 70));
  const playBtn = epLink ? `<div>
                                    <!--[if mso]>
                                    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${escAttr(epLink)}" style="height:46px;v-text-anchor:middle;width:${vmlW}px;" arcsize="50%" stroke="f" fillcolor="#9c1c1f">
                                      <w:anchorlock/>
                                      <center style="color:#ffffff;font-family:Arial,sans-serif;font-size:14px;font-weight:bold;letter-spacing:1px;">${esc(btnLabel)}</center>
                                    </v:roundrect>
                                    <![endif]-->
                                    <!--[if !mso]><!-- -->
                                    <table role="presentation" border="0" cellspacing="0" cellpadding="0"><tr><td align="center" bgcolor="#9c1c1f" style="border-radius:50px;"><a href="${escAttr(epLink)}" target="_blank" style="display:inline-block;padding:14px 32px;font-family:'Oswald',Arial,sans-serif;font-size:14px;font-weight:700;color:#ffffff !important;text-decoration:none;border-radius:50px;text-transform:uppercase;letter-spacing:1px;border:none;">${esc(btnLabel)}</a></td></tr></table>
                                    <!--<![endif]-->
                                  </div>` : '';
  return `
                ${HR}
                <table data-volt="podcast" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#020617;background:linear-gradient(145deg, #0f172a 0%, #020617 100%);border-radius:16px;margin-bottom:25px;box-shadow:0 12px 30px rgba(0,0,0,0.15);border:1px solid #1e293b;overflow:hidden;">
                    <tr><td style="padding:0;">
                        <table width="100%" border="0" cellspacing="0" cellpadding="0"><tr><td height="4" bgcolor="#9c1c1f" style="font-size:1px;line-height:1px;">&nbsp;</td></tr></table>
                        <table width="100%" border="0" cellspacing="0" cellpadding="0"><tr><td style="padding:30px 28px;">
                            <p style="margin:0 0 20px 0;font-family:'Oswald',sans-serif;font-size:12px;color:#cbd5e1;font-weight:900;text-transform:uppercase;letter-spacing:2px;">🎙️ SME South Africa Podcast</p>
                            <table width="100%" border="0" cellspacing="0" cellpadding="0"><tr>
                                <td class="col" width="140" valign="top" style="padding-right:25px;">${cover}</td>
                                <td class="col" valign="top">
                                    ${guest}
                                    <h3 style="margin:0 0 10px 0;font-family:'Oswald',sans-serif;font-size:24px;color:#ffffff;font-weight:900;line-height:1.2;">${esc(p.title)}</h3>
                                    ${p.desc ? `<p style="margin:0 0 20px 0;font-family:'Roboto',sans-serif;color:#94a3b8;line-height:1.6;font-size:15px;">${esc(p.desc)}</p>` : ''}
                                    ${playBtn}
                                </td>
                            </tr></table>
                            ${platRow}
                        </td></tr></table>
                    </td></tr>
                </table>`;
}

function merchBlock(p){
  // Deliberately NOT the podcast card. Podcast is a dark slate panel with the photo on the left;
  // the store is a light "shelf" card with the product on the RIGHT, a price row, and a navy trust
  // strip at the foot — so a reader scrolling past can tell the two blocks apart at a glance.
  const img = p.image
    ? `<img src="${escAttr(p.image)}" width="150" alt="${escAttr(p.title||'Product')}" style="display:block;width:150px;height:auto;border-radius:12px;border:1px solid #e2e8f0;background-color:#ffffff;">`
    : `<table border="0" cellspacing="0" cellpadding="0" style="width:150px;height:150px;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:12px;"><tr><td align="center" valign="middle" style="font-size:54px;line-height:1;">🛍️</td></tr></table>`;
  // Price row: the price is the loudest thing after the product name. A was-price only renders when
  // it's actually given — a fake strikethrough is the fastest way to lose trust.
  const priceRow = p.price ? `<table border="0" cellspacing="0" cellpadding="0" style="margin:0 0 14px 0;"><tr>
                                    <td style="font-family:'Oswald',sans-serif;font-size:30px;font-weight:900;color:#9c1c1f;line-height:1;">${esc(p.price)}</td>
                                    ${p.was ? `<td style="padding-left:12px;font-family:'Roboto',sans-serif;font-size:16px;color:#94a3b8;text-decoration:line-through;">${esc(p.was)}</td>` : ''}
                                  </tr></table>` : '';
  // "Also in the store" — Name | Price rows. Keeps the email to ONE hero product without hiding the
  // rest of the shelf.
  const alsoItems = (p.also || '').split('\n').map(s => s.trim()).filter(Boolean).slice(0, 4);
  const also = alsoItems.length ? `<table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-top:22px;border-top:1px solid #e2e8f0;">
                            <tr><td style="padding-top:16px;">
                                <p style="margin:0 0 10px 0;font-family:'Oswald',sans-serif;font-size:11px;color:#94a3b8;font-weight:900;text-transform:uppercase;letter-spacing:2px;">Also in the store</p>
                                <table width="100%" border="0" cellspacing="0" cellpadding="0">${alsoItems.map(it => {
                                  const parts = it.split('|');
                                  const nm = (parts[0] || '').trim(), pr = (parts[1] || '').trim();
                                  return `<tr><td style="padding:6px 0;font-family:'Roboto',sans-serif;font-size:15px;color:#0a2c3d;font-weight:600;">${esc(nm)}</td>`
                                       + `<td align="right" style="padding:6px 0;font-family:'Oswald',sans-serif;font-size:17px;color:#9c1c1f;font-weight:700;white-space:nowrap;">${esc(pr)}</td></tr>`;
                                }).join('')}</table>
                            </td></tr></table>` : '';
  // Bulletproof button — same VML pattern as the podcast play button (Outlook's Word engine ignores
  // border-radius and mangles padding on <a>). Renders only when there is a real link.
  const btnLabel = String(p.btn || 'Shop now').trim() || 'Shop now';
  const link = String(p.link || '').trim();
  const vmlW = Math.min(320, Math.max(160, btnLabel.replace(/[^\x20-\x7E]/g, '').length * 11 + 66));
  const btn = link ? `<div style="margin-top:4px;">
                                    <!--[if mso]>
                                    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${escAttr(link)}" style="height:46px;v-text-anchor:middle;width:${vmlW}px;" arcsize="14%" stroke="f" fillcolor="#9c1c1f">
                                      <w:anchorlock/>
                                      <center style="color:#ffffff;font-family:Arial,sans-serif;font-size:14px;font-weight:bold;letter-spacing:1px;">${esc(btnLabel)}</center>
                                    </v:roundrect>
                                    <![endif]-->
                                    <!--[if !mso]><!-- -->
                                    <table role="presentation" border="0" cellspacing="0" cellpadding="0"><tr><td align="center" bgcolor="#9c1c1f" style="border-radius:6px;"><a href="${escAttr(link)}" target="_blank" style="display:inline-block;padding:14px 30px;font-family:'Oswald',Arial,sans-serif;font-size:14px;font-weight:700;color:#ffffff !important;text-decoration:none;border-radius:6px;text-transform:uppercase;letter-spacing:1.2px;border:none;">${esc(btnLabel)}</a></td></tr></table>
                                    <!--<![endif]-->
                                  </div>` : '';
  const trust = String(p.trust || '').trim();
  return `
                ${HR}
                <table data-volt="merch" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#fbf8f6;border:1px solid #ecdfd9;border-radius:16px;margin:28px 0;box-shadow:0 10px 26px rgba(10,44,61,0.07);overflow:hidden;">
                    <tr><td style="padding:0;">
                        <table width="100%" border="0" cellspacing="0" cellpadding="0"><tr><td height="4" bgcolor="#9c1c1f" style="font-size:1px;line-height:1px;border-radius:15px 15px 0 0;">&nbsp;</td></tr></table>
                        <table width="100%" border="0" cellspacing="0" cellpadding="0"><tr><td style="padding:28px 26px 24px 26px;">
                            <p style="margin:0 0 18px 0;font-family:'Oswald',sans-serif;font-size:11px;color:#9c1c1f;font-weight:900;text-transform:uppercase;letter-spacing:2px;">🛍️ ${esc(p.eyebrow || "The Founder's Kit")}</p>
                            <table width="100%" border="0" cellspacing="0" cellpadding="0"><tr>
                                <td class="col" valign="top" style="padding-right:22px;">
                                    <h3 style="margin:0 0 12px 0;font-family:'Oswald',sans-serif;font-size:23px;color:#0a2c3d;font-weight:900;line-height:1.2;text-transform:uppercase;letter-spacing:0.3px;">${esc(p.title)}</h3>
                                    ${priceRow}
                                    ${p.desc ? `<p style="margin:0 0 18px 0;font-family:'Roboto',sans-serif;font-size:15px;color:#475569;line-height:1.6;">${esc(p.desc)}</p>` : ''}
                                    ${btn}
                                </td>
                                <td class="col" width="150" valign="top">${img}</td>
                            </tr></table>
                            ${also}
                        </td></tr></table>
                        ${trust ? `<table width="100%" border="0" cellspacing="0" cellpadding="0"><tr><td bgcolor="#0a2c3d" style="padding:13px 26px;font-family:'Roboto',sans-serif;font-size:13px;color:#ffffff;font-weight:600;letter-spacing:0.2px;border-radius:0 0 15px 15px;">🚚 ${esc(trust)}</td></tr></table>` : ''}
                    </td></tr>
                </table>`;
}

function sponsoredBlock(p){
  const bl = (p.bullets || '').split('\n').map(s => s.trim()).filter(Boolean);
  const bulletsHtml = bl.length
    ? `<table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 4px 0 18px 0;">` + bl.map(b =>
        `<tr><td width="20" valign="top" style="padding-top: 2px; font-size: 18px; color: #9c1c1f;">•</td><td style="font-family: 'Roboto', sans-serif; color: #444444; line-height: 1.6; font-size: 15px; padding-bottom: 8px;">${esc(b)}</td></tr>`).join('') + `</table>`
    : '';
  const btnHtml = p.link
    ? `<table border="0" cellspacing="0" cellpadding="0" align="center" style="margin: 6px auto 0;"><tr><td align="center" style="border-radius: 6px; background-color: #9c1c1f; box-shadow: 0 4px 10px rgba(156,28,31,0.2);"><a href="${escAttr(p.link)}" target="_blank" style="font-size: 14px; font-family: 'Oswald', sans-serif; font-weight: 700; color: #ffffff !important; text-decoration: none; padding: 14px 28px; border-radius: 6px; display: inline-block; text-transform: uppercase; border: none;">${esc(p.btn || 'Learn more')}</a></td></tr></table>`
    : '';
  return `
                ${HR}
                <table data-volt="sponsored" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #fafbfc; border: 1px solid #e2e8f0; border-radius: 12px; margin: 25px 0;">
                    <tr><td style="padding: 28px 26px;">
                        <p style="margin: 0 0 10px 0; font-family: 'Oswald', sans-serif; font-size: 11px; color: #94a3b8; font-weight: 900; text-transform: uppercase; letter-spacing: 2px;">✦ In Partnership With${p.brand ? ' ' + esc(p.brand) : ''}</p>
                        <h2 style="margin: 0 0 12px 0; font-size: 20px;">${esc(p.title)}</h2>
                        ${p.body ? `<p style="margin: 0 0 14px 0;">${esc(p.body)}</p>` : ''}
                        ${bulletsHtml}
                        ${btnHtml}
                    </td></tr>
                </table>`;
}

function taskBlock(p){
  const ritual = esc((p.ritual || "This Week's Action").trim());
  const shout = p.shout ? `<p style="margin: 0 0 14px 0; padding: 9px 13px; background-color: rgba(255,255,255,0.08); border-radius: 8px; font-family: 'Roboto', sans-serif; color: #ffe1e1; font-size: 13px; line-height: 1.5;">🎉 ${esc(p.shout)}</p>` : '';
  // Prompt pills — deliberately NOT links. These read as a nudge, not a click target; wiring them
  // to mailto: sent replies nobody wanted and made a non-interactive design look interactive.
  const opts = Array.isArray(p.poll) ? p.poll.filter(Boolean).slice(0, 4) : [];
  const poll = opts.length ? `<div style="margin: 18px 0 0 0;">${opts.map(o =>
    `<table role="presentation" border="0" cellspacing="0" cellpadding="0" style="display: inline-block; margin: 0 8px 8px 0;"><tr><td align="center" bgcolor="#ffb1b1" style="border-radius: 8px; padding: 10px 18px; font-family: 'Roboto', Arial, sans-serif; font-size: 14px; font-weight: 700; color: #0a2c3d;">${esc(o)}</td></tr></table>`
  ).join('')}</div>` : '';
  return `
                ${HR}
                <table data-volt="task" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #0a2c3d; background: linear-gradient(135deg, #0a2c3d 0%, #061f2b 100%); border-radius: 14px; margin: 25px 0; box-shadow: 0 10px 25px rgba(10,44,61,0.2);">
                    <tr><td style="padding: 30px 28px;">
                        <p style="margin: 0 0 10px 0; font-family: 'Oswald', sans-serif; font-size: 12px; color: #ffb1b1; font-weight: 900; text-transform: uppercase; letter-spacing: 2px;">👉 ${ritual}</p>
                        ${shout}
                        <h3 style="margin: 0 0 12px 0; font-family: 'Oswald', sans-serif; font-size: 22px; color: #ffffff; font-weight: 900; line-height: 1.25;">${esc(p.title)}</h3>
                        <p style="margin: 0; font-family: 'Roboto', sans-serif; color: rgba(255,255,255,0.88); line-height: 1.6; font-size: 15px;">${esc(p.body)}</p>
                        ${poll}
                        ${p.cta ? `<p style="margin: 16px 0 0 0; font-family: 'Roboto', sans-serif; color: #ffffff; line-height: 1.5; font-size: 14px; font-weight: 700;">${esc(p.cta)}</p>` : ''}
                    </td></tr>
                </table>`;
}

const OPP_TAGS = { debt:['#e0f2fe','#0284c7'], grant:['#dcfce7','#166534'], equity:['#f3e8ff','#7e22ce'], event:['#fef9c3','#854d0e'] };

function opportunityBlock(p){
  const pair = OPP_TAGS[p.tagType] || OPP_TAGS.grant;
  const tag = p.tag ? `<span style="display: inline-block; padding: 4px 10px; border-radius: 4px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; font-family: 'Oswald', sans-serif; background-color: ${pair[0]}; color: ${pair[1]};">${esc(p.tag)}</span>` : '';
  const dl = p.deadline ? `<p style="margin: 0 0 12px 0; font-size: 12px; font-family: 'Oswald', sans-serif; letter-spacing: 1px; text-transform: uppercase; color: #9c1c1f; font-weight: 700;">⏳ Closes ${esc(p.deadline)}</p>` : '';
  const best = p.bestFor ? `<p style="font-size: 14px; color: #64748b; margin: 0 0 12px 0;"><strong>Best for:</strong> ${esc(p.bestFor)}</p>` : '';
  const body = p.body ? `<p style="font-size: 14px; margin: 0;">${mdLinks(p.body)}</p>` : '';
  const cta = p.link ? `<table border="0" cellspacing="0" cellpadding="0" style="margin-top: 15px;"><tr>
                            <td align="center" bgcolor="#9c1c1f" style="border-radius: 6px;">
                                <a href="${escAttr(p.link)}" target="_blank" class="btn-mobile" style="font-size: 13px; font-family: 'Oswald', sans-serif; font-weight: 700; color: #ffffff !important; text-decoration: none; padding: 10px 20px; border-radius: 6px; display: inline-block; text-transform: uppercase; letter-spacing: 1px; border: none;">${esc(p.btn||'Check eligibility')} &rarr;</a>
                            </td>
                        </tr></table>` : '';
  return `
                <table data-volt="opportunity" width="100%" border="0" cellspacing="0" cellpadding="0" style="border: 1px solid #e2e8f0; border-radius: 10px; margin: 0 0 20px 0; overflow: hidden; background-color: #ffffff;">
                    <tr><td style="background-color: #f8fafc; padding: 15px 20px; border-bottom: 1px solid #e2e8f0;">
                        <table width="100%" border="0" cellspacing="0" cellpadding="0"><tr>
                            <td align="left"><h3 style="margin: 0; font-family: 'Oswald', sans-serif; font-size: 18px; color: #0f172a;">${esc(p.title)}</h3></td>
                            <td align="right" width="90">${tag}</td>
                        </tr></table>
                    </td></tr>
                    <tr><td style="padding: 20px;">${dl}${best}${body}${cta}</td></tr>
                </table>`;
}

function ctaBlock(p){
  if(!p.link || !p.btn) return '';
  const bl = String(p.bullets||'').split('\n').map(s=>s.trim()).filter(Boolean);
  const ol = bl.length ? `<ol style="margin: 0 0 25px 0; padding-left: 20px; font-size: 15px; color: #334155; line-height: 1.6;">${bl.map(b=>`<li style="margin-bottom: 10px;">${mdLinks(b)}</li>`).join('')}</ol>` : '';
  return `
                ${p.kicker ? `<p style="margin: 0 0 6px 0; font-family: 'Oswald', sans-serif; font-size: 11px; font-weight: 900; letter-spacing: 2px; text-transform: uppercase; color: #9c1c1f;">${esc(p.kicker)}</p>` : ''}
                ${p.title ? `<h2>${esc(p.title)}</h2>` : ''}
                ${p.body ? `<p>${mdLinks(p.body).replace(/\n/g,'<br>')}</p>` : ''}
                ${ol}
                <div style="text-align: center; margin: 30px 0 10px 0;">
                    <!--[if mso]>
                    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${escAttr(p.link)}" style="height:48px;v-text-anchor:middle;width:280px;" arcsize="12%" stroke="f" fillcolor="#9c1c1f">
                    <w:anchorlock/>
                    <center style="color:#ffffff;font-family:'Oswald', Arial, sans-serif;font-size:15px;font-weight:900;text-transform:uppercase;letter-spacing:1px;">${esc(p.btn)}</center>
                    </v:roundrect>
                    <![endif]-->
                    <a href="${escAttr(p.link)}" target="_blank" class="btn-mobile" style="font-family: 'Oswald', Arial, sans-serif; background-color: #9c1c1f; color: #ffffff !important; padding: 14px 25px; text-decoration: none; border-radius: 6px; font-weight: 900; font-size: 15px; display: inline-block; text-transform: uppercase; letter-spacing: 1px; border: none; mso-hide: all;">${esc(p.btn)}</a>
                </div>`;
}

function signatureBlock(p){
  if(!p.name && !p.email) return '';
  const photo = p.photo
    ? `<img src="${escAttr(p.photo)}" width="115" height="115" alt="${escAttr(p.name||'')}" style="display: block; width: 115px; height: 115px; border-radius: 24px; object-fit: cover; border: 1px solid #e2e8f0; margin-bottom: 15px; box-shadow: 0 4px 10px rgba(0,0,0,0.05);">`
    : `<div style="width: 115px; height: 115px; border-radius: 24px; background: #0a2c3d; color: #fff; font-family: 'Oswald', sans-serif; font-size: 40px; line-height: 115px; text-align: center; margin-bottom: 15px;">${esc((p.name||'S').trim().charAt(0).toUpperCase())}</div>`;
  const socials = SIG_SOCIAL.map(([href,icon,alt]) => `<td style="padding-right: 12px;"><a href="${href}" target="_blank" style="border: none;"><img src="${icon}" width="16" height="16" alt="${alt}" style="display: block; opacity: 0.9;"></a></td>`).join('');
  const rows = [];
  if(p.email) rows.push(`<tr><td valign="middle" width="30" style="padding-bottom: 10px;">${sigTile(SIG_ICON.mail)}</td><td valign="middle" style="padding-bottom: 10px; padding-left: 10px;"><a href="mailto:${escAttr(p.email)}" style="font-size: 13px; font-weight: 600; color: #000000; text-decoration: none; border: none;">${esc(p.email)}</a></td></tr>`);
  if(p.phone) rows.push(`<tr><td valign="middle" width="30" style="padding-bottom: 10px;">${sigTile(SIG_ICON.phone)}</td><td valign="middle" style="padding-bottom: 10px; padding-left: 10px;"><span style="font-size: 13px; font-weight: 600; color: #000000;">${esc(p.phone)}</span></td></tr>`);
  rows.push(`<tr><td valign="middle" width="30">${sigTile(SIG_ICON.pin)}</td><td valign="middle" style="padding-left: 10px;"><span style="font-size: 12px; line-height: 1.4; color: #444444;"><strong>Clearwater Office Park</strong><br>Strubensvalley, Roodepoort, 1735</span></td></tr>`);
  return `
                <table cellpadding="0" cellspacing="0" border="0" style="font-family: 'Roboto', Arial, sans-serif; width: 100%; max-width: 520px; margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 24px;">
                    <tr>
                        <td class="col" valign="top" width="140" style="padding-right: 25px;">
                            ${photo}
                            <a href="https://smesouthafrica.co.za" target="_blank" style="display: block; background-color: #9c1c1f; color: #ffffff !important; font-size: 11px; font-weight: bold; text-align: center; text-decoration: none; padding: 8px 0; border-radius: 20px; white-space: nowrap; border: none;">smesouthafrica.co.za &rsaquo;</a>
                        </td>
                        <td class="col" valign="top">
                            <h2 style="margin: 0 0 4px 0; font-family: 'Oswald', Arial, sans-serif; font-size: 22px; color: #000000; font-weight: 700; letter-spacing: 0.5px;">${esc(p.name||'')}</h2>
                            ${p.role ? `<p style="margin: 0 0 15px 0; font-size: 13px; color: #9c1c1f; font-weight: 600;">${esc(p.role)}</p>` : ''}
                            <table cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 20px;"><tr>${socials}</tr></table>
                            <table cellpadding="0" cellspacing="0" border="0">${rows.join('')}</table>
                        </td>
                    </tr>
                </table>`;
}

const BASE_P  = "font-family:'Roboto',Arial,Helvetica,sans-serif;color:#444444;font-size:15px;line-height:1.6;margin:0 0 12px 0;";

const BASE_H2 = "font-family:'Oswald','Arial Narrow',Arial,sans-serif;color:#0a2c3d;font-size:22px;font-weight:700;line-height:1.35;letter-spacing:0.5px;margin:20px 0 10px 0;";

const BASE_H3 = "font-family:'Oswald','Arial Narrow',Arial,sans-serif;color:#0a2c3d;font-size:18px;font-weight:700;line-height:1.35;letter-spacing:0.4px;margin:18px 0 8px 0;";

const BASE_LI = "font-family:'Roboto',Arial,Helvetica,sans-serif;color:#444444;font-size:15px;line-height:1.6;margin:0 0 6px 0;";

const BASE_RR = "background-color:#f8fafc;padding:15px 18px;border-left:4px solid #9c1c1f;margin:12px 0 20px 0;font-size:14px;line-height:1.5;border-radius:0 8px 8px 0;color:#444444;font-family:'Roboto',Arial,Helvetica,sans-serif;";

const FAM_HEAD = "'Oswald','Arial Narrow',Arial,sans-serif";

const FAM_BODY = "'Roboto',Arial,Helvetica,sans-serif";

function injectBaseStyle(tag, base){
  if(/font-size\s*:/i.test(tag)) return tag;                 // intentionally-styled component (promo) — leave it
  const m = tag.match(/\bstyle\s*=\s*"([^"]*)"/i);
  if(m){                                                     // base first, so an existing decl (e.g. the intro's margin-bottom:0) still wins
    const merged = base + m[1].trim().replace(/;?\s*$/, ';');
    return tag.replace(m[0], 'style="' + merged + '"');
  }
  return tag.replace(/^<(\w+)/, '<$1 style="' + base + '"');
}

function inlineBaseTypography(html){
  return String(html || '')
    .replace(/<p\b[^>]*>/gi,  t => injectBaseStyle(t, BASE_P))
    .replace(/<h1\b[^>]*>/gi, t => injectBaseStyle(t, BASE_H2))
    .replace(/<h2\b[^>]*>/gi, t => injectBaseStyle(t, BASE_H2))
    .replace(/<h3\b[^>]*>/gi, t => injectBaseStyle(t, BASE_H3))
    .replace(/<h4\b[^>]*>/gi, t => injectBaseStyle(t, BASE_H3))
    .replace(/<li\b[^>]*>/gi, t => injectBaseStyle(t, BASE_LI))
    .replace(/<div\b[^>]*\bclass="[^"]*related-reading[^"]*"[^>]*>/gi, t => injectBaseStyle(t, BASE_RR));
}

function ensureFontFamily(html){
  return String(html || '').replace(
    /<(p|h1|h2|h3|h4|h5|h6|li|ul|ol|td|th|span|a|div|blockquote|strong|em|b|i)\b([^>]*)>/gi,
    function(tag, name, attrs){
      if(/font-family\s*:/i.test(attrs)) return tag;                       // already on brand
      const fam = /^h[1-6]$/i.test(name) ? FAM_HEAD : FAM_BODY;
      const m = attrs.match(/\bstyle\s*=\s*"([^"]*)"/i);
      if(m) return tag.replace(m[0], 'style="' + m[1].trim().replace(/;?\s*$/, ';') + 'font-family:' + fam + ';"');
      return '<' + name + attrs + ' style="font-family:' + fam + ';">';
    });
}

function normalizeFontStacks(html){
  return String(html || '').replace(/font-family\s*:\s*([^;"]+)/gi, function(decl, list){
    if(/Oswald/i.test(list)) return 'font-family:' + FAM_HEAD;
    if(/Roboto/i.test(list)) return 'font-family:' + FAM_BODY;
    return decl;
  });
}
