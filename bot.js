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
const IS_VPS = true; 

let browser;
let page;

const randomDelay = (min, max) => new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min + 1) + min)));

async function initBot() {
    console.log(`🚀 Đang khởi động Bot (Chế độ VPS: ${IS_VPS})...`);
    
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

    page = await browser.newPage();
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
        // Tối ưu: Kiểm tra tiêu đề chat hiện tại
        const currentChatTitle = await page.evaluate(() => {
            const header = document.querySelector('#header-title span');
            return header ? header.innerText.trim() : "";
        });

        if (currentChatTitle.toLowerCase() !== groupName.toLowerCase()) {
            console.log(`🔍 Đang tìm nhóm: ${groupName}`);
            const searchSelector = '#contact-search-input';
            await page.waitForSelector(searchSelector);
            await page.click(searchSelector);
            
            await page.keyboard.down('Control');
            await page.keyboard.press('A');
            await page.keyboard.up('Control');
            await page.keyboard.press('Backspace');
            
            await page.type(searchSelector, groupName, { delay: 50 });
            await randomDelay(500, 1000);

            const clicked = await page.evaluate((name) => {
                const elements = Array.from(document.querySelectorAll('.conv-item, .contact-item, div[title], span[title]'));
                const target = elements.find(el => {
                    const text = (el.getAttribute('title') || el.innerText || "").toLowerCase();
                    return text.includes(name.toLowerCase());
                });
                if (target) { target.click(); return true; }
                return false;
            }, groupName);

            if (!clicked) {
                await page.keyboard.press('ArrowDown');
                await randomDelay(200, 400);
                await page.keyboard.press('Enter');
            }
            await randomDelay(800, 1200);
        }

        // Chọn ô nhập liệu
        const inputSelectors = ['#rich-input', '.chat-input-container', 'div[contenteditable="true"]'];
        let foundInput = null;
        for (const selector of inputSelectors) {
            foundInput = await page.waitForSelector(selector, { visible: true, timeout: 3000 }).catch(() => null);
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

        // Gõ phím - Sửa lỗi gửi nhiều bong bóng tin nhắn
        console.log("⌨ Đang gõ nội dung (Chế độ 1 tin nhắn duy nhất)...");
        for (const char of message) {
            if (char === '\n') {
                // Thay thế xuống dòng bằng Shift + Enter để Zalo không tự gửi tin
                await page.keyboard.down('Shift');
                await page.keyboard.press('Enter');
                await page.keyboard.up('Shift');
            } else {
                await page.keyboard.type(char);
            }
            await randomDelay(5, 15); 
        }

        await randomDelay(500, 1000);
        await page.keyboard.press('Enter'); // Gửi toàn bộ 1 khối

        console.log("✅ Đã gửi trọn bộ thông tin trong 1 tin nhắn!");
        return { success: true };
    } catch (error) {
        console.error("❌ Lỗi gửi ngầm:", error.message);
        return { success: false, error: error.message };
    }
}

// API Endpoint - Hỗ trợ giới hạn giờ và gửi ngầm
app.post('/send-zalo', (req, res) => {
    // 1. Kiểm tra giờ làm việc (8h - 24h)
    const now = new Date();
    const VietnamHour = (now.getUTCHours() + 7) % 24; // Tính giờ VN từ UTC

    if (VietnamHour < 8 && VietnamHour >= 0) {
        return res.status(403).json({ 
            success: false, 
            error: `Bot đang trong giờ nghỉ (Giờ VN hiện tại: ${VietnamHour}h). Vui lòng thử lại sau 8h sáng!` 
        });
    }

    // 2. Kiểm tra Key bảo mật
    const clientKey = req.headers['x-api-key'];
    if (clientKey !== SECRET_KEY) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    const { groupName, message } = req.body;
    if (!groupName || !message) {
        return res.status(400).json({ error: "Missing data" });
    }

    // 3. Phản hồi ngay lập tức
    res.json({ success: true, status: 'Processing' });

    // 4. Thực hiện gửi tin nhắn ngầm
    sendMessage(groupName, message).then(() => {
        console.log(`🏁 Hoàn thành gửi tin cho nhóm: ${groupName}`);
    }).catch(err => {
        console.error(`🏁 Lỗi khi gửi tin ngầm: ${err.message}`);
    });
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