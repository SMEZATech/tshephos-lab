/* Volt — SME South Africa 2026 design tokens. © 2026 Tshepho Joel.
 *
 * TOKENS ONLY. Every value here is already public on the brand CI page
 * (https://smezatech.github.io/smehubmockups/brand_ci.html), which wins over this file if they ever
 * disagree. The 2026 TEMPLATES are not here and must never be: they are served only to previewers by
 * /api/rebrand (see api/_rebrand/ in the web repo), because anything in app/*.js ships publicly.
 *
 * Studio's worker, the email builder and the video editor all read the same object, so a colour
 * can't drift between a post, a mailer and an end card. UMD so it loads in a page (window), a worker
 * (self, via the install message) and Node (the render tests).
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.VoltBrand2026 = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    var T = {
        // Colours. These are the ONLY legal neutrals — #374151 / #475569 and friends are banned.
        red: '#DC183C', redHover: '#B0142F', redTint: '#FDECEF',
        orange: '#FF9900',                 // never for small text: small amber text is amber on amberTint
        amber: '#AE6B0A', amberTint: '#FFF1E0',
        navy: '#0C1F31',                   // surfaces only
        ink: '#121A21',                    // text only
        muted: '#6A7581', border: '#E7EBEF', slate: '#F0F5F9', bg: '#FCFCFC',
        green: '#29A37A', greenTint: '#E4F5EE',
        wine: '#2b1626', wineDeep: '#5e1a2c',
        warmA: '#FFF8EE', warmB: '#FDEFF2',
        radius: 12,
        // Gradients as stop lists, so canvas and CSS build them from one definition.
        hero: { angle: 115, stops: [[0, '#0C1F31'], [0.5, '#0C1F31'], [0.8, '#2b1626'], [1.15, '#5e1a2c']] },
        accent: { angle: 135, stops: [[0, '#DC183C'], [1, '#FF9900']] },   // the ONE hero CTA per view
        warm: { angle: 135, stops: [[0, '#FFF8EE'], [1, '#FDEFF2']] },
        dotGrid: 22,
        fonts: {
            head: 'Plus Jakarta Sans',      // headings + UI, 700–800
            body: 'Inter',                  // body, 400–500
            // Email: web fonts first, then the fallbacks Outlook will actually use.
            headStack: "'Plus Jakarta Sans',Helvetica,Arial,sans-serif",
            bodyStack: "Inter,Helvetica,Arial,sans-serif",
            css: 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700&display=swap'
        },
        // Oswald is banned in 2026 designs (it stays loaded only for the 2024 kit).
        bannedFonts: ['Oswald']
    };
    T.heroCss = 'linear-gradient(115deg,#0C1F31 0%,#0C1F31 50%,#2b1626 80%,#5e1a2c 115%)';
    T.accentCss = 'linear-gradient(135deg,#DC183C 0%,#FF9900 100%)';
    T.warmCss = 'linear-gradient(135deg,#FFF8EE 0%,#FDEFF2 100%)';

    // THE CANVAS FONT TRAP. Canvas text never triggers a web-font download on its own, so the first
    // frames of a render set in a fallback face unless something asked for the exact face first —
    // this already bit the Funding Summit video cards. Call (and await) this before the first draw.
    T.loadFonts = function (doc) {
        doc = doc || (typeof document !== 'undefined' ? document : null);
        if (!doc || !doc.fonts || !doc.fonts.load) return Promise.resolve();
        if (doc.querySelector && !doc.querySelector('link[data-brand26]')) {
            var l = doc.createElement('link');
            l.rel = 'stylesheet'; l.href = T.fonts.css; l.setAttribute('data-brand26', '1');
            doc.head.appendChild(l);
        }
        var faces = ['800 40px "Plus Jakarta Sans"', '700 40px "Plus Jakarta Sans"', '600 40px "Plus Jakarta Sans"',
                     '500 40px "Plus Jakarta Sans"', '400 40px Inter', '500 40px Inter', '600 40px Inter'];
        return Promise.all(faces.map(function (f) { return doc.fonts.load(f).catch(function () {}); }));
    };
    return T;
}));
