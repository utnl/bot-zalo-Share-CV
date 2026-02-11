const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const express = require('express');
const cors = require('cors');

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
        console.log("� Đã chụp ảnh mã QR tại file: zalo_qr.png");
        console.log("👉 Hãy tải file này về máy để quét mã.");
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
            
            await page.type(searchSelector, groupName, { delay: 100 });
            await randomDelay(1500, 2000);

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
                await randomDelay(500, 800);
                await page.keyboard.press('Enter');
            }
            await randomDelay(1500, 2000);
        }

        // Chọn ô nhập liệu (đa dụng)
        const inputSelectors = ['#rich-input', '.chat-input-container', 'div[contenteditable="true"]'];
        let foundInput = null;
        for (const selector of inputSelectors) {
            foundInput = await page.waitForSelector(selector, { visible: true, timeout: 3000 }).catch(() => null);
            if (foundInput) {
                await page.click(selector);
                break;
            }
        }

        // Gõ phím kiểu người thật (Anti-ban)
        console.log("⌨ Đang gửi dữ liệu ứng viên...");
        for (const char of message) {
            await page.keyboard.type(char);
            await randomDelay(30, 100); 
        }

        await randomDelay(500, 1000);
        await page.keyboard.press('Enter');

        console.log("✅ Gửi tin nhắn thành công!");
        return { success: true };
    } catch (error) {
        console.error("❌ Lỗi Bot:", error.message);
        await page.screenshot({ path: 'debug_error.png' });
        return { success: false, error: error.message };
    }
}

// API Endpoint
app.post('/send-zalo', async (req, res) => {
    // Kiểm tra Key bảo mật
    const clientKey = req.headers['x-api-key'];
    if (clientKey !== SECRET_KEY) {
        return res.status(401).json({ error: "Unauthorized: Invalid API Key" });
    }

    const { groupName, message } = req.body;
    if (!groupName || !message) return res.status(400).json({ error: "Missing groupName or message" });

    const result = await sendMessage(groupName, message);
    res.json(result.success ? { status: 'Success' } : result);
});

// Chụp ảnh lại màn hình QR (Nếu cần lấy lại mã mới)
app.get('/get-qr', async (req, res) => {
    await page.goto('https://chat.zalo.me');
    await randomDelay(3000, 4000);
    await page.screenshot({ path: 'zalo_qr.png' });
    res.send("Đã cập nhật file zalo_qr.png. Hãy tải về để quét mã.");
});

initBot().then(() => {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Bot Server đang chạy tại cổng: ${PORT}`);
        console.log(`🔑 Key bảo mật: ${SECRET_KEY}`);
    });
});