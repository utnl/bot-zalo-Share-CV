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
        // Tối ưu: Kiểm tra tiêu đề chat hiện tại để tránh tìm kiếm lại
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
            await randomDelay(800, 1200);

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
                await randomDelay(400, 600);
                await page.keyboard.press('Enter');
            }
            await randomDelay(1200, 1800);
        }

        // 1. Chọn ô nhập liệu (Rich Text Editor)
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

        // 2. CƠ CHẾ CHỐNG "NUỐT CHỮ" (Sử dụng insertHTML)
        console.log("� Đang dán hồ sơ ứng viên (Bản Fix rụng chữ)...");
        await page.evaluate((text) => {
            const input = document.querySelector('#rich-input') || document.querySelector('div[contenteditable="true"]');
            if (input) {
                input.focus();
                // Xóa sạch nội dung cũ
                document.execCommand('selectAll', false, null);
                document.execCommand('delete', false, null);

                // Biến văn bản thành HTML chia theo từng dòng <div>
                const safeHtml = text
                    .split('\n')
                    .map(line => {
                        return line.trim() === '' ? '<div><br></div>' : `<div>${line}</div>`;
                    })
                    .join('');

                // Dán HTML - Zalo sẽ nhận nguyên khối, không bị rụng dấu
                document.execCommand('insertHTML', false, safeHtml);
                
                // Kích hoạt sự kiện để nút Gửi xuất hiện
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }, message);

        // 3. Đợi Zalo "tiêu hóa" nội dung rồi mới bấm Enter
        await randomDelay(1000, 2000);
        await page.keyboard.press('Enter');

        console.log("✅ Đã gửi trọn bộ thông tin (Chuẩn SEO & Font)!");
        return { success: true };
    } catch (error) {
        console.error("❌ Lỗi Bot:", error.message);
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