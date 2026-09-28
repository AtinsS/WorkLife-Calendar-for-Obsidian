// Jest setup — provide browser/Obsidian globals used by the plugin at runtime.
const momentLib = require("moment");
const moment = momentLib.default || momentLib;

// Obsidian exposes moment on window; habit/task code relies on it.
window.moment = moment;
global.moment = moment;

// Obsidian's HTMLElement helpers (addClass/removeClass/hasClass/createEl/createDiv/createSpan/empty)
function ensureObsidianDomHelpers() {
  const proto = typeof HTMLElement !== "undefined" ? HTMLElement.prototype : null;
  if (!proto || proto.__wlDomHelpers) return;
  proto.__wlDomHelpers = true;

  proto.addClass = function (...classes) {
    this.classList.add(...classes.filter(Boolean));
  };
  proto.removeClass = function (...classes) {
    this.classList.remove(...classes.filter(Boolean));
  };
  proto.toggleClass = function (cls, force) {
    this.classList.toggle(cls, force);
  };
  proto.hasClass = function (cls) {
    return this.classList.contains(cls);
  };
  proto.empty = function () {
    while (this.firstChild) this.removeChild(this.firstChild);
  };
  proto.createEl = function (tag, opts) {
    const el = document.createElement(tag);
    if (typeof opts === "string") {
      el.className = opts;
    } else if (opts && typeof opts === "object") {
      if (opts.cls) el.className = Array.isArray(opts.cls) ? opts.cls.join(" ") : opts.cls;
      if (opts.text != null) el.textContent = opts.text;
      if (opts.attr) {
        for (const [k, v] of Object.entries(opts.attr)) el.setAttribute(k, String(v));
      }
    }
    this.appendChild(el);
    return el;
  };
  proto.createDiv = function (opts) {
    return this.createEl("div", opts);
  };
  proto.createSpan = function (opts) {
    return this.createEl("span", opts);
  };
  proto.instanceOf = function (type) {
    return this instanceof type;
  };
  proto.setCssStyles = function (styles) {
    if (!styles) return;
    for (const [k, v] of Object.entries(styles)) {
      if (v == null || v === "") this.style.removeProperty(k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()));
      else this.style.setProperty(k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()), String(v));
    }
  };
  proto.setCssProps = function (props) {
    if (!props) return;
    for (const [k, v] of Object.entries(props)) this.style.setProperty(k, String(v));
  };
}

ensureObsidianDomHelpers();

// Global create helpers (Obsidian exposes these as globals)
if (typeof globalThis.createDiv !== "function") {
  globalThis.createDiv = function (opts) {
    const el = document.createElement("div");
    if (typeof opts === "string") el.className = opts;
    else if (opts && typeof opts === "object") {
      if (opts.cls) el.className = Array.isArray(opts.cls) ? opts.cls.join(" ") : opts.cls;
      if (opts.text != null) el.textContent = opts.text;
      if (opts.attr) for (const [k, v] of Object.entries(opts.attr)) el.setAttribute(k, String(v));
    }
    return el;
  };
}
if (typeof globalThis.createFragment !== "function") {
  globalThis.createFragment = function () {
    return document.createDocumentFragment();
  };
}
