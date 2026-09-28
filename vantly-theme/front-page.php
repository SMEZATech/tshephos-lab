<?php get_header(); ?>

  <section class="hero-section" aria-labelledby="hero-heading">
    <div class="hero-eyebrow" aria-label="Status: Now available">
      <span class="dot" aria-hidden="true"></span>
      AI marketing suite — now available
    </div>

    <h1 class="hero-title" id="hero-heading">
      Your <em>vantage point</em><br />for every campaign.
    </h1>

    <p class="hero-tagline">See further. Create faster. Grow confidently.</p>

    <p class="hero-sub">
      Vantly gives your brand a unified workspace — AI-powered copy, on-brand graphics,
      scroll-stopping video, and real performance analytics — all in one place.
    </p>

    <div class="hero-cta">
      <a href="https://vantly-xi.vercel.app/signup" class="btn-hero">
        Start free today
        <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4"/></svg>
      </a>
      <a href="#features" class="btn-hero-ghost">
        See what's inside
      </a>
    </div>
    <p class="hero-fine">Free to start — <b>no credit card required.</b> Your workspace is ready in under 60 seconds.</p>
  </section>

  <!-- ══ HERO PREVIEW WINDOW ══ -->
  <div class="hero-preview" aria-hidden="true">
    <div class="preview-window">
      <div class="preview-bar">
        <span class="preview-dot"></span>
        <span class="preview-dot"></span>
        <span class="preview-dot"></span>
        <span class="preview-url">vantly.co.za/copy</span>
      </div>
      <div class="preview-body">
        <div class="preview-sidebar">
          <div class="preview-sidebar-logo">Vantly</div>
          <div class="preview-nav-item active"><span class="preview-nav-icon">✍️</span> Copy</div>
          <div class="preview-nav-item"><span class="preview-nav-icon">🎨</span> Studio</div>
          <div class="preview-nav-item"><span class="preview-nav-icon">🎬</span> Video</div>
          <div class="preview-nav-item"><span class="preview-nav-icon">🎯</span> SmartClip</div>
          <div class="preview-nav-item"><span class="preview-nav-icon">✉️</span> Email</div>
          <div class="preview-nav-item"><span class="preview-nav-icon">📊</span> Stats</div>
        </div>
        <div class="preview-main">
          <div class="preview-card">
            <div class="preview-card-label">Top Ad Angles — Ranked by performance</div>
            <div class="preview-angles">
              <div class="preview-angle">
                <span class="preview-angle-score">9.4</span>
                <span>Stop scrolling — your next best decision takes 5 minutes</span>
              </div>
              <div class="preview-angle">
                <span class="preview-angle-score">8.7</span>
                <span>Most brands miss this. Yours won't have to.</span>
              </div>
              <div class="preview-angle">
                <span class="preview-angle-score">8.1</span>
                <span>Built for teams who'd rather create than guess</span>
              </div>
            </div>
          </div>
          <div class="preview-card">
            <div class="preview-card-label">This Week's Performance</div>
            <div class="preview-stat-row">
              <div class="preview-stat">
                <div class="preview-stat-val">4.2×</div>
                <div class="preview-stat-lbl">Avg. ROAS</div>
              </div>
              <div class="preview-stat">
                <div class="preview-stat-val">6.8%</div>
                <div class="preview-stat-lbl">Click-through</div>
              </div>
              <div class="preview-stat">
                <div class="preview-stat-val">↑31%</div>
                <div class="preview-stat-lbl">Reach vs. last wk</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- ══ SOCIAL PROOF STRIP ══ -->
  <div class="proof-strip" aria-label="Key metrics">
    <div class="proof-inner">
      <div class="proof-stat">
        <div class="proof-stat-val">500+</div>
        <div class="proof-stat-lbl">Brands & teams</div>
      </div>
      <div class="proof-divider" aria-hidden="true"></div>
      <div class="proof-stat">
        <div class="proof-stat-val">7 tools</div>
        <div class="proof-stat-lbl">In one workspace</div>
      </div>
      <div class="proof-divider" aria-hidden="true"></div>
      <div class="proof-stat">
        <div class="proof-stat-val">60 sec</div>
        <div class="proof-stat-lbl">To first output</div>
      </div>
      <div class="proof-divider" aria-hidden="true"></div>
      <div class="proof-stat">
        <div class="proof-stat-val">Zero</div>
        <div class="proof-stat-lbl">Design skills needed</div>
      </div>
    </div>
  </div>

  <!-- ══════════════════════════════════════════════════════
       FEATURES — tabbed deep dive
  ══════════════════════════════════════════════════════ -->
  <section class="features-section container" id="features" aria-labelledby="features-heading">
    <div class="fade-up">
      <p class="section-eyebrow">The full toolkit</p>
      <h2 class="section-title" id="features-heading">
        One platform.<br/>Every content need.
      </h2>
      <p class="section-sub">
        From the first blank page to a published post — Vantly covers the whole journey
        without switching between five different tools.
      </p>
    </div>

    <div class="feature-tabs" role="tablist" aria-label="Feature categories">
      <button class="feature-tab active" role="tab" aria-selected="true" data-tab="copy">
        <span class="icon">✍️</span> Copy
      </button>
      <button class="feature-tab" role="tab" aria-selected="false" data-tab="studio">
        <span class="icon">🎨</span> Studio
      </button>
      <button class="feature-tab" role="tab" aria-selected="false" data-tab="video">
        <span class="icon">🎬</span> Video
      </button>
      <button class="feature-tab" role="tab" aria-selected="false" data-tab="smartclip">
        <span class="icon">🎯</span> SmartClip
      </button>
      <button class="feature-tab" role="tab" aria-selected="false" data-tab="analytics">
        <span class="icon">📊</span> Analytics
      </button>
    </div>

    <!-- Copy panel -->
    <div class="feature-panel active" id="panel-copy" role="tabpanel" aria-labelledby="tab-copy">
      <div class="feature-info fade-up">
        <h3>Ad copy that actually <em style="font-style:italic;color:var(--accent-hi)">performs</em></h3>
        <p>
          Describe your product, pick your platform, and Vantly generates ranked ad angles
          with scores, hashtags and calls to action — informed by your own brand kit and
          what has historically worked for your audience.
        </p>
        <ul class="feature-bullets" aria-label="Copy feature highlights">
          <li><span class="check" aria-hidden="true">✓</span>Ranked angles with performance scores — not random outputs</li>
          <li><span class="check" aria-hidden="true">✓</span>Platform-specific formatting (Meta, TikTok, LinkedIn, X)</li>
          <li><span class="check" aria-hidden="true">✓</span>Brand voice enforced — copy always sounds like you</li>
          <li><span class="check" aria-hidden="true">✓</span>Learns from your analytics over time</li>
          <li><span class="check" aria-hidden="true">✓</span>One-click refine, retone, or expand</li>
        </ul>
      </div>
      <div class="feature-visual fade-up fade-up-d2">
        <div style="margin-bottom:14px;">
          <div style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--faint);margin-bottom:10px;">Ranked ad angles</div>
          <div style="display:flex;flex-direction:column;gap:8px;">
            <div style="display:flex;align-items:center;gap:10px;background:rgba(226,146,74,.08);border:1px solid rgba(226,146,74,.22);border-radius:10px;padding:11px 13px;">
              <span style="font-family:monospace;font-weight:800;font-size:15px;color:var(--accent);">9.4</span>
              <span style="font-size:13px;color:var(--text);">Stop scrolling — your next best decision takes 5 minutes</span>
            </div>
            <div style="display:flex;align-items:center;gap:10px;background:rgba(0,0,0,.2);border:1px solid var(--border);border-radius:10px;padding:11px 13px;">
              <span style="font-family:monospace;font-weight:800;font-size:15px;color:var(--dim);">8.7</span>
              <span style="font-size:13px;color:var(--dim);">Most brands miss this. Yours won't have to.</span>
            </div>
            <div style="display:flex;align-items:center;gap:10px;background:rgba(0,0,0,.2);border:1px solid var(--border);border-radius:10px;padding:11px 13px;">
              <span style="font-family:monospace;font-weight:800;font-size:15px;color:var(--dim);">8.1</span>
              <span style="font-size:13px;color:var(--dim);">Built for teams who'd rather create than guess</span>
            </div>
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px;">
          <span style="font-size:12px;padding:5px 11px;border-radius:7px;background:rgba(226,146,74,.1);border:1px solid rgba(226,146,74,.2);color:var(--accent-hi);">#growyourbrand</span>
          <span style="font-size:12px;padding:5px 11px;border-radius:7px;background:rgba(226,146,74,.1);border:1px solid rgba(226,146,74,.2);color:var(--accent-hi);">#marketingsuite</span>
          <span style="font-size:12px;padding:5px 11px;border-radius:7px;background:rgba(0,0,0,.2);border:1px solid var(--border);color:var(--faint);">#contentcreation</span>
        </div>
      </div>
    </div>

    <!-- Studio panel -->
    <div class="feature-panel" id="panel-studio" role="tabpanel" aria-labelledby="tab-studio">
      <div class="feature-info fade-up">
        <h3>Graphics your brand is <em style="font-style:italic;color:var(--accent-hi)">proud of</em></h3>
        <p>
          Studio is a full design canvas — templates, AI image generation, text overlays,
          and brand-kit enforcement — so everything that leaves looks like it belongs together.
          No Photoshop. No Canva subscription.
        </p>
        <ul class="feature-bullets">
          <li><span class="check" aria-hidden="true">✓</span>Templates for every post format — Stories, Reels, Feed, LinkedIn</li>
          <li><span class="check" aria-hidden="true">✓</span>AI image generation built in</li>
          <li><span class="check" aria-hidden="true">✓</span>Brand colours, fonts and logo locked in by default</li>
          <li><span class="check" aria-hidden="true">✓</span>Export at any resolution, any format</li>
          <li><span class="check" aria-hidden="true">✓</span>Freeform canvas for one-offs</li>
        </ul>
      </div>
      <div class="feature-visual fade-up fade-up-d2" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:20px;">
        <div style="background:linear-gradient(135deg,var(--surface2),var(--ink-in,#0e1226));border-radius:12px;aspect-ratio:1;display:grid;place-items:center;border:1px solid var(--border);">
          <div style="text-align:center;padding:16px;">
            <div style="font-family:var(--fd);font-weight:800;font-size:18px;color:var(--accent-hi);margin-bottom:6px;">Brand post</div>
            <div style="width:40px;height:3px;background:var(--accent);border-radius:2px;margin:0 auto 8px;"></div>
            <div style="font-size:11px;color:var(--faint);">Story format · 1080×1920</div>
          </div>
        </div>
        <div style="background:linear-gradient(135deg,rgba(226,146,74,.1),var(--ink-in,#0e1226));border-radius:12px;aspect-ratio:1;display:grid;place-items:center;border:1px solid rgba(226,146,74,.2);">
          <div style="text-align:center;padding:16px;">
            <div style="font-size:28px;margin-bottom:8px;">✨</div>
            <div style="font-size:12px;color:var(--dim);">AI-generated<br>background</div>
          </div>
        </div>
        <div style="background:var(--surface2);border-radius:12px;padding:14px;border:1px solid var(--border);grid-column:span 2;">
          <div style="font-size:11px;color:var(--faint);margin-bottom:6px;">BRAND KIT ACTIVE</div>
          <div style="display:flex;gap:6px;align-items:center;">
            <div style="width:18px;height:18px;border-radius:4px;background:#e2924a;"></div>
            <div style="width:18px;height:18px;border-radius:4px;background:#12162a;border:1px solid var(--border3);"></div>
            <div style="width:18px;height:18px;border-radius:4px;background:#f4c88b;"></div>
            <span style="font-size:12px;color:var(--dim);margin-left:8px;">Fraunces · Public Sans</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Video panel -->
    <div class="feature-panel" id="panel-video" role="tabpanel" aria-labelledby="tab-video">
      <div class="feature-info fade-up">
        <h3>Video that fits every <em style="font-style:italic;color:var(--accent-hi)">format</em></h3>
        <p>
          Upload once. Vantly reframes, captions, and brands it for every platform it
          needs to live on — all in the editor, without touching a timeline tool.
        </p>
        <ul class="feature-bullets">
          <li><span class="check" aria-hidden="true">✓</span>Auto-reframe: 16:9 → 9:16 → 1:1 in one click</li>
          <li><span class="check" aria-hidden="true">✓</span>AI captions with word-level timing</li>
          <li><span class="check" aria-hidden="true">✓</span>Brand overlays, stickers, and lower thirds</li>
          <li><span class="check" aria-hidden="true">✓</span>Trim, cut and export ready to post</li>
          <li><span class="check" aria-hidden="true">✓</span>Speaker-follow auto-crop</li>
        </ul>
      </div>
      <div class="feature-visual fade-up fade-up-d2">
        <div style="background:rgba(0,0,0,.3);border-radius:14px;overflow:hidden;aspect-ratio:16/9;display:grid;place-items:center;border:1px solid var(--border);margin-bottom:14px;position:relative;">
          <div style="position:absolute;inset:0;display:flex;">
            <div style="flex:1;border-right:2px dashed rgba(226,146,74,.3);display:grid;place-items:center;">
              <span style="font-size:11px;color:var(--faint);">16:9</span>
            </div>
            <div style="width:56%;border-right:2px dashed rgba(226,146,74,.3);display:grid;place-items:center;">
              <div style="text-align:center;">
                <div style="font-size:30px;margin-bottom:6px;">🎬</div>
                <div style="font-size:11px;color:var(--dim);">Original clip</div>
              </div>
            </div>
            <div style="flex:1;display:grid;place-items:center;">
              <span style="font-size:11px;color:var(--faint);">9:16</span>
            </div>
          </div>
        </div>
        <div style="background:rgba(226,146,74,.06);border:1px solid rgba(226,146,74,.15);border-radius:10px;padding:12px 14px;font-size:13px;color:var(--dim);">
          🎙️ <strong style="color:var(--text)">AI Captions</strong> — word-level, styled to match your brand colours
        </div>
      </div>
    </div>

    <!-- SmartClip panel -->
    <div class="feature-panel" id="panel-smartclip" role="tabpanel" aria-labelledby="tab-smartclip">
      <div class="feature-info fade-up">
        <h3>One hour of content.<br/><em style="font-style:italic;color:var(--accent-hi)">Ten clips, automatically.</em></h3>
        <p>
          Drop in a podcast, webinar, or interview. SmartClip finds the sharpest moments,
          follows the speaker, and sends each clip straight to the video editor — ready to caption and post.
        </p>
        <ul class="feature-bullets">
          <li><span class="check" aria-hidden="true">✓</span>AI finds the highest-energy moments automatically</li>
          <li><span class="check" aria-hidden="true">✓</span>Speaker-follow crop — stays on who's talking</li>
          <li><span class="check" aria-hidden="true">✓</span>One-click send to the Video editor</li>
          <li><span class="check" aria-hidden="true">✓</span>Works on any long-form video file</li>
        </ul>
      </div>
      <div class="feature-visual fade-up fade-up-d2">
        <div style="margin-bottom:12px;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--faint);">Detected highlights</div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          <div style="display:flex;align-items:center;gap:10px;background:rgba(226,146,74,.08);border:1px solid rgba(226,146,74,.2);border-radius:10px;padding:11px 13px;">
            <span style="font-size:18px;">🎯</span>
            <div>
              <div style="font-size:13px;color:var(--text);font-weight:600;">12:34 – 13:02</div>
              <div style="font-size:11.5px;color:var(--dim);">High energy · "The insight that changed everything…"</div>
            </div>
            <span style="margin-left:auto;font-size:11px;color:var(--accent);font-weight:700;">CLIP →</span>
          </div>
          <div style="display:flex;align-items:center;gap:10px;background:rgba(0,0,0,.2);border:1px solid var(--border);border-radius:10px;padding:11px 13px;">
            <span style="font-size:18px;">💡</span>
            <div>
              <div style="font-size:13px;color:var(--text);font-weight:600;">24:11 – 24:55</div>
              <div style="font-size:11.5px;color:var(--dim);">Strong hook · Quotable moment</div>
            </div>
            <span style="margin-left:auto;font-size:11px;color:var(--faint);font-weight:700;">CLIP →</span>
          </div>
          <div style="display:flex;align-items:center;gap:10px;background:rgba(0,0,0,.2);border:1px solid var(--border);border-radius:10px;padding:11px 13px;">
            <span style="font-size:18px;">🔥</span>
            <div>
              <div style="font-size:13px;color:var(--text);font-weight:600;">38:47 – 39:20</div>
              <div style="font-size:11.5px;color:var(--dim);">Actionable tip · Natural cliffhanger</div>
            </div>
            <span style="margin-left:auto;font-size:11px;color:var(--faint);font-weight:700;">CLIP →</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Analytics panel -->
    <div class="feature-panel" id="panel-analytics" role="tabpanel" aria-labelledby="tab-analytics">
      <div class="feature-info fade-up">
        <h3>Know what's working — <em style="font-style:italic;color:var(--accent-hi)">before you guess</em></h3>
        <p>
          Vantly pulls your real performance numbers across channels and feeds them back
          into the Brain — the same system that scores your copy angles and ranks your ideas.
          Real data, closing the loop.
        </p>
        <ul class="feature-bullets">
          <li><span class="check" aria-hidden="true">✓</span>Unified dashboard across platforms</li>
          <li><span class="check" aria-hidden="true">✓</span>Best-performing posts surfaced automatically</li>
          <li><span class="check" aria-hidden="true">✓</span>Analytics feeds the AI — smarter angles over time</li>
          <li><span class="check" aria-hidden="true">✓</span>Understand reach, engagement and conversions in one view</li>
        </ul>
      </div>
      <div class="feature-visual fade-up fade-up-d2">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:14px;">
          <div style="background:rgba(0,0,0,.25);border:1px solid var(--border);border-radius:10px;padding:13px;">
            <div style="font-family:var(--fd);font-weight:800;font-size:22px;color:var(--accent-hi);line-height:1;">4.2×</div>
            <div style="font-size:11px;color:var(--faint);margin-top:4px;">Avg. ROAS</div>
          </div>
          <div style="background:rgba(0,0,0,.25);border:1px solid var(--border);border-radius:10px;padding:13px;">
            <div style="font-family:var(--fd);font-weight:800;font-size:22px;color:var(--good);line-height:1;">↑31%</div>
            <div style="font-size:11px;color:var(--faint);margin-top:4px;">Reach</div>
          </div>
          <div style="background:rgba(0,0,0,.25);border:1px solid var(--border);border-radius:10px;padding:13px;">
            <div style="font-family:var(--fd);font-weight:800;font-size:22px;color:var(--text);line-height:1;">6.8%</div>
            <div style="font-size:11px;color:var(--faint);margin-top:4px;">CTR</div>
          </div>
        </div>
        <div style="background:rgba(226,146,74,.06);border:1px solid rgba(226,146,74,.15);border-radius:10px;padding:13px 15px;">
          <div style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);margin-bottom:6px;">🧠 Brain insight</div>
          <div style="font-size:13px;color:var(--dim);">Video hooks outperform static images 2.3× this month. Copy with urgency verbs scores 1.6× higher.</div>
        </div>
      </div>
    </div>
  </section>

  <!-- ══════════════════════════════════════════════════════
       HOW IT WORKS
  ══════════════════════════════════════════════════════ -->
  <section class="how-section" id="how-it-works" aria-labelledby="how-heading">
    <div class="container text-center">
      <p class="section-eyebrow fade-up">The process</p>
      <h2 class="section-title fade-up mx-auto" id="how-heading" style="max-width:500px;margin-left:auto;margin-right:auto;">
        From blank page to published post
      </h2>
      <p class="section-sub fade-up mx-auto" style="margin-left:auto;margin-right:auto;">
        Three steps. No scattered tools. No creative guesswork.
      </p>
      <div class="how-grid">
        <div class="how-step fade-up">
          <div class="how-step-num">Step 01</div>
          <div class="how-step-icon" aria-hidden="true">🏗️</div>
          <h3>Set up your Brand Kit</h3>
          <p>
            Tell Vantly your colours, fonts, voice and what works for your audience.
            Every tool you use inherits it automatically — you never have to brief the
            AI from scratch again.
          </p>
        </div>
        <div class="how-step fade-up fade-up-d2">
          <div class="how-step-num">Step 02</div>
          <div class="how-step-icon" aria-hidden="true">⚡</div>
          <h3>Create in any module</h3>
          <p>
            Jump into Copy, Studio, Video, SmartClip or Email — each tool is purpose-built,
            but shares your brand kit and feeds your analytics. One input, polished output.
          </p>
        </div>
        <div class="how-step fade-up fade-up-d3">
          <div class="how-step-num">Step 03</div>
          <div class="how-step-icon" aria-hidden="true">📈</div>
          <h3>Measure, learn, improve</h3>
          <p>
            Vantly's Brain reads your performance numbers and feeds them back into every
            tool — so next week's copy is smarter than this week's, without lifting a finger.
          </p>
        </div>
      </div>
    </div>
  </section>

  <!-- ══════════════════════════════════════════════════════
       BRAND KIT — on-brand every time
  ══════════════════════════════════════════════════════ -->
  <section class="brandkit-section" aria-labelledby="brandkit-heading">
    <div class="brandkit-inner">
      <div class="fade-up">
        <p class="section-eyebrow">Brand Kit</p>
        <h2 class="section-title" id="brandkit-heading">
          Your brand.<br/>Locked in, always on.
        </h2>
        <p class="section-sub" style="margin-bottom:24px;">
          Set your brand once — colours, fonts, logo, voice, tone, calls-to-action.
          Every tool in Vantly reads it automatically so everything you create is
          on-brand without a brief or style guide reminder.
        </p>
        <ul class="feature-bullets">
          <li><span class="check" aria-hidden="true">✓</span>Colours, fonts and logo stored and applied automatically</li>
          <li><span class="check" aria-hidden="true">✓</span>Brand voice guides the AI on every copy generation</li>
          <li><span class="check" aria-hidden="true">✓</span>Default CTA, URL and tagline pre-filled in every tool</li>
          <li><span class="check" aria-hidden="true">✓</span>Update once — every tool inherits the change instantly</li>
        </ul>
      </div>
      <div class="brandkit-visual fade-up fade-up-d2" style="order:2;">
        <div style="margin-bottom:14px;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--faint);">Your Brand Kit</div>
        <div class="bk-palette">
          <div class="bk-swatch" style="background:#e2924a;" title="Primary"></div>
          <div class="bk-swatch" style="background:#12162a;border:1px solid var(--border3);" title="Secondary"></div>
          <div class="bk-swatch" style="background:#f4c88b;" title="Highlight"></div>
          <div class="bk-swatch" style="background:#6bd39a;" title="Success"></div>
        </div>
        <div class="bk-row">
          <strong>Brand name</strong>
          <small>Vantly · vantly.co.za</small>
        </div>
        <div class="bk-row">
          <strong>Typography</strong>
          <small>Display: Fraunces · Body: Public Sans</small>
        </div>
        <div class="bk-row">
          <strong>Voice</strong>
          <small>Clear, confident and useful. Plain language, no hype.</small>
        </div>
        <div class="bk-row">
          <strong>Default CTA</strong>
          <small>Get your vantage point →</small>
        </div>
        <div style="margin-top:14px;padding:11px 14px;background:rgba(226,146,74,.08);border:1px solid rgba(226,146,74,.2);border-radius:10px;font-size:13px;color:var(--dim);">
          🧠 Brand Kit is active in <strong style="color:var(--text)">Copy, Studio, Video, Email</strong> — all tools, automatically.
        </div>
      </div>
    </div>
  </section>

  <!-- ══════════════════════════════════════════════════════
       ALL MODULES
  ══════════════════════════════════════════════════════ -->
  <section class="modules-section" id="modules" aria-labelledby="modules-heading">
    <div class="container text-center fade-up">
      <p class="section-eyebrow">Everything inside</p>
      <h2 class="section-title mx-auto" id="modules-heading" style="max-width:480px;margin-left:auto;margin-right:auto;">
        Seven tools. One workspace.
      </h2>
    </div>
    <div class="container">
      <div class="modules-grid">

        <div class="module-card featured fade-up">
          <div class="module-icon" aria-hidden="true">✍️</div>
          <h3>Copy Lab</h3>
          <p>Ranked ad-copy angles with performance scores, hashtags and brand-voice enforcement — for every platform.</p>
          <span class="module-badge">Core</span>
        </div>

        <div class="module-card fade-up fade-up-d1">
          <div class="module-icon" aria-hidden="true">🎨</div>
          <h3>Studio</h3>
          <p>On-brand graphics for every post type — templates, AI images, text overlays, drag-and-drop canvas.</p>
        </div>

        <div class="module-card fade-up fade-up-d2">
          <div class="module-icon" aria-hidden="true">🖌️</div>
          <h3>Freeform</h3>
          <p>A blank, infinite canvas for when you want to design a one-off from scratch without constraints.</p>
        </div>

        <div class="module-card featured fade-up fade-up-d1">
          <div class="module-icon" aria-hidden="true">🎬</div>
          <h3>Video Editor</h3>
          <p>Reframe, caption, brand and trim a video for every format — Reels, Stories, Shorts, LinkedIn — in one session.</p>
          <span class="module-badge">Core</span>
        </div>

        <div class="module-card fade-up fade-up-d2">
          <div class="module-icon" aria-hidden="true">🎯</div>
          <h3>SmartClip</h3>
          <p>AI finds the sharpest moments in a long recording and sends them to the Video editor, automatically.</p>
        </div>

        <div class="module-card fade-up fade-up-d3">
          <div class="module-icon" aria-hidden="true">📝</div>
          <h3>Transcribe</h3>
          <p>Turn any recording into clean, accurate text in seconds — ready to repurpose into copy or email.</p>
        </div>

        <div class="module-card fade-up">
          <div class="module-icon" aria-hidden="true">✉️</div>
          <h3>Email</h3>
          <p>Build on-brand newsletters that actually render properly in Gmail and Outlook. No template wrestling.</p>
        </div>

        <div class="module-card fade-up fade-up-d1">
          <div class="module-icon" aria-hidden="true">📅</div>
          <h3>Scheduler</h3>
          <p>Plan and queue your content calendar across social platforms — all in one view, ready to publish.</p>
        </div>

        <div class="module-card featured fade-up fade-up-d2">
          <div class="module-icon" aria-hidden="true">📊</div>
          <h3>Analytics & Brain</h3>
          <p>Real performance numbers across channels, feeding the AI Brain — so every next piece of content is smarter than the last.</p>
          <span class="module-badge">Core</span>
        </div>

      </div>
    </div>
  </section>



  <!-- ══════════════════════════════════════════════════════
       PRICING
  ══════════════════════════════════════════════════════ -->
  <section class="pricing-section" id="pricing" aria-labelledby="pricing-heading">
    <div class="container text-center fade-up">
      <p class="section-eyebrow">Simple pricing</p>
      <h2 class="section-title mx-auto" id="pricing-heading" style="max-width:480px;margin-left:auto;margin-right:auto;">
        Start free. Scale when ready.
      </h2>
      <p class="section-sub mx-auto" style="margin-left:auto;margin-right:auto;">
        No credit card needed to start. Every plan includes the full Brand Kit and core tools.
      </p>
    </div>
    <div class="container">
      <div class="pricing-grid">

        <div class="pricing-card fade-up">
          <div class="pricing-tier">Starter</div>
          <div class="pricing-price">Free<span></span></div>
          <div class="pricing-desc">For individuals and early-stage brands exploring their content strategy.</div>
          <div class="pricing-divider"></div>
          <ul class="pricing-features">
            <li><span class="pf-check" aria-hidden="true">✓</span>Copy Lab — 20 generations / month</li>
            <li><span class="pf-check" aria-hidden="true">✓</span>Studio — basic templates</li>
            <li><span class="pf-check" aria-hidden="true">✓</span>Video editor — up to 5 min clips</li>
            <li><span class="pf-check" aria-hidden="true">✓</span>Brand Kit (1 brand)</li>
            <li><span class="pf-check" aria-hidden="true">✓</span>Analytics overview</li>
          </ul>
          <a href="https://vantly-xi.vercel.app/signup" class="pricing-cta">Get started free</a>
        </div>

        <div class="pricing-card featured fade-up fade-up-d2">
          <div class="pricing-tier">Pro</div>
          <div class="pricing-price">R799<span></span> <span class="per">/mo</span></div>
          <div class="pricing-desc">For active brands publishing consistently across multiple platforms.</div>
          <div class="pricing-divider"></div>
          <ul class="pricing-features">
            <li><span class="pf-check" aria-hidden="true">✓</span>Everything in Starter</li>
            <li><span class="pf-check" aria-hidden="true">✓</span>Unlimited Copy generations</li>
            <li><span class="pf-check" aria-hidden="true">✓</span>Full Studio + AI image generation</li>
            <li><span class="pf-check" aria-hidden="true">✓</span>Video editor — unlimited length</li>
            <li><span class="pf-check" aria-hidden="true">✓</span>SmartClip — 10 hrs/month</li>
            <li><span class="pf-check" aria-hidden="true">✓</span>Email + Scheduler</li>
            <li><span class="pf-check" aria-hidden="true">✓</span>Full Analytics + Brain insights</li>
            <li><span class="pf-check" aria-hidden="true">✓</span>3 team members</li>
          </ul>
          <a href="https://vantly-xi.vercel.app/signup" class="pricing-cta">Start Pro free for 14 days</a>
        </div>

        <div class="pricing-card fade-up fade-up-d3">
          <div class="pricing-tier">Team</div>
          <div class="pricing-price">R1,999<span></span> <span class="per">/mo</span></div>
          <div class="pricing-desc">For growing teams who need shared Brand Kits and collaborative workflows.</div>
          <div class="pricing-divider"></div>
          <ul class="pricing-features">
            <li><span class="pf-check" aria-hidden="true">✓</span>Everything in Pro</li>
            <li><span class="pf-check" aria-hidden="true">✓</span>Unlimited team members</li>
            <li><span class="pf-check" aria-hidden="true">✓</span>Multiple Brand Kits</li>
            <li><span class="pf-check" aria-hidden="true">✓</span>SmartClip — unlimited</li>
            <li><span class="pf-check" aria-hidden="true">✓</span>Priority AI processing</li>
            <li><span class="pf-check" aria-hidden="true">✓</span>Admin & role management</li>
            <li><span class="pf-check" aria-hidden="true">✓</span>Priority support</li>
          </ul>
          <a href="<?php echo esc_url(home_url('/contact')); ?>" class="pricing-cta">Talk to us</a>
        </div>

      </div>
      <p class="pricing-note">All prices in ZAR. Billed monthly. Cancel any time. VAT may apply.</p>
    </div>
  </section>

  <!-- ══════════════════════════════════════════════════════
       FINAL CTA
  ══════════════════════════════════════════════════════ -->
  <section class="cta-section" aria-labelledby="cta-heading">
    <div class="container">
      <div class="cta-inner">
        <div class="cta-glow" aria-hidden="true"></div>
        <h2 id="cta-heading">
          Ready to see from a higher<br/>
          <em>vantage point?</em>
        </h2>
        <p>
          Create your free account in under 60 seconds. No credit card.
          No complicated setup. Just your brand, better content, and real results.
        </p>
        <a href="https://vantly-xi.vercel.app/signup" class="btn-hero">
          Get your vantage point →
        </a>
        <p class="hero-fine fine">Free to start · No credit card required · Cancel any time</p>
      </div>
    </div>
  </section>

<?php get_footer(); ?>
