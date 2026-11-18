import assert from "node:assert/strict";
import { appConfig } from "./pg-clients.mjs";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";

const base = "http://localhost:3000";
const out = path.join(process.cwd(), "qa-artifacts");
await fs.mkdir(out, { recursive: true });
assert.equal((await fetch(base)).status, 200, "local app is reachable");

const chromePath = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
].find(existsSync);
assert.ok(chromePath, "Google Chrome is installed");
const profile = await fs.mkdtemp(path.join(os.tmpdir(), "nightline-qa-chrome-"));
const port = 54331;
const chrome = spawn(chromePath, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank",
], { windowsHide: true, stdio: "ignore" });

let socket;
let nextId = 0;
const pending = new Map();
try {
  let version;
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  assert.ok(version?.webSocketDebuggerUrl, "isolated Chrome DevTools endpoint started");
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = targets.find((item) => item.type === "page");
  assert.ok(target, "Chrome page target is available");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const waiter = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result);
    }
  });

  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? "Browser evaluation failed");
    return result.result.value;
  };
  const navigate = async (url) => {
    await cdp("Page.navigate", { url: `${base}${url}` });
    for (let attempt = 0; attempt < 80; attempt++) {
      const state = await evaluate("({ready:document.readyState,url:location.pathname+location.search,text:document.body?.innerText||''})");
      if (state.ready === "complete" && state.text.length > 0) return state;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Browser route did not settle: ${url}`);
  };
  const screenshot = async (name, fullPage = true) => {
    const metrics = await cdp("Page.getLayoutMetrics");
    const size = metrics.cssContentSize ?? metrics.contentSize;
    const params = fullPage
      ? { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: size.width, height: size.height, scale: 1 } }
      : { format: "png", captureBeyondViewport: false };
    const image = await cdp("Page.captureScreenshot", params);
    const file = path.join(out, `${name}.png`);
    await fs.writeFile(file, Buffer.from(image.data, "base64"));
    return file;
  };
  const formField = async (selector, value, type = "input") => evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error('Missing form field: ' + ${JSON.stringify(selector)});
    const prototype = ${JSON.stringify(type)} === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, ${JSON.stringify(value)});
    element.dispatchEvent(new Event('input', {bubbles:true}));
    element.dispatchEvent(new Event('change', {bubbles:true}));
  })()`);
  const inspectRoute = async (route, expectedText) => {
    await navigate(route);
    for (let attempt = 0; attempt < 60; attempt++) {
      const state = await evaluate("({text:document.body?.innerText||''})");
      if (state.text.toLowerCase().includes(expectedText.toLowerCase())) return state;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const state = await evaluate("({text:document.body?.innerText||''})");
    assert.fail(`${route} shows ${expectedText}: ${state.text.slice(0, 260)}`);
  };

  await cdp("Page.enable");
  await cdp("Runtime.enable");
  await cdp("DOM.enable");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1365, height: 900, deviceScaleFactor: 1, mobile: false });
  await navigate("/");
  const screenshots = [];
  screenshots.push(await screenshot("landing-desktop"));

  for (const [route, label] of [
    ["/archive", "Archive"], ["/store", "Catalogue"], ["/terms", "Terms"], ["/privacy", "Privacy"], ["/vote", "Decisions"],
  ]) await inspectRoute(route, label);

  await navigate("/board");
  const boardText = await evaluate("document.body.innerText");
  assert.ok(boardText.toLowerCase().includes("local development sign-in"), "local sign-in page renders");
  const loginEmail = `qa-passenger-${Date.now()}@nightline.local`;
  const code = await evaluate(`(async()=>{const r=await fetch('/api/auth/local/start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:${JSON.stringify(loginEmail)}})});const b=await r.json();if(!r.ok)throw Error(b.message);return b.devCode})()`);
  assert.match(code, /^\d{6}$/, "local sign-in endpoint issues a one-time code");
  const verified = await evaluate(`(async()=>{const r=await fetch('/api/auth/local/verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:${JSON.stringify(loginEmail)},code:${JSON.stringify(code)}})});return r.ok})()`);
  assert.equal(verified, true, "local sign-in endpoint establishes browser session");
  await navigate("/register");
  const registrationText = await evaluate("document.body.innerText");
  assert.ok(registrationText.toLowerCase().includes("take a number"), `registration form is available after local sign-in: ${registrationText.slice(0, 250)}`);
  screenshots.push(await screenshot("registration-desktop"));

  const registrationResult = await evaluate(`(async()=>{const links=[...document.querySelectorAll('a')];const terms=links.find(a=>a.href.endsWith('/terms')).textContent.match(/\\d{4}-\\d{2}-\\d{2}/)?.[0];const privacy=links.find(a=>a.href.endsWith('/privacy')).textContent.match(/\\d{4}-\\d{2}-\\d{2}/)?.[0];const r=await fetch('/api/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({displayName:'QA Passenger',instagram:'qa.passenger',accept:true,termsVersion:terms,privacyVersion:privacy})});const b=await r.json();if(!r.ok)throw Error(b.message);return b})()`);
  assert.match(registrationResult.ticket_serial, /^NL-F\d{3}$/, "registration API allocates a founding ticket");
  const ticketState = await navigate("/ticket");
  assert.ok(ticketState.text.includes("QA Passenger"), "personalized ticket shows passenger name");
  assert.ok(ticketState.text.includes(registrationResult.ticket_serial), "personalized ticket displays allocated serial");
  screenshots.push(await screenshot("ticket-desktop"));

  await navigate("/ticket");
  const afterRefresh = await evaluate("document.body.innerText");
  assert.ok(afterRefresh.includes(registrationResult.ticket_serial), "ticket persists after refresh");
  const verifyPath = await evaluate("document.querySelector('a[href^=\"http://localhost:3000/verify/\"]')?.getAttribute('href')");
  assert.ok(verifyPath, "ticket includes public verification link");
  const verifyUrl = new URL(verifyPath);
  const verifyState = await navigate(verifyUrl.pathname);
  assert.ok(verifyState.text.toLowerCase().includes("verified ticket"), "public ticket verification page confirms ticket");
  await inspectRoute("/dashboard", "Terminal");
  screenshots.push(await screenshot("dashboard-desktop"));
  const profileState = await inspectRoute("/profile", "Edit public details");
  assert.ok(profileState.text.includes("QA Passenger"), "profile loads current passenger data");
  const profileSave = await evaluate(`(async()=>{const r=await fetch('/api/profile',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({displayName:'QA Passenger Edited',instagram:'qa.passenger',bio:'',handlePublic:false,listed:true})});return r.status})()`);
  assert.equal(profileSave, 200, "profile update endpoint accepts own profile edit");
  await navigate("/profile");

  const manifest = await inspectRoute("/manifest", "Manifest");
  assert.ok(manifest.text.includes("QA Passenger Edited"), "updated passenger appears in public manifest");
  assert.ok(!/qa-passenger-\d+@nightline\.local/i.test(manifest.text), "manifest omits private email");
  assert.ok(!manifest.text.includes("verification_code") && !manifest.text.includes("user_id"), "manifest omits private ticket and account fields");
  screenshots.push(await screenshot("manifest-desktop"));

  const security = await evaluate(`(async()=>{
    await fetch('/api/auth/logout',{method:'POST'});
    const unauthRegister = await fetch('/api/register',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
    const start=await fetch('/api/auth/local/start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:${JSON.stringify(loginEmail)}})});const code=(await start.json()).devCode;
    await fetch('/api/auth/local/verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:${JSON.stringify(loginEmail)},code})});
    const adminDenied = await fetch('/api/admin',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'transmission',title:'Forbidden QA',body:'must not publish'})});
    const idem = await fetch('/api/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({displayName:'QA Passenger',instagram:'qa.passenger',accept:true,termsVersion:'2026-11-18',privacyVersion:'2026-11-18'})});
    const duplicate = await idem.json();
    const payment = await fetch('/api/purchases',{method:'POST'});
    return {unauthRegister:unauthRegister.status,adminDenied:adminDenied.status,duplicate:duplicate.already_registered,serial:duplicate.ticket_serial,payment:payment.status};
  })()`);
  assert.equal(security.unauthRegister, 401, "unauthenticated registration is rejected");
  assert.equal(security.adminDenied, 403, "ordinary passenger cannot publish as admin");
  assert.equal(security.duplicate, true, "duplicate registration returns existing ticket");
  assert.equal(security.serial, registrationResult.ticket_serial, "duplicate registration does not allocate another ticket");
  assert.equal(security.payment, 403, "payments API remains disabled");
  const deniedAdmin = await inspectRoute("/admin", "Sealed");
  assert.ok(deniedAdmin.text.includes("authorised administrator"), "ordinary passenger sees sealed admin console");

  await evaluate("fetch('/api/auth/logout',{method:'POST',redirect:'manual'})");
  await navigate("/board");
  const localAdminEmail = await fs.readFile(path.join(process.cwd(), ".env.local"), "utf8")
    .then((text) => text.match(/^LOCAL_ADMIN_EMAILS=(.*)$/m)?.[1]?.split(",")[0]?.trim());
  assert.ok(localAdminEmail, "local admin account is configured without printing environment settings");
  await formField('input[type="email"]', localAdminEmail);
  const adminCode = await evaluate(`(async()=>{const r=await fetch('/api/auth/local/start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:${JSON.stringify(localAdminEmail)}})});const b=await r.json();if(!r.ok)throw Error(b.message);return b.devCode})()`);
  const adminVerified = await evaluate(`(async()=>{const r=await fetch('/api/auth/local/verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:${JSON.stringify(localAdminEmail)},code:${JSON.stringify(adminCode)}})});return r.ok})()`);
  assert.equal(adminVerified, true, "authorized administrator session is established locally");
  await inspectRoute("/admin", "Conductor’s desk");
  const adminText = await evaluate("document.body.innerText");
  assert.ok(adminText.toLowerCase().includes("conductor’s desk"), "authorized administrator sees console");
  assert.ok(adminText.toLowerCase().includes("roles"), `authorized administrator sees roles section: ${adminText.slice(-300)}`);
  assert.ok(!adminText.includes("Passenger 500 holds Conductor") && !adminText.includes("Passenger 500 holds Driver"), "unresolved roles remain unassigned");
  screenshots.push(await screenshot("admin-desktop"));

  const publish = await evaluate(`(async()=>{
    const now=new Date();
    const result=await fetch('/api/admin',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'transmission',title:'QA Admin Publication',body:'Published in isolated QA database only.'})});
    return result.status;
  })()`);
  assert.equal(publish, 200, "authorized administrator can publish content in QA database");

  const pollPublish = await evaluate(`(async()=>{const now=new Date();const close=new Date(now.getTime()+86400000);const r=await fetch('/api/admin',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'poll',title:'QA single vote',story:'Local voting check',options:['Option A','Option B'],opensAt:now.toISOString(),closesAt:close.toISOString(),showResults:'live'})});return r.status})()`);
  assert.equal(pollPublish, 200, "authorized administrator can publish a poll in QA");
  const qaDb = new pg.Client(appConfig("nightline_qa_ui", 54329));
  let votes;
  await qaDb.connect();
  try {
    const poll = await qaDb.query("select p.id, o.id as option_id from public.polls p join public.poll_options o on o.poll_id=p.id where p.title='QA single vote' and o.label='Option A' order by p.created_at desc limit 1");
    assert.equal(poll.rowCount, 1, "published QA poll and option exist");
    await evaluate("fetch('/api/auth/logout',{method:'POST',redirect:'manual'})");
    const voterCode = await evaluate(`(async()=>{const r=await fetch('/api/auth/local/start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:${JSON.stringify(loginEmail)}})});return (await r.json()).devCode})()`);
    const voterVerified = await evaluate(`(async()=>{const r=await fetch('/api/auth/local/verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:${JSON.stringify(loginEmail)},code:${JSON.stringify(voterCode)}})});return r.ok})()`);
    assert.equal(voterVerified, true, "passenger session restored for voting");
    votes = await evaluate(`(async()=>{const body=JSON.stringify({pollId:${JSON.stringify(poll.rows[0].id)},optionId:${JSON.stringify(poll.rows[0].option_id)}});const first=await fetch('/api/vote',{method:'POST',headers:{'content-type':'application/json'},body});const second=await fetch('/api/vote',{method:'POST',headers:{'content-type':'application/json'},body});return {first:first.status,second:second.status}})()`);
    assert.equal(votes.first, 200, "passenger can cast a vote");
    assert.notEqual(votes.second, 200, "same passenger cannot vote twice in the same poll");
  } finally {
    await qaDb.end();
  }

  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  const mobile = [];
  for (const route of ["/", "/register", "/ticket", "/manifest", "/dashboard", "/admin"]) {
    await navigate(route);
    const dimensions = await evaluate("({innerWidth,scrollWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth})");
    assert.ok(dimensions.scrollWidth <= dimensions.innerWidth + 1, `${route} has no horizontal page overflow on mobile (${JSON.stringify(dimensions)})`);
    mobile.push({ route, width: dimensions.innerWidth, scrollWidth: dimensions.scrollWidth });
    if (["/", "/register", "/ticket", "/manifest", "/dashboard", "/admin"].includes(route)) await screenshot(`mobile-${route.slice(1) || "landing"}`);
  }
  await evaluate("fetch('/api/auth/logout',{method:'POST',redirect:'manual'})");
  const mobileAdminCode = await evaluate(`(async()=>{const r=await fetch('/api/auth/local/start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:${JSON.stringify(localAdminEmail)}})});return (await r.json()).devCode})()`);
  await evaluate(`fetch('/api/auth/local/verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:${JSON.stringify(localAdminEmail)},code:${JSON.stringify(mobileAdminCode)}})})`);
  const mobileAdmin = await navigate("/admin");
  assert.ok(mobileAdmin.text.toLowerCase().includes("conductor’s desk"), "authorized admin console renders on mobile");
  const adminDimensions = await evaluate("({innerWidth,scrollWidth:document.documentElement.scrollWidth})");
  assert.ok(adminDimensions.scrollWidth <= adminDimensions.innerWidth + 1, "authorized admin console has no horizontal overflow on mobile");
  mobile.push({ route: "/admin (authorized)", ...adminDimensions });
  await screenshot("mobile-admin-authorized");
  await cdp("Emulation.clearDeviceMetricsOverride");

  const result = {
    browser: "Google Chrome headless, isolated temporary profile",
    localDatabase: "nightline_qa_ui",
    screenshots,
    desktopRoutes: ["/", "/board", "/register", "/ticket", "/verify/[code]", "/dashboard", "/profile", "/manifest", "/vote", "/archive", "/store", "/terms", "/privacy", "/admin"],
    security,
    adminPublishStatus: publish,
    pollPublishStatus: pollPublish,
    voteStatuses: votes,
    mobile,
  };
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    try { socket.send(JSON.stringify({ id: ++nextId, method: "Browser.close" })); } catch { /* browser is already closing */ }
  }
  try { chrome.kill(); } catch { /* process already exited */ }
}
