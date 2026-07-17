import asyncio
import logging
import os
from telegram import Update
from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes
from playwright.async_api import async_playwright

# ================== CONFIG (Yaha change karo) ==================
BOT_TOKEN = os.environ.get("BOT_TOKEN", "YAHA_APNA_TOKEN_DALO")
CHAT_ID = os.environ.get("CHAT_ID", "YAHA_APNI_CHAT_ID_DALO")
EMAIL = os.environ.get("EMAIL", "flwdlqx@indogmail.com")
URL = "https://accounts.atxp.ai/fund"
# ==============================================================

logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)
logger = logging.getLogger(__name__)

# Global state - code wait karne ke liye
user_state = {}


async def send_msg(context, text):
    """Telegram pe message bhejo"""
    await context.bot.send_message(chat_id=CHAT_ID, text=text)


async def run_automation(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Main automation - browser kholke login karega"""
    
    await send_msg(context, "🚀 Automation shuru ho rahi hai...")

    async with async_playwright() as p:
        try:
            # Browser launch (Railway pe headless zaroori hai)
            browser = await p.chromium.launch(
                headless=True,
                args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
            )
            page = await browser.new_page()
            await send_msg(context, "✓ Browser launch ho gaya")

            # STEP 1: Site kholo
            await page.goto(URL, timeout=60000)
            await send_msg(context, f"✓ Site khul gayi: {URL}")
            await page.wait_for_timeout(3000)

            # STEP 2: "Log in or Sign up" button click
            try:
                await page.click("text=Log in or Sign up", timeout=15000)
                await send_msg(context, "✓ 'Log in or Sign up' button click ho gaya")
            except Exception as e:
                await send_msg(context, f"✗ Login button nahi mila: {e}")
                await browser.close()
                return

            await page.wait_for_timeout(3000)

            # STEP 3: Email daalo (popup ke email box me)
            try:
                # Privy popup ka email input
                email_input = page.locator("input[type='email'], input[placeholder*='email']").first
                await email_input.wait_for(timeout=15000)
                await email_input.fill(EMAIL)
                await send_msg(context, f"✓ Email daal diya: {EMAIL}")
            except Exception as e:
                await send_msg(context, f"✗ Email box nahi mila: {e}")
                await browser.close()
                return

            await page.wait_for_timeout(1500)

            # STEP 4: Submit click
            try:
                await page.click("text=Submit", timeout=15000)
                await send_msg(context, "✓ Submit button click ho gaya")
            except Exception as e:
                await send_msg(context, f"✗ Submit button nahi mila: {e}")
                await browser.close()
                return

            await page.wait_for_timeout(4000)

            # STEP 5: Verify - code popup aaya ya nahi
            page_content = await page.content()
            if "code" in page_content.lower() or "verify" in page_content.lower() or "enter" in page_content.lower():
                await send_msg(context, "✓ Code ka popup aa gaya (verification)")
            else:
                await send_msg(context, "⚠️ Code popup confirm nahi hua, phir bhi code maang raha hoon...")

            # STEP 6: Aapse code maango
            await send_msg(context, "📩 Email pe jo 6-digit CODE aaya hai, wo yaha bhej do:")
            user_state["waiting_for_code"] = True
            user_state["code"] = None

            # Code ka wait karo (max 5 minute)
            for i in range(150):  # 150 x 2 sec = 5 min
                if user_state.get("code"):
                    break
                await asyncio.sleep(2)

            code = user_state.get("code")
            user_state["waiting_for_code"] = False

            if not code:
                await send_msg(context, "✗ Code nahi mila 5 minute me. Automation cancel.")
                await browser.close()
                return

            await send_msg(context, f"✓ Code mil gaya: {code} — ab daal raha hoon...")

            # STEP 7: Code daalo (OTP boxes)
            try:
                # OTP alag alag boxes me ho sakta hai
                otp_inputs = page.locator("input[inputmode='numeric'], input[type='text'][maxlength='1'], input[autocomplete='one-time-code']")
                count = await otp_inputs.count()

                if count > 1:
                    # Har box me ek digit
                    for idx, digit in enumerate(code.strip()):
                        if idx < count:
                            await otp_inputs.nth(idx).fill(digit)
                    await send_msg(context, f"✓ Code {count} boxes me daal diya")
                else:
                    # Single box me pura code
                    single = page.locator("input").last
                    await single.fill(code.strip())
                    await send_msg(context, "✓ Code single box me daal diya")
            except Exception as e:
                await send_msg(context, f"✗ Code daalne me error: {e}")
                await browser.close()
                return

            await page.wait_for_timeout(5000)

            # STEP 8: Login VERIFY karo (jhooth na ho - REAL check)
            await page.wait_for_timeout(3000)
            current_url = page.url
            final_content = await page.content()

            logged_in = False
            if "fund" in current_url and "login" not in final_content.lower()[:2000]:
                logged_in = True
            if "logout" in final_content.lower() or "dashboard" in final_content.lower() or "balance" in final_content.lower() or "wallet" in final_content.lower():
                logged_in = True

            if logged_in:
                await send_msg(context, f"✅ LOGIN SUCCESS! Sach me login ho gaya.\n🔗 URL: {current_url}")
            else:
                await send_msg(context, f"⚠️ Login confirm nahi hua. Code galat ho sakta hai ya extra step hai.\n🔗 URL: {current_url}")

            # Screenshot bhejo (visual proof)
            try:
                await page.screenshot(path="result.png", full_page=True)
                with open("result.png", "rb") as photo:
                    await context.bot.send_photo(chat_id=CHAT_ID, photo=photo, caption="📸 Final screenshot (proof)")
            except Exception as e:
                logger.error(f"Screenshot error: {e}")

            await browser.close()
            await send_msg(context, "🏁 Automation complete ho gayi.")

        except Exception as e:
            await send_msg(context, f"✗ Bada error aaya: {e}")
            logger.error(f"Automation error: {e}")


async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """/start command - automation shuru"""
    await update.message.reply_text("👋 Bot ready hai! Automation start kar raha hoon...")
    # CHAT_ID auto detect (agar env me nahi)
    global CHAT_ID
    if CHAT_ID == "YAHA_APNI_CHAT_ID_DALO":
        CHAT_ID = str(update.effective_chat.id)
    await run_automation(update, context)


async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """User ka message - agar code ka wait ho raha hai"""
    text = update.message.text.strip()
    if user_state.get("waiting_for_code"):
        # Sirf numbers/code lo
        user_state["code"] = text
        await update.message.reply_text(f"✓ Code receive hua: {text}")
    else:
        await update.message.reply_text("Automation start karne ke liye /start bhejo")


def main():
    app = Application.builder().token(BOT_TOKEN).build()
    app.add_handler(CommandHandler("start", start_command))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))
    logger.info("Bot chal raha hai...")
    app.run_polling(drop_pending_updates=True)


if __name__ == "__main__":
    main()
