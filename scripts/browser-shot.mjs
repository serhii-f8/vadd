// Zero-dependency Chrome DevTools Protocol driver. Node 22 has a global
// WebSocket, so this needs no packages at all — which matters, because the
// point is to prove browser verification is possible here without changing
// the repo's dependencies.
import { writeFileSync } from 'node:fs'

const [, , wsUrl, outDir, ...steps] = process.argv
let id = 0
const pending = new Map()
const ws = new WebSocket(wsUrl)
await new Promise((r) => (ws.onopen = r))
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data)
  if (msg.id && pending.has(msg.id)) pending.get(msg.id)(msg)
}
const send = (method, params = {}) =>
  new Promise((res) => {
    const n = ++id
    pending.set(n, res)
    ws.send(JSON.stringify({ id: n, method, params }))
  })

const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
  })
  return r.result?.result?.value
}
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${outDir}/${name}.png`, Buffer.from(r.result.data, 'base64'))
  console.log('shot', name)
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

await send('Page.enable')
await send('Runtime.enable')

for (const step of steps) {
  const [op, ...rest] = step.split('|')
  const arg = rest.join('|')
  if (op === 'goto') {
    await send('Page.navigate', { url: arg })
    await wait(2500)
  } else if (op === 'wait') {
    await wait(Number(arg))
  } else if (op === 'shot') {
    await shot(arg)
  } else if (op === 'theme') {
    await send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: arg }],
    })
    await wait(400)
  } else if (op === 'click') {
    // Click the first element whose text matches, scoped by an optional
    // CSS prefix: "click|button|Release" clicks the first <button> saying Release.
    // Dispatches a full pointerdown/mousedown/mouseup/click sequence, not just
    // .click() — Radix primitives (Tabs among them) activate on mousedown, and
    // a bare synthetic .click() call never fires that handler.
    // Prefers an exact (trimmed) text match over a substring one — two
    // buttons whose text is a prefix/suffix of each other (e.g. "Clone" the
    // submit button vs. "Clone repository" the tab, in DOM order before it)
    // otherwise silently click the wrong one with no error.
    const [sel, text] = arg.split('~')
    const ok = await evaluate(`(() => {
      const els = [...document.querySelectorAll(${JSON.stringify(sel)})];
      const el =
        els.find((e) => e.textContent.trim() === ${JSON.stringify(text)}) ??
        els.find((e) => e.textContent.includes(${JSON.stringify(text)}));
      if (!el) return 'NOT FOUND: ' + ${JSON.stringify(text)};
      const opts = { bubbles: true, cancelable: true, view: window, button: 0 };
      el.dispatchEvent(new PointerEvent('pointerdown', opts));
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      el.dispatchEvent(new PointerEvent('pointerup', opts));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      el.click();
      return 'clicked';
    })()`)
    console.log('click', text, '->', ok)
    await wait(600)
  } else if (op === 'eval') {
    console.log('eval ->', JSON.stringify(await evaluate(arg)))
  } else if (op === 'type') {
    // Set a controlled React input's value via the native setter so React's
    // own onChange fires, then dispatch input/change: "type|input[name=url]|https://..."
    const [sel, text] = arg.split('~')
    const ok = await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return 'NOT FOUND: ' + ${JSON.stringify(sel)};
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, ${JSON.stringify(text)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return 'typed: ' + el.value;
    })()`)
    console.log('type', sel, '->', ok)
    await wait(300)
  }
}
ws.close()
