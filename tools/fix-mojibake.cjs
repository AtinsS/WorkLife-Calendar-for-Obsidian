const fs = require("fs");
const path = process.argv[2] || "src/task-tracker/TaskModal.ts";
let s = fs.readFileSync(path, "utf8");

// Mojibake: UTF-8 bytes interpreted as Windows-1251/CP866
// вњЋ = ✎, вљЎ = ⚡, рџ“… = 📅, вњЁ = ✨, вЂє = ›, в‚Ѕ = ₽, вЂ¦ = …, в”Ђ = ─
const fixes = [
  [/вњЋ/g, "\u270E"], // ✎
  [/вљЎ/g, "\u26A1"], // ⚡
  [/рџ“…/g, "\uD83D\uDCC5"], // 📅
  [/вњЁ/g, "\u2728"], // ✨
  [/вЂє/g, "\u203A"], // ›
  [/в‚Ѕ/g, "\u20BD"], // ₽
  [/вЂ¦/g, "\u2026"], // …
  [/в”Ђ/g, "\u2500"], // ─
];
for (const [re, to] of fixes) s = s.replace(re, to);

fs.writeFileSync(path, s, "utf8");
const check = fs.readFileSync(path, "utf8");
const samples = check.match(/text: "[^"]+"/g) || [];
console.log(samples.slice(0, 30).join("\n"));
console.log("---");
console.log("mojibake left:", /вњ|вљ|рџ|вЂ|в‚/.test(check));
