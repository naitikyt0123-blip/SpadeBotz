const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const QRCode = require('qrcode');
const axios = require('axios');

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID  = process.env.ADMIN_ID;
const MONGO_URL = process.env.MONGO_URL;

// ─── STARTUP CHECKS ───────────────────────────────────────────────────────────
if (!BOT_TOKEN) { console.error('❌ FATAL: BOT_TOKEN missing'); process.exit(1); }
if (!ADMIN_ID)  { console.error('❌ FATAL: ADMIN_ID missing');  process.exit(1); }
if (!MONGO_URL) { console.error('❌ FATAL: MONGO_URL missing'); process.exit(1); }

// ─── KILL ANY EXISTING WEBHOOK/POLLING ───────────────────────────────────────
async function killExistingConnections() {
  try {
    // Delete webhook and drop pending updates
    const res = await axios.post(
      `https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook`,
      { drop_pending_updates: true },
      { timeout: 10000 }
    );
    console.log('✅ Webhook cleared:', res.data.description);
    
    // Close any existing getUpdates by calling it once with -1 offset
    await axios.post(
      `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates`,
      { offset: -1, limit: 1, timeout: 0 },
      { timeout: 10000 }
    );
    console.log('✅ Existing getUpdates cleared');
    
    // Wait for Telegram servers to release the lock
    await new Promise(r => setTimeout(r, 3000));
  } catch (err) {
    console.error('⚠️ killExistingConnections error:', err.message);
  }
}

// ─── MONGO CONNECT ────────────────────────────────────────────────────────────
async function connectMongo() {
  for (let i = 5; i > 0; i--) {
    try {
      await mongoose.connect(MONGO_URL, {
        serverSelectionTimeoutMS: 10000,
        socketTimeoutMS: 45000,
      });
      console.log('✅ MongoDB Connected');
      return;
    } catch (err) {
      console.error(`❌ MongoDB failed. Retries left: ${i-1} | ${err.message}`);
      if (i === 1) { process.exit(1); }
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

mongoose.connection.on('disconnected', () => console.warn('⚠️ MongoDB Disconnected'));
mongoose.connection.on('reconnected',  () => console.log('✅ MongoDB Reconnected'));
mongoose.connection.on('error', err    => console.error('❌ MongoDB Error:', err.message));

// ─── SCHEMAS ──────────────────────────────────────────────────────────────────
const User = mongoose.model('User', new mongoose.Schema({
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
}));

const Payment = mongoose.model('Payment', new mongoose.Schema({
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
}));

const Settings = mongoose.model('Settings', new mongoose.Schema({
  key:   { type: String, unique: true },
  value: mongoose.Schema.Types.Mixed
}));

// ─── SETTINGS HELPERS ─────────────────────────────────────────────────────────
async function getSetting(key, def = null) {
  try {
    const s = await Settings.findOne({ key });
    return s ? s.value : def;
  } catch { return def; }
}

async function setSetting(key, value) {
  try {
    await Settings.findOneAndUpdate({ key }, { key, value }, { upsert: true, new: true });
  } catch (err) {
    console.error(`❌ setSetting[${key}]:`, err.message);
  }
}

// ─── DEFAULT PLANS ────────────────────────────────────────────────────────────
const DEFAULT_PLANS = [
  { id:'plan_1',  name:'🌽ᴄʜ1ʟᴅ ᴄ0ʀɴ🌽',             price:59,  days:30,     desc:'🌽CH1LD C0RN🌽',                                          link:'', demo:'' },
  { id:'plan_2',  name:'🌽🌽 ᴀʟʟ ᴛʏᴘᴇ',               price:199, days:999999, desc:'All types c0rn🌽 LIFETIME',                                link:'', demo:'' },
  { id:'plan_3',  name:'💦ʀᴇᴀʟ ɪɴᴅ!ᴀɴ ᴅēsɪ ᴘ0ʀɴ 💦', price:99,  days:30,     desc:'💦 Full Desi Indian 40000+ videos💦',                      link:'', demo:'' },
  { id:'plan_4',  name:'👻ɢ0ʀᴇ ʀ@ᴘᴇ💦',               price:99,  days:30,     desc:'✨10000+ Mom&Son\n✨6000+ R@pe Videos\n✨New Content',       link:'', demo:'' },
  { id:'plan_5',  name:'🥵 ʜᴏᴛ ᴅᴇsɪ ʙʜᴀʙʜɪ 🥵',      price:69,  days:30,     desc:'💦New Desi Bhabhi Best P0rn💦',                            link:'', demo:'' },
  { id:'plan_6',  name:'🫦ᴄᴏʟʟᴇɢᴇ ʟᴇᴀᴋᴇs 🫦',         price:69,  days:30,     desc:'College girls ki videos💦🫦',                              link:'', demo:'' },
  { id:'plan_7',  name:'ᴀᴅɪᴛʏ ᴍɪsʀʏ ᴀʟʟ 😋',         price:89,  days:30,     desc:'ADITI MISRY SHOWS 🫦',                                     link:'', demo:'' },
  { id:'plan_8',  name:'😘 ᴍᴏᴍ ᴀɴᴅ sᴏɴ 😘',          price:59,  days:30,     desc:'😘 MOM AND SON 😘',                                        link:'', demo:'' },
  { id:'plan_9',  name:'✂️ ʟᴇsʙɪᴀɴs ✂️',              price:49,  days:30,     desc:'LESBIANS 🫦✂️',                                            link:'', demo:'' },
  { id:'plan_10', name:'ɪɴᴅɪᴀɴ ᴡᴇʙsᴇʀɪᴇs 😋🫦',       price:99,  days:30,     desc:'WEBSERIES 🫦',                                             link:'', demo:'' },
  { id:'plan_11', name:'💦 ᴅᴇsɪ ᴘɪssɪɴɢ 💦',          price:79,  days:30,     desc:'PISSING 🫦💦',                                             link:'', demo:'' }
];

async function getPlans() {
  return await getSetting('plans', DEFAULT_PLANS);
}
async function savePlans(plans) {
  await setSetting('plans', plans);
}

// ─── ORDER ID ────────────────────────────────────────────────────────────────
function generateOrderId() {
  const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const r = (n) => Array.from({length:n}, () => c[Math.floor(Math.random()*c.length)]).join('');
  return `ORD-${r(8)}-${r(4)}`;
}

// ─── USER STATE ───────────────────────────────────────────────────────────────
const userState = {};

// ─── BOT INSTANCE ─────────────────────────────────────────────────────────────
let bot = null;
let isPolling = false;

// ─── SAFE HELPERS ─────────────────────────────────────────────────────────────
const safeDelete = async (cid, mid) => {
  try { await bot.deleteMessage(cid, mid); } catch {}
};

const safeSend = async (cid, text, opts = {}) => {
  try { return await bot.sendMessage(cid, text, opts); }
  catch (e) { console.error(`❌ safeSend(${cid}):`, e.message); }
};

const safeEdit = async (text, opts = {}) => {
  try { return await bot.editMessageText(text, opts); }
  catch (e) { if (!e.message?.includes('not modified')) console.error('❌ safeEdit:', e.message); }
};

const safeEditCaption = async (caption, opts = {}) => {
  try { return await bot.editMessageCaption(caption, opts); }
  catch (e) { if (!e.message?.includes('not modified')) console.error('❌ safeEditCaption:', e.message); }
};

const safeAnswer = async (id, opts = {}) => {
  try { await bot.answerCallbackQuery(id, opts); } catch {}
};

// ─── UI BUILDERS ─────────────────────────────────────────────────────────────
async function sendAdminMenu(chatId) {
  await safeSend(chatId,
    `👑 ᴡᴇʟᴄᴏᴍᴇ ᴀᴅᴍɪɴ!\n\n` +
    `🤖 Bot Developed By @ZeroSpade\n` +
    `━━━━━━━━━━━━━━━━━`,
    { reply_markup: { inline_keyboard: [
      [{ text:'💰 Change Price', callback_data:'admin_change_price' }, { text:'💳 Change UPI',  callback_data:'admin_change_upi'   }],
      [{ text:'📢 Broadcast',   callback_data:'admin_broadcast'    }, { text:'👥 Check Users', callback_data:'admin_check_users'  }],
      [{ text:'📊 Stats',       callback_data:'admin_stats'        }, { text:'🔗 Links',       callback_data:'admin_links'        }]
    ]}}
  );
}

async function sendHome(chatId, firstName) {
  await safeSend(chatId,
    `👋 ʜᴇʟʟᴏ 𝘚𝘱𝘢𝘥𝘦 • ${firstName}!\n\n` +
    `🌟 ᴡᴇʟᴄᴏᴍᴇ ᴛᴏ ᴘʀᴇᴍɪᴜᴍ ʙᴏᴛ\n\n` +
    `━━━━━━━━━━━━━━━━━\n` +
    `💎 ᴘʀᴇᴍɪᴜᴍ ᴘʀɪᴄᴇ: ₹49 - ₹199\n` +
    `📦 ᴘʟᴀɴs: 11 ᴘʟᴀɴs ᴀᴠᴀɪʟᴀʙʟᴇ\n` +
    `━━━━━━━━━━━━━━━━━\n\n` +
    `🔒 ᴘʀᴇᴍɪᴜᴍ ʟᴇɴᴇ ᴋᴇ ʟɪʏᴇ ɴɪᴄʜᴇ ᴄʟɪᴄᴋ ᴋᴀʀᴏ!`,
    { reply_markup: { inline_keyboard: [
      [{ text:'BUY PREMIUM 💦',  callback_data:'buy_premium'  }],
      [{ text:'💫 MY PREMIUMS',  callback_data:'my_premiums'  }, { text:'👤 MY PROFILE', callback_data:'my_profile'  }],
      [{ text:'👀 VIEW DEMO',    callback_data:'view_demo_0'  }]
    ]}}
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  HANDLERS
// ─────────────────────────────────────────────────────────────────────────────
function registerHandlers() {

  // /start
  bot.onText(/\/start/, async (msg) => {
    try {
      const { id: chatId } = msg.chat;
      const { id: userId, first_name, username } = msg.from;
      const firstName = first_name || 'User';

      await User.findOneAndUpdate(
        { userId },
        { userId, username: username || '', firstName },
        { upsert: true, setDefaultsOnInsert: true }
      );

      if (String(userId) === String(ADMIN_ID)) {
        return sendAdminMenu(chatId);
      }
      return sendHome(chatId, firstName);
    } catch (e) { console.error('❌ /start:', e.message); }
  });

  // /admin
  bot.onText(/\/admin/, async (msg) => {
    try {
      if (String(msg.from.id) !== String(ADMIN_ID)) return;
      return sendAdminMenu(msg.chat.id);
    } catch (e) { console.error('❌ /admin:', e.message); }
  });

  // CALLBACKS
  bot.on('callback_query', async (query) => {
    const chatId    = query.message.chat.id;
    const userId    = query.from.id;
    const msgId     = query.message.message_id;
    const data      = query.data;
    const isAdmin   = String(userId) === String(ADMIN_ID);
    const firstName = query.from.first_name || 'User';

    await safeAnswer(query.id);

    try {
      // ── BUY PREMIUM
      if (data === 'buy_premium') {
        const plans = await getPlans();
        await safeDelete(chatId, msgId);
        let text = `💎 ᴘʀᴇᴍɪᴜᴍ ᴘʟᴀɴs\n\n━━━━━━━━━━━━━━━━━\n`;
        for (const p of plans) {
          const v = p.days >= 999999 ? 'LIFETIME' : `${p.days} DAYS`;
          text += `🔹 ${p.name}\n   💰 ₹${p.price} | ⏳ ${v}\n   📌 ${p.desc}\n\n`;
        }
        text += `━━━━━━━━━━━━━━━━━\n👇 ᴘʟᴀɴ sᴇʟᴇᴄᴛ ᴋᴀʀᴏ`;
        const kb = plans.map(p => {
          const v = p.days >= 999999 ? 'LIFETIME' : `${p.days}D`;
          return [{ text:`${p.name} • ₹${p.price} • ${v}`, callback_data:`sp_${p.id}` }];
        });
        kb.push([{ text:'🏠 Back Home', callback_data:'back_home' }]);
        await safeSend(chatId, text, { reply_markup:{ inline_keyboard: kb } });
        return;
      }

      // ── SELECT PLAN
      if (data.startsWith('sp_')) {
        const planId = data.replace('sp_', '');
        const plans  = await getPlans();
        const plan   = plans.find(p => p.id === planId);
        if (!plan) return;

        const upiId   = await getSetting('upi_id',   'Sakib006@ybl');
        const upiName = await getSetting('upi_name', 'Sakib');
        const v = plan.days >= 999999 ? 'LIFETIME' : `${plan.days} DAYS`;

        await safeDelete(chatId, msgId);

        let qrBuffer = null;
        try {
          const upiUri = `upi://pay?pa=${upiId}&pn=${encodeURIComponent(upiName)}&am=${plan.price}&cu=INR`;
          qrBuffer = await QRCode.toBuffer(upiUri, { width:300, margin:2 });
        } catch (e) { console.error('❌ QR error:', e.message); }

        const caption =
          `💳 ᴘᴀʏᴍᴇɴᴛ ᴅᴇᴛᴀɪʟs\n\n` +
          `━━━━━━━━━━━━━━━━━\n` +
          `📦 ᴘʟᴀɴ: ${plan.name}\n` +
          `💰 ᴀᴍᴏᴜɴᴛ: ₹${plan.price}\n` +
          `⏳ ᴠᴀʟɪᴅɪᴛʏ: ${v}\n` +
          `━━━━━━━━━━━━━━━━━\n\n` +
          `👤 ɴᴀᴍᴇ: ${upiName}\n` +
          `📱 UPI: ${upiId}\n\n` +
          `📋 sᴛᴇᴘs:\n` +
          `1️⃣ UPI ᴘᴇ ₹${plan.price} ʙʜᴇᴊᴏ\n` +
          `2️⃣ sᴄʀᴇᴇɴsʜᴏᴛ ʟᴏ\n` +
          `3️⃣ SUBMIT PROOF ᴅᴀʙᴀᴏ\n\n` +
          `⚠️ ᴠᴇʀɪꜰʏ ᴍᴇɪɴ 24ʜ ʟᴀɢ sᴀᴋᴛᴇ ʜᴀɪɴ`;

        const kb = { inline_keyboard:[
          [{ text:'📸 SUBMIT PROOF', callback_data:`proof_${planId}` }],
          [{ text:'🔙 BACK TO PLANS', callback_data:'buy_premium' }]
        ]};

        userState[userId] = { action:'awaiting_screenshot', planId };

        if (qrBuffer) {
          await bot.sendPhoto(chatId, qrBuffer, { caption, reply_markup: kb })
            .catch(e => console.error('❌ sendPhoto:', e.message));
        } else {
          await safeSend(chatId, caption, { reply_markup: kb });
        }
        return;
      }

      // ── SUBMIT PROOF
      if (data.startsWith('proof_')) {
        const planId = data.replace('proof_', '');
        userState[userId] = { action:'awaiting_screenshot', planId };
        await safeDelete(chatId, msgId);
        await safeSend(chatId,
          `📸 ᴘᴀʏᴍᴇɴᴛ sᴄʀᴇᴇɴsʜᴏᴛ ʙʜᴇᴊᴏ\n\n` +
          `✅ Payment ke baad screenshot yahan bhejo\n` +
          `⚠️ Sirf image/screenshot accept hoga`,
          { reply_markup:{ inline_keyboard:[[{ text:'❌ Cancel', callback_data:'back_home' }]] }}
        );
        return;
      }

      // ── MY PREMIUMS
      if (data === 'my_premiums') {
        await safeDelete(chatId, msgId);
        const user   = await User.findOne({ userId });
        const now    = new Date();
        const active = user?.activePlans?.filter(p => new Date(p.expiresAt) > now) || [];
        if (!active.length) {
          await safeSend(chatId,
            `💎 ᴍʏ ᴘʀᴇᴍɪᴜᴍs 🥵\n\n━━━━━━━━━━━━━━━━━\n` +
            `❌ ᴀᴀᴘᴋᴇ ᴘᴀᴀs ᴋᴏɪ ᴀᴄᴛɪᴠᴇ ᴘʀᴇᴍɪᴜᴍ ɴᴀʜɪ ʜᴀɪ!\n` +
            `━━━━━━━━━━━━━━━━━`,
            { reply_markup:{ inline_keyboard:[
              [{ text:'BUY PREMIUM 💦', callback_data:'buy_premium' }],
              [{ text:'🏠 Back Home',   callback_data:'back_home'   }]
            ]}}
          );
        } else {
          let text = `💎 ᴍʏ ᴘʀᴇᴍɪᴜᴍs 🥵\n\n━━━━━━━━━━━━━━━━━\n`;
          for (const p of active) {
            const exp = new Date(p.expiresAt).getFullYear() > 2090 ? 'LIFETIME' : new Date(p.expiresAt).toDateString();
            text += `✅ ${p.planName}\n⏳ Expires: ${exp}\n\n`;
          }
          text += `━━━━━━━━━━━━━━━━━`;
          await safeSend(chatId, text, { reply_markup:{ inline_keyboard:[[{ text:'🏠 Back Home', callback_data:'back_home' }]] }});
        }
        return;
      }

      // ── MY PROFILE
      if (data === 'my_profile') {
        await safeDelete(chatId, msgId);
        const user     = await User.findOne({ userId });
        const payments = await Payment.find({ userId });
        const approved = payments.filter(p => p.status === 'approved').length;
        const pending  = payments.filter(p => p.status === 'pending').length;
        const now      = new Date();
        const active   = user?.activePlans?.filter(p => new Date(p.expiresAt) > now) || [];
        const joined   = user?.joinedAt?.toISOString().replace('T',' ').substring(0,19) || 'N/A';

        await safeSend(chatId,
          `👤 ᴍʏ ᴘʀᴏꜰɪʟᴇ\n\n━━━━━━━━━━━━━━━━━\n` +
          `🙍 ɴᴀᴍᴇ: ${query.from.first_name||''} ${query.from.last_name||''}\n` +
          `📛 ᴜsᴇʀɴᴀᴍᴇ: @${query.from.username||'N/A'}\n` +
          `🆔 ID: ${userId}\n` +
          `📅 ᴊᴏɪɴᴇᴅ: ${joined}\n` +
          `━━━━━━━━━━━━━━━━━\n` +
          `💎 ᴘʀᴇᴍɪᴜᴍ: ${active.length > 0 ? '✅ ᴀᴄᴛɪᴠᴇ' : '❌ ɴᴏᴛ ᴀᴄᴛɪᴠᴇ'}\n` +
          `━━━━━━━━━━━━━━━━━\n` +
          `💳 ᴘᴀʏᴍᴇɴᴛ ʜɪsᴛᴏʀʏ:\n` +
          `   ✅ ᴀᴘᴘʀᴏᴠᴇᴅ: ${approved}\n` +
          `   ⏳ ᴘᴇɴᴅɪɴɢ:  ${pending}\n` +
          `   📊 ᴛᴏᴛᴀʟ:   ${payments.length}\n` +
          `━━━━━━━━━━━━━━━━━`,
          { reply_markup:{ inline_keyboard:[
            [{ text:'BUY PREMIUM 💦', callback_data:'buy_premium' }],
            [{ text:'🏠 Back Home',   callback_data:'back_home'   }]
          ]}}
        );
        return;
      }

      // ── VIEW DEMO
      if (data.startsWith('view_demo_')) {
        const idx   = parseInt(data.replace('view_demo_','')) || 0;
        const plans = await getPlans();
        const i     = Math.max(0, Math.min(idx, plans.length - 1));
        const plan  = plans[i];
        const v     = plan.days >= 999999 ? 'LIFETIME' : `${plan.days} DAYS`;
        const demo  = await getSetting('demo_channel', 'https://t.me/yourchannel');
        await safeDelete(chatId, msgId);
        await safeSend(chatId,
          `👀 ᴅᴇᴍᴏ: ${plan.name}\n\n━━━━━━━━━━━━━━━━━\n` +
          `💰 ᴘʀɪᴄᴇ: ₹${plan.price}\n⏳ ᴠᴀʟɪᴅɪᴛʏ: ${v}\n━━━━━━━━━━━━━━━━━`,
          { reply_markup:{ inline_keyboard:[
            [{ text:'👀 OPEN DEMO', url: demo }],
            [
              { text:'⬅️ Prev', callback_data:`view_demo_${i > 0 ? i-1 : plans.length-1}` },
              { text:`${i+1}/${plans.length}`, callback_data:'noop' },
              { text:'➡️ Next', callback_data:`view_demo_${(i+1) % plans.length}` }
            ],
            [{ text:'💎 Get Premium', callback_data:'buy_premium' }, { text:'🏠 Back Home', callback_data:'back_home' }]
          ]}}
        );
        return;
      }

      // ── BACK HOME
      if (data === 'back_home') {
        await safeDelete(chatId, msgId);
        if (isAdmin) return sendAdminMenu(chatId);
        return sendHome(chatId, firstName);
      }

      // ── NOOP
      if (data === 'noop') return;

      // ════════════════════════════════════════════════════
      //  ADMIN ONLY BEYOND THIS POINT
      // ════════════════════════════════════════════════════
      if (!isAdmin) return;

      // ── CHANGE PRICE
      if (data === 'admin_change_price') {
        const plans = await getPlans();
        const kb = plans.map(p => [{ text:`${p.name} — ₹${p.price}`, callback_data:`acp_${p.id}` }]);
        kb.push([{ text:'🔙 Back', callback_data:'admin_back' }]);
        await safeEdit(`💰 Kaun se plan ka price change karna hai?`, { chat_id:chatId, message_id:msgId, reply_markup:{ inline_keyboard:kb } });
        return;
      }

      if (data.startsWith('acp_')) {
        const planId = data.replace('acp_','');
        userState[userId] = { action:'admin_set_price', planId };
        await safeEdit(`💰 Naya price bhejo (only number, e.g. 99):`, {
          chat_id:chatId, message_id:msgId,
          reply_markup:{ inline_keyboard:[[{ text:'❌ Cancel', callback_data:'admin_back' }]] }
        });
        return;
      }

      // ── CHANGE UPI
      if (data === 'admin_change_upi') {
        const id   = await getSetting('upi_id', 'Sakib006@ybl');
        const name = await getSetting('upi_name', 'Sakib');
        userState[userId] = { action:'admin_set_upi' };
        await safeEdit(
          `💳 Current UPI:\nID: ${id}\nName: ${name}\n\nNew format:\nUPI_ID|NAME\nE.g: newupi@ybl|Rahul`,
          { chat_id:chatId, message_id:msgId, reply_markup:{ inline_keyboard:[[{ text:'❌ Cancel', callback_data:'admin_back' }]] }}
        );
        return;
      }

      // ── BROADCAST
      if (data === 'admin_broadcast') {
        userState[userId] = { action:'admin_broadcast' };
        await safeEdit(
          `📢 Broadcast message bhejo:\n✅ Text/Image/Video/GIF/Sticker sab support hai\n✅ Koi bhi font use karo`,
          { chat_id:chatId, message_id:msgId, reply_markup:{ inline_keyboard:[[{ text:'❌ Cancel', callback_data:'admin_back' }]] }}
        );
        return;
      }

      // ── CHECK USERS
      if (data === 'admin_check_users') {
        const total   = await User.countDocuments();
        const today   = new Date(); today.setHours(0,0,0,0);
        const todayN  = await User.countDocuments({ joinedAt:{ $gte:today } });
        const last24  = new Date(Date.now() - 86400000);
        const last24N = await User.countDocuments({ joinedAt:{ $gte:last24 } });
        await safeEdit(
          `👥 ᴜsᴇʀ sᴛᴀᴛs\n\n━━━━━━━━━━━━━━━━━\n` +
          `👤 Total Users: ${total}\n` +
          `📅 Today: ${todayN}\n` +
          `⏱️ Avg/Hour (24h): ${(last24N/24).toFixed(1)}\n` +
          `━━━━━━━━━━━━━━━━━`,
          { chat_id:chatId, message_id:msgId, reply_markup:{ inline_keyboard:[[{ text:'🔙 Back', callback_data:'admin_back' }]] }}
        );
        return;
      }

      // ── STATS
      if (data === 'admin_stats') {
        const t0      = Date.now();
        const total   = await User.countDocuments();
        const premium = await User.countDocuments({ isPremium:true });
        const payments= await Payment.countDocuments();
        const pending = await Payment.countDocuments({ status:'pending' });
        const speed   = Date.now() - t0;

        const agg = await User.aggregate([
          { $match:{ country:{ $exists:true, $ne:null, $ne:'' } } },
          { $group:{ _id:'$country', c:{ $sum:1 } } },
          { $sort:{ c:-1 } }, { $limit:3 }
        ]);
        const medals = ['🥇','🥈','🥉'];
        const top = agg.length
          ? agg.map((x,i) => `   ${medals[i]} ${x._id}: ${x.c} users`).join('\n')
          : '   📍 Data not available yet';

        await safeEdit(
          `📊 ʙᴏᴛ sᴛᴀᴛs\n\n━━━━━━━━━━━━━━━━━\n` +
          `⚡ Speed: ${speed}ms\n` +
          `👤 Total: ${total}\n💎 Premium: ${premium}\n` +
          `💳 Payments: ${payments}\n⏳ Pending: ${pending}\n` +
          `━━━━━━━━━━━━━━━━━\n🌍 Top Regions:\n${top}\n━━━━━━━━━━━━━━━━━`,
          { chat_id:chatId, message_id:msgId, reply_markup:{ inline_keyboard:[[{ text:'🔙 Back', callback_data:'admin_back' }]] }}
        );
        return;
      }

      // ── LINKS
      if (data === 'admin_links') {
        await safeEdit(`🔗 Links Management`, {
          chat_id:chatId, message_id:msgId,
          reply_markup:{ inline_keyboard:[
            [{ text:'🔗 Change Plans Link',   callback_data:'admin_plan_links'   }],
            [{ text:'📺 Change Demo Channel', callback_data:'admin_demo_channel' }],
            [{ text:'🔙 Back',                callback_data:'admin_back'         }]
          ]}
        });
        return;
      }

      if (data === 'admin_demo_channel') {
        const cur = await getSetting('demo_channel','Not set');
        userState[userId] = { action:'admin_set_demo' };
        await safeEdit(`📺 Current: ${cur}\n\nNaya link bhejo:`, {
          chat_id:chatId, message_id:msgId,
          reply_markup:{ inline_keyboard:[[{ text:'❌ Cancel', callback_data:'admin_back' }]] }
        });
        return;
      }

      if (data === 'admin_plan_links') {
        const plans = await getPlans();
        const kb = plans.map(p => [{ text:p.name, callback_data:`apl_${p.id}` }]);
        kb.push([{ text:'🔙 Back', callback_data:'admin_links' }]);
        await safeEdit(`🔗 Kaun se plan ki link set karni hai?`, {
          chat_id:chatId, message_id:msgId, reply_markup:{ inline_keyboard:kb }
        });
        return;
      }

      if (data.startsWith('apl_')) {
        const planId = data.replace('apl_','');
        userState[userId] = { action:'admin_set_link', planId };
        await safeEdit(`🔗 Is plan ki nai link bhejo:`, {
          chat_id:chatId, message_id:msgId,
          reply_markup:{ inline_keyboard:[[{ text:'❌ Cancel', callback_data:'admin_back' }]] }
        });
        return;
      }

      // ── APPROVE
      if (data.startsWith('approve_')) {
        const pid     = data.replace('approve_','');
        const payment = await Payment.findById(pid);
        if (!payment)                     { await safeAnswer(query.id,{ text:'❌ Not found!' }); return; }
        if (payment.status !== 'pending') { await safeAnswer(query.id,{ text:'⚠️ Already done!' }); return; }

        const plans = await getPlans();
        const plan  = plans.find(p => p.id === payment.planId);
        const exp   = plan && plan.days < 999999
          ? new Date(Date.now() + plan.days*86400000)
          : new Date('2099-12-31');

        await Payment.findByIdAndUpdate(pid, { status:'approved' });
        await User.findOneAndUpdate(
          { userId:payment.userId },
          { isPremium:true, $push:{ activePlans:{ planId:payment.planId, planName:payment.planName, expiresAt:exp, approvedAt:new Date() } } }
        );

        await safeEditCaption(
          `✅ APPROVED\n👤 ${payment.firstName} (@${payment.username})\n🆔 ${payment.userId}\n📦 ${payment.planName}\n💰 ₹${payment.amount}`,
          { chat_id:chatId, message_id:msgId }
        );

        const link = plan?.link || '⚠️ Link not set — set karo admin panel se';
        await safeSend(payment.userId,
          `🎉 ᴘᴀʏᴍᴇɴᴛ sᴜᴄᴄᴇssꜰᴜʟ!\n\n━━━━━━━━━━━━━━━━━\n` +
          `✅ ᴀᴘᴘʀᴏᴠᴇᴅ\n📦 ${payment.planName}\n🧾 ${payment.orderId}\n` +
          `━━━━━━━━━━━━━━━━━\n\n🔗 Access karo:\n${link}\n\n🙏 Thank you!`
        );
        console.log(`✅ Approved: ${payment.orderId}`);
        return;
      }

      // ── REJECT
      if (data.startsWith('reject_')) {
        const pid     = data.replace('reject_','');
        const payment = await Payment.findById(pid);
        if (!payment)                     { await safeAnswer(query.id,{ text:'❌ Not found!' }); return; }
        if (payment.status !== 'pending') { await safeAnswer(query.id,{ text:'⚠️ Already done!' }); return; }

        await Payment.findByIdAndUpdate(pid, { status:'rejected' });
        await safeEditCaption(
          `❌ REJECTED\n👤 ${payment.firstName} (@${payment.username})\n🆔 ${payment.userId}\n📦 ${payment.planName}\n💰 ₹${payment.amount}`,
          { chat_id:chatId, message_id:msgId }
        );
        await safeSend(payment.userId,
          `❌ ᴘᴀʏᴍᴇɴᴛ ʀᴇᴊᴇᴄᴛᴇᴅ\n\n━━━━━━━━━━━━━━━━━\n` +
          `📦 ${payment.planName}\n🧾 ${payment.orderId}\n━━━━━━━━━━━━━━━━━\n\n` +
          `⚠️ Proof reject hua. Dobara try karo ya admin se sampark karo.`,
          { reply_markup:{ inline_keyboard:[
            [{ text:'BUY PREMIUM 💦', callback_data:'buy_premium' }],
            [{ text:'🏠 Back Home',   callback_data:'back_home'   }]
          ]}}
        );
        console.log(`❌ Rejected: ${payment.orderId}`);
        return;
      }

      // ── ADMIN BACK
      if (data === 'admin_back') {
        await safeDelete(chatId, msgId);
        return sendAdminMenu(chatId);
      }

    } catch (e) {
      console.error(`❌ Callback [${data}] error:`, e.message);
    }
  });

  // MESSAGES
  bot.on('message', async (msg) => {
    if (msg.text?.startsWith('/')) return;
    const chatId  = msg.chat.id;
    const userId  = msg.from.id;
    const isAdmin = String(userId) === String(ADMIN_ID);
    const state   = userState[userId];
    if (!state) return;

    try {
      // ── SCREENSHOT
      if (state.action === 'awaiting_screenshot') {
        if (!msg.photo && !msg.document) {
          await safeSend(chatId, `⚠️ Sirf image/screenshot bhejo!`);
          return;
        }
        const plans  = await getPlans();
        const plan   = plans.find(p => p.id === state.planId);
        if (!plan) { delete userState[userId]; return; }

        const fileId  = msg.photo ? msg.photo[msg.photo.length-1].file_id : msg.document.file_id;
        const orderId = generateOrderId();

        const payment = await Payment.create({
          orderId, userId,
          username:  msg.from.username  || '',
          firstName: msg.from.first_name || '',
          planId:    plan.id,
          planName:  plan.name,
          amount:    plan.price,
          screenshotFileId: fileId,
          status: 'pending'
        });

        delete userState[userId];

        await safeSend(chatId,
          `✅ ᴘᴀʏᴍᴇɴᴛ ᴘʀᴏᴏꜰ sᴜʙᴍɪᴛ ʜᴏ ɢᴀʏᴀ.\n\n━━━━━━━━━━━━━━━━━\n` +
          `📦 ᴘʟᴀɴ: ${plan.name}\n🧾 ᴏʀᴅᴇʀ: ${orderId}\n⏳ sᴛᴀᴛᴜs: ᴘᴇɴᴅɪɴɢ\n━━━━━━━━━━━━━━━━━\n\nVerification ke baad access milega.`
        );

        try {
          const sent = await bot.sendPhoto(ADMIN_ID, fileId, {
            caption:
              `🔔 NEW PAYMENT\n━━━━━━━━━━━━━━━━━\n` +
              `👤 ${msg.from.first_name||''} ${msg.from.last_name||''}\n` +
              `📛 @${msg.from.username||'N/A'}\n🆔 ${userId}\n` +
              `━━━━━━━━━━━━━━━━━\n` +
              `📦 ${plan.name}\n💰 ₹${plan.price}\n🧾 ${orderId}\n━━━━━━━━━━━━━━━━━`,
            reply_markup:{ inline_keyboard:[[
              { text:'✅ APPROVE', callback_data:`approve_${payment._id}` },
              { text:'❌ REJECT',  callback_data:`reject_${payment._id}`  }
            ]]}
          });
          await Payment.findByIdAndUpdate(payment._id, { adminMsgId: sent.message_id });
          console.log(`📸 Proof sent to admin: ${orderId}`);
        } catch (e) {
          console.error('❌ Forward to admin failed:', e.message);
        }
        return;
      }

      if (!isAdmin) return;

      // ── ADMIN: SET PRICE
      if (state.action === 'admin_set_price') {
        const price = parseInt(msg.text);
        if (isNaN(price) || price <= 0) { await safeSend(chatId,`❌ Invalid! Sirf number bhejo.`); return; }
        const plans = await getPlans();
        const idx   = plans.findIndex(p => p.id === state.planId);
        if (idx === -1) { delete userState[userId]; return; }
        const old = plans[idx].price;
        plans[idx].price = price;
        await savePlans(plans);
        delete userState[userId];
        await safeSend(chatId,`✅ Price Updated!\n${plans[idx].name}\n₹${old} → ₹${price}`);
        return sendAdminMenu(chatId);
      }

      // ── ADMIN: SET UPI
      if (state.action === 'admin_set_upi') {
        const parts = (msg.text||'').split('|');
        if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) {
          await safeSend(chatId,`❌ Format: UPI_ID|NAME\nE.g: upi@ybl|Rahul`); return;
        }
        await setSetting('upi_id',   parts[0].trim());
        await setSetting('upi_name', parts[1].trim());
        delete userState[userId];
        await safeSend(chatId,`✅ UPI Updated!\n📱 ${parts[0].trim()}\n👤 ${parts[1].trim()}`);
        return sendAdminMenu(chatId);
      }

      // ── ADMIN: SET DEMO CHANNEL
      if (state.action === 'admin_set_demo') {
        const link = (msg.text||'').trim();
        if (!link.startsWith('http') && !link.startsWith('t.me')) {
          await safeSend(chatId,`❌ Valid link bhejo!`); return;
        }
        await setSetting('demo_channel', link);
        delete userState[userId];
        await safeSend(chatId,`✅ Demo Channel Updated!\n🔗 ${link}`);
        return sendAdminMenu(chatId);
      }

      // ── ADMIN: SET PLAN LINK
      if (state.action === 'admin_set_link') {
        const link = (msg.text||'').trim();
        if (!link.startsWith('http') && !link.startsWith('t.me')) {
          await safeSend(chatId,`❌ Valid link bhejo!`); return;
        }
        const plans = await getPlans();
        const idx   = plans.findIndex(p => p.id === state.planId);
        if (idx === -1) { delete userState[userId]; return; }
        plans[idx].link = link;
        await savePlans(plans);
        delete userState[userId];
        await safeSend(chatId,`✅ Link Updated!\n📦 ${plans[idx].name}\n🔗 ${link}`);
        return sendAdminMenu(chatId);
      }

      // ── ADMIN: BROADCAST
      if (state.action === 'admin_broadcast') {
        delete userState[userId];
        const users = await User.find({}, 'userId');
        const total = users.length;
        let ok = 0, fail = 0;

        const prog = await safeSend(chatId, `📢 Broadcasting to ${total} users...`);

        for (let i = 0; i < users.length; i++) {
          const uid = users[i].userId;
          try {
            if      (msg.photo)     await bot.sendPhoto(uid,     msg.photo[msg.photo.length-1].file_id, { caption: msg.caption||'' });
            else if (msg.video)     await bot.sendVideo(uid,     msg.video.file_id,     { caption: msg.caption||'' });
            else if (msg.document)  await bot.sendDocument(uid,  msg.document.file_id,  { caption: msg.caption||'' });
            else if (msg.animation) await bot.sendAnimation(uid, msg.animation.file_id, { caption: msg.caption||'' });
            else if (msg.sticker)   await bot.sendSticker(uid,   msg.sticker.file_id);
            else if (msg.text)      await bot.sendMessage(uid,   msg.text);
            ok++;
          } catch (e) {
            fail++;
            if (e.message?.includes('bot was blocked') || e.message?.includes('user is deactivated')) {
              await User.deleteOne({ userId: uid });
            }
          }
          await new Promise(r => setTimeout(r, 50)); // Anti-flood

          if (prog && (i+1) % 50 === 0) {
            await safeEdit(`📢 Broadcasting...\n✅ ${ok} ❌ ${fail} / 👥 ${total}\n⏳ ${i+1}/${total}`,
              { chat_id:chatId, message_id:prog.message_id }
            ).catch(()=>{});
          }
        }

        console.log(`📢 Broadcast done: ${ok} ok, ${fail} fail`);
        await safeSend(chatId,`✅ Broadcast Complete!\n✅ Success: ${ok}\n❌ Failed: ${fail}\n👥 Total: ${total}`);
        return sendAdminMenu(chatId);
      }

    } catch (e) {
      console.error('❌ Message handler error:', e.message);
    }
  });
}

// ─── GRACEFUL SHUTDOWN ────────────────────────────────────────────────────────
async function shutdown(sig) {
  console.log(`\n⚠️ ${sig} received. Shutting down...`);
  try {
    if (bot && isPolling) { await bot.stopPolling(); console.log('✅ Polling stopped'); }
    await mongoose.connection.close(); console.log('✅ MongoDB closed');
  } catch (e) { console.error('❌ Shutdown error:', e.message); }
  process.exit(0);
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('uncaughtException', (err) => {
  console.error('❌ UNCAUGHT EXCEPTION:', err.message);
  console.error(err.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ UNHANDLED REJECTION:', String(reason));
  process.exit(1);
});

// ─── MAIN ─────────────────────────────────────────────────────────────────────
(async () => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🤖 Premium Bot by @ZeroSpade');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  await connectMongo();
  await killExistingConnections();

  bot = new TelegramBot(BOT_TOKEN, {
    polling: {
      interval: 300,
      autoStart: true,
      params: { timeout: 10, allowed_updates: ['message','callback_query'] }
    }
  });

  isPolling = true;

  bot.on('polling_error', (err) => {
    const msg = err.message || '';
    if (msg.includes('409')) {
      console.error('❌ 409 Conflict! Another instance running. Stopping...');
      bot.stopPolling();
      isPolling = false;
      setTimeout(async () => {
        await killExistingConnections();
        bot.startPolling();
        isPolling = true;
        console.log('🔄 Polling restarted');
      }, 10000);
    } else if (msg.includes('ETIMEDOUT') || msg.includes('ECONNRESET')) {
      // Silent - auto retries
    } else {
      console.error('❌ Polling error:', msg.substring(0, 100));
    }
  });

  try {
    const me = await bot.getMe();
    console.log(`✅ Bot: @${me.username} (${me.id})`);
    console.log(`✅ Admin: ${ADMIN_ID}`);
    console.log('✅ Bot is LIVE!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  } catch (e) {
    console.error('❌ FATAL: Invalid BOT_TOKEN!', e.message);
    process.exit(1);
  }

  registerHandlers();
})();
