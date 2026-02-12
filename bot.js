const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const express = require('express');
const cors = require('cors');
const path = require('path');

// Kích hoạt plugin tàng hình
puppeteer.use(StealthPlugin());

const app = express();
app.use(express.json());
app.use(cors());

// --- CẤU HÌNH ---
const PORT = 3001;
const SECRET_KEY = "hihihi"; 
const IS_VPS = false; // Để false để hiện trình duyệt trên Remote Desktop cho dễ quản lý

let browser;
let page;

const randomDelay = (min, max) => new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min + 1) + min)));

async function initBot() {
    console.log(`🚀 Đang khởi động Bot (Chế độ hiện hình: ${!IS_VPS})...`);
    
    browser = await puppeteer.launch({
        headless: IS_VPS ? "new" : false,
        userDataDir: './zalo_session',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-notifications',
            '--disable-blink-features=AutomationControlled',
            '--window-size=1200,900'
        ]
    });

    // --- LOGIC DỌN DẸP TAB THỪA (CHỐNG NHIỀU TAB) ---
    const pages = await browser.pages();
    // Đóng tất cả các tab cũ nếu có (chỉ để lại 1 tab duy nhất cho sạch)
    for (let i = 1; i < pages.length; i++) {
        await pages[i].close();
    }
    page = pages[0]; // Sử dụng ngay tab đầu tiên, tránh mở thêm tab trống
    
    await page.setViewport({ width: 1200, height: 900 });

    console.log("🔗 Đang truy cập Zalo Web...");
    await page.goto('https://chat.zalo.me', { waitUntil: 'networkidle2' });

    // Kiểm tra đăng nhập
    const isLoginRequired = await page.evaluate(() => {
        return document.querySelector('.qr-container') !== null || document.querySelector('canvas') !== null;
    });

    if (isLoginRequired) {
        console.log("-------------------------------------------------------");
        console.log("⚠️ Zalo yêu cầu quét mã QR!");
        await randomDelay(2000, 3000);
        await page.screenshot({ path: 'zalo_qr.png' });
        console.log("📸 Đã chụp ảnh mã QR tại file: zalo_qr.png");
        console.log("-------------------------------------------------------");
    } else {
        console.log("✅ Đã nhận diện phiên đăng nhập.");
    }
}

async function sendMessage(groupName, message) {
    try {
        // ... (phần code tìm nhóm giữ nguyên không đổi) ...

        // 1. Chọn ô nhập liệu
        const inputSelectors = ['#rich-input', 'div[contenteditable="true"]'];
        let foundInput = null;
        for (const selector of inputSelectors) {
            foundInput = await page.waitForSelector(selector, { visible: true, timeout: 5000 }).catch(() => null);
            if (foundInput) {
                await page.click(selector);
                break;
            }
        }

        if (!foundInput) {
            console.log("⚠️ Không thấy ô nhập liệu, click để focus...");
            await page.mouse.click(600, 600);
            await randomDelay(500, 800);
        }

        // 2. SỬA TẠI ĐÂY: Thay vì gõ từng chữ, ta dùng lệnh "dán" văn bản
        console.log("📥 Đang nạp nội dung tin nhắn...");
        await page.evaluate((text) => {
            const input = document.querySelector('#rich-input') || document.querySelector('div[contenteditable="true"]');
            if (input) {
                input.focus();
                // Xóa nội dung cũ nếu có
                document.execCommand('selectAll', false, null);
                document.execCommand('delete', false, null);
                // Dán nội dung mới (giữ nguyên được mọi ký tự tiếng Việt)
                document.execCommand('insertText', false, text);
            }
        }, message);

        // 3. Đợi một chút để Zalo nhận diện nội dung rồi mới ấn Enter
        await randomDelay(800, 1200);
        await page.keyboard.press('Enter');

        console.log("✅ Đã gửi trọn bộ thông tin (Không lỗi font)!");
        return { success: true };
    } catch (error) {
        console.error("❌ Lỗi gửi ngầm:", error.message);
        return { success: false, error: error.message };
    }
}

// API Endpoint
app.post('/send-zalo', (req, res) => {
    // 1. Kiểm tra giờ làm việc (8h - 22h)
    const now = new Date();
    const VietnamHour = (now.getUTCHours() + 7) % 24;

    if (VietnamHour < 8 || VietnamHour >= 22) {
        return res.status(403).json({ 
            success: false, 
            error: `Ngoài giờ làm việc (Giờ VN: ${VietnamHour}h). Bot hoạt động từ 8h-22h.` 
        });
    }

    const clientKey = req.headers['x-api-key'];
    if (clientKey !== SECRET_KEY) return res.status(401).json({ error: "Unauthorized" });

    const { groupName, message } = req.body;
    if (!groupName || !message) return res.status(400).json({ error: "Missing data" });

    // Phản hồi ngay cho App chính
    res.json({ success: true, status: 'Processing' });

    // Gửi ngầm
    sendMessage(groupName, message).catch(err => console.error("Lỗi:", err.message));
});

app.get('/view-qr', (req, res) => {
    const qrPath = path.join(__dirname, 'zalo_qr.png');
    res.sendFile(qrPath);
});

initBot().then(() => {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Bot ready: http://localhost:${PORT}`);
    });
});