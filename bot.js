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
    
    const width = 1920;
    const height = 1080;

    browser = await puppeteer.launch({
        headless: IS_VPS ? "new" : false,
        userDataDir: './zalo_session',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-notifications',
            '--disable-blink-features=AutomationControlled',
            '--start-maximized', // Mở full màn hình luôn
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
            console.log(`🎯 Đang nhắm vào nhóm: ${groupName}`);
            
            // 1. CLICK THẲNG VÀO SIDEBAR (Ưu tiên các mục ghim/đang hiện)
            const sidebarClicked = await page.evaluate((name) => {
                // Quét mọi thứ trong cột bên trái (sidebar) có chứa tên nhóm
                const sidebarItems = Array.from(document.querySelectorAll('#conversationListId [title], .conv-item, .contact-item'));
                const target = sidebarItems.find(el => {
                    const text = (el.getAttribute('title') || el.innerText || "").toLowerCase();
                    return text.includes(name.toLowerCase());
                });
                if (target) { target.click(); return true; }
                return false;
            }, groupName);

            if (!sidebarClicked) {
                console.log(`🔍 Không thấy ở ngoài, tiến hành tìm kiếm: ${groupName}`);
                const searchSelector = '#contact-search-input';
                await page.waitForSelector(searchSelector);
                await page.click(searchSelector);
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

            // ⚠️ QUAN TRỌNG: Đợi xác nhận đã nhảy vào đúng chat window chưa
            console.log("⏳ Đang đợi cửa sổ chat hiện ra...");
            
            let attempts = 0;
            let checkResult = { match: false, text: "" };

            while (attempts < 5 && !checkResult.match) {
                await randomDelay(1000, 1500); 
                
                checkResult = await page.evaluate((name) => {
                    // Thử nhiều selector khác nhau
                    const selectors = [
                        '#header-title span', 
                        '#header-title', 
                        '.header-title', 
                        '.title-header',
                        'header .title'
                    ];
                    
                    let headerText = "";
                    for (const sel of selectors) {
                        const el = document.querySelector(sel);
                        if (el && el.innerText) {
                            headerText = el.innerText;
                            break; 
                        }
                    }

                    if (!headerText) return { match: false, text: "NULL (Không tìm thấy element)" };

                    // Normalization mạnh tay: Xóa hết dấu cách, ký tự đặc biệt, chỉ giữ chữ và số
                    // Cách này xử lý được trường hợp non-breaking space ( ) khác space thường ( )
                    const cleanString = (str) => {
                        return str.toLowerCase()
                            .replace(/\s+/g, '')        // Xóa mọi khoảng trắng
                            .replace(/[^\p{L}\p{N}]/gu, '') // Chỉ giữ lại chữ (bao gồm tiếng Việt) và số
                            .trim();
                    };

                    const cleanHeader = cleanString(headerText);
                    const cleanTarget = cleanString(name);
                    
                    // So sánh chuỗi đã làm sạch
                    const match = cleanHeader.includes(cleanTarget) || cleanTarget.includes(cleanHeader);
                    
                    return { match, text: headerText };
                }, groupName);

                if (checkResult.match) break;
                
                attempts++;
                console.log(`⚠️ Thử lại xác nhận tiêu đề (${attempts}/5). Tìm thấy: "${checkResult.text}"`);
            }

            if (!checkResult.match) {
                console.error(`❌ Lỗi xác nhận tiêu đề: ${groupName}. Thực tế tìm thấy: "${checkResult.text}". Hủy gửi để an toàn.`);
                return { success: false, error: `Lỗi xác nhận nhóm. Tìm thấy: ${checkResult.text}` };
            }
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
        
        // --- FIX: Xử lý vụ không chịu gửi ---
        console.log("👉 Đang chuẩn bị gửi tin nhắn...");

        // 1. Focus vào ô nhập liệu
        await page.evaluate(() => {
            const input = document.querySelector('#rich-input') || document.querySelector('div[contenteditable="true"]');
            if (input) input.focus();
        });

        // 2. Đóng popup gợi ý (nếu có)
        await page.keyboard.press('Escape'); 
        await randomDelay(300, 500);

        // 3. Focus lại lần nữa cho chắc (vì Escape có thể làm mất focus)
        await page.evaluate(() => {
            const input = document.querySelector('#rich-input') || document.querySelector('div[contenteditable="true"]');
            if (input) input.click(); // Click để focus thực sự
        });
        await randomDelay(500, 800);
        
        // 4. Nhấn Enter
        console.log("🚀 NHẤN ENTER...");
        await page.keyboard.press('Enter');

        // Phòng hờ: Nếu Enter không ăn, tìm nút Gửi và click
        await randomDelay(1000, 1500);
        await page.evaluate(() => {
            // Danh sách các class nút gửi thường thấy của Zalo
            const sendSelectors = [
                '.btn-send', 
                '.func-send', 
                'div[title="Gửi"]', 
                '.clickable-send-btn',
                '#chatInputSend' // Đôi khi có ID này
            ];

            let sendBtn = null;
            for (const sel of sendSelectors) {
                sendBtn = document.querySelector(sel);
                if (sendBtn) break;
            }

            if (sendBtn) {
                console.log("⚠️ Enter không ăn, kích hoạt nút Gửi dự phòng...");
                sendBtn.click();
            } else {
                console.log("⚠️ Không tìm thấy nút Gửi nào cả!");
            }
        });

        console.log("✅ Đã xử lý xong (Enter hoặc Click Gửi).");
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