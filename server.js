// ═══════════════════════════════════════════════════════════════
//  BookVoice Server
//  Node.js + Express backend
//  - AWS Polly proxy (your keys stay here, never sent to browser)
//  - Per-user usage tracking (file-based, no external DB needed)
//  - Razorpay payment integration
//  - Free tier: 50,000 chars/month per user
// ═══════════════════════════════════════════════════════════════

require('dotenv').config();
const express   = require('express');
const AWS       = require('aws-sdk');
const Razorpay  = require('razorpay');
const crypto    = require('crypto');
const fs        = require('fs');
const path      = require('path');
const cors      = require('cors');

const app = express();
app.use(express.json());
app.use(cors({ origin: '*' }));  // restrict to your domain in production

// ── AWS Polly ─────────────────────────────────────────────────────────────────
AWS.config.update({
  accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region:          process.env.AWS_REGION || 'ap-south-1',
});
const polly = new AWS.Polly();

// ── Razorpay ──────────────────────────────────────────────────────────────────
const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ── Credit Packs (INR) ────────────────────────────────────────────────────────
// 1 credit = 1 character synthesized by AWS Polly
const PACKS = {
  starter: { credits: 150_000,   amount: 9900,   label: 'Starter — 150K chars (~100 pages)', pages: 100  },
  popular: { credits: 600_000,   amount: 29900,  label: 'Popular — 600K chars (~400 pages)', pages: 400  },
  pro:     { credits: 2_000_000, amount: 79900,  label: 'Pro — 2M chars (~1300 pages)',      pages: 1300 },
};

const FREE_MONTHLY = 50_000;  // free chars per user per month

// ── Simple file-based database ────────────────────────────────────────────────
// For production, swap this for PostgreSQL / MongoDB / DynamoDB
const DB_PATH = path.join(__dirname, 'data', 'users.json');

function loadDB() {
  if (!fs.existsSync(DB_PATH)) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify({ users: {} }));
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function saveDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function getUser(userId) {
  const db    = loadDB();
  const month = new Date().toISOString().slice(0, 7); // YYYY-MM
  if (!db.users[userId]) {
    db.users[userId] = {
      id:             userId,
      paidCredits:    0,
      freeUsed:       0,
      freeResetMonth: month,
      totalChars:     0,
      createdAt:      new Date().toISOString(),
    };
    saveDB(db);
  }
  const u = db.users[userId];
  // Reset free usage each month
  if (u.freeResetMonth !== month) {
    u.freeUsed = 0;
    u.freeResetMonth = month;
    db.users[userId] = u;
    saveDB(db);
  }
  return u;
}

function updateUser(userId, updates) {
  const db = loadDB();
  Object.assign(db.users[userId], updates);
  saveDB(db);
}

// ── Rate limit: 100 requests / minute per user (in-memory) ───────────────────
const rateLimitMap = new Map();
function rateLimit(userId) {
  const now    = Date.now();
  const window = 60_000;
  const max    = 100;
  if (!rateLimitMap.has(userId)) rateLimitMap.set(userId, []);
  const times = rateLimitMap.get(userId).filter(t => now - t < window);
  if (times.length >= max) return false;
  times.push(now);
  rateLimitMap.set(userId, times);
  return true;
}

// ═══ ROUTES ═══════════════════════════════════════════════════════════════════

// ── GET /api/credits?userId=xxx ───────────────────────────────────────────────
app.get('/api/credits', (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });
  const u            = getUser(userId);
  const freeLeft     = Math.max(0, FREE_MONTHLY - u.freeUsed);
  res.json({
    freeRemaining:  freeLeft,
    paidCredits:    u.paidCredits,
    freeMonthly:    FREE_MONTHLY,
    totalUsed:      u.totalChars,
  });
});

// ── POST /api/synthesize ──────────────────────────────────────────────────────
// Body: { text, voice, userId }
// voice format: "VoiceId|engine"  e.g. "Amy|neural"
app.post('/api/synthesize', async (req, res) => {
  const { text, voice = 'Amy|neural', userId } = req.body;

  if (!text || !userId)
    return res.status(400).json({ error: 'Missing text or userId' });
  if (text.length > 3000)
    return res.status(400).json({ error: 'Text too long (max 3000 chars per request)' });

  if (!rateLimit(userId))
    return res.status(429).json({ error: 'Too many requests. Slow down.' });

  const charCount = text.length;
  const u         = getUser(userId);
  const freeLeft  = Math.max(0, FREE_MONTHLY - u.freeUsed);

  // Check if user has enough credits (free + paid combined)
  const totalAvailable = freeLeft + u.paidCredits;
  if (totalAvailable < charCount) {
    return res.status(402).json({
      error:         'insufficient_credits',
      freeRemaining: freeLeft,
      paidCredits:   u.paidCredits,
      needed:        charCount,
    });
  }

  try {
    const [VoiceId, Engine] = voice.split('|');
    const safeText = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const ssml = `<speak>${safeText}</speak>`;

    const data = await polly.synthesizeSpeech({
      Text:         ssml,
      TextType:     'ssml',
      OutputFormat: 'mp3',
      VoiceId:      VoiceId || 'Amy',
      Engine:       Engine  || 'neural',
    }).promise();

    // Deduct: free first, then paid
    const freeDeduct = Math.min(freeLeft, charCount);
    const paidDeduct = charCount - freeDeduct;
    updateUser(userId, {
      freeUsed:    u.freeUsed + freeDeduct,
      paidCredits: u.paidCredits - paidDeduct,
      totalChars:  u.totalChars + charCount,
    });

    const updatedUser  = getUser(userId);
    const newFreeLeft  = Math.max(0, FREE_MONTHLY - updatedUser.freeUsed);

    res.set('Content-Type', 'audio/mpeg');
    res.set('X-Free-Remaining', String(newFreeLeft));
    res.set('X-Paid-Credits',   String(updatedUser.paidCredits));
    res.send(Buffer.from(data.AudioStream));

  } catch (err) {
    console.error('Polly error:', err.message);
    res.status(500).json({ error: 'synthesis_failed', message: err.message });
  }
});

// ── POST /api/create-order ────────────────────────────────────────────────────
app.post('/api/create-order', async (req, res) => {
  const { pack, userId } = req.body;
  const packInfo = PACKS[pack];
  if (!packInfo || !userId)
    return res.status(400).json({ error: 'Invalid pack or userId' });

  try {
    const order = await razorpay.orders.create({
      amount:   packInfo.amount,
      currency: 'INR',
      notes:    { userId, pack, credits: packInfo.credits },
    });
    res.json({
      orderId:  order.id,
      amount:   packInfo.amount,
      currency: 'INR',
      key:      process.env.RAZORPAY_KEY_ID,
      label:    packInfo.label,
      credits:  packInfo.credits,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/verify-payment ──────────────────────────────────────────────────
app.post('/api/verify-payment', (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, userId, pack } = req.body;

  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  if (expected !== razorpay_signature)
    return res.status(400).json({ error: 'Invalid payment signature' });

  const packInfo = PACKS[pack];
  if (!packInfo) return res.status(400).json({ error: 'Invalid pack' });

  const u = getUser(userId);
  updateUser(userId, { paidCredits: u.paidCredits + packInfo.credits });

  console.log(`✅ Payment verified: user=${userId} pack=${pack} credits=${packInfo.credits}`);
  res.json({ success: true, creditsAdded: packInfo.credits, newBalance: u.paidCredits + packInfo.credits });
});

// ── GET /api/packs ────────────────────────────────────────────────────────────
app.get('/api/packs', (req, res) => {
  res.json(Object.entries(PACKS).map(([id, p]) => ({ id, ...p })));
});

// ── Serve frontend from /public ───────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n📖 BookVoice Server running on http://localhost:${PORT}`);
  console.log(`   AWS Region: ${process.env.AWS_REGION || 'ap-south-1'}`);
  console.log(`   Free monthly chars: ${FREE_MONTHLY.toLocaleString()}\n`);
});
