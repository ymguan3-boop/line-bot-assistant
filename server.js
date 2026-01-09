require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const app = express();

// LINE Bot 設定
const config = {
    channelSecret: process.env.LINE_CHANNEL_SECRET,
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN
};

// MessagingApiClient
const client = new line.messagingApi.MessagingApiClient({
    channelAccessToken: config.channelAccessToken
});

// Email 設定 - 使用 SMTP
const createTransporter = () => {
    return nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: process.env.SMTP_PORT || 587,
        secure: false,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    });
};

// 資料檔案路徑
const DATA_DIR = path.join(__dirname, 'data');
const CONVERSATIONS_FILE = path.join(DATA_DIR, 'conversations.json');
const EVENTS_FILE = path.join(DATA_DIR, 'events.json');
const EXPENSES_FILE = path.join(DATA_DIR, 'expenses.json');
const ATTACHMENTS_DIR = path.join(__dirname, 'attachments');

// 確保目錄和檔案存在
function initializeDataFiles() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(ATTACHMENTS_DIR)) {
        fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });
    }

    if (!fs.existsSync(CONVERSATIONS_FILE)) {
        fs.writeFileSync(CONVERSATIONS_FILE, JSON.stringify([], null, 2));
    }
    if (!fs.existsSync(EVENTS_FILE)) {
        fs.writeFileSync(EVENTS_FILE, JSON.stringify([], null, 2));
    }
    if (!fs.existsSync(EXPENSES_FILE)) {
        fs.writeFileSync(EXPENSES_FILE, JSON.stringify([], null, 2));
    }
}

initializeDataFiles();

// 用戶狀態管理
const userStates = new Map();

// 讀取資料
function loadData(filename) {
    try {
        const data = fs.readFileSync(filename, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error('讀取資料失敗:', err);
        return [];
    }
}

// 儲存資料
function saveData(filename, data) {
    try {
        fs.writeFileSync(filename, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('儲存資料失敗:', err);
    }
}

// 健康檢查端點 (確保 Render 部署成功關鍵)
app.get('/', (req, res) => {
    res.status(200).send('LINE Bot is running! ✅');
});

app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString()
    });
});

// Webhook 路由
app.post('/webhook', line.middleware(config), (req, res) => {
    res.status(200).end();
    if (req.body.events && req.body.events.length > 0) {
        req.body.events.forEach(event => {
            handleEvent(event).catch(err => {
                console.error('處理事件時發生錯誤:', err);
            });
        });
    }
});

// --- (中間的 handleEvent, handleCommand 等函數維持不變，節省篇幅) ---
// ... 這裡請保留你原本程式碼中所有的 handleEvent, handleCommand, handleUserStateInput... 等邏輯 ...
// ... (直接跳到最後的啟動伺服器部分) ...

async function handleEvent(event) {
    // 你的原代碼處理邏輯...
}

// ... 這裡請補回你原本所有的處理函數 ...

// 啟動伺服器 (修正後的關鍵部分)
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server is running on port ${PORT} with host 0.0.0.0`);
    console.log(`📁 資料目錄: ${DATA_DIR}`);
    console.log(`📎 附件目錄: ${ATTACHMENTS_DIR}`);
});
