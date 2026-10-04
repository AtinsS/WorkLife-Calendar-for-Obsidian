const fs = require("fs");
const path = "styles.css";
let s = fs.readFileSync(path, "utf8");
s = s.split('content: "▸"').join('content: "▾"');
s = s.split('content: "›"').join('content: "▾"');
// Fix em-dash mojibake in comments only (harmless but noisy)
s = s.replace(/вЂ”/g, "—");
s = s.replace(/вЂ“/g, "–");
fs.writeFileSync(path, s, "utf8");
console.log("styles.css glyphs fixed");
console.log("content samples:", (s.match(/content: "[^"]+"/g) || []).slice(0, 15).join(" | "));
