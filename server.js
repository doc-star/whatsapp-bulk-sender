const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const puppeteer = require('puppeteer');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.json());
app.use(express.static('public'));

let numbers = [];
let message = '';
let sending = false;
let browser = null;
let page = null;
let qrCodeData = null;

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const filePath = req.file.path;
  let extractedNumbers = [];

  try {
    const workbook = XLSX.readFile(filePath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    for (let row of data) {
      const raw = row[0];
      if (raw && typeof raw === 'string') {
        let cleaned = raw.replace(/\s+/g, '').replace(/-/g, '');
        if (!cleaned.startsWith('+')) cleaned = '+' + cleaned;
        if (cleaned.length > 5) extractedNumbers.push(cleaned);
      }
    }

    fs.unlinkSync(filePath);
    numbers = extractedNumbers;
    res.json({ count: numbers.length, preview: numbers.slice(0, 5) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to parse file' });
  }
});

app.post('/set-message', (req, res) => {
  message = req.body.message;
  if (!message) return res.status(400).json({ error: 'Message is required' });
  res.json({ status: 'Message saved' });
});

app.get('/qr', (req, res) => {
  if (qrCodeData) {
    res.json({ qr: qrCodeData });
  } else {
    res.json({ qr: null });
  }
});

app.post('/send', async (req, res) => {
  if (sending) {
    return res.status(400).json({ error: 'Sending already in progress' });
  }
  if (!numbers.length) {
    return res.status(400).json({ error: 'No numbers uploaded' });
  }
  if (!message) {
    return res.status(400).json({ error: 'No message set' });
  }

  sending = true;
  res.json({ status: 'Started. Please scan the QR code shown on the page.' });

  sendMessages().finally(() => {
    sending = false;
  });
});

async function sendMessages() {
  if (!browser) {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    page = await browser.newPage();
    await page.goto('https://web.whatsapp.com');

    // Wait for QR canvas to appear
    await page.waitForSelector('div[data-ref] canvas', { timeout: 30000 });
    const qrData = await page.evaluate(() => {
      const canvas = document.querySelector('div[data-ref] canvas');
      return canvas.toDataURL();
    });
    qrCodeData = qrData;

    // Wait for login
    await page.waitForSelector('div[contenteditable="true"][data-tab="10"]', { timeout: 60000 });
    console.log('Logged in!');
    qrCodeData = null;
  }

  for (let i = 0; i < numbers.length; i++) {
    const number = numbers[i];
    console.log(`Sending to ${number} (${i+1}/${numbers.length})`);

    try {
      const encodedNumber = encodeURIComponent(number.replace('+', ''));
      const url = `https://web.whatsapp.com/send?phone=${encodedNumber}`;
      await page.goto(url);
      await page.waitForSelector('div[contenteditable="true"][data-tab="10"]', { timeout: 30000 });
      await page.click('div[contenteditable="true"][data-tab="10"]');
      await page.type('div[contenteditable="true"][data-tab="10"]', message);
      await page.click('button[data-testid="compose-btn-send"]');
      await page.waitForTimeout(2000);
    } catch (err) {
      console.error(`Failed to send to ${number}:`, err.message);
    }

    const delay = Math.floor(Math.random() * 10000) + 5000;
    await page.waitForTimeout(delay);
  }

  console.log('All messages sent!');
  await browser.close();
}

app.listen(process.env.PORT || 3000, () => {
  console.log('Server running');
});
