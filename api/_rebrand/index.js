// Volt — SMESA 2026 template definitions. © 2026 Tshepho Joel.
//
// Served ONLY through /api/rebrand (api/_routes/rebrand.js), and only to isRebrandPreviewer. The
// leading underscore keeps Vercel from routing this folder, and nothing in app/ may import from it:
// the moment a 2026 template lands in app/*.js it is public, and the gate is a UI hide.
//
// Draw code travels as SOURCE TEXT (fn.toString() of real functions in the sibling files, so they
// stay lintable and `node --check`-able here) and is installed by the page at runtime:
//   studio.engine  → posted into Studio's worker ('install-r26'), extends drawPremium
//   email.source   → evaluated by email.html, adds the t26* TEMPLATES + 2026 sections
//   video.source   → evaluated by video.html, adds the smesa26 VIDEO_TEMPLATES entry
//
// The render tests (ci-render.cjs) import this same module from disk to put the families through
// render-checks.js, so CI covers them without them ever being served publicly.

import { STUDIO_FAMILIES, FIELD_LABELS, studioEngineSource } from "./studio.js";
import { emailSource } from "./email.js";
import { videoSource } from "./video.js";

export const VERSION = "2026.1";
const ASSET = "https://tshephos-lab.vercel.app/brand26/";

// The "SME South Africa 2026" Brand Kit. A SEPARATE kit — the 2024 'sme' kit is untouched and keeps
// rendering every old design. Studio holds this one in memory only (never in the org's synced
// brandkit row), so the team can't see it before release.
export const KIT = {
  id: "sme26",
  name: "SME South Africa 2026",
  primary: "#DC183C",
  secondary: "#0C1F31",
  tag: "SME South Africa",
  cta: "Read more",
  url: "smesouthafrica.co.za",
  logo: ASSET + "logo-reversed@3x.png",       // reversed lockup, for dark surfaces
  logoDark: ASSET + "logo-light@3x.png",      // light lockup, for light surfaces
  cube: ASSET + "cube@3x.png",                // cube alone, only where the wordmark can't stay legible
  summit: ASSET + "summit-badge.png",
  voice: "Confident, practical and warm. Plain English, short sentences, no jargon or hype. Speaks to South African SME founders like a knowledgeable mentor who has done it.",
  designs: Object.keys(STUDIO_FAMILIES),
  preview: true,
};

export const EMAIL_ASSETS = {
  logoReversed: ASSET + "logo-reversed.png",
  logoLight: ASSET + "logo-light.png",
  cube: ASSET + "cube.png",
  fundingReversed: ASSET + "sme-funding-reversed.png",
};

export function definitions() {
  return {
    version: VERSION,
    kit: KIT,
    studio: { families: STUDIO_FAMILIES, labels: FIELD_LABELS, engine: studioEngineSource() },
    email: { assets: EMAIL_ASSETS, source: emailSource() },
    video: { source: videoSource(), assets: { logo: KIT.logo, summit: KIT.summit } },
  };
}
