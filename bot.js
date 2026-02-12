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
const IS_VPS = false; 

let browser;
let page;
let messageQueue = Promise.resolve(); 

const randomDelay = (min, max) => new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min + 1) + min)));

// Hàm quét và dọn dẹp tab thừa chủ động
async function cleanExcessTabs() {
    try {
        if (!browser) return;
        const allPages = await browser.pages();
        if (allPages.length <= 1) return;

        for (const p of allPages) {
            const url = p.url();
            // Đóng tab nếu không phải Zalo, hoặc là tab trắng dư thừa
            if (!url.includes('chat.zalo.me') || url === 'about:blank') {
                const updatedPages = await browser.pages();
                // Chỉ đóng nếu vẫn còn ít nhất 1 tab Zalo đang chạy
                const hasZalo = updatedPages.some(pg => pg.url().includes('chat.zalo.me'));
                if (hasZalo && updatedPages.length > 1) {
                    console.log(`🛡️ Robot tự động dọn dẹp tab: ${url}`);
                    await p.close().catch(() => {});
                }
            }
        }
    } catch (e) {}
}

async function initBot() {
    console.log(`🚀 Đang khởi động Bot (Chế độ hiện hình: ${!IS_VPS})...`);
    
    const width = 1200;
    const height = 1000;

    browser = await puppeteer.launch({
        headless: IS_VPS ? "new" : false,
        userDataDir: './zalo_session',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-notifications',
            '--disable-blink-features=AutomationControlled',
            `--window-size=${width},${height}`
        ]
    });

    // Radar canh chừng: Cứ có tab mới mở ra là kiểm tra và đóng nếu là rác
    browser.on('targetcreated', async (target) => {
        if (target.type() === 'page') {
            await randomDelay(1000, 2000); // Đợi nó load url tí
            await cleanExcessTabs();
        }
    });

    const pages = await browser.pages();
    for (let i = 1; i < pages.length; i++) {
        await pages[i].close();
    }
    page = pages[0]; 
    
    await page.setViewport({ width, height });

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
        await cleanExcessTabs(); // Dọn dẹp một lần nữa trước khi gửi

        const updatedPages = await browser.pages();
        page = updatedPages.find(p => p.url().includes('chat.zalo.me')) || updatedPages[0];
        await page.bringToFront().catch(() => {});

        const currentChatTitle = await page.evaluate(() => {
            const header = document.querySelector('#header-title span');
            return header ? header.innerText.trim() : "";
        });

        if (currentChatTitle.toLowerCase() !== groupName.toLowerCase()) {
            console.log(`🔍 Đang tìm nhóm: ${groupName}`);
            
            const clickedAlready = await page.evaluate((name) => {
                const elements = Array.from(document.querySelectorAll('.conv-item, .contact-item, div[title]'));
                const target = elements.find(el => {
                    const text = (el.getAttribute('title') || el.innerText || "").toLowerCase();
                    return text.includes(name.toLowerCase());
                });
                if (target) { target.click(); return true; }
                return false;
            }, groupName);

            if (!clickedAlready) {
                const searchSelector = '#contact-search-input';
                await page.waitForSelector(searchSelector);
                await page.click(searchSelector);
                
                await page.keyboard.down('Control');
                await page.keyboard.press('A');
                await page.keyboard.up('Control');
                await page.keyboard.press('Backspace');
                
                await page.type(searchSelector, groupName, { delay: 50 });
                await randomDelay(1000, 1500);

                const searchClicked = await page.evaluate((name) => {
                    const searchResults = Array.from(document.querySelectorAll('.cl-item, .contact-item, .conv-item'));
                    const target = searchResults.find(el => {
                        const text = (el.innerText || "").toLowerCase();
                        return text.includes(name.toLowerCase());
                    });
                    if (target) { target.click(); return true; }
                    const firstResult = document.querySelector('.cl-item, .contact-item');
                    if (firstResult) { firstResult.click(); return true; }
                    return false;
                }, groupName);

                if (!searchClicked) {
                    await page.keyboard.press('ArrowDown');
                    await randomDelay(400, 600);
                    await page.keyboard.press('Enter');
                }
            }
            await randomDelay(1500, 2000);
        }

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

        console.log("📝 Đang dán hồ sơ ứng viên...");
        await page.evaluate((text) => {
            const input = document.querySelector('#rich-input') || document.querySelector('div[contenteditable="true"]');
            if (input) {
                input.focus();
                document.execCommand('selectAll', false, null);
                document.execCommand('delete', false, null);

                const safeHtml = text
                    .split('\n')
                    .map(line => {
                        return line.trim() === '' ? '<div><br></div>' : `<div>${line}</div>`;
                    })
                    .join('');

                document.execCommand('insertHTML', false, safeHtml);
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }, message);

        await randomDelay(1200, 2000);
        
        // --- FIX: Đóng menu gợi ý của Zalo trước khi Enter ---
        await page.keyboard.press('Escape'); 
        await randomDelay(500, 800);
        
        await page.keyboard.press('Enter');

        console.log("✅ Đã gửi trọn bộ thông tin!");
        return { success: true };
    } catch (error) {
        console.error("❌ Lỗi Bot:", error.message);
        return { success: false, error: error.message };
    }
}

app.post('/send-zalo', (req, res) => {
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

    res.json({ success: true, status: 'Queued' });

    messageQueue = messageQueue.then(async () => {
        try {
            console.log(`📦 Đang xử lý tin nhắn cho nhóm: ${groupName}`);
            await sendMessage(groupName, message);
            await randomDelay(2000, 4000);
        } catch (err) {
            console.error(`❌ Lỗi trong hàng đợi: ${err.message}`);
        }
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