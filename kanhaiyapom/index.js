const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const QRCode = require('qrcode');

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN || '8945874588:AAGeIHwab9cmZ2jRR8M7zeGGlF06WJmdAKw';
const ADMIN_ID  = process.env.ADMIN_ID  || '7816214323';
const MONGO_URL = process.env.MONGO_URL;

// ─── STARTUP CHECKS ───────────────────────────────────────────────────────────
if (!BOT_TOKEN || BOT_TOKEN === 'YOUR_BOT_TOKEN') {
  console.error('❌ FATAL: BOT_TOKEN not set in environment variables!');
  process.exit(1);
}
if (!ADMIN_ID || ADMIN_ID === 'YOUR_ADMIN_CHAT_ID') {
  console.error('❌ FATAL: ADMIN_ID not set in environment variables!');
  process.exit(1);
}
if (!MONGO_URL) {
  console.error('❌ FATAL: MONGO_URL not set in environment variables!');
  process.exit(1);
}

console.log('🚀 Starting Premium Bot...');
console.log(`📋 Admin ID: ${ADMIN_ID}`);
console.log(`🔗 MongoDB: ${MONGO_URL.substring(0, 30)}...`);

// ─── MONGO CONNECT ────────────────────────────────────────────────────────────
async function connectMongo() {
  let retries = 5;
  while (retries > 0) {
    try {
      await mongoose.connect(MONGO_URL, {
        serverSelectionTimeoutMS: 10000,
        socketTimeoutMS: 45000,
      });
      console.log('✅ MongoDB Connected Successfully');
      return;
    } catch (err) {
      retries--;
      console.error(`❌ MongoDB Connection Failed! Retries left: ${retries}`);
      console.error(`❌ Error: ${err.message}`);
      if (retries === 0) {
        console.error('❌ FATAL: MongoDB connection failed after 5 retries. Exiting...');
        process.exit(1);
      }
      console.log('⏳ Retrying in 5 seconds...');
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

mongoose.connection.on('disconnected', () => {
  console.warn('⚠️ MongoDB Disconnected! Attempting reconnect...');
});
mongoose.connection.on('reconnected', () => {
  console.log('✅ MongoDB Reconnected!');
});
mongoose.connection.on('error', (err) => {
  console.error('❌ MongoDB Runtime Error:', err.message);
});

// ─── SCHEMAS ──────────────────────────────────────────────────────────────────
const userSchema = new mongoose.Schema({
  userId:      { type: Number, unique: true },
  username:    String,
  firstName:   String,
  isPremium:   { type: Boolean, default: false },
  activePlans: [{
    planId:    String,
    planName:  String,
    expiresAt: Date,
    approvedAt: Date
  }],
  joinedAt: { type: Date, default: Date.now }
});

const paymentSchema = new mongoose.Schema({
  orderId:          String,
  userId:           Number,
  username:         String,
  firstName:        String,
  planId:           String,
  planName:         String,
  amount:           Number,
  screenshotFileId: String,
  adminMsgId:       Number,
  status:           { type: String, default: 'pending' },
  submittedAt:      { type: Date, default: Date.now }
});

const settingsSchema = new mongoose.Schema({
  key:   { type: String, unique: true },
  value: mongoose.Schema.Types.Mixed
});

const User     = mongoose.model('User',     userSchema);
const Payment  = mongoose.model('Payment',  paymentSchema);
const Settings = mongoose.model('Settings', settingsSchema);

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function generateOrderId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let r1 = '', r2 = '';
  for (let i = 0; i < 8; i++) r1 += chars[Math.floor(Math.random() * chars.length)];
  for (let i = 0; i < 4; i++) r2 += chars[Math.floor(Math.random() * chars.length)];
  return `ORD-${r1}-${r2}`;
}

async function getSetting(key, defaultVal = null) {
  try {
    const s = await Settings.findOne({ key });
    return s ? s.value : defaultVal;
  } catch (err) {
    console.error(`❌ getSetting error [${key}]:`, err.message);
    return defaultVal;
  }
}

async function setSetting(key, value) {
  try {
    await Settings.findOneAndUpdate({ key }, { key, value }, { upsert: true, new: true });
  } catch (err) {
    console.error(`❌ setSetting error [${key}]:`, err.message);
  }
}

const DEFAULT_PLANS = [
  { id: 'plan_1',  name: '🌽ᴄʜ1ʟᴅ ᴄ0ʀɴ🌽',             price: 59,  days: 30,     desc: '🌽CH1LD C0RN🌽',                                                           link: '', demo: '' },
  { id: 'plan_2',  name: '🌽🌽 ᴀʟʟ ᴛʏᴘᴇ',               price: 199, days: 999999, desc: 'All types c0rn🌽 — LIFETIME',                                               link: '', demo: '' },
  { id: 'plan_3',  name: '💦ʀᴇᴀʟ ɪɴᴅ!ᴀɴ ᴅēsɪ ᴘ0ʀɴ 💦', price: 99,  days: 30,     desc: '💦 Full Desi Indian content approx 40000+ videos💦',                        link: '', demo: '' },
  { id: 'plan_4',  name: '👻ɢ0ʀᴇ ʀ@ᴘᴇ💦',               price: 99,  days: 30,     desc: '✨10000+ Mom&Son Videos\n✨6000+ R@pe Videos\n✨New Content Regularly',      link: '', demo: '' },
  { id: 'plan_5',  name: '🥵 ʜᴏᴛ ᴅᴇsɪ ʙʜᴀʙʜɪ 🥵',      price: 69,  days: 30,     desc: '💦New Desi Bhabhi Best P0rn💦',                                             link: '', demo: '' },
  { id: 'plan_6',  name: '🫦ᴄᴏʟʟᴇɢᴇ ʟᴇᴀᴋᴇs 🫦',         price: 69,  days: 30,     desc: 'College girls ki videos💦🫦',                                               link: '', demo: '' },
  { id: 'plan_7',  name: 'ᴀᴅɪᴛʏ ᴍɪsʀʏ ᴀʟʟ 😋',         price: 89,  days: 30,     desc: 'ADITI MISRY SHOWS 🫦',                                                      link: '', demo: '' },
  { id: 'plan_8',  name: '😘 ᴍᴏᴍ ᴀɴᴅ sᴏɴ 😘',          price: 59,  days: 30,     desc: '😘 MOM AND SON 😘',                                                         link: '', demo: '' },
  { id: 'plan_9',  name: '✂️ ʟᴇsʙɪᴀɴs ✂️',              price: 49,  days: 30,     desc: 'LESBIANS 🫦✂️',                                                             link: '', demo: '' },
  { id: 'plan_10', name: 'ɪɴᴅɪᴀɴ ᴡᴇʙsᴇʀɪᴇs 😋🫦',       price: 99,  days: 30,     desc: 'WEBSERIES 🫦',                                                              link: '', demo: '' },
  { id: 'plan_11', name: '💦 ᴅᴇsɪ ᴘɪssɪɴɢ 💦',          price: 79,  days: 30,     desc: 'PISSING 🫦💦',                                                              link: '', demo: '' }
];

async function getPlans() {
  try {
    return await getSetting('plans', DEFAULT_PLANS);
  } catch (err) {
    console.error('❌ getPlans error:', err.message);
    return DEFAULT_PLANS;
  }
}

async function savePlans(plans) {
  await setSetting('plans', plans);
}

// ─── STATE ────────────────────────────────────────────────────────────────────
const userState = {};

// ─── BOT INIT WITH POLLING CONFLICT FIX ──────────────────────────────────────
let bot;

async function initBot() {
  console.log('🤖 Initializing bot...');

  // First delete any existing webhook to avoid conflicts
  try {
    const axios = require('axios');
    const deleteRes = await axios.post(
      `https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook`,
      { drop_pending_updates: true }
    );
    console.log('✅ Webhook deleted:', deleteRes.data.description);
  } catch (err) {
    console.warn('⚠️ Could not delete webhook:', err.message);
  }

  // Small delay after deleting webhook
  await new Promise(r => setTimeout(r, 2000));

  bot = new TelegramBot(BOT_TOKEN, {
    polling: {
      interval: 300,
      autoStart: true,
      params: {
        timeout: 10,
        allowed_updates: ['message', 'callback_query']
      }
    }
  });

  bot.on('polling_error', (err) => {
    const code = err.code || '';
    const msg  = err.message || '';

    if (code === 'ETELEGRAM' && msg.includes('409')) {
      console.error('❌ POLLING CONFLICT (409): Another bot instance is running!');
      console.error('⏳ Waiting 15 seconds then restarting polling...');
      bot.stopPolling();
      setTimeout(() => {
        console.log('🔄 Restarting polling...');
        bot.startPolling();
      }, 15000);
    } else if (code === 'EFATAL') {
      console.error('❌ FATAL POLLING ERROR:', msg);
      console.error('🔄 Restarting in 10 seconds...');
      setTimeout(() => process.exit(1), 10000);
    } else if (code === 'EPARSE') {
      console.error('❌ PARSE ERROR in polling:', msg);
    } else if (msg.includes('ETIMEDOUT') || msg.includes('ECONNRESET')) {
      console.warn('⚠️ Network timeout in polling — will auto retry');
    } else {
      console.error(`❌ Polling error [${code}]:`, msg);
    }
  });

  bot.on('error', (err) => {
    console.error('❌ Bot general error:', err.message);
  });

  console.log('✅ Bot polling started!');

  // Verify bot token
  try {
    const me = await bot.getMe();
    console.log(`✅ Bot verified: @${me.username} (ID: ${me.id})`);
  } catch (err) {
    console.error('❌ FATAL: Bot token invalid!', err.message);
    process.exit(1);
  }

  registerHandlers();
}

// ─── SAFE SEND HELPERS ────────────────────────────────────────────────────────
async function safeDeleteMessage(chatId, msgId) {
  try {
    await bot.deleteMessage(chatId, msgId);
  } catch (e) {
    // Ignore delete errors
  }
}

async function safeSendMessage(chatId, text, opts = {}) {
  try {
    return await bot.sendMessage(chatId, text, opts);
  } catch (err) {
    console.error(`❌ safeSendMessage error to ${chatId}:`, err.message);
  }
}

async function safeEditMessageText(text, opts = {}) {
  try {
    return await bot.editMessageText(text, opts);
  } catch (err) {
    if (!err.message.includes('message is not modified')) {
      console.error('❌ safeEditMessageText error:', err.message);
    }
  }
}

async function safeEditMessageCaption(caption, opts = {}) {
  try {
    return await bot.editMessageCaption(caption, opts);
  } catch (err) {
    if (!err.message.includes('message is not modified')) {
      console.error('❌ safeEditMessageCaption error:', err.message);
    }
  }
}

async function safeAnswerCallback(queryId, opts = {}) {
  try {
    await bot.answerCallbackQuery(queryId, opts);
  } catch (e) {
    // Ignore
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  SEND ADMIN MENU
// ─────────────────────────────────────────────────────────────────────────────
async function sendAdminMenu(chatId) {
  await safeSendMessage(chatId,
    `👑 ᴡᴇʟᴄᴏᴍᴇ ᴀᴅᴍɪɴ!\n\n` +
    `🤖 Bot Developed By @ZeroSpade\n\n` +
    `━━━━━━━━━━━━━━━━━\n` +
    `ɴɪᴄʜᴇ sᴇ ᴏᴩᴛɪᴏɴ sᴇʟᴇᴄᴛ ᴋᴀʀᴏ:\n` +
    `━━━━━━━━━━━━━━━━━`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '💰 Change Price', callback_data: 'admin_change_price' }, { text: '💳 Change UPI', callback_data: 'admin_change_upi' }],
          [{ text: '📢 Broadcast',    callback_data: 'admin_broadcast'    }, { text: '👥 Check Users', callback_data: 'admin_check_users' }],
          [{ text: '📊 Stats',        callback_data: 'admin_stats'        }, { text: '🔗 Links',       callback_data: 'admin_links' }]
        ]
      }
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  SEND HOME (User)
// ─────────────────────────────────────────────────────────────────────────────
async function sendHome(chatId, firstName) {
  const displayName = `𝘚𝘱𝘢𝘥𝘦 • ${firstName}`;
  await safeSendMessage(chatId,
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
          [{ text: 'BUY PREMIUM 💦',  callback_data: 'buy_premium'  }],
          [{ text: '💫 MY PREMIUMS',  callback_data: 'my_premiums'  }, { text: '👤 MY PROFILE', callback_data: 'my_profile' }],
          [{ text: '👀 VIEW DEMO',    callback_data: 'view_demo_0'  }]
        ]
      }
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  REGISTER ALL HANDLERS
// ─────────────────────────────────────────────────────────────────────────────
function registerHandlers() {

  // ── /start ──────────────────────────────────────────────────────────────────
  bot.onText(/\/start/, async (msg) => {
    try {
      const chatId    = msg.chat.id;
      const userId    = msg.from.id;
      const firstName = msg.from.first_name || 'User';
      const username  = msg.from.username   || '';

      console.log(`📩 /start from ${firstName} (${userId})`);

      // Save/update user
      await User.findOneAndUpdate(
        { userId },
        { userId, username, firstName },
        { upsert: true, setDefaultsOnInsert: true }
      );

      if (String(userId) === String(ADMIN_ID)) {
        return sendAdminMenu(chatId);
      }

      return sendHome(chatId, firstName);
    } catch (err) {
      console.error('❌ /start handler error:', err.message);
    }
  });

  // ── /admin ───────────────────────────────────────────────────────────────────
  bot.onText(/\/admin/, async (msg) => {
    try {
      if (String(msg.from.id) !== String(ADMIN_ID)) return;
      return sendAdminMenu(msg.chat.id);
    } catch (err) {
      console.error('❌ /admin handler error:', err.message);
    }
  });

  // ── CALLBACK QUERIES ─────────────────────────────────────────────────────────
  bot.on('callback_query', async (query) => {
    const chatId  = query.message.chat.id;
    const userId  = query.from.id;
    const msgId   = query.message.message_id;
    const data    = query.data;
    const isAdmin = String(userId) === String(ADMIN_ID);
    const firstName = query.from.first_name || 'User';

    await safeAnswerCallback(query.id);

    console.log(`🔘 Callback [${data}] from ${firstName} (${userId})`);

    try {

      // ── BUY PREMIUM ───────────────────────────────────────────────────────────
      if (data === 'buy_premium') {
        const plans = await getPlans();
        await safeDeleteMessage(chatId, msgId);

        let text = `💎 ᴘʀᴇᴍɪᴜᴍ ᴘʟᴀɴs\n\n━━━━━━━━━━━━━━━━━\n`;
        for (const p of plans) {
          const validity = p.days >= 999999 ? 'LIFETIME' : `${p.days} DAYS`;
          text += `🔹 ${p.name}\n   💰 ᴘʀɪᴄᴇ: ₹${p.price}\n   ⏳ ᴠᴀʟɪᴅɪᴛʏ: ${validity}\n   📌 ${p.desc}\n\n`;
        }
        text += `━━━━━━━━━━━━━━━━━\n👇 sᴇʟᴇᴄᴛ ʏᴏᴜʀ ᴘʟᴀɴ ʙᴇʟᴏᴡ`;

        const keyboard = plans.map(p => {
          const v = p.days >= 999999 ? 'LIFETIME' : `${p.days}D`;
          return [{ text: `${p.name} • ₹${p.price} • ${v}`, callback_data: `select_plan_${p.id}` }];
        });
        keyboard.push([{ text: '🏠 Back Home', callback_data: 'back_home' }]);

        await safeSendMessage(chatId, text, { reply_markup: { inline_keyboard: keyboard } });
        return;
      }

      // ── SELECT PLAN ───────────────────────────────────────────────────────────
      if (data.startsWith('select_plan_')) {
        const planId = data.replace('select_plan_', '');
        const plans  = await getPlans();
        const plan   = plans.find(p => p.id === planId);
        if (!plan) return;

        const upiId   = await getSetting('upi_id',   'Sakib006@ybl');
        const upiName = await getSetting('upi_name', 'Sakib');
        const validity = plan.days >= 999999 ? 'LIFETIME' : `${plan.days} DAYS`;

        await safeDeleteMessage(chatId, msgId);

        // Generate QR
        let qrBuffer;
        try {
          const upiUri = `upi://pay?pa=${upiId}&pn=${encodeURIComponent(upiName)}&am=${plan.price}&cu=INR`;
          qrBuffer = await QRCode.toBuffer(upiUri, { width: 300, margin: 2 });
        } catch (qrErr) {
          console.error('❌ QR generation error:', qrErr.message);
        }

        const caption =
          `💳 ᴘᴀʏᴍᴇɴᴛ ᴅᴇᴛᴀɪʟs\n\n` +
          `━━━━━━━━━━━━━━━━━\n` +
          `📦 ᴘʟᴀɴ: ${plan.name}\n` +
          `💰 ᴀᴍᴏᴜɴᴛ: ₹${plan.price}\n` +
          `⏳ ᴠᴀʟɪᴅɪᴛʏ: ${validity}\n` +
          `━━━━━━━━━━━━━━━━━\n\n` +
          `👤 ɴᴀᴍᴇ: ${upiName}\n` +
          `📱 UPI ID: \`${upiId}\`\n\n` +
          `📋 sᴛᴇᴘs:\n` +
          `1️⃣ UPI ID ᴘᴇ ₹${plan.price} ʙʜᴇᴊᴏ\n` +
          `2️⃣ ᴘᴀʏᴍᴇɴᴛ sᴄʀᴇᴇɴsʜᴏᴛ ʟᴏ\n` +
          `3️⃣ ɴɪᴄʜᴇ SUBMIT PROOF ᴅᴀʙᴀᴏ\n\n` +
          `⚠️ ᴠᴇʀɪꜰʏ ʜᴏɴᴇ ᴍᴇɪɴ 24 ʜᴏᴜʀs ʟᴀɢ sᴀᴋᴛᴇ ʜᴀɪɴ`;

        const keyboard = {
          inline_keyboard: [
            [{ text: '📸 SUBMIT PROOF', callback_data: `submit_proof_${planId}` }],
            [{ text: '🔙 BACK TO PLANS', callback_data: 'buy_premium' }]
          ]
        };

        userState[userId] = { action: 'awaiting_screenshot', planId };

        if (qrBuffer) {
          await bot.sendPhoto(chatId, qrBuffer, {
            caption,
            parse_mode: 'Markdown',
            reply_markup: keyboard
          }).catch(err => console.error('❌ sendPhoto error:', err.message));
        } else {
          await safeSendMessage(chatId, caption, {
            parse_mode: 'Markdown',
            reply_markup: keyboard
          });
        }
        return;
      }

      // ── SUBMIT PROOF ──────────────────────────────────────────────────────────
      if (data.startsWith('submit_proof_')) {
        const planId = data.replace('submit_proof_', '');
        userState[userId] = { action: 'awaiting_screenshot', planId };
        await safeDeleteMessage(chatId, msgId);
        await safeSendMessage(chatId,
          `📸 ᴘᴀʏᴍᴇɴᴛ sᴄʀᴇᴇɴsʜᴏᴛ ʙʜᴇᴊᴏ\n\n` +
          `✅ UPI ᴘᴀʏᴍᴇɴᴛ ᴋᴀʀɴᴇ ᴋᴇ ʙᴀᴀᴅ sᴄʀᴇᴇɴsʜᴏᴛ ʏᴀʜᴀɴ ʙʜᴇᴊᴏ.\n\n` +
          `⚠️ sɪʀꜰ ɪᴍᴀɢᴇ/sᴄʀᴇᴇɴsʜᴏᴛ ᴀᴄᴄᴇᴘᴛ ʜᴏɢᴀ`,
          { reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'back_home' }]] } }
        );
        return;
      }

      // ── MY PREMIUMS ───────────────────────────────────────────────────────────
      if (data === 'my_premiums') {
        const user = await User.findOne({ userId });
        const now  = new Date();
        const active = user?.activePlans?.filter(p => new Date(p.expiresAt) > now) || [];

        await safeDeleteMessage(chatId, msgId);

        if (!active.length) {
          await safeSendMessage(chatId,
            `💎 ᴍʏ ᴘʀᴇᴍɪᴜᴍs 🥵\n\n` +
            `━━━━━━━━━━━━━━━━━\n` +
            `❌ ᴀᴀᴘᴋᴇ ᴘᴀᴀs ᴋᴏɪ ᴀᴄᴛɪᴠᴇ ᴘʀᴇᴍɪᴜᴍ ɴᴀʜɪ ʜᴀɪ!\n\n` +
            `ᴘʀᴇᴍɪᴜᴍ ʟᴇɴᴇ ᴋᴇ ʟɪʏᴇ ɢᴇᴛ ᴘʀᴇᴍɪᴜᴍ ᴅᴀʙᴀᴏ.\n` +
            `━━━━━━━━━━━━━━━━━`,
            {
              reply_markup: {
                inline_keyboard: [
                  [{ text: 'BUY PREMIUM 💦', callback_data: 'buy_premium' }],
                  [{ text: '🏠 Back Home',   callback_data: 'back_home'   }]
                ]
              }
            }
          );
        } else {
          let text = `💎 ᴍʏ ᴘʀᴇᴍɪᴜᴍs 🥵\n\n━━━━━━━━━━━━━━━━━\n`;
          for (const p of active) {
            const expStr = new Date(p.expiresAt).getFullYear() > 2090
              ? 'LIFETIME'
              : new Date(p.expiresAt).toDateString();
            text += `✅ ${p.planName}\n⏳ Expires: ${expStr}\n\n`;
          }
          text += `━━━━━━━━━━━━━━━━━`;
          await safeSendMessage(chatId, text, {
            reply_markup: {
              inline_keyboard: [[{ text: '🏠 Back Home', callback_data: 'back_home' }]]
            }
          });
        }
        return;
      }

      // ── MY PROFILE ────────────────────────────────────────────────────────────
      if (data === 'my_profile') {
        const user     = await User.findOne({ userId });
        const payments = await Payment.find({ userId });
        const approved = payments.filter(p => p.status === 'approved').length;
        const pending  = payments.filter(p => p.status === 'pending').length;
        const total    = payments.length;
        const now      = new Date();
        const active   = user?.activePlans?.filter(p => new Date(p.expiresAt) > now) || [];

        const joinedStr = user?.joinedAt
          ? user.joinedAt.toISOString().replace('T', ' ').substring(0, 19)
          : 'N/A';

        await safeDeleteMessage(chatId, msgId);
        await safeSendMessage(chatId,
          `👤 ᴍʏ ᴘʀᴏꜰɪʟᴇ\n\n` +
          `━━━━━━━━━━━━━━━━━\n` +
          `🙍 ɴᴀᴍᴇ: ${query.from.first_name || ''} ${query.from.last_name || ''}\n` +
          `📛 ᴜsᴇʀɴᴀᴍᴇ: @${query.from.username || 'N/A'}\n` +
          `🆔 ID: ${userId}\n` +
          `📅 ᴊᴏɪɴᴇᴅ: ${joinedStr}\n` +
          `━━━━━━━━━━━━━━━━━\n` +
          `💎 ᴘʀᴇᴍɪᴜᴍ sᴛᴀᴛᴜs: ${active.length > 0 ? '✅ ᴀᴄᴛɪᴠᴇ' : '❌ ɴᴏᴛ ᴀᴄᴛɪᴠᴇ'}\n` +
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
                [{ text: '🏠 Back Home',   callback_data: 'back_home'   }]
              ]
            }
          }
        );
        return;
      }

      // ── VIEW DEMO ─────────────────────────────────────────────────────────────
      if (data.startsWith('view_demo_')) {
        const idx   = parseInt(data.replace('view_demo_', '')) || 0;
        const plans = await getPlans();
        if (!plans.length) return;
        const safeIdx = Math.max(0, Math.min(idx, plans.length - 1));
        const plan    = plans[safeIdx];
        const validity = plan.days >= 999999 ? 'LIFETIME' : `${plan.days} DAYS`;
        const demoChannel = await getSetting('demo_channel', 'https://t.me/yourchannel');

        await safeDeleteMessage(chatId, msgId);
        await safeSendMessage(chatId,
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
                  { text: '⬅️ Prev', callback_data: `view_demo_${safeIdx > 0 ? safeIdx - 1 : plans.length - 1}` },
                  { text: `${safeIdx + 1}/${plans.length}`, callback_data: 'noop' },
                  { text: '➡️ Next', callback_data: `view_demo_${(safeIdx + 1) % plans.length}` }
                ],
                [{ text: '💎 Get Premium', callback_data: 'buy_premium' }, { text: '🏠 Back Home', callback_data: 'back_home' }]
              ]
            }
          }
        );
        return;
      }

      // ── BACK HOME ─────────────────────────────────────────────────────────────
      if (data === 'back_home') {
        await safeDeleteMessage(chatId, msgId);
        if (isAdmin) return sendAdminMenu(chatId);
        return sendHome(chatId, firstName);
      }

      // ══════════════════════════════════════════════════════════════════════════
      //  ADMIN CALLBACKS
      // ══════════════════════════════════════════════════════════════════════════
      if (!isAdmin) {
        console.warn(`⚠️ Non-admin (${userId}) tried admin action: ${data}`);
        return;
      }

      // ── ADMIN: CHANGE PRICE ───────────────────────────────────────────────────
      if (data === 'admin_change_price') {
        const plans = await getPlans();
        const keyboard = plans.map(p => ([{ text: `${p.name} — ₹${p.price}`, callback_data: `admin_price_plan_${p.id}` }]));
        keyboard.push([{ text: '🔙 Back', callback_data: 'admin_back' }]);
        await safeEditMessageText(`💰 Kaun se plan ka price change karna hai?`, {
          chat_id: chatId, message_id: msgId,
          reply_markup: { inline_keyboard: keyboard }
        });
        return;
      }

      if (data.startsWith('admin_price_plan_')) {
        const planId = data.replace('admin_price_plan_', '');
        userState[userId] = { action: 'admin_set_price', planId, msgId };
        await safeEditMessageText(`💰 Naya price bhejo (sirf number, e.g. 99):`, {
          chat_id: chatId, message_id: msgId,
          reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'admin_back' }]] }
        });
        return;
      }

      // ── ADMIN: CHANGE UPI ─────────────────────────────────────────────────────
      if (data === 'admin_change_upi') {
        const curId   = await getSetting('upi_id',   'Sakib006@ybl');
        const curName = await getSetting('upi_name', 'Sakib');
        userState[userId] = { action: 'admin_set_upi' };
        await safeEditMessageText(
          `💳 Current UPI:\nID: ${curId}\nName: ${curName}\n\nNaya format me bhejo:\n<UPI_ID>|<NAME>\n\nExample: newupi@ybl|Rahul`,
          {
            chat_id: chatId, message_id: msgId,
            reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'admin_back' }]] }
          }
        );
        return;
      }

      // ── ADMIN: BROADCAST ──────────────────────────────────────────────────────
      if (data === 'admin_broadcast') {
        userState[userId] = { action: 'admin_broadcast' };
        await safeEditMessageText(
          `📢 Broadcast message bhejo:\n\n` +
          `✅ Text, Image, Video sab support hai\n` +
          `✅ Caption bhi support hai\n` +
          `✅ Koi bhi font style use karo`,
          {
            chat_id: chatId, message_id: msgId,
            reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'admin_back' }]] }
          }
        );
        return;
      }

      // ── ADMIN: CHECK USERS ────────────────────────────────────────────────────
      if (data === 'admin_check_users') {
        const totalUsers = await User.countDocuments();
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const todayUsers   = await User.countDocuments({ joinedAt: { $gte: today } });
        const last24h      = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const last24hCount = await User.countDocuments({ joinedAt: { $gte: last24h } });
        const perHour      = (last24hCount / 24).toFixed(1);

        await safeEditMessageText(
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

      // ── ADMIN: STATS ──────────────────────────────────────────────────────────
      if (data === 'admin_stats') {
        const pingStart     = Date.now();
        const totalUsers    = await User.countDocuments();
        const premiumUsers  = await User.countDocuments({ isPremium: true });
        const totalPayments = await Payment.countDocuments();
        const pending       = await Payment.countDocuments({ status: 'pending' });
        const replySpeed    = Date.now() - pingStart;

        const countryAgg = await User.aggregate([
          { $match: { country: { $exists: true, $ne: null, $ne: '' } } },
          { $group: { _id: '$country', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 3 }
        ]);

        let topStates = '';
        if (!countryAgg.length) {
          topStates = '   📍 Data not available yet';
        } else {
          const medals = ['🥇', '🥈', '🥉'];
          countryAgg.forEach((c, i) => {
            topStates += `   ${medals[i]} ${c._id || 'Unknown'}: ${c.count} users\n`;
          });
        }

        await safeEditMessageText(
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

      // ── ADMIN: LINKS ──────────────────────────────────────────────────────────
      if (data === 'admin_links') {
        await safeEditMessageText(`🔗 Links Management`, {
          chat_id: chatId, message_id: msgId,
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔗 Change Plans Link',    callback_data: 'admin_change_plan_links'   }],
              [{ text: '📺 Change Demo Channel',  callback_data: 'admin_change_demo_channel' }],
              [{ text: '🔙 Back',                 callback_data: 'admin_back'                }]
            ]
          }
        });
        return;
      }

      if (data === 'admin_change_demo_channel') {
        const cur = await getSetting('demo_channel', 'Not set');
        userState[userId] = { action: 'admin_set_demo_channel' };
        await safeEditMessageText(
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
        await safeEditMessageText(`🔗 Kaun se plan ki link change karni hai?`, {
          chat_id: chatId, message_id: msgId,
          reply_markup: { inline_keyboard: keyboard }
        });
        return;
      }

      if (data.startsWith('admin_set_link_')) {
        const planId = data.replace('admin_set_link_', '');
        userState[userId] = { action: 'admin_set_plan_link', planId };
        await safeEditMessageText(`🔗 Is plan ki nai result link bhejo:`, {
          chat_id: chatId, message_id: msgId,
          reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'admin_back' }]] }
        });
        return;
      }

      // ── ADMIN: APPROVE ────────────────────────────────────────────────────────
      if (data.startsWith('approve_')) {
        const paymentId = data.replace('approve_', '');
        const payment   = await Payment.findById(paymentId);

        if (!payment) {
          await safeAnswerCallback(query.id, { text: '❌ Payment not found!' });
          return;
        }
        if (payment.status !== 'pending') {
          await safeAnswerCallback(query.id, { text: '⚠️ Already processed!' });
          return;
        }

        const plans   = await getPlans();
        const plan    = plans.find(p => p.id === payment.planId);
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
                planId:    payment.planId,
                planName:  payment.planName,
                expiresAt,
                approvedAt: new Date()
              }
            }
          }
        );

        await safeEditMessageCaption(
          `✅ APPROVED ✅\n\n` +
          `👤 User: ${payment.firstName} (@${payment.username})\n` +
          `🆔 ID: ${payment.userId}\n` +
          `📦 Plan: ${payment.planName}\n` +
          `💰 Amount: ₹${payment.amount}\n` +
          `🧾 Order: ${payment.orderId}`,
          { chat_id: chatId, message_id: msgId }
        );

        const planLink = plan?.link || '❌ Link not set — please set via admin panel';
        await safeSendMessage(payment.userId,
          `🎉 ᴘᴀʏᴍᴇɴᴛ sᴜᴄᴄᴇssꜰᴜʟ!\n\n` +
          `━━━━━━━━━━━━━━━━━\n` +
          `✅ ᴀᴘᴘʀᴏᴠᴇᴅ\n` +
          `📦 ᴘʟᴀɴ: ${payment.planName}\n` +
          `🧾 ᴏʀᴅᴇʀ: ${payment.orderId}\n` +
          `━━━━━━━━━━━━━━━━━\n\n` +
          `🔗 ᴀᴘɴᴀ ᴄᴏɴᴛᴇɴᴛ ᴀᴄᴄᴇss ᴋᴀʀᴏ:\n${planLink}\n\n` +
          `🙏 ᴛʜᴀɴᴋ ʏᴏᴜ ꜰᴏʀ ʙᴜʏɪɴɢ ᴘʀᴇᴍɪᴜᴍ!`
        );

        console.log(`✅ Payment approved: ${payment.orderId} for user ${payment.userId}`);
        return;
      }

      // ── ADMIN: REJECT ─────────────────────────────────────────────────────────
      if (data.startsWith('reject_')) {
        const paymentId = data.replace('reject_', '');
        const payment   = await Payment.findById(paymentId);

        if (!payment) {
          await safeAnswerCallback(query.id, { text: '❌ Payment not found!' });
          return;
        }
        if (payment.status !== 'pending') {
          await safeAnswerCallback(query.id, { text: '⚠️ Already processed!' });
          return;
        }

        await Payment.findByIdAndUpdate(paymentId, { status: 'rejected' });

        await safeEditMessageCaption(
          `❌ REJECTED ❌\n\n` +
          `👤 User: ${payment.firstName} (@${payment.username})\n` +
          `🆔 ID: ${payment.userId}\n` +
          `📦 Plan: ${payment.planName}\n` +
          `💰 Amount: ₹${payment.amount}\n` +
          `🧾 Order: ${payment.orderId}`,
          { chat_id: chatId, message_id: msgId }
        );

        await safeSendMessage(payment.userId,
          `❌ ᴘᴀʏᴍᴇɴᴛ ʀᴇᴊᴇᴄᴛᴇᴅ\n\n` +
          `━━━━━━━━━━━━━━━━━\n` +
          `📦 ᴘʟᴀɴ: ${payment.planName}\n` +
          `🧾 ᴏʀᴅᴇʀ: ${payment.orderId}\n` +
          `━━━━━━━━━━━━━━━━━\n\n` +
          `⚠️ ᴀᴀᴘᴋᴀ ᴘᴀʏᴍᴇɴᴛ ᴘʀᴏᴏꜰ ʀᴇᴊᴇᴄᴛ ʜᴏ ɢᴀʏᴀ.\n` +
          `ᴅᴏʙᴀʀᴀ sᴄʀᴇᴇɴsʜᴏᴛ ʙʜᴇᴊᴏ ʏᴀ ᴀᴅᴍɪɴ sᴇ sᴀᴍᴘᴀʀᴋ ᴋᴀʀᴏ.`,
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: 'BUY PREMIUM 💦', callback_data: 'buy_premium' }],
                [{ text: '🏠 Back Home',   callback_data: 'back_home'   }]
              ]
            }
          }
        );

        console.log(`❌ Payment rejected: ${payment.orderId} for user ${payment.userId}`);
        return;
      }

      // ── ADMIN: BACK ───────────────────────────────────────────────────────────
      if (data === 'admin_back') {
        await safeDeleteMessage(chatId, msgId);
        return sendAdminMenu(chatId);
      }

      // noop
      if (data === 'noop') return;

    } catch (err) {
      console.error(`❌ Callback handler error [${data}]:`, err.message);
      console.error(err.stack);
    }
  });

  // ── MESSAGE HANDLER ──────────────────────────────────────────────────────────
  bot.on('message', async (msg) => {
    // Skip commands (handled by onText)
    if (msg.text && msg.text.startsWith('/')) return;

    const chatId  = msg.chat.id;
    const userId  = msg.from.id;
    const isAdmin = String(userId) === String(ADMIN_ID);
    const state   = userState[userId];

    if (!state) return;

    try {

      // ── USER: SCREENSHOT UPLOAD ───────────────────────────────────────────────
      if (state.action === 'awaiting_screenshot') {
        if (!msg.photo && !msg.document) {
          await safeSendMessage(chatId, `⚠️ sɪʀꜰ ɪᴍᴀɢᴇ/sᴄʀᴇᴇɴsʜᴏᴛ ʙʜᴇᴊᴏ!`);
          return;
        }

        const plans = await getPlans();
        const plan  = plans.find(p => p.id === state.planId);
        if (!plan) {
          await safeSendMessage(chatId, `❌ Plan not found! /start se dobara try karo.`);
          delete userState[userId];
          return;
        }

        const fileId = msg.photo
          ? msg.photo[msg.photo.length - 1].file_id
          : msg.document.file_id;

        const orderId = generateOrderId();

        const payment = await Payment.create({
          orderId,
          userId,
          username:         msg.from.username  || '',
          firstName:        msg.from.first_name || '',
          planId:           plan.id,
          planName:         plan.name,
          amount:           plan.price,
          screenshotFileId: fileId,
          status:           'pending'
        });

        delete userState[userId];

        // Confirm to user
        await safeSendMessage(chatId,
          `✅ ᴘᴀʏᴍᴇɴᴛ ᴘʀᴏᴏꜰ sᴜʙᴍɪᴛ ʜᴏ ɢᴀʏᴀ.\n\n` +
          `━━━━━━━━━━━━━━━━━\n` +
          `📦 ᴘʟᴀɴ: ${plan.name}\n` +
          `🧾 ᴏʀᴅᴇʀ ID: ${orderId}\n` +
          `⏳ sᴛᴀᴛᴜs: ᴘᴇɴᴅɪɴɢ\n` +
          `━━━━━━━━━━━━━━━━━\n\n` +
          `ᴠᴇʀɪꜰɪᴄᴀᴛɪᴏɴ ᴋᴇ ʙᴀᴀᴅ ᴀᴄᴄᴇss sᴇɴᴅ ʜᴏ ᴊᴀʏᴇɢᴀ.`
        );

        // Forward to admin with approve/reject buttons
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

        try {
          const sentMsg = await bot.sendPhoto(ADMIN_ID, fileId, {
            caption: adminCaption,
            reply_markup: {
              inline_keyboard: [[
                { text: '✅ APPROVE', callback_data: `approve_${payment._id}` },
                { text: '❌ REJECT',  callback_data: `reject_${payment._id}`  }
              ]]
            }
          });
          await Payment.findByIdAndUpdate(payment._id, { adminMsgId: sentMsg.message_id });
          console.log(`📸 Payment proof forwarded to admin. Order: ${orderId}`);
        } catch (err) {
          console.error('❌ Failed to forward screenshot to admin:', err.message);
        }
        return;
      }

      // ══════════════════════════════════════════════════════════════════════════
      //  ADMIN MESSAGE INPUTS
      // ══════════════════════════════════════════════════════════════════════════
      if (!isAdmin) return;

      // ── ADMIN: SET PRICE ──────────────────────────────────────────────────────
      if (state.action === 'admin_set_price') {
        const newPrice = parseInt(msg.text);
        if (isNaN(newPrice) || newPrice <= 0) {
          await safeSendMessage(chatId, `❌ Invalid price! Sirf number bhejo. (e.g. 99)`);
          return;
        }
        const plans = await getPlans();
        const idx   = plans.findIndex(p => p.id === state.planId);
        if (idx === -1) {
          await safeSendMessage(chatId, `❌ Plan not found!`);
          delete userState[userId];
          return;
        }
        const oldPrice = plans[idx].price;
        plans[idx].price = newPrice;
        await savePlans(plans);
        delete userState[userId];
        console.log(`💰 Admin updated price: ${plans[idx].name} ₹${oldPrice} → ₹${newPrice}`);
        await safeSendMessage(chatId,
          `✅ Price Updated!\n\n📦 Plan: ${plans[idx].name}\n💰 Old: ₹${oldPrice}\n💰 New: ₹${newPrice}`
        );
        return sendAdminMenu(chatId);
      }

      // ── ADMIN: SET UPI ────────────────────────────────────────────────────────
      if (state.action === 'admin_set_upi') {
        const parts = (msg.text || '').split('|');
        if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) {
          await safeSendMessage(chatId,
            `❌ Format galat hai!\nSahi format: UPI_ID|NAME\nExample: myupi@ybl|Rahul`
          );
          return;
        }
        const newUpiId   = parts[0].trim();
        const newUpiName = parts[1].trim();
        await setSetting('upi_id',   newUpiId);
        await setSetting('upi_name', newUpiName);
        delete userState[userId];
        console.log(`💳 Admin updated UPI: ${newUpiId} | ${newUpiName}`);
        await safeSendMessage(chatId, `✅ UPI Updated!\n📱 ID: ${newUpiId}\n👤 Name: ${newUpiName}`);
        return sendAdminMenu(chatId);
      }

      // ── ADMIN: SET DEMO CHANNEL ───────────────────────────────────────────────
      if (state.action === 'admin_set_demo_channel') {
        const link = (msg.text || '').trim();
        if (!link.startsWith('http')) {
          await safeSendMessage(chatId, `❌ Valid link bhejo! (https:// se shuru hona chahiye)`);
          return;
        }
        await setSetting('demo_channel', link);
        delete userState[userId];
        console.log(`📺 Admin updated demo channel: ${link}`);
        await safeSendMessage(chatId, `✅ Demo Channel Updated!\n🔗 ${link}`);
        return sendAdminMenu(chatId);
      }

      // ── ADMIN: SET PLAN LINK ──────────────────────────────────────────────────
      if (state.action === 'admin_set_plan_link') {
        const link = (msg.text || '').trim();
        if (!link.startsWith('http') && !link.startsWith('t.me')) {
          await safeSendMessage(chatId, `❌ Valid link bhejo!`);
          return;
        }
        const plans = await getPlans();
        const idx   = plans.findIndex(p => p.id === state.planId);
        if (idx === -1) {
          await safeSendMessage(chatId, `❌ Plan not found!`);
          delete userState[userId];
          return;
        }
        plans[idx].link = link;
        await savePlans(plans);
        delete userState[userId];
        console.log(`🔗 Admin updated plan link: ${plans[idx].name} → ${link}`);
        await safeSendMessage(chatId, `✅ Plan Link Updated!\n📦 ${plans[idx].name}\n🔗 ${link}`);
        return sendAdminMenu(chatId);
      }

      // ── ADMIN: BROADCAST ──────────────────────────────────────────────────────
      if (state.action === 'admin_broadcast') {
        delete userState[userId];

        const users = await User.find({}, 'userId');
        const total = users.length;
        let success = 0, failed = 0;

        console.log(`📢 Broadcast started to ${total} users`);
        const progressMsg = await safeSendMessage(chatId,
          `📢 Broadcast shuru ho gaya...\n👥 Total: ${total} users\n⏳ Please wait...`
        );

        for (let i = 0; i < users.length; i++) {
          const u = users[i];
          try {
            if (msg.photo) {
              await bot.sendPhoto(u.userId, msg.photo[msg.photo.length - 1].file_id, {
                caption: msg.caption || ''
              });
            } else if (msg.video) {
              await bot.sendVideo(u.userId, msg.video.file_id, {
                caption: msg.caption || ''
              });
            } else if (msg.document) {
              await bot.sendDocument(u.userId, msg.document.file_id, {
                caption: msg.caption || ''
              });
            } else if (msg.animation) {
              await bot.sendAnimation(u.userId, msg.animation.file_id, {
                caption: msg.caption || ''
              });
            } else if (msg.sticker) {
              await bot.sendSticker(u.userId, msg.sticker.file_id);
            } else if (msg.text) {
              await bot.sendMessage(u.userId, msg.text);
            }
            success++;
          } catch (e) {
            failed++;
            if (e.message.includes('bot was blocked') || e.message.includes('user is deactivated')) {
              // Remove blocked users from DB
              await User.deleteOne({ userId: u.userId });
              console.log(`🗑️ Removed blocked user: ${u.userId}`);
            }
          }

          // Anti-flood: 50ms delay per message
          await new Promise(r => setTimeout(r, 50));

          // Progress update every 50 users
          if ((i + 1) % 50 === 0 && progressMsg) {
            await safeEditMessageText(
              `📢 Broadcasting...\n✅ ${success} / ❌ ${failed} / 👥 ${total}\n⏳ ${i + 1}/${total} done`,
              { chat_id: chatId, message_id: progressMsg.message_id }
            ).catch(() => {});
          }
        }

        console.log(`✅ Broadcast done: ${success} success, ${failed} failed`);
        await safeSendMessage(chatId,
          `✅ Broadcast Complete!\n\n` +
          `✅ Success: ${success}\n` +
          `❌ Failed: ${failed}\n` +
          `👥 Total: ${total}`
        );
        return sendAdminMenu(chatId);
      }

    } catch (err) {
      console.error('❌ Message handler error:', err.message);
      console.error(err.stack);
    }
  });
}

// ─── GRACEFUL SHUTDOWN ────────────────────────────────────────────────────────
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

async function gracefulShutdown(signal) {
  console.log(`\n⚠️ ${signal} received. Shutting down gracefully...`);
  try {
    if (bot) {
      await bot.stopPolling();
      console.log('✅ Bot polling stopped');
    }
    await mongoose.connection.close();
    console.log('✅ MongoDB connection closed');
  } catch (err) {
    console.error('❌ Shutdown error:', err.message);
  }
  process.exit(0);
}

process.on('uncaughtException', (err) => {
  console.error('❌ UNCAUGHT EXCEPTION:', err.message);
  console.error(err.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ UNHANDLED REJECTION:', reason);
  process.exit(1);
});

// ─── MAIN ENTRY ───────────────────────────────────────────────────────────────
(async () => {
  await connectMongo();
  await initBot();
  console.log('✅ Bot is fully running!');
})();
