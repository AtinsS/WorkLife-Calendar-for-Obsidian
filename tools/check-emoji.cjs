const fs = require("fs");
const files = [
  "src/task-tracker/QuickAddModal.ts",
  "src/task-tracker/TaskModal.ts",
  "src/services/aiQuickAdd.ts",
  "styles.css",
  "src/i18n/ru.ts",
  "src/i18n/en.ts",
];
const mojibake = /вњ|вљ|рџ|вЂ|в‚/;
for (const f of files) {
  const s = fs.readFileSync(f, "utf8");
  console.log(f, "mojibake=", mojibake.test(s));
}
const s = fs.readFileSync("src/task-tracker/QuickAddModal.ts", "utf8");
const em = s.match(/text: "[^"]+"/g) || [];
console.log("QuickAdd texts:", em.slice(0, 20).join(" | "));
const t = fs.readFileSync("src/task-tracker/TaskModal.ts", "utf8");
const em2 = t.match(/text: "[^"]+"|text: this\.task \? "[^"]+" : "[^"]+"/g) || [];
console.log("TaskModal texts:", em2.slice(0, 20).join(" | "));
