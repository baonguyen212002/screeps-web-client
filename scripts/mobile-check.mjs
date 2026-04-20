import { chromium } from 'playwright'

const username = `mobile${Date.now().toString().slice(-6)}`
const password = 'test1234'
const baseUrl = 'http://127.0.0.1:4173'

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
})
const page = await context.newPage()

page.on('console', (msg) => console.log('PAGE', msg.type(), msg.text()))

const registerResponse = await fetch(`${baseUrl}/api/auth/register`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Username': username,
  },
  body: JSON.stringify({ username, password }),
})
const auth = await registerResponse.json()
if (!auth?.token) {
  console.error('REGISTER_FAILED', auth)
  process.exit(1)
}

await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
await page.evaluate(({ token, username, password }) => {
  localStorage.setItem('screeps-web-client-token', token)
  localStorage.setItem('screeps-web-client-username', username)
  localStorage.setItem('screeps-web-client-user-password', password)
}, { token: auth.token, username, password })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(5000)
await page.screenshot({ path: '/tmp/screeps-mobile-world.png', fullPage: true })

console.log('USER', username)

await browser.close()
