// Records a narrated walkthrough of the running app (./dev.sh) to demo/out/.
// Captions, title cards and a visible cursor are injected into the page, so the
// recording needs no editing afterwards: `node record.mjs && python3 to_mp4.py`.
import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { chromium } from 'playwright'

const URL = process.env.APP_URL ?? 'http://localhost:5173'
const SIZE = { width: 1440, height: 900 }
const OUT = new globalThis.URL('./out/', import.meta.url).pathname

const OVERLAY = () => {
  const css = `
    #demo-cursor { position: fixed; z-index: 9999; width: 22px; height: 22px; margin: -4px 0 0 -4px; pointer-events: none;
      transition: transform .12s; filter: drop-shadow(0 1px 2px rgb(0 0 0 / .4)); }
    #demo-cursor.down { transform: scale(.8); }
    .demo-ripple { position: fixed; z-index: 9998; width: 40px; height: 40px; margin: -20px 0 0 -20px; border-radius: 50%;
      border: 3px solid #8b299b; pointer-events: none; animation: demo-ripple .6s ease-out forwards; }
    @keyframes demo-ripple { from { transform: scale(.3); opacity: 1 } to { transform: scale(1.6); opacity: 0 } }
    #demo-caption { position: fixed; z-index: 9997; left: 50%; bottom: 36px; transform: translateX(-50%); max-width: 1100px;
      background: rgb(55 8 62 / .95); color: #fdf0ff; padding: 16px 28px; border-radius: 14px; font: 600 24px/1.35 Figtree, system-ui;
      text-align: center; box-shadow: 0 10px 30px rgb(0 0 0 / .25); transition: opacity .35s; }
    #demo-caption small { display: block; font-weight: 400; font-size: 17px; color: #eeadfb; margin-top: 4px; }
    #demo-caption.hidden { opacity: 0; }
    #demo-card { position: fixed; inset: 0; z-index: 10000; display: grid; place-items: center; text-align: center;
      background: #37083e; color: #fdf0ff; font-family: Figtree, system-ui; transition: opacity .5s; }
    #demo-card.hidden { opacity: 0; pointer-events: none; }
    #demo-card h1 { font-size: 56px; margin: 0 0 18px; letter-spacing: -1px; color: #cede71; }
    #demo-card p { font-size: 24px; color: #eeadfb; margin: 0; max-width: 1000px; line-height: 1.5; }
    .demo-ring { outline: 4px solid #cede71 !important; outline-offset: 3px; border-radius: 6px; transition: outline .2s; }`
  const install = () => {
    if (document.getElementById('demo-cursor')) return
    const style = document.createElement('style')
    style.textContent = css
    document.head.append(style)
    const cursor = document.createElement('div')
    cursor.id = 'demo-cursor'
    cursor.innerHTML =
      '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M3 2l7 19 2.6-7.4L20 11z" fill="white" stroke="black" stroke-width="1.5"/></svg>'
    const caption = document.createElement('div')
    caption.id = 'demo-caption'
    caption.className = 'hidden'
    const card = document.createElement('div')
    card.id = 'demo-card'
    card.className = 'hidden'
    document.body.append(cursor, caption, card)
    document.addEventListener('mousemove', (e) => {
      cursor.style.left = `${e.clientX}px`
      cursor.style.top = `${e.clientY}px`
    })
    document.addEventListener('mousedown', (e) => {
      cursor.classList.add('down')
      const r = document.createElement('div')
      r.className = 'demo-ripple'
      r.style.left = `${e.clientX}px`
      r.style.top = `${e.clientY}px`
      document.body.append(r)
      setTimeout(() => r.remove(), 700)
    })
    document.addEventListener('mouseup', () => cursor.classList.remove('down'))
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install)
  else install()
  window.__demo = {
    caption(text, sub) {
      const el = document.getElementById('demo-caption')
      if (!text) return el.classList.add('hidden')
      el.innerHTML = `${text}${sub ? `<small>${sub}</small>` : ''}`
      el.classList.remove('hidden')
    },
    card(title, sub) {
      const el = document.getElementById('demo-card')
      if (!title) return el.classList.add('hidden')
      el.innerHTML = `<div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div>`
      el.classList.remove('hidden')
    },
    ring(selector) {
      document.querySelectorAll('.demo-ring').forEach((e) => e.classList.remove('demo-ring'))
      if (selector) document.querySelector(selector)?.classList.add('demo-ring')
    },
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: SIZE, recordVideo: { dir: OUT, size: SIZE } })
  await context.addInitScript(OVERLAY)
  const page = await context.newPage()
  page.on('dialog', (d) => d.accept())
  const started = Date.now()

  // Seed a clean demo project (shorter solver limit so the video doesn't idle).
  await page.goto(URL)
  // Let the app finish its own first load + save, or it overwrites the seed.
  await page.waitForSelector('button:has-text("Generate roster")')
  await sleep(1000)
  await page.evaluate(async () => {
    const project = await (await fetch('/api/sample')).json()
    project.solve_seconds = 10
    localStorage.setItem('project', JSON.stringify(project))
    localStorage.setItem('roster', '[]')
    localStorage.setItem('tab', '"Setup"')
  })
  await page.reload()
  await page.waitForSelector('text=Period, shifts and people')
  await page.mouse.move(720, 450)
  const demo = (fn, ...args) => page.evaluate(([f, a]) => window.__demo[f](...a), [fn, args])
  await demo('card', 'Rostering a care unit takes days.', 'Vaktaplan builds a fair, union-compliant roster in seconds.')
  const trimStart = (Date.now() - started) / 1000
  await sleep(4500)
  await demo(
    'card',
    'Built for Icelandic care homes',
    'Betri vinnutími 36h · vægi 1.05 / 1.2 · 11h rest · 2 days off a week · 48h average · public holidays',
  )
  await sleep(4500)
  await demo('card', null)

  const move = async (locator, { click = false, steps = 25 } = {}) => {
    await locator.scrollIntoViewIfNeeded()
    const box = await locator.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps })
    if (click) {
      await sleep(200)
      await page.mouse.down()
      await page.mouse.up()
    }
  }
  const tab = (name) => move(page.locator('nav button', { hasText: new RegExp(`^${name}$`) }), { click: true })
  const scroll = async (dy, steps = 8) => {
    for (let i = 0; i < steps; i++) {
      await page.mouse.wheel(0, dy / steps)
      await sleep(60)
    }
  }

  // 1. Setup
  await demo('caption', '1 · Describe your unit', 'Staff, employment %, who may work nights, shift times, tasks, floors and hallways')
  await sleep(2000)
  await scroll(520)
  await demo('ring', '.col-wide > .card:nth-child(2)')
  await move(page.locator('.form-table input[type=number]').nth(3))
  await sleep(3000)
  await demo('ring', null)

  // 2. Demand
  await tab('Demand')
  await demo('caption', '2 · Say what every shift needs', 'Nurses and floor staff per shift and per hallway, holiday exceptions, tasks like bathing or dining room')
  await sleep(1500)
  await move(page.locator('.overview').first())
  await sleep(1500)
  await move(page.locator('.form-table').first().locator('tr').nth(4))
  await sleep(2500)
  await move(page.locator('.form-table').nth(1))
  await sleep(2500)

  // 3. Leave
  await tab('Leave')
  await demo('caption', '3 · Holidays and day-off requests', 'Requests collected in MTP, entered here — reserved holidays are never touched')
  await sleep(1500)
  const requestCell = page.locator('table.roster tbody tr').nth(9).locator('td button').nth(12)
  await move(requestCell, { click: true })
  await sleep(900)
  await move(page.locator('table.roster tbody tr').nth(3).locator('td button').nth(19), { click: true })
  await sleep(400)
  await page.mouse.down()
  await page.mouse.up()
  await sleep(2500)

  // 4. Rules
  await tab('Rules')
  await demo('caption', '4 · Union rules are built in', 'Every limit is editable — and the roster is checked against all of them')
  await demo('ring', '.labor-grid')
  await sleep(4000)
  await demo('ring', null)
  await scroll(700, 10)
  await demo('caption', '…plus your own planning rules', '“Lilja always works in Gangur A” · “Petra wants a varied shift mix” · “Rotate dining duty fairly”')
  await move(page.locator('.rule-card').nth(3))
  await sleep(2000)
  await move(page.locator('.rule-card').nth(4))
  await sleep(2500)

  // 5. Generate
  await tab('Roster')
  await demo('caption', '5 · Press Generate', null)
  await sleep(1200)
  await move(page.locator('button.lime', { hasText: 'Generate roster' }), { click: true })
  await sleep(1500)
  await demo('caption', 'The solver weighs every person, day and rule at once…', '20 staff × 28 days × 3 shifts — solved as one optimisation')
  await page.waitForSelector('.status-pill:not(.busy)', { timeout: 60_000 })
  await sleep(800)
  await demo('caption', 'A complete four-week roster', 'Every shift covered · hallways and tasks in each cell · overtime shared fairly')
  await demo('ring', '.kpi.dark')
  await move(page.locator('.kpi').nth(1))
  await sleep(3500)
  await demo('ring', null)
  await move(page.locator('table.roster thead th').last())
  await demo('caption', 'Hours vs. contract for every person', 'Weighted hours (vægi), overtime and weekends worked')
  await sleep(3500)

  // 6. Manual change is re-checked
  const target = await page.evaluate(() => {
    const roster = JSON.parse(localStorage.getItem('roster'))
    const project = JSON.parse(localStorage.getItem('project'))
    const next = (d) => new Date(Date.parse(d) + 86_400_000).toISOString().slice(0, 10)
    const busy = new Set(roster.map((a) => `${a.staff_id}|${a.date}`))
    for (const a of roster) {
      const staff = project.staff.find((s) => s.id === a.staff_id)
      const d2 = next(a.date)
      const onLeave = project.leave.some((l) => l.staff_id === a.staff_id && l.start <= d2 && d2 <= l.end)
      const canMorning = staff.allowed_shift_ids === null || staff.allowed_shift_ids.includes('M')
      if (a.shift_id === 'N' && canMorning && !onLeave && !busy.has(`${a.staff_id}|${d2}`) && d2 < '2026-12-20') {
        return { staff: a.staff_id, date: d2 }
      }
    }
    return null
  })
  if (target) {
    const cell = page.locator(`button[data-staff="${target.staff}"][data-date="${target.date}"]`)
    await demo('caption', '6 · Change anything by hand', 'Put someone on a morning shift right after a night…')
    await move(cell, { click: true })
    await sleep(1000)
    await move(page.locator('.shift-option', { hasText: 'Morgunvakt' }), { click: true })
    await sleep(600)
    await move(page.locator('.modal-actions .btn.plum'), { click: true })
    await sleep(1200)
    await move(cell)
    await demo('caption', '…and it is flagged instantly', 'Only 0 hours rest after a night shift — the rule check explains every problem')
    await sleep(3000)
    await move(cell, { click: true })
    await sleep(1800)
    await move(page.locator('.shift-option', { hasText: 'Off' }), { click: true })
    await sleep(400)
    await move(page.locator('.modal-actions .btn.plum'), { click: true })
    await sleep(800)
  }

  // 7. Coverage + export
  await scroll(450, 10)
  await demo('caption', 'Coverage for every shift at a glance', 'Assigned vs. required nurses and floor staff, every day')
  await sleep(3500)
  await scroll(-450, 6)
  await demo('caption', '7 · Export and publish', 'CSV or print — then enter it in MTP as usual')
  await move(page.locator('button', { hasText: 'Export CSV' }))
  await sleep(3000)
  await demo('caption', null)
  await demo('card', 'Days of puzzle-solving → one click', 'Legal, fair, explainable rosters — and you stay in control of every shift.')
  await sleep(5500)

  const video = page.video()
  await context.close()
  await browser.close()
  const raw = await video.path()
  renameSync(raw, `${OUT}walkthrough.webm`)
  for (const f of readdirSync(OUT)) if (f.endsWith('.webm') && f !== 'walkthrough.webm') rmSync(`${OUT}${f}`)
  console.log(JSON.stringify({ webm: `${OUT}walkthrough.webm`, trimStart }))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
