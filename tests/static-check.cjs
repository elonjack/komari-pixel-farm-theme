"use strict";

const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "komari-theme.json"), "utf8"));
const html = fs.readFileSync(path.join(root, "dist", "index.html"), "utf8");
const js = fs.readFileSync(path.join(root, "dist", "assets", "farm.js"), "utf8");

function assert(condition, message) { if (!condition) throw new Error(message); }

assert(manifest.short === "pixel-farm", "Theme short identifier must be pixel-farm.");
assert(fs.existsSync(path.join(root, "dist", "index.html")), "dist/index.html is required.");
assert(html.includes('id="farm-canvas"'), "The responsive tile-map canvas is required.");
assert(html.includes("<title>Komari Monitor</title>"), "Komari title placeholder is required.");
assert(html.includes('content="A simple server monitor tool."'), "Komari description placeholder is required.");
assert(html.includes("Powered by Komari Monitor."), "Komari attribution is required.");
assert(!/\.innerHTML\s*=/.test(js), "Remote API data must not be written with innerHTML.");
assert(!/https?:\/\//.test(js), "Theme script must not fetch third-party endpoints.");
assert(js.includes('credentials: "same-origin"'), "API calls must use same-origin credentials.");
console.log("Static theme checks passed.");
