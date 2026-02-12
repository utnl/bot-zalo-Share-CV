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

    // Cấp quyền Clipboard để dùng tính năng Copy-Paste
    const context = browser.defaultBrowserContext();
    await context.overridePermissions('https://chat.zalo.me', ['clipboard-read', 'clipboard-write']);

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

        // --- 1. TÌM VÀ CHỌN NHÓM ---
        let attempts = 0;
        let checkResult = { match: false, text: "" };
        let isChatOpened = false;

        // Check tiêu đề hiện tại trước
        const currentTitle = await page.evaluate(() => {
            const h = document.querySelector('#header-title span'); 
            return h ? h.innerText : "";
        });

        const normalize = (s) => s.toLowerCase().replace(/\s+/g, '').replace(/[^\p{L}\p{N}]/gu, '');
        if (normalize(currentTitle).includes(normalize(groupName))) {
            isChatOpened = true;
        }

        if (!isChatOpened) {
            console.log(`🎯 Đang nhắm vào nhóm: ${groupName}`);
            
            // Tìm trong sidebar
            const sidebarClicked = await page.evaluate((name) => {
                const sidebarItems = Array.from(document.querySelectorAll('#conversationListId [title], .conv-item, .contact-item'));
                const target = sidebarItems.find(el => {
                    const text = (el.getAttribute('title') || el.innerText || "").toLowerCase();
                    return text.includes(name.toLowerCase());
                });
                if (target) { target.click(); return true; }
                return false;
            }, groupName);

            if (!sidebarClicked) {
                console.log(`🔍 Search nhóm: ${groupName}`);
                const searchSelector = '#contact-search-input';
                await page.waitForSelector(searchSelector);
                await page.click(searchSelector);
                
                // Xóa cũ bằng Ctrl+A Backspace
                await page.keyboard.down('Control');
                await page.keyboard.press('A');
                await page.keyboard.up('Control');
                await page.keyboard.press('Backspace');

                await page.type(searchSelector, groupName, { delay: 50 });
                await randomDelay(1200, 1500);

                await page.evaluate(() => {
                    const firstResult = document.querySelector('.cl-item, .contact-item, .conv-item');
                    if (firstResult) firstResult.click();
                });
            }

            // Đợi loading chat window
            console.log("⏳ Đang đợi cửa sổ chat...");
            const maxWaitInfo = 10;
            for(let k=0; k<maxWaitInfo; k++) {
                await randomDelay(500, 800);
                const check = await page.evaluate((name) => {
                    const selectors = ['#header-title span', '#header-title', '.header-title'];
                    let txt = "";
                    for(let s of selectors) {
                        const el = document.querySelector(s);
                        if(el) txt = el.innerText || "";
                        if(txt) break;
                    }
                    if(!txt) return false;
                    
                    const clean = (s) => s.toLowerCase().replace(/\s+/g,'').replace(/[^\p{L}\p{N}]/gu,'');
                    return clean(txt).includes(clean(name)) || clean(name).includes(clean(txt));
                }, groupName);
                
                if (check) {
                    isChatOpened = true;
                    break;
                }
            }
            if(!isChatOpened) {
                console.error(`❌ Không mở được nhóm ${groupName} (Title không khớp)`);
                // Vẫn thử gửi nếu user muốn force, nhưng an toàn thì return
                // return { success: false, error: "Wrong Group" };
            }
        }

        // --- 2. NHẬP LIỆU (SIMULATE PASTE: CTRL+V) ---
        // Click vào ô chat
        const inputSelectors = ['#rich-input', 'div[contenteditable="true"]'];
        let foundInput = null;
        for (const selector of inputSelectors) {
            foundInput = await page.waitForSelector(selector, { visible: true, timeout: 5000 }).catch(() => null);
            if (foundInput) {
                console.log("🖱️ Focus vào ô chat...");
                await page.click(selector);
                break;
            }
        }

        if (!foundInput) {
            console.log("⚠️ Không thấy selector ô nhập, click tọa độ...");
            await page.mouse.click(600, 700); 
            await randomDelay(500, 800);
        }

        console.log("� Đang copy nội dung vào Clipboard...");
        
        // 1. Copy text vào Clipboard của trình duyệt
        await page.evaluate((text) => {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
        }, message);

        await randomDelay(300, 500);

        // 2. Xóa nội dung cũ (Ctrl+A -> Backspace)
        console.log("🧹 Xóa nội dung cũ...");
        await page.keyboard.down('Control');
        await page.keyboard.press('A');
        await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');
        await randomDelay(300, 500);

        // 3. Dán nội dung (Ctrl+V)
        console.log("⌨️ Nhấn Ctrl+V để dán...");
        await page.keyboard.down('Control');
        await page.keyboard.press('V');
        await page.keyboard.up('Control');
        
        // Đợi Zalo xử lý paste
        await randomDelay(1000, 1500);

        // --- TRICK QUAN TRỌNG: Gõ phím giả để kích hoạt React state ---
        // Gõ dấu chấm (.) rồi xóa đi. Delay đủ lâu để Zalo kịp phản ứng.
        await randomDelay(300, 500);
        console.log("⚡ Kích hoạt trạng thái nhập liệu...");
        await page.keyboard.type('.', { delay: 100 });
        await randomDelay(300, 500);
        await page.keyboard.press('Backspace');
        await randomDelay(800, 1000);

        // --- 3. GỬI TIN NHẮN ---
        // --- 3. GỬI TIN NHẮN (ƯU TIÊN CLICK NÚT GỬI) ---
        console.log("🚀 Đang tìm nút Gửi để click (thay vì nhấn Enter)...");
        
        const clickedSend = await page.evaluate(() => {
            // Danh sách selector nút Gửi
            const selectors = [
                '.chat-box-input-button.send-msg-btn', // Selector chính xác từ người dùng
                '.btn-tertiary-primary.chat-box-input-button',
                '[icon="Sent-msg_24_Line"]', // Selector theo thuộc tính icon
                '.btn-send', 
                '.func-send', 
                'div[title="Gửi"]',
                'div[data-translate-title="STR_SEND"]', 
                '.chat-input__send-button',
                '#chatInputSend'
            ];

            // 1. Tìm theo selector chính xác
            for (const sel of selectors) {
                const btn = document.querySelector(sel);
                if (btn && btn.offsetParent !== null) { // Check visible
                    console.log(`Tìm thấy nút gửi (Selector: ${sel})`);
                    btn.click();
                    return true;
                }
            }
            
            // 2. Tìm theo icon (mạnh mẽ nhất)
            // Tìm tất cả các element có class chứa 'icon-send' hoặc 'fa-paper-plane'
            const icons = Array.from(document.querySelectorAll('*'));
            const sendIcon = icons.find(el => {
                const cls = (el.className || "").toString();
                return cls.includes('icon-send') || cls.includes('fa-paper-plane') || cls.includes('func-send');
            });

            if (sendIcon) {
                // Click vào nút cha của icon (thường là button hoặc div wrap)
                const btn = sendIcon.closest('.clickable, button, div[onclick], div[role="button"]') || sendIcon;
                console.log("Tìm thấy nút gửi qua Icon!");
                btn.click();
                return true;
            }

            return false;
        });

        if (clickedSend) {
            console.log("✅ Đã click nút Gửi.");
        } else {
            console.log("⚠️ Không thấy nút Gửi, thử vận may với phím Enter...");
            await page.keyboard.press('Enter');
        }

        // Phòng hờ: Check lại xem tin nhắn đi chưa
        await randomDelay(1500, 2000);
        const hasText = await page.evaluate(() => {
            const input = document.querySelector('#rich-input') || document.querySelector('div[contenteditable="true"]');
            return input && input.innerText.trim().length > 0;
        });

        if (hasText) {
            console.error("❌ Vẫn còn chữ trong ô nhập -> Gửi thất bại.");
            // Thử nhấn Ctrl + Enter (phòng trường hợp Zalo đang set chế độ này)
             console.log("👉 Thử combo Ctrl + Enter...");
            await page.keyboard.down('Control');
            await page.keyboard.press('Enter');
            await page.keyboard.up('Control');
        } else {
            console.log("✅ Tin nhắn đã bay (ô nhập trống).");
        }

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