const fs = require("fs");
const path = "V:/dev/obsidian/WorkLife-Calendar-for-Obsidian/styles.css";
let s = fs.readFileSync(path, "utf8");
// Fix mojibake CSS markers → proper Unicode escapes (ASCII-safe source)
const fixes = [
  ['content: "в–ё"', 'content: "\\2022"'], // bullet •
  ['content: "в–ѕ"', 'content: "\\25B8"'], // small right triangle ▸
  ['content: "в– "', 'content: "\\258C"'], // left half block (caret) ▌
  ['content: "в–Ў"', 'content: "\\258C"'],
  ['content: "в–Ќ"', 'content: "\\258C"'],
];
let n = 0;
for (const [a, b] of fixes) {
  while (s.includes(a)) {
    s = s.replace(a, b);
    n++;
  }
}
fs.writeFileSync(path, s);
console.log("fixed", n, "css content values");
