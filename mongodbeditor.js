const TelegramBot = require('node-telegram-bot-api');
const { MongoClient } = require('mongodb');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');

const BOT_TOKEN = "8895076785:AAGLd626qzY1GhRj4qwbogwPih730bM8ee8";
const ADMIN_CHAT_ID = 5291409360;

// Railway me MONGO_URI env variable se aayega
if (!process.env.MONGO_URL) {
    console.error("ERROR: MONGO_URI environment variable set nahi hai. Kripya Railway me ise add karein.");
    process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
let mongoClient = null;

// Admin ka state track karne ke liye in-memory storage
const adminState = {
    tempFilePath: null,
    selectedDb: null,
    selectedCollection: null,
    dbList: [],
    colList: []
};

// MongoDB Connection helper function
async function getMongoClient() {
    if (!mongoClient) {
        console.log("MongoDB se connect kar rahe hain...");
        mongoClient = new MongoClient(process.env.MONGO_URI);
        await mongoClient.connect();
        console.log("✅ MongoDB successfully connect ho gaya!");
    }
    return mongoClient;
}

// Temp file cleanup function memory leak rokne ke liye
async function cleanupState() {
    if (adminState.tempFilePath) {
        try {
            await fsp.unlink(adminState.tempFilePath);
            console.log(`🗑️ Temp file delete ho gayi: ${adminState.tempFilePath}`);
        } catch (error) {
            console.error("Temp file delete karne me error aaya:", error.message);
        }
        adminState.tempFilePath = null;
    }
    adminState.selectedDb = null;
    adminState.selectedCollection = null;
    adminState.dbList = [];
    adminState.colList = [];
}

// Access Control check
function checkAdmin(chatId) {
    return chatId === ADMIN_CHAT_ID;
}

// Global Message Handler - Unauthorized users ko block karne ke liye
bot.on('message', (msg) => {
    if (!checkAdmin(msg.chat.id)) {
        bot.sendMessage(msg.chat.id, "Access Denied").catch(() => {});
    }
});

// Command: /start
bot.onText(/\/start/, async (msg) => {
    if (!checkAdmin(msg.chat.id)) return;
    
    console.log("Admin ne /start command bheji.");
    await cleanupState(); // Purani koi state ho toh usko reset karein
    await bot.sendMessage(ADMIN_CHAT_ID, "📂 Send me a .json file to replace MongoDB data.");
});

// Document Handler (JSON Uploads)
bot.on('document', async (msg) => {
    if (!checkAdmin(msg.chat.id)) return;

    const doc = msg.document;
    
    // Check karein ki file strictly .json hi hai
    if (!doc.file_name || !doc.file_name.toLowerCase().endsWith('.json')) {
        console.log("Reject kiya: File .json format me nahi thi.");
        return bot.sendMessage(ADMIN_CHAT_ID, "❌ Format galat hai. Kripya sirf .json document upload karein.");
    }

    try {
        await cleanupState(); // Nayi file aane par purani remove karein
        const waitMsg = await bot.sendMessage(ADMIN_CHAT_ID, "📥 File download ho rahi hai...");
        
        // File download process
        const filePath = await bot.downloadFile(doc.file_id, os.tmpdir());
        adminState.tempFilePath = filePath;
        console.log(`✅ File successfully download hui temporary path par: ${filePath}`);

        bot.deleteMessage(ADMIN_CHAT_ID, waitMsg.message_id).catch(() => {});
        await showDatabases(ADMIN_CHAT_ID);
        
    } catch (error) {
        console.error("Telegram file download error:", error);
        bot.sendMessage(ADMIN_CHAT_ID, "❌ Telegram se download karne me error: " + error.message);
    }
});

// Databases fetch and display function
async function showDatabases(chatId) {
    try {
        const client = await getMongoClient();
        const adminDb = client.db().admin();
        const result = await adminDb.listDatabases();
        
        // Filter out local aur admin dbs if you want, par abhi sab show karenge
        adminState.dbList = result.databases.map(db => db.name);

        const keyboard = [];
        // Callback limit bypass karne ke liye index based routing use ki hai
        for (let i = 0; i < adminState.dbList.length; i += 2) {
            const row = [];
            row.push({ text: adminState.dbList[i], callback_data: `db_${i}` });
            if (adminState.dbList[i + 1]) {
                row.push({ text: adminState.dbList[i + 1], callback_data: `db_${i + 1}` });
            }
            keyboard.push(row);
        }

        await bot.sendMessage(chatId, "🗄 Database select karein:", {
            reply_markup: { inline_keyboard: keyboard }
        });
        console.log("Databases ki list admin ko bhej di gayi.");
    } catch (error) {
        console.error("DB Fetch Error:", error);
        bot.sendMessage(chatId, "❌ Database fetch fail ho gaya: " + error.message);
        await cleanupState();
    }
}

// Collections fetch and display function
async function showCollections(messageId, dbName) {
    try {
        const client = await getMongoClient();
        const db = client.db(dbName);
        const collections = await db.listCollections().toArray();
        adminState.colList = collections.map(c => c.name);

        if (adminState.colList.length === 0) {
            await bot.editMessageText(`🗄 Database: ${dbName}\n❌ Isme koi collection nahi mili.`, {
                chat_id: ADMIN_CHAT_ID,
                message_id: messageId
            });
            await cleanupState();
            return;
        }

        const keyboard = [];
        for (let i = 0; i < adminState.colList.length; i += 2) {
            const row = [];
            row.push({ text: adminState.colList[i], callback_data: `col_${i}` });
            if (adminState.colList[i + 1]) {
                row.push({ text: adminState.colList[i + 1], callback_data: `col_${i + 1}` });
            }
            keyboard.push(row);
        }

        await bot.editMessageText(`🗄 Database: ${dbName}\n📑 Ab Collection select karein:`, {
            chat_id: ADMIN_CHAT_ID,
            message_id: messageId,
            reply_markup: { inline_keyboard: keyboard }
        });
        console.log(`${dbName} ki collections admin ko bhej di gayi.`);
    } catch (error) {
        console.error("Collection fetch error:", error);
        bot.sendMessage(ADMIN_CHAT_ID, "❌ Collections fetch fail ho gaya: " + error.message);
        await cleanupState();
    }
}

// Replacement confirmation logic
async function sendConfirmation(messageId) {
    const text = `⚠️ Database: ${adminState.selectedDb}\n⚠️ Collection: ${adminState.selectedCollection}\n\nThis operation will permanently delete every document.`;
    const keyboard = [
        [{ text: "✅ Replace", callback_data: "confirm_yes" }],
        [{ text: "❌ Cancel", callback_data: "confirm_no" }]
    ];

    await bot.editMessageText(text, {
        chat_id: ADMIN_CHAT_ID,
        message_id: messageId,
        reply_markup: { inline_keyboard: keyboard }
    });
}

// Final execution function
async function executeReplacement(messageId) {
    if (!adminState.tempFilePath) {
        return bot.editMessageText("❌ Error: JSON file memory se gayab ho gayi hai. Kripya wapas upload karein.", {
            chat_id: ADMIN_CHAT_ID,
            message_id: messageId
        });
    }

    const startTime = Date.now();
    await bot.editMessageText("⏳ Data replace ho raha hai, kripya wait karein...", { 
        chat_id: ADMIN_CHAT_ID, 
        message_id: messageId 
    });

    try {
        const fileData = await fsp.readFile(adminState.tempFilePath, 'utf8');
        let jsonData;
        
        try {
            jsonData = JSON.parse(fileData);
        } catch (err) {
            throw new Error("Invalid JSON File. Kripya apna syntax check karein.");
        }

        if (!jsonData || (Array.isArray(jsonData) && jsonData.length === 0) || (Object.keys(jsonData).length === 0)) {
            throw new Error("Aapne empty JSON file di hai.");
        }

        const client = await getMongoClient();
        const collection = client.db(adminState.selectedDb).collection(adminState.selectedCollection);

        // Saare purane documents delete ho rahe hain
        const deleteResult = await collection.deleteMany({});
        const deletedCount = deleteResult.deletedCount;
        console.log(`Purane ${deletedCount} documents delete ho gaye.`);

        // Naye documents insert ho rahe hain (Array ya single Object detect karke)
        let insertedCount = 0;
        if (Array.isArray(jsonData)) {
            const insertResult = await collection.insertMany(jsonData);
            insertedCount = insertResult.insertedCount;
        } else if (typeof jsonData === 'object') {
            await collection.insertOne(jsonData);
            insertedCount = 1;
        } else {
            throw new Error("Aapki JSON file Object ya Array format me honi chahiye.");
        }

        const executionTime = ((Date.now() - startTime) / 1000).toFixed(2);

        const successMsg = `✅ Replace Completed\n\nDatabase: ${adminState.selectedDb}\nCollection: ${adminState.selectedCollection}\nDeleted Documents: ${deletedCount}\nInserted Documents: ${insertedCount}\nExecution Time: ${executionTime}s`;

        await bot.editMessageText(successMsg, {
            chat_id: ADMIN_CHAT_ID,
            message_id: messageId
        });
        
        console.log("✅ Data successfully replace ho gaya!");

    } catch (error) {
        console.error("Replacement Execution Error:", error);
        await bot.editMessageText(`❌ Replacement ke time error aaya:\n\n${error.message}`, {
            chat_id: ADMIN_CHAT_ID,
            message_id: messageId
        });
    } finally {
        await cleanupState();
    }
}

// Callback Query Handler (Buttons click handle karne ke liye)
bot.on('callback_query', async (query) => {
    const data = query.data;
    const messageId = query.message.message_id;

    if (!checkAdmin(query.message.chat.id)) {
        return bot.answerCallbackQuery(query.id, { text: "Access Denied", show_alert: true });
    }

    try {
        if (data.startsWith('db_')) {
            const index = parseInt(data.replace('db_', ''));
            adminState.selectedDb = adminState.dbList[index];
            await showCollections(messageId, adminState.selectedDb);
            bot.answerCallbackQuery(query.id);
            
        } else if (data.startsWith('col_')) {
            const index = parseInt(data.replace('col_', ''));
            adminState.selectedCollection = adminState.colList[index];
            await sendConfirmation(messageId);
            bot.answerCallbackQuery(query.id);
            
        } else if (data === 'confirm_yes') {
            bot.answerCallbackQuery(query.id);
            await executeReplacement(messageId);
            
        } else if (data === 'confirm_no') {
            bot.answerCallbackQuery(query.id);
            await bot.editMessageText("❌ Replacement cancel kar diya gaya hai.", {
                chat_id: ADMIN_CHAT_ID,
                message_id: messageId
            });
            await cleanupState();
        }
    } catch (error) {
        console.error("Callback query catch block error:", error);
        bot.sendMessage(ADMIN_CHAT_ID, "❌ System error: " + error.message);
    }
});

console.log("🤖 MongoDB Editor Bot strictly shuru ho gaya hai. Waiting for commands...");
