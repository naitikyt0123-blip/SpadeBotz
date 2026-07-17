const TelegramBot = require("node-telegram-bot-api");
const { chromium } = require("playwright");

// ================== CONFIG (Yaha apna daalo) ==================
const BOT_TOKEN = process.env.ATXP_BOT_TOKEN || "8507909071:AAGIHe3wPDvFhg5riJ8wvLgZ-_w48f27IYM";
let CHAT_ID = process.env.ATXP_CHAT_ID || "5291409360";
const EMAIL = process.env.ATXP_EMAIL || "flwdlqx@indogmail.com";
const URL = "https://accounts.atxp.ai/fund";
// =============================================================

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

let waitingForCode = false;
let receivedCode = null;
let automationRunning = false;

console.log("🤖 ATXP Bot chal raha hai...");

// ---- Helper: message bhejo ----
async function sendMsg(text) {
  try {
    await bot.sendMessage(CHAT_ID, text);
  } catch (e) {
    console.error("[atxp] Send error:", e.message);
  }
}

// ---- Helper: code ka wait ----
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

// ---- MAIN AUTOMATION ----
async function runAutomation() {
  if (automationRunning) {
    await sendMsg("⚠️ Automation pehle se chal rahi hai...");
    return;
  }
  automationRunning = true;
  await sendMsg("🚀 Automation shuru ho rahi hai...");

  let browser;
  try {
    // ---- Browser launch (detailed error ke saath) ----
    await sendMsg("⏳ Browser launch kar raha hoon...");
    try {
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
    } catch (e) {
      await sendMsg(
        "✗ Browser launch FAIL hua!\nError: " +
          e.message +
          "\n\n(Ye Playwright/chromium install ki problem hai)"
      );
      automationRunning = false;
      return;
    }

    const page = await browser.newPage();
    await page.setViewportSize({ width: 412, height: 915 });
    await sendMsg("✓ Browser launch ho gaya");

    // ---- STEP 1: Site kholo ----
    await page.goto(URL, { timeout: 60000, waitUntil: "domcontentloaded" });
    await sendMsg("✓ Site khul gayi: " + URL);
    await page.waitForTimeout(4000);

    // ---- STEP 2: "Log in or Sign up" button ----
    try {
      await page.click("text=Log in or Sign up", { timeout: 20000 });
      await sendMsg("✓ 'Log in or Sign up' button click ho gaya");
    } catch (e) {
      await sendMsg("✗ Login button nahi mila: " + e.message);
      await sendShot(page, "login button nahi mila");
      await browser.close();
      automationRunning = false;
      return;
    }
    await page.waitForTimeout(4000);

    // ---- STEP 3: Email daalo ----
    try {
      const emailInput = page
        .locator(
          "input[type='email'], input[placeholder*='email'], input[placeholder*='@'], input[name='email']"
        )
        .first();
      await emailInput.waitFor({ timeout: 20000 });
      await emailInput.click();
      await emailInput.fill(EMAIL);
      await sendMsg("✓ Email daal diya: " + EMAIL);
    } catch (e) {
      await sendMsg("✗ Email box nahi mila: " + e.message);
      await sendShot(page, "email box nahi mila");
      await browser.close();
      automationRunning = false;
      return;
    }
    await page.waitForTimeout(2000);

    // ---- STEP 4: Submit click ----
    try {
      await page.click("text=Submit", { timeout: 20000 });
      await sendMsg("✓ Submit button click ho gaya");
    } catch (e) {
      // Enter dabake bhi try karo
      try {
        await page.keyboard.press("Enter");
        await sendMsg("✓ Submit (Enter key se) ho gaya");
      } catch (e2) {
        await sendMsg("✗ Submit button nahi mila: " + e.message);
        await sendShot(page, "submit nahi mila");
        await browser.close();
        automationRunning = false;
        return;
      }
    }
    await page.waitForTimeout(5000);

    // ---- STEP 5: Code popup verify ----
    const content = (await page.content()).toLowerCase();
    if (
      content.includes("code") ||
      content.includes("verify") ||
      content.includes("enter")
    ) {
      await sendMsg("✓ Code ka popup aa gaya (verification)");
    } else {
      await sendMsg("⚠️ Code popup confirm nahi hua, phir bhi code maang raha hoon...");
    }
    await sendShot(page, "code popup");

    // ---- STEP 6: Code maango ----
    await sendMsg("📩 Email pe jo CODE aaya hai wo yaha bhej do (sirf number):");
    waitingForCode = true;
    receivedCode = null;

    const code = await waitForCode(300000);
    waitingForCode = false;

    if (!code) {
      await sendMsg("✗ Code nahi mila 5 minute me. Automation cancel.");
      await browser.close();
      automationRunning = false;
      return;
    }
    await sendMsg("✓ Code mil gaya: " + code + " — ab daal raha hoon...");

    // ---- STEP 7: Code daalo ----
    try {
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
        await sendMsg("✓ Code " + count + " boxes me daal diya");
      } else {
        const single = page.locator("input").last();
        await single.fill(code.trim());
        await sendMsg("✓ Code single box me daal diya");
      }
    } catch (e) {
      await sendMsg("✗ Code daalne me error: " + e.message);
      await sendShot(page, "code daalne me error");
      await browser.close();
      automationRunning = false;
      return;
    }
    await page.waitForTimeout(6000);

    // ---- STEP 8: Login VERIFY (REAL check) ----
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
      await sendMsg(
        "⚠️ Login confirm nahi hua. Code galat ho sakta hai ya extra step.\n🔗 URL: " +
          currentUrl
      );
    }

    // ---- Final screenshot proof ----
    await sendShot(page, "FINAL result (proof)");

    await browser.close();
    await sendMsg("🏁 Automation complete ho gayi.");
  } catch (e) {
    await sendMsg("✗ Bada error aaya: " + e.message);
    console.error(e);
    try {
      if (browser) await browser.close();
    } catch (er) {}
  }
  automationRunning = false;
}

// ---- Helper: screenshot bhejo ----
async function sendShot(page, caption) {
  try {
    const shot = await page.screenshot({ fullPage: true });
    await bot.sendPhoto(CHAT_ID, shot, { caption: "📸 " + caption });
  } catch (e) {
    console.error("[atxp] Screenshot error:", e.message);
  }
}

// ---- /start command ----
bot.onText(/\/start/, async (msg) => {
  CHAT_ID = msg.chat.id.toString();
  await bot.sendMessage(CHAT_ID, "👋 ATXP Bot ready hai! Automation start kar raha hoon...");
  runAutomation();
});

// ---- Code receive ----
bot.on("message", async (msg) => {
  const text = msg.text ? msg.text.trim() : "";
  if (text.startsWith("/")) return;
  if (waitingForCode) {
    receivedCode = text;
    await bot.sendMessage(msg.chat.id, "✓ Code receive hua: " + text);
  }
});

// ---- Error handling (crash bhi telegram pe aaye) ----
bot.on("polling_error", (err) => console.error("[atxp] Polling error:", err.message));

process.on("uncaughtException", async (err) => {
  console.error("Uncaught:", err);
  try {
    await bot.sendMessage(CHAT_ID, "❌ CRASH: " + err.message);
  } catch (e) {}
});

process.on("unhandledRejection", async (err) => {
  console.error("Rejection:", err);
  try {
    await bot.sendMessage(CHAT_ID, "❌ ERROR: " + (err.message || err));
  } catch (e) {}
});
