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

const client = new line.Client(config);

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
app.get('/', (req, res) => {
  res.status(200).send('LINE Bot is running! ✅');
});

app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    message: 'Server is healthy',
    timestamp: new Date().toISOString()
  });
});

// 健康檢查端點
app.get('/', (req, res) => {
  res.status(200).send('LINE Bot is running! ✅');
});

app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

// Webhook 路由 - 立即響應版本
app.post('/webhook', line.middleware(config), (req, res) => {
  // 立即回應 200 OK 給 LINE 平台
  res.status(200).end();
  
  // 異步處理所有事件,不阻塞響應
  if (req.body.events && req.body.events.length > 0) {
    req.body.events.forEach(event => {
      handleEvent(event).catch(err => {
        console.error('處理事件時發生錯誤:', err);
      });
    });
  }
});

// 處理事件
async function handleEvent(event) {
  // 只處理訊息和 postback 事件
  if (event.type !== 'message' && event.type !== 'postback') {
    return;
  }

  const userId = event.source.userId;
  const timestamp = new Date(event.timestamp);
  const timeString = timestamp.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
  
  // 取得用戶資訊
  let userName = 'Unknown User';
  try {
    const profile = await client.getProfile(userId);
    userName = profile.displayName;
  } catch (err) {
    console.error('無法取得用戶資訊:', err);
  }
  
  // 處理文字訊息
  if (event.type === 'message' && event.message.type === 'text') {
    const userMessage = event.message.text.trim();
    
    // 記錄對話
    const conversations = loadData(CONVERSATIONS_FILE);
    conversations.push({
      id: event.message.id,
      time: timeString,
      timestamp: timestamp.getTime(),
      user: userName,
      userId: userId,
      type: 'text',
      content: userMessage
    });
    saveData(CONVERSATIONS_FILE, conversations);
    
    // 檢查用戶狀態
    const userState = userStates.get(userId);
    
    if (userState) {
      await handleUserStateInput(event, userId, userName, userMessage, userState, timeString);
    } else {
      await handleCommand(event, userId, userName, userMessage, timeString);
    }
  }
  
  // 處理其他類型的訊息(圖片、影片等)
  if (event.type === 'message' && event.message.type !== 'text') {
    // 記錄非文字訊息
    const conversations = loadData(CONVERSATIONS_FILE);
    conversations.push({
      id: event.message.id,
      time: timeString,
      timestamp: timestamp.getTime(),
      user: userName,
      userId: userId,
      type: event.message.type,
      content: `[${event.message.type}]`
    });
    saveData(CONVERSATIONS_FILE, conversations);
  }
  
  // 處理 postback 事件
  if (event.type === 'postback') {
    const data = event.postback.data;
    // 你的 postback 處理邏輯
    console.log('Postback data:', data);
  }
}
  
  // 處理附件
  else if (event.type === 'message' && ['image', 'video', 'audio', 'file'].includes(event.message.type)) {
    const messageId = event.message.id;
    const fileType = event.message.type;
    
    // 下載附件
    const filename = await downloadAndSaveAttachment(messageId, fileType, userName, timestamp);
    
    // 記錄附件
    const conversations = loadData(CONVERSATIONS_FILE);
    conversations.push({
      id: messageId,
      time: timeString,
      timestamp: timestamp.getTime(),
      user: userName,
      userId: userId,
      type: fileType,
      filename: filename
    });
    saveData(CONVERSATIONS_FILE, conversations);

    // 回應用戶
    await client.replyMessage(event.replyToken, {
      type: 'text',
      text: `✅ 已收到您的${getFileTypeName(fileType)}: ${filename}`
    });
  }
}

// 處理指令
async function handleCommand(event, userId, userName, userMessage, timeString) {
  const lowerMessage = userMessage.toLowerCase();
  let replyText = '';

  // 行程管理
  if (userMessage.includes('新增行程') || userMessage.includes('記錄行程')) {
    userStates.set(userId, { action: 'add_event', step: 1, data: {} });
    replyText = '📅 請輸入行程標題:';
    
  } else if (userMessage.includes('查詢行程')) {
    userStates.set(userId, { action: 'query_events', step: 1 });
    replyText = '請輸入查詢日期區間:\n\n格式: YYYY/MM/DD - YYYY/MM/DD\n例如: 2026/01/01 - 2026/01/31\n\n或直接輸入「本月」查詢本月行程';
    
  } else if (userMessage.includes('所有行程')) {
    replyText = getAllEvents();

  // 花費管理
  } else if (userMessage.includes('記帳') || userMessage.includes('記錄花費')) {
    userStates.set(userId, { action: 'add_expense', step: 1, data: {} });
    replyText = '💰 請輸入消費項目\n例如: 午餐';
    
  } else if (userMessage.includes('查詢花費') || userMessage.includes('花費查詢')) {
    userStates.set(userId, { action: 'query_expenses', step: 1 });
    replyText = '請選擇查詢方式:\n\n1. 本月花費\n2. 本週花費\n3. 今日花費\n4. 自訂日期區間\n\n請輸入數字 1-4';
    
  } else if (userMessage.includes('花費統計')) {
    replyText = getExpenseStats('month');

  // 對話轉寄 - 新增輸入 email 功能
  } else if (userMessage.includes('轉寄對話') || userMessage.includes('轉寄')) {
    userStates.set(userId, { action: 'send_email', step: 1 });
    replyText = '📧 請輸入收件者 Email:\n例如: example@gmail.com';

  // 功能選單
  } else if (userMessage.includes('功能') || userMessage.includes('幫助') || lowerMessage === 'help' || userMessage === '?') {
    replyText = `📋 功能選單\n\n` +
      `📅 行程管理:\n` +
      `• 新增行程 - 記錄重大行程\n` +
      `• 查詢行程 - 查詢特定日期區間\n` +
      `• 所有行程 - 查看所有行程\n\n` +
      `💰 花費管理:\n` +
      `• 記帳 - 記錄花費\n` +
      `• 查詢花費 - 查詢花費明細\n` +
      `• 花費統計 - 查看分類統計\n\n` +
      `📧 其他功能:\n` +
      `• 轉寄對話 - 寄送對話紀錄\n` +
      `• 取消 - 取消目前操作\n` +
      `• 功能 - 顯示此選單`;

  // 一般對話
  } else {
    replyText = generateAutoReply(userMessage);
  }

  // 回應用戶
  await client.replyMessage(event.replyToken, {
    type: 'text',
    text: replyText
  });

  // 記錄 Bot 回應
  const conversations = loadData(CONVERSATIONS_FILE);
  conversations.push({
    time: new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }),
    timestamp: Date.now(),
    user: 'Bot',
    userId: 'bot',
    type: 'text',
    content: replyText
  });
  saveData(CONVERSATIONS_FILE, conversations);
}

// 處理流程中的輸入
async function handleUserStateInput(event, userId, userName, userMessage, userState, timeString) {
  let replyText = '';

  if (userMessage === '取消') {
    userStates.delete(userId);
    replyText = '❌ 操作已取消';
  } else if (userState.action === 'add_event') {
    replyText = await handleAddEventFlow(userId, userName, userMessage, userState);
  } else if (userState.action === 'query_events') {
    replyText = await handleQueryEventsFlow(userId, userMessage, userState);
  } else if (userState.action === 'add_expense') {
    replyText = await handleAddExpenseFlow(userId, userName, userMessage, userState);
  } else if (userState.action === 'query_expenses') {
    replyText = await handleQueryExpensesFlow(userId, userMessage, userState);
  } else if (userState.action === 'send_email') {
    replyText = await handleSendEmailFlow(userId, userMessage, userState);
  }

  // 回應用戶
  await client.replyMessage(event.replyToken, {
    type: 'text',
    text: replyText
  });

  // 記錄 Bot 回應
  const conversations = loadData(CONVERSATIONS_FILE);
  conversations.push({
    time: new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }),
    timestamp: Date.now(),
    user: 'Bot',
    userId: 'bot',
    type: 'text',
    content: replyText
  });
  saveData(CONVERSATIONS_FILE, conversations);
}

// 郵件轉寄流程
async function handleSendEmailFlow(userId, userMessage, userState) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  
  if (!emailRegex.test(userMessage)) {
    return '❌ Email 格式不正確，請重新輸入\n例如: example@gmail.com\n\n或輸入「取消」取消操作';
  }
  
  try {
    await sendEmailSummary(userMessage);
    userStates.delete(userId);
    return `✅ 對話紀錄已成功寄送到:\n${userMessage}\n\n請檢查您的信箱(包含垃圾郵件匣)`;
  } catch (err) {
    userStates.delete(userId);
    return `❌ 郵件發送失敗: ${err.message}\n\n請確認:\n1. Email 地址正確\n2. SMTP 設定正確\n3. 網路連線正常`;
  }
}

// 行程管理流程
async function handleAddEventFlow(userId, userName, userMessage, userState) {
  if (userState.step === 1) {
    userState.data.title = userMessage;
    userState.step = 2;
    userStates.set(userId, userState);
    return '📅 請輸入日期\n格式: YYYY/MM/DD\n例如: 2026/01/15';
    
  } else if (userState.step === 2) {
    const dateMatch = userMessage.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
    if (!dateMatch) {
      return '❌ 日期格式錯誤,請重新輸入\n格式: YYYY/MM/DD';
    }
    userState.data.date = userMessage;
    userState.step = 3;
    userStates.set(userId, userState);
    return '📝 請輸入行程描述或備註\n(可選,直接輸入「略過」跳過)';
    
  } else if (userState.step === 3) {
    const description = userMessage === '略過' ? '' : userMessage;
    
    const events = loadData(EVENTS_FILE);
    const newEvent = {
      id: Date.now(),
      user: userName,
      userId: userId,
      title: userState.data.title,
      date: userState.data.date,
      description: description,
      createdAt: new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })
    };
    events.push(newEvent);
    saveData(EVENTS_FILE, events);
    
    userStates.delete(userId);
    return `✅ 行程已新增!\n\n` +
      `📌 ${newEvent.title}\n` +
      `📅 ${newEvent.date}\n` +
      (description ? `📝 ${description}\n` : '') +
      `\n輸入「查詢行程」可查看所有行程`;
  }
}

async function handleQueryEventsFlow(userId, userMessage, userState) {
  let startDate, endDate;
  
  if (userMessage === '本月') {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    startDate = `${year}/${month.toString().padStart(2, '0')}/01`;
    const lastDay = new Date(year, month, 0).getDate();
    endDate = `${year}/${month.toString().padStart(2, '0')}/${lastDay}`;
  } else {
    const rangeMatch = userMessage.match(/(\d{4}[/-]\d{1,2}[/-]\d{1,2})\s*-\s*(\d{4}[/-]\d{1,2}[/-]\d{1,2})/);
    if (!rangeMatch) {
      return '❌ 格式錯誤,請重新輸入\n格式: YYYY/MM/DD - YYYY/MM/DD\n或輸入「本月」';
    }
    startDate = rangeMatch[1];
    endDate = rangeMatch[2];
  }
  
  userStates.delete(userId);
  return queryEventsByDateRange(startDate, endDate);
}

function queryEventsByDateRange(startDate, endDate) {
  const events = loadData(EVENTS_FILE);
  
  const start = new Date(startDate.replace(/\//g, '-'));
  const end = new Date(endDate.replace(/\//g, '-'));
  
  const filteredEvents = events.filter(event => {
    const eventDate = new Date(event.date.replace(/\//g, '-'));
    return eventDate >= start && eventDate <= end;
  });
  
  if (filteredEvents.length === 0) {
    return `📅 查詢期間: ${startDate} ~ ${endDate}\n\n目前沒有行程紀錄`;
  }
  
  filteredEvents.sort((a, b) => {
    const dateA = new Date(a.date.replace(/\//g, '-'));
    const dateB = new Date(b.date.replace(/\//g, '-'));
    return dateA - dateB;
  });
  
  let message = `📅 查詢期間: ${startDate} ~ ${endDate}\n`;
  message += `\n共 ${filteredEvents.length} 個行程:\n\n`;
  
  filteredEvents.forEach((event, index) => {
    message += `${index + 1}. ${event.title}\n`;
    message += `   📅 ${event.date}\n`;
    if (event.description) {
      message += `   📝 ${event.description}\n`;
    }
    message += '\n';
  });
  
  return message.trim();
}

function getAllEvents() {
  const events = loadData(EVENTS_FILE);
  
  if (events.length === 0) {
    return '📅 目前沒有行程紀錄';
  }
  
  events.sort((a, b) => {
    const dateA = new Date(a.date.replace(/\//g, '-'));
    const dateB = new Date(b.date.replace(/\//g, '-'));
    return dateB - dateA;
  });
  
  let message = `📅 所有行程 (共 ${events.length} 個):\n\n`;
  
  events.forEach((event, index) => {
    message += `${index + 1}. ${event.title}\n`;
    message += `   📅 ${event.date}\n`;
    if (event.description) {
      message += `   📝 ${event.description}\n`;
    }
    message += '\n';
  });
  
  return message.trim();
}

// 花費管理流程
async function handleAddExpenseFlow(userId, userName, userMessage, userState) {
  if (userState.step === 1) {
    userState.data.item = userMessage;
    userState.step = 2;
    userStates.set(userId, userState);
    return '💰 請輸入金額\n例如: 150';
    
  } else if (userState.step === 2) {
    const amount = parseFloat(userMessage);
    if (isNaN(amount) || amount <= 0) {
      return '❌ 請輸入有效的金額(數字)';
    }
    userState.data.amount = amount;
    userState.step = 3;
    userStates.set(userId, userState);
    return '📂 請選擇類別:\n\n1. 飲食\n2. 交通\n3. 娛樂\n4. 購物\n5. 生活\n6. 其他\n\n請輸入數字 1-6';
    
  } else if (userState.step === 3) {
    const categories = ['飲食', '交通', '娛樂', '購物', '生活', '其他'];
    const categoryIndex = parseInt(userMessage) - 1;
    
    if (categoryIndex < 0 || categoryIndex >= categories.length) {
      return '❌ 請輸入有效的類別編號(1-6)';
    }
    
    const category = categories[categoryIndex];
    
    const expenses = loadData(EXPENSES_FILE);
    const newExpense = {
      id: Date.now(),
      user: userName,
      userId: userId,
      item: userState.data.item,
      amount: userState.data.amount,
      category: category,
      date: new Date().toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' }),
      datetime: new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })
    };
    expenses.push(newExpense);
    saveData(EXPENSES_FILE, expenses);
    
    userStates.delete(userId);
    return `✅ 花費已記錄!\n\n` +
      `📝 ${newExpense.item}\n` +
      `💰 NT$ ${newExpense.amount.toLocaleString()}\n` +
      `📂 ${newExpense.category}\n` +
      `📅 ${newExpense.datetime}\n` +
      `\n輸入「查詢花費」可查看明細`;
  }
}

async function handleQueryExpensesFlow(userId, userMessage, userState) {
  const choice = parseInt(userMessage);
  let result = '';
  
  if (choice === 1) {
    result = getExpensesByPeriod('month');
    userStates.delete(userId);
  } else if (choice === 2) {
    result = getExpensesByPeriod('week');
    userStates.delete(userId);
  } else if (choice === 3) {
    result = getExpensesByPeriod('today');
    userStates.delete(userId);
  } else if (choice === 4) {
    userState.step = 2;
    userStates.set(userId, userState);
    return '請輸入查詢日期區間:\n\n格式: YYYY/MM/DD - YYYY/MM/DD\n例如: 2026/01/01 - 2026/01/31';
  } else {
    return '❌ 請輸入有效的選項(1-4)';
  }
  
  return result;
}

function getExpensesByPeriod(period) {
  const expenses = loadData(EXPENSES_FILE);
  const now = new Date();
  
  let startDate, endDate, periodName;
  
  if (period === 'today') {
    const today = now.toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' });
    startDate = endDate = today;
    periodName = '今日';
  } else if (period === 'week') {
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    startDate = weekStart.toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' });
    endDate = weekEnd.toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' });
    periodName = '本週';
  } else if (period === 'month') {
    const year = now.getFullYear();
    const month = now.getMonth();
    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month + 1, 0);
    startDate = monthStart.toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' });
    endDate = monthEnd.toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' });
    periodName = '本月';
  }
  
  const filtered = expenses.filter(expense => {
    const expenseDate = expense.date;
    return expenseDate >= startDate && expenseDate <= endDate;
  });
  
  if (filtered.length === 0) {
    return `💰 ${periodName}花費查詢\n\n目前沒有花費紀錄`;
  }
  
  let total = 0;
  let message = `💰 ${periodName}花費明細\n\n`;
  
  filtered.forEach((expense, index) => {
    message += `${index + 1}. ${expense.item}\n`;
    message += `   💵 NT$ ${expense.amount.toLocaleString()}\n`;
    message += `   📂 ${expense.category}\n`;
    message += `   📅 ${expense.datetime}\n\n`;
    total += expense.amount;
  });
  
  message += `───────────────\n`;
  message += `📊 共 ${filtered.length} 筆\n`;
  message += `💰 總計: NT$ ${total.toLocaleString()}`;
  
  return message;
}

function getExpenseStats(period) {
  const expenses = loadData(EXPENSES_FILE);
  const now = new Date();
  
  let startDate, endDate, periodName;
  
  if (period === 'month') {
    const year = now.getFullYear();
    const month = now.getMonth();
    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month + 1, 0);
    startDate = monthStart.toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' });
    endDate = monthEnd.toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' });
    periodName = '本月';
  }
  
  const filtered = expenses.filter(expense => {
    const expenseDate = expense.date;
    return expenseDate >= startDate && expenseDate <= endDate;
  });
  
  if (filtered.length === 0) {
    return `📊 ${periodName}花費統計\n\n目前沒有花費紀錄`;
  }
  
  const categoryTotals = {};
  let total = 0;
  
  filtered.forEach(expense => {
    const category = expense.category;
    if (!categoryTotals[category]) {
      categoryTotals[category] = 0;
    }
    categoryTotals[category] += expense.amount;
    total += expense.amount;
  });
  
  let message = `📊 ${periodName}花費統計\n\n`;
  
  const sortedCategories = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]);
  
  sortedCategories.forEach(([category, amount]) => {
    const percentage = ((amount / total) * 100).toFixed(1);
    message += `${category}: NT$ ${amount.toLocaleString()} (${percentage}%)\n`;
  });
  
  message += `\n───────────────\n`;
  message += `💰 總計: NT$ ${total.toLocaleString()}\n`;
  message += `📝 筆數: ${filtered.length} 筆\n`;
  message += `📈 平均: NT$ ${Math.round(total / filtered.length).toLocaleString()}`;
  
  return message;
}

// 附件處理
async function downloadAndSaveAttachment(messageId, fileType, userName, timestamp) {
  try {
    const stream = await client.getMessageContent(messageId);
    const chunks = [];
    
    return new Promise((resolve, reject) => {
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const ext = getFileExtension(fileType);
        const dateStr = timestamp.toISOString().slice(0, 10).replace(/-/g, '');
        const filename = `${dateStr}_${userName}_${messageId}.${ext}`;
        const filepath = path.join(ATTACHMENTS_DIR, filename);
        
        fs.writeFileSync(filepath, buffer);
        console.log(`附件已儲存: ${filename}`);
        resolve(filename);
      });
      stream.on('error', reject);
    });
  } catch (err) {
    console.error('下載附件失敗:', err);
    return `attachment_${messageId}`;
  }
}

function getFileExtension(fileType) {
  const extensions = {
    image: 'jpg',
    video: 'mp4',
    audio: 'm4a',
    file: 'file'
  };
  return extensions[fileType] || 'dat';
}

function getFileTypeName(fileType) {
  const names = {
    image: '圖片',
    video: '影片',
    audio: '語音',
    file: '檔案'
  };
  return names[fileType] || '附件';
}

// 郵件轉寄
async function sendEmailSummary(recipientEmail) {
  const conversations = loadData(CONVERSATIONS_FILE);
  
  let emailContent = '<html><head><meta charset="UTF-8"></head><body>';
  emailContent += '<h2>📱 LINE 對話紀錄</h2>';
  emailContent += `<p><strong>匯出時間:</strong> ${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}</p>`;
  emailContent += '<hr>';
  
  emailContent += '<h3>💬 對話內容</h3>';
  emailContent += '<table border="1" cellpadding="8" style="border-collapse: collapse; width: 100%; font-family: Arial, sans-serif;">';
  emailContent += '<tr style="background-color: #4CAF50; color: white;"><th>時間</th><th>用戶</th><th>類型</th><th>內容</th></tr>';
  
  conversations.forEach((log, index) => {
    let content = log.content || '';
    if (log.type !== 'text') {
      content = `[${getFileTypeName(log.type)}] ${log.filename || ''}`;
    }
    
    const bgColor = index % 2 === 0 ? '#f9f9f9' : 'white';
    
    emailContent += `<tr style="background-color: ${bgColor};">
      <td>${log.time}</td>
      <td>${log.user}</td>
      <td>${log.type}</td>
      <td>${content}</td>
    </tr>`;
  });

  emailContent += '</table>';
  
  const events = loadData(EVENTS_FILE);
  if (events.length > 0) {
    emailContent += '<br><h3>📅 行程紀錄</h3>';
    emailContent += '<table border="1" cellpadding="8" style="border-collapse: collapse; width: 100%; font-family: Arial, sans-serif;">';
    emailContent += '<tr style="background-color: #2196F3; color: white;"><th>標題</th><th>日期</th><th>描述</th><th>建立時間</th></tr>';
    events.forEach((event, index) => {
      const bgColor = index % 2 === 0 ? '#f9f9f9' : 'white';
      emailContent += `<tr style="background-color: ${bgColor};">
        <td>${event.title}</td>
        <td>${event.date}</td>
        <td>${event.description || '-'}</td>
        <td>${event.createdAt}</td>
      </tr>`;
    });
    emailContent += '</table>';
  }
  
  const expenses = loadData(EXPENSES_FILE);
  if (expenses.length > 0) {
    emailContent += '<br><h3>💰 花費紀錄</h3>';
    emailContent += '<table border="1" cellpadding="8" style="border-collapse: collapse; width: 100%; font-family: Arial, sans-serif;">';
    emailContent += '<tr style="background-color: #FF9800; color: white;"><th>項目</th><th>金額</th><th>類別</th><th>日期時間</th></tr>';
    let total = 0;
    expenses.forEach((expense, index) => {
      const bgColor = index % 2 === 0 ? '#f9f9f9' : 'white';
      emailContent += `<tr style="background-color: ${bgColor};">
        <td>${expense.item}</td>
        <td>NT$ ${expense.amount.toLocaleString()}</td>
        <td>${expense.category}</td>
        <td>${expense.datetime}</td>
      </tr>`;
      total += expense.amount;
    });
    emailContent += `<tr style="background-color: #ffffcc; font-weight: bold;">
      <td colspan="3" style="text-align: right;">總計</td>
      <td>NT$ ${total.toLocaleString()}</td>
    </tr>`;
    emailContent += '</table>';
  }
  
  emailContent += '</body></html>';
  
  const attachments = [];
  const attachmentFiles = fs.readdirSync(ATTACHMENTS_DIR);
  attachmentFiles.forEach(file => {
    attachments.push({
      filename: file,
      path: path.join(ATTACHMENTS_DIR, file)
    });
  });
  
  // 發送郵件
  await sendEmail(recipientEmail, emailContent, attachments);
}

// 發送郵件函數
async function sendEmail(recipientEmail, emailContent, attachments) {
  const transporter = createTransporter();
  const mailOptions = {
    from: `"LINE Bot 助手" <${process.env.SMTP_USER}>`,
    to: recipientEmail,
    subject: `LINE 對話紀錄匯出 - ${new Date().toLocaleDateString('zh-TW')}`,
    html: emailContent,
    attachments: attachments
  };
  await transporter.sendMail(mailOptions);
  console.log(`郵件已發送到: ${recipientEmail}`);
}

// 自動回應
function generateAutoReply(message) {
  const lowerMessage = message.toLowerCase();
  if (lowerMessage.includes('你好') || lowerMessage.includes('哈囉') || lowerMessage === 'hi' || lowerMessage === 'hello') {
    return '您好!我是您的智能助手 😊\n\n輸入「功能」查看可用功能';
  }
  if (lowerMessage.includes('謝謝') || lowerMessage.includes('感謝')) {
    return '不客氣!很高興能幫助您 😊\n有其他需要隨時告訴我';
  }
  if (lowerMessage.includes('營業時間') || lowerMessage.includes('服務時間')) {
    return '我是 24/7 全天候為您服務的智能助手!\n隨時都可以使用記帳、行程管理等功能 😊';
  }
  return '我收到您的訊息了!\n\n如需使用功能,請輸入:\n• 「功能」- 查看功能選單\n• 「記帳」- 記錄花費\n• 「新增行程」- 記錄行程\n• 「轉寄對話」- 匯出紀錄';
}

// 啟動伺服器
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server is running on port ${PORT}`);
  console.log(`📁 資料目錄: ${DATA_DIR}`);
  console.log(`📎 附件目錄: ${ATTACHMENTS_DIR}`);
});



