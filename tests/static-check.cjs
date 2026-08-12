"use strict";

const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "komari-theme.json"), "utf8"));
const html = fs.readFileSync(path.join(root, "dist", "index.html"), "utf8");
const js = fs.readFileSync(path.join(root, "dist", "assets", "farm.js"), "utf8");
const css = fs.readFileSync(path.join(root, "dist", "assets", "farm.css"), "utf8");

function assert(condition, message) { if (!condition) throw new Error(message); }

assert(manifest.short === "pixel-farm", "Theme short identifier must be pixel-farm.");
assert(fs.existsSync(path.join(root, "dist", "index.html")), "dist/index.html is required.");
assert(html.includes('class="farm-scenery"'), "The expandable farm scenery layer is required.");
assert(html.includes('id="ping-tasks"'), "The Ping task detail panel is required.");
assert(manifest.preview === "dist/assets/farm-map-v8.png", "The manifest must point to the current original map artwork.");
assert(fs.existsSync(path.join(root, "dist", "assets", "farm-map-v8.png")), "The original six-plot farm map artwork is required.");
assert(fs.existsSync(path.join(root, "dist", "assets", "farm-map-spring.png")), "The spring map artwork is required.");
assert(fs.existsSync(path.join(root, "dist", "assets", "farm-map-autumn.png")), "The autumn map artwork is required.");
assert(fs.existsSync(path.join(root, "dist", "assets", "farm-map-winter.png")), "The winter map artwork is required.");
assert(html.includes("<title>Komari Monitor</title>"), "Komari title placeholder is required.");
assert(html.includes('content="A simple server monitor tool."'), "Komari description placeholder is required.");
assert(html.includes("Powered by Komari Monitor."), "Komari attribution is required.");
assert(html.includes('href="/admin"'), "The theme must provide a direct admin link.");
assert(html.includes('data-season="spring"') && html.includes('data-season="winter"'), "The seasonal controls are required.");
assert(html.includes('data-time="night"'), "The day/night control is required.");
assert(html.includes('id="weather-controls"'), "The weather intensity controls are required.");
assert(!/\.innerHTML\s*=/.test(js), "Remote API data must not be written with innerHTML.");
assert(!/https?:\/\//.test(js), "Theme script must not fetch third-party endpoints.");
assert(js.includes('credentials: "same-origin"'), "API calls must use same-origin credentials.");
assert(js.includes('"/api/records/ping"'), "The theme must collect Komari Ping results.");
assert(js.includes("komari-pixel-farm-scene-v2"), "The selected scene must be stored locally.");
assert(!html.includes("farm-scarecrow"), "The fixed decorative scarecrow overlay must not block the farm.");
assert(!html.includes('id="moon-phase"'), "The fixed moon overlay must not block the farm.");
assert(css.includes("grid-template-columns: repeat(3"), "The farm layout must expand as a CSS grid.");
assert(css.includes("grid-template-columns: repeat(2"), "The farm layout must adapt to smaller screens.");
assert(js.includes('sign.append(createTextElement("span", "plot-name", node.name))'), "Field signposts must show only a node name.");
console.log("Static theme checks passed.");
