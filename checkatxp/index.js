const TelegramBot = require("node-telegram-bot-api");
const { chromium } = require("playwright");

// ================== CONFIG (Yaha apna daalo) ==================
const BOT_TOKEN = process.env.ATXP_BOT_TOKEN || "8507909071:AAH-dKGOKGP1-UKfnrHB7pB378BcjZWvLuQ";
let CHAT_ID = process.env.ATXP_CHAT_ID || "5291409360";
const EMAIL = process.env.ATXP_EMAIL || "flwdlqx@indogmail.com";
const URL = "https://accounts.atxp.ai/fund";
// =============================================================

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

let waitingForCode = false;
let receivedCode = null;
let automationRunning = false;

console.log("🤖 ATXP Bot chal raha hai...");

// ============ HELPER: message bhejo (4096 limit safe) ============
async function sendMsg(text) {
  try {
    let safe = String(text);
    if (safe.length > 3500) safe = safe.substring(0, 3500) + "\n...(kaata gaya)";
    await bot.sendMessage(CHAT_ID, safe);
  } catch (e) {
    console.error("[atxp] Send error:", e.message);
  }
}

// ============ HELPER: error ko detail me bhejo ============
async function sendError(step, e) {
  let msg = "❌ ERROR at STEP: " + step + "\n";
  msg += "Reason: " + (e && e.message ? e.message : e);
  if (msg.length > 3500) msg = msg.substring(0, 3500);
  await sendMsg(msg);
  console.error("[atxp][" + step + "]", e);
}

// ============ HELPER: screenshot bhejo ============
async function sendShot(page, caption) {
  try {
    const shot = await page.screenshot({ fullPage: true });
    await bot.sendPhoto(CHAT_ID, shot, { caption: "📸 " + String(caption).substring(0, 900) });
  } catch (e) {
    console.error("[atxp] Screenshot error:", e.message);
    await sendMsg("⚠️ Screenshot nahi le paya: " + e.message);
  }
}

// ============ HELPER: code ka wait ============
function waitForCode(timeoutMs = 300000) {
  return new Promise((resolve) => {
    const interval = 2000;
    let elapsed = 0;
    const timer = setInterval(() => {
      if (receivedCode) {
        clearInterval(timer);
        resolve(receivedCode);
      }
      elapsed += interval;
      if (elapsed >= timeoutMs) {
        clearInterval(timer);
        resolve(null);
      }
    }, interval);
  });
}

// ==================== MAIN AUTOMATION ====================
async function runAutomation() {
  if (automationRunning) {
    await sendMsg("⚠️ Automation pehle se chal rahi hai...");
    return;
  }
  automationRunning = true;
  await sendMsg("🚀 Automation shuru ho rahi hai...");

  let browser;
  let page;

  // -------- BROWSER LAUNCH --------
  try {
    await sendMsg("⏳ [1/8] Browser launch kar raha hoon...");
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--single-process",
      ],
    });
    page = await browser.newPage();
    await page.setViewportSize({ width: 412, height: 915 });
    await sendMsg("✓ [1/8] Browser launch ho gaya");
  } catch (e) {
    await sendError("1-BROWSER_LAUNCH", e);
    await sendMsg("💡 Fix: Railway me variable daalo → PLAYWRIGHT_BROWSERS_PATH = 0");
    automationRunning = false;
    return;
  }

  // -------- STEP 2: SITE OPEN --------
  try {
    await sendMsg("⏳ [2/8] Site khol raha hoon...");
    await page.goto(URL, { timeout: 60000, waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4000);
    await sendMsg("✓ [2/8] Site khul gayi: " + URL);
  } catch (e) {
    await sendError("2-SITE_OPEN", e);
    await safeClose(browser);
    automationRunning = false;
    return;
  }

  // -------- STEP 3: LOGIN BUTTON --------
  try {
    await sendMsg("⏳ [3/8] 'Log in or Sign up' button dhundh raha hoon...");
    await page.click("text=Log in or Sign up", { timeout: 20000 });
    await page.waitForTimeout(4000);
    await sendMsg("✓ [3/8] Login button click ho gaya");
  } catch (e) {
    await sendError("3-LOGIN_BUTTON", e);
    await sendShot(page, "STEP 3 fail - login button nahi mila");
    await safeClose(browser);
    automationRunning = false;
    return;
  }

  // -------- STEP 4: EMAIL FILL --------
  try {
    await sendMsg("⏳ [4/8] Email box dhundh raha hoon...");
    const emailInput = page
      .locator("input[type='email'], input[placeholder*='email'], input[placeholder*='@'], input[name='email']")
      .first();
    await emailInput.waitFor({ timeout: 20000 });
    await emailInput.click();
    await emailInput.fill(EMAIL);
    await page.waitForTimeout(1500);
    await sendMsg("✓ [4/8] Email daal diya: " + EMAIL);
  } catch (e) {
    await sendError("4-EMAIL_FILL", e);
    await sendShot(page, "STEP 4 fail - email box nahi mila");
    await safeClose(browser);
    automationRunning = false;
    return;
  }

  // -------- STEP 5: SUBMIT --------
  try {
    await sendMsg("⏳ [5/8] Submit kar raha hoon...");
    let submitDone = false;
    try {
      await page.click("text=Submit", { timeout: 15000 });
      submitDone = true;
      await sendMsg("✓ [5/8] Submit button click ho gaya");
    } catch (e1) {
      // Backup: Enter key
      await page.keyboard.press("Enter");
      submitDone = true;
      await sendMsg("✓ [5/8] Submit (Enter key se) ho gaya");
    }
    await page.waitForTimeout(5000);
    if (!submitDone) throw new Error("Submit ka koi tarika kaam nahi kiya");
  } catch (e) {
    await sendError("5-SUBMIT", e);
    await sendShot(page, "STEP 5 fail - submit nahi hua");
    await safeClose(browser);
    automationRunning = false;
    return;
  }

  // -------- STEP 6: CODE POPUP + CODE MAANGO --------
  let code;
  try {
    await sendMsg("⏳ [6/8] Code popup check kar raha hoon...");
    const content = (await page.content()).toLowerCase();
    if (content.includes("code") || content.includes("verify") || content.includes("enter")) {
      await sendMsg("✓ [6/8] Code ka popup aa gaya");
    } else {
      await sendMsg("⚠️ [6/8] Code popup confirm nahi hua, phir bhi code maang raha hoon...");
    }
    await sendShot(page, "STEP 6 - code popup");

    await sendMsg("📩 Email pe jo CODE aaya hai wo yaha bhej do (sirf number):");
    waitingForCode = true;
    receivedCode = null;
    code = await waitForCode(300000);
    waitingForCode = false;

    if (!code) {
      await sendMsg("✗ [6/8] Code nahi mila 5 minute me. Automation cancel.");
      await safeClose(browser);
      automationRunning = false;
      return;
    }
    await sendMsg("✓ [6/8] Code mil gaya: " + code);
  } catch (e) {
    await sendError("6-CODE_POPUP", e);
    await sendShot(page, "STEP 6 fail");
    await safeClose(browser);
    automationRunning = false;
    return;
  }

  // -------- STEP 7: CODE FILL --------
  try {
    await sendMsg("⏳ [7/8] Code daal raha hoon...");
    const otpInputs = page.locator(
      "input[inputmode='numeric'], input[type='text'][maxlength='1'], input[autocomplete='one-time-code']"
    );
    const count = await otpInputs.count();

    if (count > 1) {
      const digits = code.trim().split("");
      for (let i = 0; i < digits.length && i < count; i++) {
        await otpInputs.nth(i).fill(digits[i]);
        await page.waitForTimeout(200);
      }
      await sendMsg("✓ [7/8] Code " + count + " boxes me daal diya");
    } else {
      const single = page.locator("input").last();
      await single.fill(code.trim());
      await sendMsg("✓ [7/8] Code single box me daal diya");
    }
    await page.waitForTimeout(6000);
  } catch (e) {
    await sendError("7-CODE_FILL", e);
    await sendShot(page, "STEP 7 fail - code daalne me error");
    await safeClose(browser);
    automationRunning = false;
    return;
  }

  // -------- STEP 8: LOGIN VERIFY (REAL) --------
  try {
    await sendMsg("⏳ [8/8] Login verify kar raha hoon...");
    await page.waitForTimeout(3000);
    const currentUrl = page.url();
    const finalContent = (await page.content()).toLowerCase();

    const loggedIn =
      finalContent.includes("logout") ||
      finalContent.includes("dashboard") ||
      finalContent.includes("balance") ||
      finalContent.includes("wallet") ||
      finalContent.includes("sign out") ||
      finalContent.includes("account");

    if (loggedIn) {
      await sendMsg("✅ LOGIN SUCCESS! Sach me login ho gaya.\n🔗 URL: " + currentUrl);
    } else {
      await sendMsg("⚠️ Login confirm nahi hua. Code galat ya extra step ho sakta hai.\n🔗 URL: " + currentUrl);
    }
    await sendShot(page, "FINAL result (proof)");
  } catch (e) {
    await sendError("8-VERIFY", e);
    await sendShot(page, "STEP 8 fail");
  }

  await safeClose(browser);
  await sendMsg("🏁 Automation complete ho gayi.");
  automationRunning = false;
}

// ============ HELPER: browser safe close ============
async function safeClose(browser) {
  try {
    if (browser) await browser.close();
  } catch (e) {
    console.error("[atxp] Close error:", e.message);
  }
}

// ==================== TELEGRAM HANDLERS ====================

// /start command
bot.onText(/\/start/, async (msg) => {
  CHAT_ID = msg.chat.id.toString();
  await bot.sendMessage(CHAT_ID, "👋 ATXP Bot ready hai! Automation start kar raha hoon...");
  runAutomation().catch(async (e) => {
    await sendMsg("❌ Automation crash: " + (e.message || e));
  });
});

// Code receive
bot.on("message", async (msg) => {
  const text = msg.text ? msg.text.trim() : "";
  if (text.startsWith("/")) return;
  if (waitingForCode) {
    receivedCode = text;
    await bot.sendMessage(msg.chat.id, "✓ Code receive hua: " + text);
  }
});

// ==================== ERROR HANDLING (crash-proof) ====================

// Polling error - 409 conflict pe band mat karo
bot.on("polling_error", (err) => {
  const m = err && err.message ? err.message : String(err);
  console.error("[atxp] Polling error:", m);
  // 409 = do instance chal rahe hain, ignore karke chalte raho
});

process.on("uncaughtException", async (err) => {
  console.error("[atxp] Uncaught:", err);
  try {
    let m = String((err && err.message) || err).substring(0, 3000);
    await bot.sendMessage(CHAT_ID, "❌ CRASH (Uncaught): " + m);
  } catch (e) {}
});

process.on("unhandledRejection", async (err) => {
  console.error("[atxp] Rejection:", err);
  try {
    let m = String((err && err.message) || err).substring(0, 3000);
    await bot.sendMessage(CHAT_ID, "❌ ERROR (Rejection): " + m);
  } catch (e) {}
});
