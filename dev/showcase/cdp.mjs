// Minimal Chrome DevTools Protocol client for the showcase VS Code window.
//
//   node dev/showcase/cdp.mjs hold [width height]  keep a fixed 2x viewport until interrupted
//   node dev/showcase/cdp.mjs shot <output.png>     screenshot the workbench, webviews included
//   node dev/showcase/cdp.mjs eval '<js>'           evaluate in the workbench renderer
//   node dev/showcase/cdp.mjs key <key> [modifiers] press a key, e.g. `key p Meta,Shift`
//   node dev/showcase/cdp.mjs type '<text>'         insert text into the focused element
//   node dev/showcase/cdp.mjs click <x> <y> [right] click at CSS pixel coordinates
//   node dev/showcase/cdp.mjs drag <x1> <y1> <x2> <y2>  drag, e.g. to resize a sash
//   node dev/showcase/cdp.mjs tree '<regex>' [index] click the tree row whose aria-label matches
//   node dev/showcase/cdp.mjs run '<label>'         run a Command Palette entry, exact label only
//
// Electron has no CDP window-bounds API, so `hold` emulates the viewport instead. Run it in the
// background while arranging and capturing; the override ends when the process exits.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const port = process.env.SHOWCASE_CDP_PORT ?? "9333";

async function connectWorkbench() {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const workbench = targets.find(
    (target) => target.type === "page" && target.url.includes("workbench.html")
  );
  if (!workbench) {
    throw new Error(
      "No VS Code workbench found. Start it with `node dev/showcase/launch-vscode.mjs`."
    );
  }
  const socket = new WebSocket(workbench.webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => {
    socket.addEventListener("open", resolveOpen, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const handlers = pending.get(message.id);
    if (!handlers) return;
    pending.delete(message.id);
    if (message.error) handlers.reject(new Error(message.error.message));
    else handlers.resolve(message.result);
  });
  const send = (method, params = {}) =>
    new Promise((resolveSend, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve: resolveSend, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  return { send, close: () => socket.close() };
}

const KEY_CODES = {
  Enter: 13,
  Escape: 27,
  Tab: 9,
  Backspace: 8,
  ArrowDown: 40,
  ArrowUp: 38,
  PageUp: 33,
  PageDown: 34,
  End: 35,
  Home: 36,
  F1: 112
};
const MODIFIER_BITS = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };

const [command, ...args] = process.argv.slice(2);
const page = await connectWorkbench();
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function evaluate(expression) {
  const { result, exceptionDetails } = await page.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (exceptionDetails)
    throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  return result.value;
}

async function pressKey(key, modifierList = "") {
  const modifiers = modifierList
    .split(",")
    .filter(Boolean)
    .reduce((bits, name) => bits | MODIFIER_BITS[name], 0);
  const base = {
    key,
    code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
    windowsVirtualKeyCode: KEY_CODES[key] ?? key.toUpperCase().charCodeAt(0),
    modifiers
  };
  await page.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
}

async function click(x, y, button = "left") {
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
    await page.send("Input.dispatchMouseEvent", { type, x, y, button, clickCount: 1 });
  }
}

switch (command) {
  case "hold": {
    const [width = "1600", height = "1000"] = args;
    await page.send("Emulation.setDeviceMetricsOverride", {
      width: Number(width),
      height: Number(height),
      deviceScaleFactor: 2,
      mobile: false
    });
    console.log(`Holding ${width}x${height} @2x; press Ctrl+C to release.`);
    setInterval(() => {}, 60_000);
    await new Promise(() => {});
    break;
  }
  case "shot": {
    const { data } = await page.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(resolve(args[0]), Buffer.from(data, "base64"));
    console.log(`Saved ${args[0]}`);
    break;
  }
  case "eval": {
    const value = await evaluate(args[0]);
    console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
    break;
  }
  case "key":
    await pressKey(args[0], args[1]);
    break;
  case "type":
    await page.send("Input.insertText", { text: args[0] });
    break;
  case "click":
    await click(Number(args[0]), Number(args[1]), args[2] ?? "left");
    break;
  case "drag": {
    const [x1, y1, x2, y2] = args.map(Number);
    await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x1, y: y1 });
    await page.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: x1,
      y: y1,
      button: "left",
      clickCount: 1
    });
    for (let step = 1; step <= 10; step += 1) {
      const x = x1 + ((x2 - x1) * step) / 10;
      const y = y1 + ((y2 - y1) * step) / 10;
      await page.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x,
        y,
        button: "left",
        buttons: 1
      });
    }
    await page.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: x2,
      y: y2,
      button: "left",
      clickCount: 1
    });
    break;
  }
  case "tree": {
    const [pattern, index = "0"] = args;
    const point = await evaluate(`(() => {
      const pattern = new RegExp(${JSON.stringify(pattern)});
      const rows = [...document.querySelectorAll(".monaco-list-row")].filter((row) =>
        pattern.test(row.getAttribute("aria-label") ?? ""));
      const row = rows[${Number(index)}];
      if (!row) return undefined;
      row.scrollIntoView({ block: "nearest" });
      const box = row.getBoundingClientRect();
      return [box.x + Math.min(140, box.width / 2), box.y + box.height / 2];
    })()`);
    if (!point) throw new Error(`No tree row matches ${pattern}`);
    await click(...point);
    break;
  }
  case "run": {
    await pressKey("F1");
    await sleep(800);
    await page.send("Input.insertText", { text: args[0] });
    await sleep(1200);
    const top = await evaluate(
      `(document.querySelector(".quick-input-list .monaco-list-row.focused")?.getAttribute("aria-label") ?? "").split(",")[0]`
    );
    if (top !== args[0]) {
      await pressKey("Escape");
      throw new Error(`Top Command Palette match was "${top}"`);
    }
    await pressKey("Enter");
    break;
  }
  default:
    throw new Error(`Unknown command ${command ?? "(none)"}`);
}
page.close();
