const TelegramBot = require('node-telegram-bot-api');
const { MongoClient } = require('mongodb');

// ==========================================
// CONFIGURATION & SETUP
// ==========================================
// Railway Environment Variables fetch karega, warna default use karega
const API_TOKEN = process.env.BOT_TOKEN || '8710207047:AAGd692mWcXeHDZJ4uNhkaWG1_vxYjdBv74';
const ADMIN_ID = process.env.ADMIN_ID || '8218080024';
const MONGO_URL = process.env.MONGO_URL; // Railway ka MongoDB URL

if (!MONGO_URL) {
    console.error("❌ ERROR: MONGO_URL nahi mili! Railway variables check karo.");
    process.exit(1);
}

// Bot Initialization (With forced stop for old instances)
const bot = new TelegramBot(API_TOKEN, { 
    polling: {
        params: { drop_pending_updates: true } // Purane atke hue messages ignore karega
    } 
});

console.log("✅ Bot is running...");

// ==========================================
// MONGODB DATABASE SETUP
// ==========================================
const client = new MongoClient(MONGO_URL);
let db, usersCol, configCol;

async function initDB() {
    await client.connect();
    db = client.db('telegramBotDB');
    usersCol = db.collection('users');
    configCol = db.collection('config');

    // Default Config Set Karna agar pehli baar chal raha ho
    let config = await configCol.findOne({ _id: 'main' });
    if (!config) {
        config = {
            _id: 'main',
            prices: { desi: 49, mother: 59, brother: 59, forced: 69, child: 79, all: 149 },
            links: { desi: '', mother: '', brother: '', forced: '', child: '', all: '' },
            upi: { id: 'paytm.admin@pty', name: 'ᴀᴅᴍɪɴ' },
            support: '@AdminSupport',
            stats: { starts: 0, approvals: 0, rejections: 0 },
            videos: { welcome: [], after_welcome: [], demo: [] }
        };
        await configCol.insertOne(config);
    }
    console.log("✅ MongoDB Connected!");
}
initDB();

// ==========================================
// UTILITIES & CONSTANTS
// ==========================================
const delay = ms => new Promise(res => setTimeout(res, ms));

const categories = {
    desi: 'ᴅᴇsɪ ᴘᴏʀɴ 720ᴘ',
    mother: 'ᴍᴏᴛʜᴇʀ sᴏɴ 720ᴘ',
    brother: 'ʙʀᴏᴛʜᴇʀ sɪsᴛᴇʀ 720ᴘ',
    forced: 'ꜰᴏʀᴄᴇᴅ ʀᴀᴘᴇ 720ᴘ',
    child: 'ᴄʜɪʟᴅ ᴘᴏʀɴ 720ᴘ',
    all: 'ᴀʟʟ ɪɴ ᴏɴᴇ 1444ᴘ'
};

async function sendCleanMsg(cid, txt, kb = null, mediaUrl = null, is_video = false) {
    let user = await usersCol.findOne({ id: cid });
    
    // Purana Message Delete
    if (user && user.last_msg_id) {
        try { await bot.deleteMessage(cid, user.last_msg_id); } catch(e) {}
    }
    
    let opts = { parse_mode: 'HTML' };
    if (kb) opts.reply_markup = kb; // Object hi pass karna hai node-telegram-bot-api mein
    
    let sentMsg;
    try {
        if (mediaUrl) {
            opts.caption = txt;
            if (is_video) sentMsg = await bot.sendVideo(cid, mediaUrl, opts);
            else sentMsg = await bot.sendPhoto(cid, mediaUrl, opts);
        } else {
            sentMsg = await bot.sendMessage(cid, txt, opts);
        }
        
        // Naya message ID save karo
        if (user && sentMsg) {
            user.last_msg_id = sentMsg.message_id;
            await usersCol.replaceOne({ id: cid }, user);
        }
        return sentMsg ? sentMsg.message_id : null;
    } catch (e) {
        console.error("Message Error:", e.message);
        return null;
    }
}

// ==========================================
// EVENT LISTENER: INCOMING MESSAGES
// ==========================================
bot.on('message', async (msg) => {
    if (!usersCol || !configCol) return; // Wait for DB to connect

    const chatId = msg.chat.id.toString();
    const fromId = msg.from.id.toString();
    const text = msg.text || '';
    const firstName = msg.from.first_name || 'ᴜsᴇʀ';
    const username = msg.from.username || 'ɴᴏᴜsᴇʀɴᴀᴍᴇ';
    const isAdmin = (fromId === ADMIN_ID);

    let config = await configCol.findOne({ _id: 'main' });
    let user = await usersCol.findOne({ id: fromId });

    // NEW USER REGISTRATION
    if (!user) {
        user = {
            id: fromId, name: firstName, username: username,
            joined: new Date().toISOString().replace(/T/, ' ').replace(/\..+/, ''),
            state: 'none', last_msg_id: null,
            history: { approved: 0, pending: 0, total: 0 },
            active_packs: []
        };
        await usersCol.insertOne(user);
        
        config.stats.starts++;
        await configCol.replaceOne({ _id: 'main' }, config);
        
        bot.sendMessage(ADMIN_ID, `📣 <b>ɴᴇᴡ ᴜsᴇʀ sᴛᴀʀᴛᴇᴅ ʙᴏᴛ</b>\nɴᴀᴍᴇ: <a href='tg://user?id=${fromId}'>${firstName}</a>\nɪᴅ: <code>${fromId}</code>`, { parse_mode: 'HTML' });
    }

    const u_state = user.state;

    // 1. PHOTO UPLOAD (SCREENSHOT) HANDLER
    if (msg.photo && u_state.startsWith('wait_screenshot_')) {
        const pack = u_state.replace('wait_screenshot_', '');
        const photoId = msg.photo[msg.photo.length - 1].file_id; // Highest resolution
        
        user.state = 'none';
        user.history.pending++;
        await usersCol.replaceOne({ id: fromId }, user);

        const admin_txt = `💳 <b>ɴᴇᴡ ᴘᴀʏᴍᴇɴᴛ ʀᴇǫᴜᴇsᴛ</b>\n\n👤 ɴᴀᴍᴇ: ${firstName}\n📛 ᴜsᴇʀɴᴀᴍᴇ: @${username}\n🆔 ɪᴅ: <code>${fromId}</code>\n📦 ᴘᴀᴄᴋ: <b>${categories[pack]}</b>`;
        const admin_kb = { inline_keyboard: [
            [{ text: '✅ ᴀᴘᴘʀᴏᴠᴇ', callback_data: `approve_${fromId}_${pack}` }, { text: '❌ ʀᴇᴊᴇᴄᴛ', callback_data: `reject_${fromId}_${pack}` }]
        ]};
        
        await bot.sendPhoto(ADMIN_ID, photoId, { caption: admin_txt, parse_mode: 'HTML', reply_markup: admin_kb });
        
        const confirm_txt = `⏳ ᴘᴀʏᴍᴇɴᴛ sᴇɴᴛ ꜰᴏʀ ᴀᴘᴘʀᴏᴠᴀʟ ᴛᴏ ᴀᴅᴍɪɴ\n\n📞 ᴄᴏɴᴛᴀᴄᴛ sᴜᴘᴘᴏʀᴛ: ${config.support}`;
        await sendCleanMsg(chatId, confirm_txt, { inline_keyboard: [[{ text: '⬅️ ʙᴀᴄᴋ ᴛᴏ ʜᴏᴍᴇ', callback_data: 'home' }]] }, "https://i.ibb.co/1YCk5tj8/x.jpg", false);
        return;
    }

    // 2. ADMIN TEXT INPUT HANDLERS
    if (isAdmin && text !== '' && !text.startsWith('/')) {
        if (text === '📊 sᴛᴀᴛs') {
            const userCount = await usersCol.countDocuments();
            const txt = `📊 <b>ʙᴏᴛ sᴛᴀᴛɪsᴛɪᴄs</b>\n\n👥 ᴛᴏᴛᴀʟ ᴜsᴇʀs: ${userCount}\n▶️ ᴛᴏᴛᴀʟ sᴛᴀʀᴛs: ${config.stats.starts}\n✅ ᴀᴘᴘʀᴏᴠᴇᴅ: ${config.stats.approvals}\n❌ ʀᴇᴊᴇᴄᴛᴇᴅ: ${config.stats.rejections}`;
            bot.sendMessage(chatId, txt, { parse_mode: 'HTML' });
            return;
        }
        else if (text === '👥 ᴜsᴇʀs') {
            const allUsers = await usersCol.find({}).toArray();
            let list = allUsers.map(u => ({ id: u.id, name: u.name, user: "@"+u.username }));
            for (let i = 0; i < list.length; i += 50) {
                const chunk = list.slice(i, i + 50);
                bot.sendMessage(chatId, `<pre>${JSON.stringify(chunk, null, 2)}</pre>`, { parse_mode: 'HTML' });
            }
            return;
        }
        else if (text === '💰 ᴘʀɪᴄᴇs') {
            let kb = { inline_keyboard: [] };
            for (const [k, n] of Object.entries(categories)) {
                kb.inline_keyboard.push([{ text: `${n} (₹${config.prices[k]})`, callback_data: `edit_price_${k}` }]);
            }
            bot.sendMessage(chatId, "💰 <b>ᴇᴅɪᴛ ᴘʀɪᴄᴇs</b>\nsᴇʟᴇᴄᴛ ᴄᴀᴛᴇɢᴏʀʏ:", { parse_mode: 'HTML', reply_markup: kb });
            return;
        }
        else if (text === '🔗 ʟɪɴᴋs') {
            let kb = { inline_keyboard: [] };
            for (const [k, n] of Object.entries(categories)) {
                kb.inline_keyboard.push([{ text: n, callback_data: `edit_link_${k}` }]);
            }
            bot.sendMessage(chatId, "🔗 <b>ᴇᴅɪᴛ ʟɪɴᴋs</b>\nsᴇʟᴇᴄᴛ ᴄᴀᴛᴇɢᴏʀʏ:", { parse_mode: 'HTML', reply_markup: kb });
            return;
        }
        else if (text === '💳 ᴜᴘɪ') {
            user.state = 'wait_upi_id'; await usersCol.replaceOne({ id: chatId }, user);
            bot.sendMessage(chatId, `💳 ᴄᴜʀʀᴇɴᴛ ᴜᴘɪ: <code>${config.upi.id}</code>\n\nsᴇɴᴅ ɴᴇᴡ <b>ᴜᴘɪ ɪᴅ</b>:`, { parse_mode: 'HTML' });
            return;
        }
        else if (text === '📞 sᴜᴘᴘᴏʀᴛ ɪᴅ') {
            user.state = 'wait_support'; await usersCol.replaceOne({ id: chatId }, user);
            bot.sendMessage(chatId, `📞 ᴄᴜʀʀᴇɴᴛ sᴜᴘᴘᴏʀᴛ: <code>${config.support}</code>\n\nsᴇɴᴅ ɴᴇᴡ <b>sᴜᴘᴘᴏʀᴛ ᴜsᴇʀɴᴀᴍᴇ</b> (@username):`, { parse_mode: 'HTML' });
            return;
        }
        else if (text === '📢 ʙʀᴏᴀᴅᴄᴀsᴛ') {
            user.state = 'wait_broadcast'; await usersCol.replaceOne({ id: chatId }, user);
            bot.sendMessage(chatId, "📢 sᴇɴᴅ ᴍᴇssᴀɢᴇ/ᴘʜᴏᴛᴏ/ᴠɪᴅᴇᴏ ᴛᴏ ʙʀᴏᴀᴅᴄᴀsᴛ:");
            return;
        }
        else if (text === '🎬 ᴠɪᴅᴇᴏs') {
            const kb = { inline_keyboard: [
                [{ text: '➕ ᴀᴅᴅ ᴡᴇʟᴄᴏᴍᴇ (1)', callback_data: 'add_vid_welcome' }, { text: '🗑 ʀᴇᴍ ᴡᴇʟᴄᴏᴍᴇ', callback_data: 'rem_vid_welcome' }],
                [{ text: '➕ ᴀᴅᴅ ᴀꜰᴛᴇʀ (3)', callback_data: 'add_vid_after' }, { text: '🗑 ʀᴇᴍ ᴀꜰᴛᴇʀ', callback_data: 'rem_vid_after' }],
                [{ text: '➕ ᴀᴅᴅ ᴅᴇᴍᴏs (8)', callback_data: 'add_vid_demo' }, { text: '🗑 ʀᴇᴍ ᴅᴇᴍᴏs', callback_data: 'rem_vid_demo' }]
            ]};
            bot.sendMessage(chatId, "🎬 <b>ᴠɪᴅᴇᴏ ᴍᴀɴᴀɢᴇʀ</b>", { parse_mode: 'HTML', reply_markup: kb });
            return;
        }

        // STATE PROCESSING
        if (u_state === 'wait_broadcast') {
            bot.sendMessage(ADMIN_ID, "⏳ ʙʀᴏᴀᴅᴄᴀsᴛ sᴛᴀʀᴛᴇᴅ...");
            const allUsers = await usersCol.find({}).toArray();
            let count = 0;
            for (const u of allUsers) {
                try {
                    await bot.sendMessage(u.id, text, { parse_mode: 'HTML' });
                    count++;
                } catch(e) {}
                await delay(35); // 35ms sleep limits flood
            }
            user.state = 'none'; await usersCol.replaceOne({ id: fromId }, user);
            bot.sendMessage(ADMIN_ID, `✅ ʙʀᴏᴀᴅᴄᴀsᴛ ᴄᴏᴍᴘʟᴇᴛᴇᴅ ᴛᴏ ${count} ᴜsᴇʀs!`);
            return;
        }
        else if (u_state === 'wait_support') {
            config.support = text; await configCol.replaceOne({ _id: 'main' }, config);
            user.state = 'none'; await usersCol.replaceOne({ id: fromId }, user);
            bot.sendMessage(ADMIN_ID, "✅ sᴜᴘᴘᴏʀᴛ ᴜsᴇʀɴᴀᴍᴇ ᴜᴘᴅᴀᴛᴇᴅ!");
            return;
        }
        else if (u_state.startsWith('wait_price_') && !isNaN(text)) {
            const pack = u_state.replace('wait_price_', '');
            config.prices[pack] = parseInt(text); await configCol.replaceOne({ _id: 'main' }, config);
            user.state = 'none'; await usersCol.replaceOne({ id: fromId }, user);
            bot.sendMessage(ADMIN_ID, `✅ ᴘʀɪᴄᴇ ᴜᴘᴅᴀᴛᴇᴅ ᴛᴏ ₹${text}!`);
            return;
        }
        else if (u_state.startsWith('wait_link_')) {
            const pack = u_state.replace('wait_link_', '');
            config.links[pack] = text; await configCol.replaceOne({ _id: 'main' }, config);
            user.state = 'none'; await usersCol.replaceOne({ id: fromId }, user);
            bot.sendMessage(ADMIN_ID, "✅ ʟɪɴᴋ ᴜᴘᴅᴀᴛᴇᴅ sᴜᴄᴄᴇssꜰᴜʟʟʏ!");
            return;
        }
        else if (u_state === 'wait_upi_id') {
            config.upi.id = text; await configCol.replaceOne({ _id: 'main' }, config);
            user.state = 'wait_upi_name'; await usersCol.replaceOne({ id: fromId }, user);
            bot.sendMessage(ADMIN_ID, "✅ ᴜᴘɪ ɪᴅ sᴀᴠᴇᴅ.\n\nsᴇɴᴅ ɴᴇᴡ <b>ᴜᴘɪ ɴᴀᴍᴇ</b>:", { parse_mode: 'HTML' });
            return;
        }
        else if (u_state === 'wait_upi_name') {
            config.upi.name = text; await configCol.replaceOne({ _id: 'main' }, config);
            user.state = 'none'; await usersCol.replaceOne({ id: fromId }, user);
            bot.sendMessage(ADMIN_ID, "✅ ᴜᴘɪ ᴘʀᴏꜰɪʟᴇ ᴄᴏᴍᴘʟᴇᴛᴇʟʏ ᴜᴘᴅᴀᴛᴇᴅ!");
            return;
        }
    }

    // 3. ADMIN VIDEO UPLOAD HANDLER
    if (isAdmin && msg.video && u_state.startsWith('wait_vid_')) {
        const type = u_state.replace('wait_vid_', '');
        const vid_id = msg.video.file_id;
        const limitMap = { welcome: 1, after: 3, demo: 8 };
        const limit = limitMap[type];
        const type_key = (type === 'after') ? 'after_welcome' : type;
        
        if (config.videos[type_key].length >= limit) {
            bot.sendMessage(ADMIN_ID, `⚠️ ʟɪᴍɪᴛ ʀᴇᴀᴄʜᴇᴅ ꜰᴏʀ ${type} (${limit}). ᴘʟᴇᴀsᴇ ʀᴇᴍᴏᴠᴇ ᴏʟᴅ ᴠɪᴅᴇᴏs ꜰɪʀsᴛ.`);
        } else {
            config.videos[type_key].push(vid_id); await configCol.replaceOne({ _id: 'main' }, config);
            user.state = 'none'; await usersCol.replaceOne({ id: fromId }, user);
            bot.sendMessage(ADMIN_ID, `✅ ᴠɪᴅᴇᴏ ᴀᴅᴅᴇᴅ ᴛᴏ ${type}! (${config.videos[type_key].length}/${limit})`);
        }
        return;
    }

    // 4. START COMMAND
    if (text === '/start' || text === '/admin') {
        user.state = 'none'; await usersCol.replaceOne({ id: fromId }, user);

        if (isAdmin) {
            const txt = "⚜️ <b>ᴡᴇʟᴄᴏᴍᴇ ᴀᴅᴍɪɴ ᴍᴀsᴛᴇʀ!</b>\n\nᴀᴀᴘᴋᴀ ᴍᴀsᴛᴇʀ ᴘᴀɴᴇʟ ʀᴇᴀᴅʏ ʜᴀɪ. ɴᴇᴇᴄʜᴇ ᴅɪʏᴇ ɢᴀʏᴇ ʙᴜᴛᴛᴏɴs sᴇ ʙᴏᴛ ᴄᴏɴᴛʀᴏʟ ᴋᴀʀᴇɪɴ:";
            const admin_keyboard = {
                keyboard: [
                    [{ text: '📊 sᴛᴀᴛs' }, { text: '👥 ᴜsᴇʀs' }],
                    [{ text: '💰 ᴘʀɪᴄᴇs' }, { text: '🔗 ʟɪɴᴋs' }],
                    [{ text: '💳 ᴜᴘɪ' }, { text: '📞 sᴜᴘᴘᴏʀᴛ ɪᴅ' }],
                    [{ text: '📢 ʙʀᴏᴀᴅᴄᴀsᴛ' }, { text: '🎬 ᴠɪᴅᴇᴏs' }]
                ],
                resize_keyboard: true,
                is_persistent: true
            };
            bot.sendMessage(chatId, txt, { parse_mode: 'HTML', reply_markup: admin_keyboard });
            return;
        } else {
            // Normal User
            const welcomeText = `👋 ʜᴇʟʟᴏ, <b>${firstName}</b>!\n\n⭐️ ᴡᴇʟᴄᴏᴍᴇ ᴛᴏ ᴘʀᴇᴍɪᴜᴍ ʙᴏᴛ\n\n━━━━━━━━━━━━━━━━━\n⚜️ ᴘʀᴇᴍɪᴜᴍ ᴘʀɪᴄᴇ: ₹49 - ₹149\n💳 ᴘʟᴀɴs: 6 ᴘʟᴀɴs ᴀᴠᴀɪʟᴀʙʟᴇ\n━━━━━━━━━━━━━━━━━\n\n🔒 ᴘʀᴇᴍɪᴜᴍ ᴄᴏɴᴛᴇɴᴛ ᴀᴄᴄᴇss ᴋᴀʀɴᴇ ᴋᴇ ʟɪʏᴇ ᴘʀᴇᴍɪᴜᴍ ʟᴏ!`;
            
            const kb = { inline_keyboard: [
                [{ text: '🛒 ʙᴜʏ ᴘʀᴇᴍɪᴜᴍ', callback_data: 'buy_premium' }],
                [{ text: '💎 ᴍʏ ᴘʀᴇᴍɪᴜᴍs 🥵', callback_data: 'my_premiums' }],
                [{ text: '👤 ᴍʏ ᴘʀᴏꜰɪʟᴇ', callback_data: 'my_profile' }],
                [{ text: '👀 ᴠɪᴇᴡ ᴅᴇᴍᴏ', callback_data: 'view_demo_0' }]
            ]};
            
            const vid = config.videos.welcome.length > 0 ? config.videos.welcome[0] : null;
            const sent_id = await sendCleanMsg(chatId, welcomeText, kb, vid, !!vid);
            
            if (config.videos.after_welcome.length > 0 && sent_id) {
                for (const v of config.videos.after_welcome) {
                    await bot.sendVideo(chatId, v, { reply_to_message_id: sent_id });
                }
            }
            return;
        }
    }
});

// ==========================================
// EVENT LISTENER: CALLBACK QUERIES
// ==========================================
bot.on('callback_query', async (query) => {
    bot.answerCallbackQuery(query.id); // Stops loading circle immediately

    const chatId = query.message.chat.id.toString();
    const fromId = query.from.id.toString();
    const data = query.data;
    const msgId = query.message.message_id;
    const firstName = query.from.first_name || 'ᴜsᴇʀ';
    const username = query.from.username || 'ɴᴏᴜsᴇʀɴᴀᴍᴇ';
    const isAdmin = (fromId === ADMIN_ID);

    let config = await configCol.findOne({ _id: 'main' });
    let user = await usersCol.findOne({ id: fromId });
    if (!user) return; // Failsafe

    // --- ADMIN CALLBACKS ---
    if (isAdmin) {
        if (data.startsWith('edit_price_')) {
            const pack = data.replace('edit_price_', '');
            user.state = `wait_price_${pack}`; await usersCol.replaceOne({ id: chatId }, user);
            bot.sendMessage(ADMIN_ID, `ᴇɴᴛᴇʀ ɴᴇᴡ ᴘʀɪᴄᴇ ꜰᴏʀ <b>${categories[pack]}</b> (ɴᴜᴍʙᴇʀs ᴏɴʟʏ):`, { parse_mode: 'HTML' });
            return;
        }
        else if (data.startsWith('edit_link_')) {
            const pack = data.replace('edit_link_', '');
            user.state = `wait_link_${pack}`; await usersCol.replaceOne({ id: chatId }, user);
            bot.sendMessage(ADMIN_ID, `sᴇɴᴅ ᴘʀɪᴠᴀᴛᴇ ʟɪɴᴋ ꜰᴏʀ <b>${categories[pack]}</b>:`, { parse_mode: 'HTML' });
            return;
        }
        else if (data.startsWith('add_vid_')) {
            const type = data.replace('add_vid_', '');
            user.state = `wait_vid_${type}`; await usersCol.replaceOne({ id: chatId }, user);
            bot.sendMessage(ADMIN_ID, `sᴇɴᴅ ᴠɪᴅᴇᴏ ꜰᴏʀ <b>${type}</b>:`);
            return;
        }
        else if (data.startsWith('rem_vid_')) {
            const type = data.replace('rem_vid_', '');
            const type_key = (type === 'after') ? 'after_welcome' : type;
            config.videos[type_key] = []; await configCol.replaceOne({ _id: 'main' }, config);
            bot.sendMessage(ADMIN_ID, `ᴄʟᴇᴀʀᴇᴅ ${type} ᴠɪᴅᴇᴏs!`);
            return;
        }
        
        // APPROVE / REJECT
        if (data.startsWith('approve_')) {
            const parts = data.split('_');
            const uid = parts[1], pack = parts[2];
            
            let targetUser = await usersCol.findOne({ id: uid });
            if (targetUser) {
                if (targetUser.history.pending > 0) targetUser.history.pending--;
                targetUser.history.approved++; targetUser.history.total++;
                if (!targetUser.active_packs.includes(pack)) targetUser.active_packs.push(pack);
                await usersCol.replaceOne({ id: uid }, targetUser);
            }
            
            config.stats.approvals++; await configCol.replaceOne({ _id: 'main' }, config);

            // Update Admin Message
            bot.editMessageCaption(`✅ ᴀᴘᴘʀᴏᴠᴇᴅ ꜰᴏʀ <code>${uid}</code> (${categories[pack]})`, { chat_id: ADMIN_ID, message_id: msgId, parse_mode: 'HTML' });
            
            // Send Success to User
            const txt = `✅ ᴘᴀʏᴍᴇɴᴛ sᴜᴄᴄᴇssꜰᴜʟ\n\n📦 ᴘʟᴀɴ: ${categories[pack]}\n💰 ᴘᴀɪᴅ: ₹${config.prices[pack]}\n\n👇 ᴄʟɪᴄᴋ ʟɪɴᴋ ʙᴇʟᴏᴡ ᴛᴏ ᴊᴏɪɴ`;
            const kb = { inline_keyboard: [[{ text: '🔗 ᴊᴏɪɴ ɴᴏᴡ', url: config.links[pack] }]] };
            await sendCleanMsg(uid, txt, kb, "https://i.ibb.co/7dh0gnf4/x.jpg", false);
            return;
        }
        else if (data.startsWith('reject_')) {
            const parts = data.split('_');
            const uid = parts[1], pack = parts[2];
            
            let targetUser = await usersCol.findOne({ id: uid });
            if (targetUser) {
                if (targetUser.history.pending > 0) targetUser.history.pending--;
                await usersCol.replaceOne({ id: uid }, targetUser);
            }
            
            config.stats.rejections++; await configCol.replaceOne({ _id: 'main' }, config);

            // Update Admin Message
            bot.editMessageCaption(`❌ ʀᴇᴊᴇᴄᴛᴇᴅ ꜰᴏʀ <code>${uid}</code>`, { chat_id: ADMIN_ID, message_id: msgId, parse_mode: 'HTML' });
            
            // Send Fail to User
            const txt = `❌ ᴘᴀʏᴍᴇɴᴛ ꜰᴀɪʟᴇᴅ\n\n⚠️ ʏᴏᴜʀ ᴘᴀʏᴍᴇɴᴛ ᴡᴀs ʀᴇᴊᴇᴄᴛᴇᴅ ʙʏ ᴀᴅᴍɪɴ.\n\n📞 ᴄᴏɴᴛᴀᴄᴛ sᴜᴘᴘᴏʀᴛ: ${config.support}`;
            const kb = { inline_keyboard: [[{ text: '⬅️ ʙᴀᴄᴋ ᴛᴏ ʜᴏᴍᴇ', callback_data: 'home' }]] };
            await sendCleanMsg(uid, txt, kb, "https://i.ibb.co/MkV55Kdk/x.jpg", false);
            return;
        }
    }

    // --- USER CALLBACKS ---
    if (data === 'home') {
        user.state = 'none'; await usersCol.replaceOne({ id: fromId }, user);
        const welcomeText = `👋 ʜᴇʟʟᴏ, <b>${firstName}</b>!\n\n⭐️ ᴡᴇʟᴄᴏᴍᴇ ᴛᴏ ᴘʀᴇᴍɪᴜᴍ ʙᴏᴛ\n\n━━━━━━━━━━━━━━━━━\n⚜️ ᴘʀᴇᴍɪᴜᴍ ᴘʀɪᴄᴇ: ₹49 - ₹149\n💳 ᴘʟᴀɴs: 6 ᴘʟᴀɴs ᴀᴠᴀɪʟᴀʙʟᴇ\n━━━━━━━━━━━━━━━━━\n\n🔒 ᴘʀᴇᴍɪᴜᴍ ᴄᴏɴᴛᴇɴᴛ ᴀᴄᴄᴇss ᴋᴀʀɴᴇ ᴋᴇ ʟɪʏᴇ ᴘʀᴇᴍɪᴜᴍ ʟᴏ!`;
        const kb = { inline_keyboard: [
            [{ text: '🛒 ʙᴜʏ ᴘʀᴇᴍɪᴜᴍ', callback_data: 'buy_premium' }],
            [{ text: '💎 ᴍʏ ᴘʀᴇᴍɪᴜᴍs 🥵', callback_data: 'my_premiums' }],
            [{ text: '👤 ᴍʏ ᴘʀᴏꜰɪʟᴇ', callback_data: 'my_profile' }],
            [{ text: '👀 ᴠɪᴇᴡ ᴅᴇᴍᴏ', callback_data: 'view_demo_0' }]
        ]};
        const vid = config.videos.welcome.length > 0 ? config.videos.welcome[0] : null;
        await sendCleanMsg(chatId, welcomeText, kb, vid, !!vid);
        return;
    }

    else if (data === 'buy_premium') {
        let txt = "⚜️ ᴘʀᴇᴍɪᴜᴍ ᴘʟᴀɴs\n\n━━━━━━━━━━━━━━━━━\n";
        for (const [key, name] of Object.entries(categories)) {
            txt += `🔘 <b>${name}</b>\n   💰 ᴘʀɪᴄᴇ: ₹${config.prices[key]}\n   ⏳ ᴠᴀʟɪᴅɪᴛʏ: 30 ᴅᴀʏs\n\n`;
        }
        txt += "━━━━━━━━━━━━━━━━━\n👈 sᴇʟᴇᴄᴛ ʏᴏᴜʀ ᴘʟᴀɴ ʙᴇʟᴏᴡ";

        let kb = { inline_keyboard: [] };
        for (const [key, name] of Object.entries(categories)) {
            kb.inline_keyboard.push([{ text: `${name} - ₹${config.prices[key]}`, callback_data: `pay_${key}` }]);
        }
        kb.inline_keyboard.push([{ text: '⬅️ ʙᴀᴄᴋ ᴛᴏ ʜᴏᴍᴇ', callback_data: 'home' }]);
        await sendCleanMsg(chatId, txt, kb);
        return;
    }

    else if (data.startsWith('pay_')) {
        const pack = data.replace('pay_', '');
        const price = config.prices[pack];
        const plan_name = categories[pack];
        const upi_id = config.upi.id;
        const upi_name = encodeURIComponent(config.upi.name);
        
        const upi_link = `upi://pay?pa=${upi_id}&pn=${upi_name}&am=${price}&cu=INR`;
        const qr_url = `https://quickchart.io/qr?size=300x300&text=${encodeURIComponent(upi_link)}`;

        const txt = `📲 ᴜᴘɪ ᴘᴀʏᴍᴇɴᴛ\n\n━━━━━━━━━━━━━━━━━\n📦 ᴘʟᴀɴ: <b>${plan_name}</b>\n💰 ᴀᴍᴏᴜɴᴛ: ₹${price}\n⏳ ᴠᴀʟɪᴅɪᴛʏ: 30 ᴅᴀʏs\n━━━━━━━━━━━━━━━━━\n\n👤 ɴᴀᴍᴇ: ${decodeURIComponent(upi_name)}\n📱 ᴜᴘɪ ɪᴅ: <code>${upi_id}</code>\n\n📋 sᴛᴇᴘs:\n1️⃣ ᴜᴘᴀʀ Qʀ ᴄᴏᴅᴇ sᴄᴀɴ ᴋᴀʀᴏ\n2️⃣ ₹${price} ᴀᴍᴏᴜɴᴛ ᴀᴜʀ ɴᴏᴛᴇ ᴀᴜᴛᴏ-ꜰɪʟʟ ʜᴏɢᴀ\n3️⃣ ᴘɪɴ ᴅᴀᴀʟᴋᴇ ᴘᴀʏᴍᴇɴᴛ ᴄᴏᴍᴘʟᴇᴛᴇ ᴋᴀʀᴏ\n4️⃣ sᴄʀᴇᴇɴsʜᴏᴛ ʟᴏ ᴀᴜʀ ᴘᴀʏᴍᴇɴᴛ ᴅᴏɴᴇ ✅ ᴅᴀʙᴀᴏ`;

        const kb = { inline_keyboard: [
            [{ text: '✅ ᴘᴀʏᴍᴇɴᴛ ᴅᴏɴᴇ', callback_data: `check_pay_${pack}` }],
            [{ text: '❌ ᴄᴀɴᴄᴇʟ', callback_data: 'buy_premium' }]
        ]};
        
        await sendCleanMsg(chatId, txt, kb, qr_url, false);
        return;
    }

    else if (data.startsWith('check_pay_')) {
        const pack = data.replace('check_pay_', '');
        user.state = `wait_screenshot_${pack}`; await usersCol.replaceOne({ id: fromId }, user);

        const txt = "📸 ᴘᴀʏᴍᴇɴᴛ sᴄʀᴇᴇɴsʜᴏᴛ ʙʜᴇᴊᴏ\n\n✅ ᴜᴘɪ ᴘᴀʏᴍᴇɴᴛ ᴋᴀʀɴᴇ ᴋᴇ ʙᴀᴀᴅ sᴄʀᴇᴇɴsʜᴏᴛ ʏᴀʜᴀɴ ʙʜᴇᴊᴏ.\n\n⚠️ sɪʀꜰ ɪᴍᴀɢᴇ/sᴄʀᴇᴇɴsʜᴏᴛ ᴀᴄᴄᴇᴘᴛ ʜᴏɢᴀ";
        await sendCleanMsg(chatId, txt, { inline_keyboard: [[{ text: '❌ ᴄᴀɴᴄᴇʟ', callback_data: 'buy_premium' }]] });
        return;
    }

    else if (data === 'my_profile') {
        const hist = user.history;
        const status = user.active_packs.length > 0 ? "✅ ᴀᴄᴛɪᴠᴇ" : "❌ ɴᴏᴛ ᴀᴄᴛɪᴠᴇ";
        const txt = `👤 ᴍʏ ᴘʀᴏꜰɪʟᴇ\n\n━━━━━━━━━━━━━━━━━\n🙍 ɴᴀᴍᴇ: ${firstName}\n📛 ᴜsᴇʀɴᴀᴍᴇ: @${username}\n🆔 ɪᴅ: <code>${fromId}</code>\n📅 ᴊᴏɪɴᴇᴅ: ${user.joined}\n━━━━━━━━━━━━━━━━━\n💎 ᴘʀᴇᴍɪᴜᴍ sᴛᴀᴛᴜs: ${status}\n━━━━━━━━━━━━━━━━━\n💳 ᴘᴀʏᴍᴇɴᴛ ʜɪsᴛᴏʀʏ:\n   ✅ ᴀᴘᴘʀᴏᴠᴇᴅ: ${hist.approved}\n   ⏳ ᴘᴇɴᴅɪɴɢ: ${hist.pending}\n   📊 ᴛᴏᴛᴀʟ: ${hist.total}\n━━━━━━━━━━━━━━━━━`;
        await sendCleanMsg(chatId, txt, { inline_keyboard: [[{ text: '⬅️ ʙᴀᴄᴋ ᴛᴏ ʜᴏᴍᴇ', callback_data: 'home' }]] });
        return;
    }

    else if (data === 'my_premiums') {
        const active = user.active_packs;
        if (active.length === 0) {
            const txt = "💎 ᴍʏ ᴘʀᴇᴍɪᴜᴍs 🥵\n\n━━━━━━━━━━━━━━━━━\n❌ ᴀᴀᴘᴋᴇ ᴘᴀᴀs ᴋᴏɪ ᴀᴄᴛɪᴠᴇ ᴘʀᴇᴍɪᴜᴍ ɴᴀʜɪ ʜᴀɪ!\n\nᴘʀᴇᴍɪᴜᴍ ʟᴇɴᴇ ᴋᴇ ʟɪʏᴇ ɢᴇᴛ ᴘʀᴇᴍɪᴜᴍ ʙᴜᴛᴛᴏɴ ᴅᴀʙᴀᴏ.\n━━━━━━━━━━━━━━━━━";
            const kb = { inline_keyboard: [[{ text: '🛒 ɢᴇᴛ ᴘʀᴇᴍɪᴜᴍ', callback_data: 'buy_premium' }], [{ text: '⬅️ ʙᴀᴄᴋ', callback_data: 'home' }]] };
            await sendCleanMsg(chatId, txt, kb);
        } else {
            let txt = "💎 ᴍʏ ᴘʀᴇᴍɪᴜᴍs 🥵\n\n━━━━━━━━━━━━━━━━━\n✅ ᴀᴄᴛɪᴠᴇ ᴘᴀᴄᴋs:\n\n";
            for (const p of active) txt += `⚜️ ${categories[p]}\n`;
            txt += "━━━━━━━━━━━━━━━━━";
            const kb = { inline_keyboard: [[{ text: '⬅️ ʙᴀᴄᴋ', callback_data: 'home' }]] };
            await sendCleanMsg(chatId, txt, kb);
        }
        return;
    }

    else if (data.startsWith('view_demo_')) {
        const index = parseInt(data.replace('view_demo_', ''));
        const demo_vids = config.videos.demo;
        
        if (demo_vids.length === 0) {
            await sendCleanMsg(chatId, "⚠️ ɴᴏ ᴅᴇᴍᴏs ᴀᴠᴀɪʟᴀʙʟᴇ ʏᴇᴛ. ᴄʜᴇᴄᴋ ʙᴀᴄᴋ ʟᴀᴛᴇʀ!", { inline_keyboard: [[{ text: '⬅️ ʙᴀᴄᴋ', callback_data: 'home' }]] });
            return;
        }
        
        let kb = { inline_keyboard: [] };
        let nav = [];
        if (index > 0) nav.push({ text: '⬅️ ᴘʀᴇᴠɪᴏᴜs', callback_data: `view_demo_${index - 1}` });
        if (index < demo_vids.length - 1) nav.push({ text: 'ɴᴇxᴛ ➡️', callback_data: `view_demo_${index + 1}` });
        if (nav.length > 0) kb.inline_keyboard.push(nav);
        kb.inline_keyboard.push([{ text: '🛒 ɢᴇᴛ ᴘʀᴇᴍɪᴜᴍ', callback_data: 'buy_premium' }]);
        kb.inline_keyboard.push([{ text: '⬅️ ʜᴏᴍᴇ', callback_data: 'home' }]);

        await sendCleanMsg(chatId, `👀 ᴠɪᴇᴡ ᴅᴇᴍᴏ ${index + 1}/${demo_vids.length}`, kb, demo_vids[index], true);
        return;
    }
});

// Error handling to prevent crashes
bot.on("polling_error", (err) => console.log("Polling Error:", err.message));
