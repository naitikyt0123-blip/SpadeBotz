const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const QRCode = require('qrcode');
const https = require('https');
const http = require('http');

// ─── CONFIG ───────────────────────────────────────────────
const BOT_TOKEN = '8945874588:AAGeIHwab9cmZ2jRR8M7zeGGlF06WJmdAKw';
const ADMIN_ID = '7816214323';
const MONGO_URL = process.env.MONGO_URL;

// ─── MONGO CONNECT ────────────────────────────────────────
mongoose.connect(MONGO_URL)
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.error('❌ MongoDB Error:', err));

// ─── SCHEMAS ──────────────────────────────────────────────
const userSchema = new mongoose.Schema({
  userId: { type: Number, unique: true },
  username: String,
  firstName: String,
  country: String,
  isPremium: { type: Boolean, default: false },
  activePlans: [{
    planId: String,
    planName: String,
    expiresAt: Date,
    approvedAt: Date
  }],
  joinedAt: { type: Date, default: Date.now }
});

const paymentSchema = new mongoose.Schema({
  orderId: String,
  userId: Number,
  username: String,
  firstName: String,
  planId: String,
  planName: String,
  amount: Number,
  screenshotFileId: String,
  adminMsgId: Number,
  status: { type: String, default: 'pending' },
  submittedAt: { type: Date, default: Date.now }
});

const settingsSchema = new mongoose.Schema({
  key: { type: String, unique: true },
  value: mongoose.Schema.Types.Mixed
});

const User = mongoose.model('User', userSchema);
const Payment = mongoose.model('Payment', paymentSchema);
const Settings = mongoose.model('Settings', settingsSchema);

// ─── BOT INIT ─────────────────────────────────────────────
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ─── HELPERS ──────────────────────────────────────────────
function generateOrderId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let r1 = '', r2 = '';
  for (let i = 0; i < 8; i++) r1 += chars[Math.floor(Math.random() * chars.length)];
  for (let i = 0; i < 4; i++) r2 += chars[Math.floor(Math.random() * chars.length)];
  return `ORD-${r1}-${r2}`;
}

async function getSetting(key, defaultVal = null) {
  const s = await Settings.findOne({ key });
  return s ? s.value : defaultVal;
}

async function setSetting(key, value) {
  await Settings.findOneAndUpdate({ key }, { key, value }, { upsert: true });
}

async function getPlans() {
  return await getSetting('plans', [
    { id: 'plan_1',  name: '🌽ᴄʜ1ʟᴅ ᴄ0ʀɴ🌽',             price: 59,  days: 30,     desc: '🌽CH1LD C0RN🌽',                                                              link: '', demo: '' },
    { id: 'plan_2',  name: '🌽🌽 ᴀʟʟ ᴛʏᴘᴇ',               price: 199, days: 999999, desc: 'All types c0rn🌽 — LIFETIME',                                                  link: '', demo: '' },
    { id: 'plan_3',  name: '💦ʀᴇᴀʟ ɪɴᴅ!ᴀɴ ᴅēsɪ ᴘ0ʀɴ 💦', price: 99,  days: 30,     desc: '💦 Full Desi Indian content approx 40000+ videos💦',                           link: '', demo: '' },
    { id: 'plan_4',  name: '👻ɢ0ʀᴇ ʀ@ᴘᴇ💦',               price: 99,  days: 30,     desc: '✨10000+ 𝐌0𝐦&𝐒0𝐧 Videos\n✨ 6000+ 𝐑@𝐩€ Videos\n✨ New Content Regularly',    link: '', demo: '' },
    { id: 'plan_5',  name: '🥵 ʜᴏᴛ ᴅᴇsɪ ʙʜᴀʙʜɪ 🥵',      price: 69,  days: 30,     desc: '💦New Desi Bhabhi bes P0rn💦💦',                                              link: '', demo: '' },
    { id: 'plan_6',  name: '🫦ᴄᴏʟʟᴇɢᴇ ʟᴇᴀᴋᴇs 🫦',         price: 69,  days: 30,     desc: 'College girls ki khudai videos milega isme 💦🫦',                              link: '', demo: '' },
    { id: 'plan_7',  name: 'ᴀᴅɪᴛʏ ᴍɪsʀʏ ᴀʟʟ 😋👉🏻👌🏻', price: 89,  days: 30,     desc: 'ADITI MISRY SHOWS 🫦🫶🏻👈🏻',                                                link: '', demo: '' },
    { id: 'plan_8',  name: '😘 ᴍᴏᴍ ᴀɴᴅ sᴏɴ 😘',          price: 59,  days: 30,     desc: '😘 MOM AND SON 😘',                                                           link: '', demo: '' },
    { id: 'plan_9',  name: '✂️ ʟᴇsʙɪᴀɴs ✂️',              price: 49,  days: 30,     desc: 'LESBIANS 🫦✂️',                                                               link: '', demo: '' },
    { id: 'plan_10', name: 'ɪɴᴅɪᴀɴ ᴡᴇʙsᴇʀɪᴇs 😋🫦',       price: 99,  days: 30,     desc: 'WEBSERIES 🫦',                                                                link: '', demo: '' },
    { id: 'plan_11', name: '💦 ᴅᴇsɪ ᴘɪssɪɴɢ 💦',          price: 79,  days: 30,     desc: 'PISSING 🫦💦',                                                                link: '', demo: '' }
  ]);
}

async function savePlans(plans) {
  await setSetting('plans', plans);
}

// State management
const userState = {};

// ─────────────────────────────────────────────────────────
//  /START
// ─────────────────────────────────────────────────────────
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const firstName = msg.from.first_name || '';
  const username = msg.from.username || '';

  // Save user
  await User.findOneAndUpdate(
    { userId },
    { userId, username, firstName, joinedAt: new Date() },
    { upsert: true, setDefaultsOnInsert: true }
  );

  if (String(userId) === String(ADMIN_ID)) {
    return sendAdminMenu(chatId);
  }

  const displayName = `𝘚𝘱𝘢𝘥𝘦 • ${firstName}`;

  await bot.sendMessage(chatId,
    `👋 ʜᴇʟʟᴏ ${displayName}!\n\n` +
    `🌟 ᴡᴇʟᴄᴏᴍᴇ ᴛᴏ ᴘʀᴇᴍɪᴜᴍ ʙᴏᴛ\n\n` +
    `━━━━━━━━━━━━━━━━━\n` +
    `💎 ᴘʀᴇᴍɪᴜᴍ ᴘʀɪᴄᴇ: ₹49 - ₹199\n` +
    `📦 ᴘʟᴀɴs: 11 ᴘʟᴀɴs ᴀᴠᴀɪʟᴀʙʟᴇ\n` +
    `━━━━━━━━━━━━━━━━━\n\n` +
    `🔒 ᴘʀᴇᴍɪᴜᴍ ᴄᴏɴᴛᴇɴᴛ ᴀᴄᴄᴇss ᴋᴀʀɴᴇ ᴋᴇ ʟɪʏᴇ ᴘʀᴇᴍɪᴜᴍ ʟᴏ!`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'BUY PREMIUM 💦', callback_data: 'buy_premium' }],
          [{ text: '💫 MY PREMIUMS', callback_data: 'my_premiums' }, { text: '👤 MY PROFILE', callback_data: 'my_profile' }],
          [{ text: '👀 VIEW DEMO', callback_data: 'view_demo_0' }]
        ]
      }
    }
  );
});

// ─────────────────────────────────────────────────────────
//  ADMIN MENU
// ─────────────────────────────────────────────────────────
async function sendAdminMenu(chatId) {
  await bot.sendMessage(chatId,
    `👑 ᴡᴇʟᴄᴏᴍᴇ ᴀᴅᴍɪɴ!\n\n` +
    `🤖 Bot Developed By @ZeroSpade\n\n` +
    `━━━━━━━━━━━━━━━━━\n` +
    `ɴɪᴄʜᴇ sᴇ ᴏᴩᴛɪᴏɴ sᴇʟᴇᴄᴛ ᴋᴀʀᴏ:\n` +
    `━━━━━━━━━━━━━━━━━`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '💰 Change Price', callback_data: 'admin_change_price' }, { text: '💳 Change UPI', callback_data: 'admin_change_upi' }],
          [{ text: '📢 Broadcast', callback_data: 'admin_broadcast' }, { text: '👥 Check Users', callback_data: 'admin_check_users' }],
          [{ text: '📊 Stats', callback_data: 'admin_stats' }, { text: '🔗 Links', callback_data: 'admin_links' }]
        ]
      }
    }
  );
}

// ─────────────────────────────────────────────────────────
//  CALLBACK QUERY HANDLER
// ─────────────────────────────────────────────────────────
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const msgId  = query.message.message_id;
  const data   = query.data;
  const isAdmin = String(userId) === String(ADMIN_ID);

  await bot.answerCallbackQuery(query.id).catch(() => {});

  // ── BUY PREMIUM ──
  if (data === 'buy_premium') {
    const plans = await getPlans();
    await bot.deleteMessage(chatId, msgId).catch(() => {});

    let text = `💎 ᴘʀᴇᴍɪᴜᴍ ᴘʟᴀɴs\n\n━━━━━━━━━━━━━━━━━\n`;
    for (const p of plans) {
      const validity = p.days >= 999999 ? 'LIFETIME' : `${p.days} DAYS`;
      text += `🔹 ${p.name}\n   💰 ᴘʀɪᴄᴇ: ₹${p.price}\n   ⏳ ᴠᴀʟɪᴅɪᴛʏ: ${validity}\n   📌 ${p.desc}\n\n`;
    }
    text += `━━━━━━━━━━━━━━━━━\n👇 sᴇʟᴇᴄᴛ ʏᴏᴜʀ ᴘʟᴀɴ ʙᴇʟᴏᴡ`;

    const keyboard = [];
    for (const p of plans) {
      const validity = p.days >= 999999 ? 'LIFETIME' : `${p.days}D`;
      keyboard.push([{ text: `${p.name} • ₹${p.price} • ${validity}`, callback_data: `select_plan_${p.id}` }]);
    }
    keyboard.push([{ text: '🏠 Back Home', callback_data: 'back_home' }]);

    await bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: keyboard } });
    return;
  }

  // ── SELECT PLAN ──
  if (data.startsWith('select_plan_')) {
    const planId = data.replace('select_plan_', '');
    const plans = await getPlans();
    const plan = plans.find(p => p.id === planId);
    if (!plan) return;

    const upiId   = await getSetting('upi_id', 'Sakib006@ybl');
    const upiName = await getSetting('upi_name', 'Sakib');
    const validity = plan.days >= 999999 ? 'LIFETIME' : `${plan.days} DAYS`;

    await bot.deleteMessage(chatId, msgId).catch(() => {});

    // Generate QR
    const upiUri = `upi://pay?pa=${upiId}&pn=${encodeURIComponent(upiName)}&am=${plan.price}&cu=INR`;
    const qrBuffer = await QRCode.toBuffer(upiUri, { width: 300 });

    const caption =
      `💳 ᴘᴀʏᴍᴇɴᴛ ᴅᴇᴛᴀɪʟs\n\n` +
      `━━━━━━━━━━━━━━━━━\n` +
      `📦 ᴘʟᴀɴ: ${plan.name}\n` +
      `💰 ᴀᴍᴏᴜɴᴛ: ₹${plan.price}\n` +
      `⏳ ᴠᴀʟɪᴅɪᴛʏ: ${validity}\n` +
      `━━━━━━━━━━━━━━━━━\n\n` +
      `👤 ɴᴀᴍᴇ: ${upiName}\n` +
      `📱 UPI ID: ${upiId}\n\n` +
      `📋 sᴛᴇᴘs:\n` +
      `1️⃣ ᴜᴘɪ ɪᴅ ᴘᴇ ₹${plan.price} ʙʜᴇᴊᴏ\n` +
      `2️⃣ ᴘᴀʏᴍᴇɴᴛ sᴄʀᴇᴇɴsʜᴏᴛ ʟᴏ\n` +
      `3️⃣ ɴɪᴄʜᴇ sᴜʙᴍɪᴛ ᴘʀᴏᴏꜰ ʙᴜᴛᴛᴏɴ ᴅᴀʙᴀᴏ\n\n` +
      `⚠️ ᴠᴇʀɪꜰʏ ʜᴏɴᴇ ᴍᴇɪɴ 24 ʜᴏᴜʀs ʟᴀɢ sᴀᴋᴛᴇ ʜᴀɪɴ`;

    userState[userId] = { action: 'awaiting_screenshot', planId };

    await bot.sendPhoto(chatId, qrBuffer, {
      caption,
      reply_markup: {
        inline_keyboard: [
          [{ text: '📸 SUBMIT PROOF', callback_data: `submit_proof_${planId}` }],
          [{ text: '🔙 BACK TO PLANS', callback_data: 'buy_premium' }]
        ]
      }
    });
    return;
  }

  // ── SUBMIT PROOF ──
  if (data.startsWith('submit_proof_')) {
    const planId = data.replace('submit_proof_', '');
    userState[userId] = { action: 'awaiting_screenshot', planId };
    await bot.deleteMessage(chatId, msgId).catch(() => {});
    await bot.sendMessage(chatId,
      `📸 ᴘᴀʏᴍᴇɴᴛ sᴄʀᴇᴇɴsʜᴏᴛ ʙʜᴇᴊᴏ\n\n` +
      `✅ ᴜᴘɪ ᴘᴀʏᴍᴇɴᴛ ᴋᴀʀɴᴇ ᴋᴇ ʙᴀᴀᴅ sᴄʀᴇᴇɴsʜᴏᴛ ʏᴀʜᴀɴ ʙʜᴇᴊᴏ.\n\n` +
      `⚠️ sɪʀꜰ ɪᴍᴀɢᴇ/sᴄʀᴇᴇɴsʜᴏᴛ ᴀᴄᴄᴇᴘᴛ ʜᴏɢᴀ`,
      { reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'back_home' }]] } }
    );
    return;
  }

  // ── MY PREMIUMS ──
  if (data === 'my_premiums') {
    const user = await User.findOne({ userId });
    const now = new Date();
    const active = user?.activePlans?.filter(p => p.expiresAt > now || p.expiresAt === null) || [];

    await bot.deleteMessage(chatId, msgId).catch(() => {});

    if (!active.length) {
      await bot.sendMessage(chatId,
        `💎 ᴍʏ ᴘʀᴇᴍɪᴜᴍs 🥵\n\n` +
        `━━━━━━━━━━━━━━━━━\n` +
        `❌ ᴀᴀᴘᴋᴇ ᴘᴀᴀs ᴋᴏɪ ᴀᴄᴛɪᴠᴇ ᴘʀᴇᴍɪᴜᴍ ɴᴀʜɪ ʜᴀɪ!\n\n` +
        `ᴘʀᴇᴍɪᴜᴍ ʟᴇɴᴇ ᴋᴇ ʟɪʏᴇ ɢᴇᴛ ᴘʀᴇᴍɪᴜᴍ ʙᴜᴛᴛᴏɴ ᴅᴀʙᴀᴏ.\n` +
        `━━━━━━━━━━━━━━━━━`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: 'BUY PREMIUM 💦', callback_data: 'buy_premium' }],
              [{ text: '🏠 Back Home', callback_data: 'back_home' }]
            ]
          }
        }
      );
    } else {
      let text = `💎 ᴍʏ ᴘʀᴇᴍɪᴜᴍs 🥵\n\n━━━━━━━━━━━━━━━━━\n`;
      for (const p of active) {
        const expStr = p.expiresAt && p.expiresAt.getFullYear() > 2099 ? 'LIFETIME' : (p.expiresAt ? p.expiresAt.toDateString() : 'N/A');
        text += `✅ ${p.planName}\n⏳ Expires: ${expStr}\n\n`;
      }
      text += `━━━━━━━━━━━━━━━━━`;
      await bot.sendMessage(chatId, text, {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🏠 Back Home', callback_data: 'back_home' }]
          ]
        }
      });
    }
    return;
  }

  // ── MY PROFILE ──
  if (data === 'my_profile') {
    const user = await User.findOne({ userId });
    const payments = await Payment.find({ userId });
    const approved = payments.filter(p => p.status === 'approved').length;
    const pending  = payments.filter(p => p.status === 'pending').length;
    const total    = payments.length;
    const now = new Date();
    const activePlans = user?.activePlans?.filter(p => p.expiresAt > now) || [];

    const joinedStr = user?.joinedAt
      ? user.joinedAt.toISOString().replace('T', ' ').substring(0, 19)
      : 'N/A';

    await bot.deleteMessage(chatId, msgId).catch(() => {});
    await bot.sendMessage(chatId,
      `👤 ᴍʏ ᴘʀᴏꜰɪʟᴇ\n\n` +
      `━━━━━━━━━━━━━━━━━\n` +
      `🙍 ɴᴀᴍᴇ: ${query.from.first_name || ''} ${query.from.last_name || ''}\n` +
      `📛 ᴜsᴇʀɴᴀᴍᴇ: @${query.from.username || 'N/A'}\n` +
      `🆔 ID: ${userId}\n` +
      `📅 ᴊᴏɪɴᴇᴅ: ${joinedStr}\n` +
      `━━━━━━━━━━━━━━━━━\n` +
      `💎 ᴘʀᴇᴍɪᴜᴍ sᴛᴀᴛᴜs: ${activePlans.length > 0 ? '✅ ᴀᴄᴛɪᴠᴇ' : '❌ ɴᴏᴛ ᴀᴄᴛɪᴠᴇ'}\n` +
      `━━━━━━━━━━━━━━━━━\n` +
      `💳 ᴘᴀʏᴍᴇɴᴛ ʜɪsᴛᴏʀʏ:\n` +
      `   ✅ ᴀᴘᴘʀᴏᴠᴇᴅ: ${approved}\n` +
      `   ⏳ ᴘᴇɴᴅɪɴɢ:  ${pending}\n` +
      `   📊 ᴛᴏᴛᴀʟ:   ${total}\n` +
      `━━━━━━━━━━━━━━━━━`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'BUY PREMIUM 💦', callback_data: 'buy_premium' }],
            [{ text: '🏠 Back Home', callback_data: 'back_home' }]
          ]
        }
      }
    );
    return;
  }

  // ── VIEW DEMO ──
  if (data.startsWith('view_demo_')) {
    const idx = parseInt(data.replace('view_demo_', ''));
    const plans = await getPlans();
    const plan = plans[idx];
    if (!plan) return;

    const validity = plan.days >= 999999 ? 'LIFETIME' : `${plan.days} DAYS`;
    const demoChannel = await getSetting('demo_channel', 'https://t.me/yourchannel');

    await bot.deleteMessage(chatId, msgId).catch(() => {});
    await bot.sendMessage(chatId,
      `👀 ᴅᴇᴍᴏ: ${plan.name}\n\n` +
      `━━━━━━━━━━━━━━━━━\n` +
      `💰 ᴘʀɪᴄᴇ: ₹${plan.price}\n` +
      `⏳ ᴠᴀʟɪᴅɪᴛʏ: ${validity}\n` +
      `━━━━━━━━━━━━━━━━━`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '👀 OPEN DEMO', url: demoChannel }],
            [
              { text: idx > 0 ? '⬅️ Prev' : '⬅️ Prev', callback_data: idx > 0 ? `view_demo_${idx - 1}` : `view_demo_${plans.length - 1}` },
              { text: `${idx + 1}/${plans.length}`, callback_data: 'noop' },
              { text: '➡️ Next', callback_data: `view_demo_${(idx + 1) % plans.length}` }
            ],
            [{ text: '💎 Get Premium', callback_data: 'buy_premium' }, { text: '🏠 Back Home', callback_data: 'back_home' }]
          ]
        }
      }
    );
    return;
  }

  // ── BACK HOME ──
  if (data === 'back_home') {
    const firstName = query.from.first_name || '';
    const displayName = `𝘚𝘱𝘢𝘥𝘦 • ${firstName}`;
    await bot.deleteMessage(chatId, msgId).catch(() => {});
    await bot.sendMessage(chatId,
      `👋 ʜᴇʟʟᴏ ${displayName}!\n\n` +
      `🌟 ᴡᴇʟᴄᴏᴍᴇ ᴛᴏ ᴘʀᴇᴍɪᴜᴍ ʙᴏᴛ\n\n` +
      `━━━━━━━━━━━━━━━━━\n` +
      `💎 ᴘʀᴇᴍɪᴜᴍ ᴘʀɪᴄᴇ: ₹49 - ₹199\n` +
      `📦 ᴘʟᴀɴs: 11 ᴘʟᴀɴs ᴀᴠᴀɪʟᴀʙʟᴇ\n` +
      `━━━━━━━━━━━━━━━━━\n\n` +
      `🔒 ᴘʀᴇᴍɪᴜᴍ ᴄᴏɴᴛᴇɴᴛ ᴀᴄᴄᴇss ᴋᴀʀɴᴇ ᴋᴇ ʟɪʏᴇ ᴘʀᴇᴍɪᴜᴍ ʟᴏ!`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'BUY PREMIUM 💦', callback_data: 'buy_premium' }],
            [{ text: '💫 MY PREMIUMS', callback_data: 'my_premiums' }, { text: '👤 MY PROFILE', callback_data: 'my_profile' }],
            [{ text: '👀 VIEW DEMO', callback_data: 'view_demo_0' }]
          ]
        }
      }
    );
    return;
  }

  // ══════════════════════════════════════════
  //  ADMIN CALLBACKS
  // ══════════════════════════════════════════
  if (!isAdmin) return;

  // ── ADMIN: CHANGE PRICE ──
  if (data === 'admin_change_price') {
    const plans = await getPlans();
    const keyboard = plans.map(p => ([{ text: `${p.name} — ₹${p.price}`, callback_data: `admin_price_plan_${p.id}` }]));
    keyboard.push([{ text: '🔙 Back', callback_data: 'admin_back' }]);
    await bot.editMessageText(`💰 Kaun se plan ka price change karna hai?`, {
      chat_id: chatId, message_id: msgId,
      reply_markup: { inline_keyboard: keyboard }
    });
    return;
  }

  if (data.startsWith('admin_price_plan_')) {
    const planId = data.replace('admin_price_plan_', '');
    userState[userId] = { action: 'admin_set_price', planId };
    await bot.editMessageText(`💰 Naya price bhejo (sirf number, e.g. 99):`, {
      chat_id: chatId, message_id: msgId,
      reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'admin_back' }]] }
    });
    return;
  }

  // ── ADMIN: CHANGE UPI ──
  if (data === 'admin_change_upi') {
    const curId   = await getSetting('upi_id', 'Sakib006@ybl');
    const curName = await getSetting('upi_name', 'Sakib');
    await bot.editMessageText(
      `💳 Current UPI:\nID: ${curId}\nName: ${curName}\n\nFormat me bhejo:\n<UPI_ID>|<NAME>\n\nExample: newupi@ybl|Rahul`,
      {
        chat_id: chatId, message_id: msgId,
        reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'admin_back' }]] }
      }
    );
    userState[userId] = { action: 'admin_set_upi' };
    return;
  }

  // ── ADMIN: BROADCAST ──
  if (data === 'admin_broadcast') {
    userState[userId] = { action: 'admin_broadcast' };
    await bot.editMessageText(
      `📢 Broadcast message bhejo:\n\n✅ Text, Image, Video sab support hai\n✅ Caption bhi support hai\n✅ Koi bhi font style use karo`,
      {
        chat_id: chatId, message_id: msgId,
        reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'admin_back' }]] }
      }
    );
    return;
  }

  // ── ADMIN: CHECK USERS ──
  if (data === 'admin_check_users') {
    const totalUsers = await User.countDocuments();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayUsers = await User.countDocuments({ joinedAt: { $gte: today } });

    // Per hour average (last 24h)
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const last24hCount = await User.countDocuments({ joinedAt: { $gte: last24h } });
    const perHour = (last24hCount / 24).toFixed(1);

    await bot.editMessageText(
      `👥 ᴜsᴇʀ sᴛᴀᴛs\n\n` +
      `━━━━━━━━━━━━━━━━━\n` +
      `👤 Total Users: ${totalUsers}\n` +
      `📅 Today's Users: ${todayUsers}\n` +
      `⏱️ Avg/Hour (24h): ${perHour}\n` +
      `━━━━━━━━━━━━━━━━━`,
      {
        chat_id: chatId, message_id: msgId,
        reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'admin_back' }]] }
      }
    );
    return;
  }

  // ── ADMIN: STATS ──
  if (data === 'admin_stats') {
    const start = Date.now();
    await bot.answerCallbackQuery(query.id).catch(() => {});
    const replySpeed = Date.now() - start;

    const totalUsers    = await User.countDocuments();
    const premiumUsers  = await User.countDocuments({ isPremium: true });
    const totalPayments = await Payment.countDocuments();
    const pending       = await Payment.countDocuments({ status: 'pending' });

    // Top 3 countries (using country field if available)
    const countryAgg = await User.aggregate([
      { $group: { _id: '$country', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 3 }
    ]);

    let topStates = '';
    if (countryAgg.length === 0) {
      topStates = '   📍 Data not available yet\n   (Users need to share location)';
    } else {
      countryAgg.forEach((c, i) => {
        const medals = ['🥇', '🥈', '🥉'];
        topStates += `   ${medals[i]} ${c._id || 'Unknown'}: ${c.count} users\n`;
      });
    }

    await bot.editMessageText(
      `📊 ʙᴏᴛ sᴛᴀᴛs\n\n` +
      `━━━━━━━━━━━━━━━━━\n` +
      `⚡ Reply Speed: ${replySpeed}ms\n` +
      `👤 Total Users: ${totalUsers}\n` +
      `💎 Premium Users: ${premiumUsers}\n` +
      `💳 Total Payments: ${totalPayments}\n` +
      `⏳ Pending: ${pending}\n` +
      `━━━━━━━━━━━━━━━━━\n` +
      `🌍 Top 3 Regions:\n${topStates}\n` +
      `━━━━━━━━━━━━━━━━━`,
      {
        chat_id: chatId, message_id: msgId,
        reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'admin_back' }]] }
      }
    );
    return;
  }

  // ── ADMIN: LINKS ──
  if (data === 'admin_links') {
    await bot.editMessageText(
      `🔗 Links Management`,
      {
        chat_id: chatId, message_id: msgId,
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔗 Change Plans Link', callback_data: 'admin_change_plan_links' }],
            [{ text: '📺 Change Demo Channel', callback_data: 'admin_change_demo_channel' }],
            [{ text: '🔙 Back', callback_data: 'admin_back' }]
          ]
        }
      }
    );
    return;
  }

  if (data === 'admin_change_demo_channel') {
    const cur = await getSetting('demo_channel', 'Not set');
    userState[userId] = { action: 'admin_set_demo_channel' };
    await bot.editMessageText(
      `📺 Current Demo Channel: ${cur}\n\nNaya link bhejo (e.g. https://t.me/channel):`,
      {
        chat_id: chatId, message_id: msgId,
        reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'admin_back' }]] }
      }
    );
    return;
  }

  if (data === 'admin_change_plan_links') {
    const plans = await getPlans();
    const keyboard = plans.map(p => ([{ text: `${p.name}`, callback_data: `admin_set_link_${p.id}` }]));
    keyboard.push([{ text: '🔙 Back', callback_data: 'admin_links' }]);
    await bot.editMessageText(`🔗 Kaun se plan ki link change karni hai?`, {
      chat_id: chatId, message_id: msgId,
      reply_markup: { inline_keyboard: keyboard }
    });
    return;
  }

  if (data.startsWith('admin_set_link_')) {
    const planId = data.replace('admin_set_link_', '');
    userState[userId] = { action: 'admin_set_plan_link', planId };
    await bot.editMessageText(`🔗 Is plan ki nai result link bhejo:`, {
      chat_id: chatId, message_id: msgId,
      reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'admin_back' }]] }
    });
    return;
  }

  // ── ADMIN: APPROVE ──
  if (data.startsWith('approve_')) {
    const paymentId = data.replace('approve_', '');
    const payment = await Payment.findById(paymentId);
    if (!payment) return;
    if (payment.status !== 'pending') {
      await bot.answerCallbackQuery(query.id, { text: 'Already processed!' });
      return;
    }

    const plans = await getPlans();
    const plan = plans.find(p => p.id === payment.planId);

    const expiresAt = plan && plan.days < 999999
      ? new Date(Date.now() + plan.days * 24 * 60 * 60 * 1000)
      : new Date('2099-12-31');

    await Payment.findByIdAndUpdate(paymentId, { status: 'approved' });
    await User.findOneAndUpdate(
      { userId: payment.userId },
      {
        isPremium: true,
        $push: {
          activePlans: {
            planId: payment.planId,
            planName: payment.planName,
            expiresAt,
            approvedAt: new Date()
          }
        }
      }
    );

    // Edit admin message
    await bot.editMessageCaption(
      `✅ APPROVED\n\n👤 User: ${payment.firstName} (@${payment.username})\n📦 Plan: ${payment.planName}\n💰 Amount: ₹${payment.amount}`,
      { chat_id: chatId, message_id: msgId }
    ).catch(() => {});

    // Send link to user
    const planLink = plan?.link || 'Link not set by admin';
    await bot.sendMessage(payment.userId,
      `🎉 ᴘᴀʏᴍᴇɴᴛ sᴜᴄᴄᴇssꜰᴜʟ!\n\n` +
      `━━━━━━━━━━━━━━━━━\n` +
      `✅ ᴀᴘᴘʀᴏᴠᴇᴅ\n` +
      `📦 ᴘʟᴀɴ: ${payment.planName}\n` +
      `🧾 ᴏʀᴅᴇʀ: ${payment.orderId}\n` +
      `━━━━━━━━━━━━━━━━━\n\n` +
      `🔗 ᴀᴘɴᴀ ᴄᴏɴᴛᴇɴᴛ ᴀᴄᴄᴇss ᴋᴀʀᴏ:\n${planLink}\n\n` +
      `🙏 ᴛʜᴀɴᴋ ʏᴏᴜ ꜰᴏʀ ʙᴜʏɪɴɢ ᴘʀᴇᴍɪᴜᴍ!`
    ).catch(() => {});

    return;
  }

  // ── ADMIN: REJECT ──
  if (data.startsWith('reject_')) {
    const paymentId = data.replace('reject_', '');
    const payment = await Payment.findById(paymentId);
    if (!payment) return;
    if (payment.status !== 'pending') {
      await bot.answerCallbackQuery(query.id, { text: 'Already processed!' });
      return;
    }

    await Payment.findByIdAndUpdate(paymentId, { status: 'rejected' });

    await bot.editMessageCaption(
      `❌ REJECTED\n\n👤 User: ${payment.firstName} (@${payment.username})\n📦 Plan: ${payment.planName}\n💰 Amount: ₹${payment.amount}`,
      { chat_id: chatId, message_id: msgId }
    ).catch(() => {});

    await bot.sendMessage(payment.userId,
      `❌ ᴘᴀʏᴍᴇɴᴛ ʀᴇᴊᴇᴄᴛᴇᴅ\n\n` +
      `━━━━━━━━━━━━━━━━━\n` +
      `📦 ᴘʟᴀɴ: ${payment.planName}\n` +
      `🧾 ᴏʀᴅᴇʀ: ${payment.orderId}\n` +
      `━━━━━━━━━━━━━━━━━\n\n` +
      `⚠️ ᴀᴀᴘᴋᴀ ᴘᴀʏᴍᴇɴᴛ ᴘʀᴏᴏꜰ ʀᴇᴊᴇᴄᴛ ʜᴏ ɢᴀʏᴀ.\n` +
      `ᴅᴏʙᴀʀᴀ sʜᴏsʜᴏᴛ ʙʜᴇᴊᴏ ʏᴀ ᴀᴅᴍɪɴ sᴇ sᴀᴍᴘᴀʀᴋ ᴋᴀʀᴏ.`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'BUY PREMIUM 💦', callback_data: 'buy_premium' }],
            [{ text: '🏠 Back Home', callback_data: 'back_home' }]
          ]
        }
      }
    ).catch(() => {});

    return;
  }

  // ── ADMIN: BACK ──
  if (data === 'admin_back') {
    await bot.deleteMessage(chatId, msgId).catch(() => {});
    return sendAdminMenu(chatId);
  }

  // noop
  if (data === 'noop') return;
});

// ─────────────────────────────────────────────────────────
//  MESSAGE HANDLER (Screenshots + Admin inputs)
// ─────────────────────────────────────────────────────────
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const isAdmin = String(userId) === String(ADMIN_ID);
  const state = userState[userId];

  if (!state) return;

  // ── USER: SCREENSHOT UPLOAD ──
  if (state.action === 'awaiting_screenshot') {
    if (!msg.photo && !msg.document) {
      await bot.sendMessage(chatId, `⚠️ sɪʀꜰ ɪᴍᴀɢᴇ/sᴄʀᴇᴇɴsʜᴏᴛ ʙʜᴇᴊᴏ!`);
      return;
    }

    const plans = await getPlans();
    const plan = plans.find(p => p.id === state.planId);
    if (!plan) return;

    const fileId = msg.photo
      ? msg.photo[msg.photo.length - 1].file_id
      : msg.document.file_id;

    const orderId = generateOrderId();

    const payment = await Payment.create({
      orderId,
      userId,
      username: msg.from.username || '',
      firstName: msg.from.first_name || '',
      planId: plan.id,
      planName: plan.name,
      amount: plan.price,
      screenshotFileId: fileId,
      status: 'pending'
    });

    delete userState[userId];

    // Confirm to user
    await bot.sendMessage(chatId,
      `✅ ᴘᴀʏᴍᴇɴᴛ ᴘʀᴏᴏꜰ sᴜʙᴍɪᴛ ʜᴏ ɢᴀʏᴀ.\n\n` +
      `━━━━━━━━━━━━━━━━━\n` +
      `📦 ᴘʟᴀɴ: ${plan.name}\n` +
      `🧾 ᴏʀᴅᴇʀ ID: ${orderId}\n` +
      `⏳ sᴛᴀᴛᴜs: ᴘᴇɴᴅɪɴɢ\n` +
      `━━━━━━━━━━━━━━━━━\n\n` +
      `ᴠᴇʀɪꜰɪᴄᴀᴛɪᴏɴ ᴋᴇ ʙᴀᴀᴅ ᴀᴄᴄᴇss sᴇɴᴅ ʜᴏ ᴊᴀʏᴇɢᴀ.`
    );

    // Forward screenshot to admin
    const adminCaption =
      `🔔 ɴᴇᴡ ᴘᴀʏᴍᴇɴᴛ ʀᴇQᴜᴇsᴛ\n\n` +
      `━━━━━━━━━━━━━━━━━\n` +
      `👤 Name: ${msg.from.first_name || ''} ${msg.from.last_name || ''}\n` +
      `📛 Username: @${msg.from.username || 'N/A'}\n` +
      `🆔 User ID: ${userId}\n` +
      `━━━━━━━━━━━━━━━━━\n` +
      `📦 Plan: ${plan.name}\n` +
      `💰 Amount: ₹${plan.price}\n` +
      `🧾 Order: ${orderId}\n` +
      `━━━━━━━━━━━━━━━━━`;

    const sentMsg = await bot.sendPhoto(ADMIN_ID, fileId, {
      caption: adminCaption,
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ APPROVE', callback_data: `approve_${payment._id}` },
            { text: '❌ REJECT', callback_data: `reject_${payment._id}` }
          ]
        ]
      }
    });

    await Payment.findByIdAndUpdate(payment._id, { adminMsgId: sentMsg.message_id });
    return;
  }

  // ══════════════════════════════════════════
  //  ADMIN INPUTS
  // ══════════════════════════════════════════
  if (!isAdmin) return;

  // ── ADMIN: SET PRICE ──
  if (state.action === 'admin_set_price') {
    const newPrice = parseInt(msg.text);
    if (isNaN(newPrice) || newPrice <= 0) {
      await bot.sendMessage(chatId, `❌ Invalid price! Sirf number bhejo.`);
      return;
    }
    const plans = await getPlans();
    const idx = plans.findIndex(p => p.id === state.planId);
    if (idx === -1) return;
    plans[idx].price = newPrice;
    await savePlans(plans);
    delete userState[userId];
    await bot.sendMessage(chatId, `✅ Price updated!\n${plans[idx].name}\n💰 New Price: ₹${newPrice}`);
    return sendAdminMenu(chatId);
  }

  // ── ADMIN: SET UPI ──
  if (state.action === 'admin_set_upi') {
    const parts = msg.text.split('|');
    if (parts.length !== 2) {
      await bot.sendMessage(chatId, `❌ Format galat hai!\nSahi format: UPI_ID|NAME\nExample: myupi@ybl|Rahul`);
      return;
    }
    await setSetting('upi_id', parts[0].trim());
    await setSetting('upi_name', parts[1].trim());
    delete userState[userId];
    await bot.sendMessage(chatId, `✅ UPI Updated!\nID: ${parts[0].trim()}\nName: ${parts[1].trim()}`);
    return sendAdminMenu(chatId);
  }

  // ── ADMIN: SET DEMO CHANNEL ──
  if (state.action === 'admin_set_demo_channel') {
    const link = msg.text.trim();
    await setSetting('demo_channel', link);
    delete userState[userId];
    await bot.sendMessage(chatId, `✅ Demo Channel Updated!\n${link}`);
    return sendAdminMenu(chatId);
  }

  // ── ADMIN: SET PLAN LINK ──
  if (state.action === 'admin_set_plan_link') {
    const link = msg.text.trim();
    const plans = await getPlans();
    const idx = plans.findIndex(p => p.id === state.planId);
    if (idx === -1) return;
    plans[idx].link = link;
    await savePlans(plans);
    delete userState[userId];
    await bot.sendMessage(chatId, `✅ Plan Link Updated!\n${plans[idx].name}\n🔗 ${link}`);
    return sendAdminMenu(chatId);
  }

  // ── ADMIN: BROADCAST ──
  if (state.action === 'admin_broadcast') {
    delete userState[userId];

    const users = await User.find({}, 'userId');
    let success = 0, failed = 0;

    await bot.sendMessage(chatId, `📢 Broadcast shuru ho gaya...\n👥 Total: ${users.length} users`);

    for (const user of users) {
      try {
        if (msg.photo) {
          const fileId = msg.photo[msg.photo.length - 1].file_id;
          await bot.sendPhoto(user.userId, fileId, { caption: msg.caption || '' });
        } else if (msg.video) {
          await bot.sendVideo(user.userId, msg.video.file_id, { caption: msg.caption || '' });
        } else if (msg.document) {
          await bot.sendDocument(user.userId, msg.document.file_id, { caption: msg.caption || '' });
        } else if (msg.text) {
          await bot.sendMessage(user.userId, msg.text);
        }
        success++;
      } catch (e) {
        failed++;
      }
      // Delay to avoid flood
      await new Promise(r => setTimeout(r, 50));
    }

    await bot.sendMessage(chatId,
      `✅ Broadcast Complete!\n\n` +
      `✅ Success: ${success}\n` +
      `❌ Failed: ${failed}\n` +
      `👥 Total: ${users.length}`
    );
    return sendAdminMenu(chatId);
  }
});

console.log('🚀 Bot Started!');
