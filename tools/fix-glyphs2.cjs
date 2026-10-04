const fs = require("fs");

// styles.css remaining content mojibake
let css = fs.readFileSync("styles.css", "utf8");
css = css.replace(/content: "в–Ќ"/g, 'content: "■"');
css = css.replace(/content: "в–Њ"/g, 'content: "□"');
css = css.replace(/content: "в–Љ"/g, 'content: "▪"');
css = css.replace(/content: "в–‹"/g, 'content: "▫"');
css = css.replace(/content: "в–…"/g, 'content: "…"');
fs.writeFileSync("styles.css", css, "utf8");

// TS: replace fancy › caret with ASCII >
for (const f of ["src/task-tracker/QuickAddModal.ts", "src/task-tracker/TaskModal.ts"]) {
  let s = fs.readFileSync(f, "utf8");
  s = s.split('text: "›"').join('text: ">"');
  fs.writeFileSync(f, s, "utf8");
}

console.log("ok");
console.log((css.match(/content: "[^"]+"/g) || []).slice(0, 20).join(" | "));
