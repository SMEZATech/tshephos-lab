#!/usr/bin/env node
/**
 * Volt — headless render check.
 *
 * smoke.html renders every design through the REAL production worker and asserts on the draw
 * trace (contrast, headline presence, occlusion, dead space). It has always had to be opened in a
 * browser by hand, which means it only ran when someone remembered — and the bugs it catches are
 * exactly the ones that reached the list because nobody remembered.
 *
 * This drives that same page headlessly so it can run on every push. It deliberately does NOT
 * reimplement any of the checks: one source of truth, and the browser version stays the thing you
 * open when you want to look at thumbnails.
 *
 * Playwright is optional. If it isn't installed this exits 0 with a notice rather than failing the
 * build, so `npm test` still works on a machine that only wants the static checks.
 */
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.CI_RENDER_PORT || 8977);
const ROOT = __dirname;

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html";
      const file = path.join(ROOT, rel);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); return res.end("not found");
      }
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(PORT, "127.0.0.1", () => resolve(srv));
  });
}

(async () => {
  let chromium;
  try { ({ chromium } = require("playwright")); }
  catch (e) {
    console.log("· render check SKIPPED — playwright not installed (npm i -D playwright && npx playwright install chromium)");
    process.exit(0);
  }

  const srv = await serve();
  const browser = await chromium.launch();
  let code = 1;
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`http://127.0.0.1:${PORT}/smoke.html`, { waitUntil: "domcontentloaded" });
    // The matrix renders ~180 designs through a worker; give it room on a cold CI runner.
    await page.waitForFunction("window.__smoke !== undefined", null, { timeout: 300000 });
    const r = await page.evaluate("window.__smoke");

    const failures = r.results.filter((x) => !x.ok);
    const warnings = r.results.filter((x) => x.warn);
    console.log(`\n  ${r.passed}/${r.total} designs OK` + (warnings.length ? `  ·  ${warnings.length} warning(s)` : ""));
    for (const w of warnings) console.log(`  ⚠ ${w.name}\n      ${w.warn}`);
    for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.why}`);
    for (const e of errors) console.log(`  ✗ page error: ${e}`);

    if (failures.length || errors.length) {
      console.log(`\n✗ render check FAILED — ${failures.length} design(s), ${errors.length} page error(s)\n`);
      code = 1;
    } else {
      console.log("\n✓ render check passed\n");
      code = 0;
    }
  } catch (e) {
    console.log("\n✗ render check ERRORED — " + (e && e.message) + "\n");
    code = 1;
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(code);
})();
