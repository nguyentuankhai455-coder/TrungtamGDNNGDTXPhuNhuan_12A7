
'use strict';

const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const admin = require('firebase-admin');
const path = require('path');
const net = require('net');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // Render's reverse proxy; req.ip is resolved by Express.
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: '20kb' }));

const PORT = Number(process.env.PORT || 3000);
const DATABASE_URL = process.env.FIREBASE_DATABASE_URL ||
  'https://a7-website-3bd33-default-rtdb.asia-southeast1.firebasedatabase.app';
const RETENTION_DAYS = Math.max(30, Math.min(365, Number(process.env.IP_RETENTION_DAYS || 90)));
const CONSENT_VERSION = '12A7-IP-NOTICE-2026-11-v1';

let firebaseReady = false;
let db = null;
let auth = null;

function initFirebaseAdmin() {
  if (admin.apps.length) {
    db = admin.database();
    auth = admin.auth();
    firebaseReady = true;
    return;
  }
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    console.warn('[12A7] FIREBASE_SERVICE_ACCOUNT_JSON is missing; API writes are disabled.');
    return;
  }
  try {
    let parsed;
    const trimmed = raw.trim();
    parsed = trimmed.startsWith('{')
      ? JSON.parse(trimmed)
      : JSON.parse(Buffer.from(trimmed, 'base64').toString('utf8'));
    admin.initializeApp({
      credential: admin.credential.cert(parsed),
      databaseURL: DATABASE_URL
    });
    db = admin.database();
    auth = admin.auth();
    firebaseReady = true;
    console.log('[12A7] Firebase Admin SDK initialized.');
  } catch (error) {
    console.error('[12A7] Firebase Admin SDK initialization failed:', error.message);
  }
}
initFirebaseAdmin();

function requireFirebase(req, res, next) {
  if (!firebaseReady || !auth || !db) {
    return res.status(503).json({
      error: 'Máy chủ chưa cấu hình Firebase Admin SDK. Cần thêm FIREBASE_SERVICE_ACCOUNT_JSON trên Render.'
    });
  }
  next();
}

const activityLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Quá nhiều yêu cầu ghi nhật ký. Vui lòng thử lại sau.' }
});
const reportLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false
});
const broadcastLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Đã vượt giới hạn gửi thông báo. Hãy thử lại sau.' }
});

async function requireUser(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) return res.status(401).json({ error: 'Thiếu Firebase ID Token.' });
    req.user = await auth.verifyIdToken(match[1], true);
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.' });
  }
}

function roleText(value) {
  if (typeof value === 'string') return value.toLowerCase();
  if (value && typeof value === 'object') return String(value.role || value.name || '').toLowerCase();
  return '';
}

async function isStaff(uid, claims = {}) {
  if (claims.admin === true || claims.isGvcn === true ||
      ['admin', 'gvcn', 'teacher_admin'].includes(String(claims.role || '').toLowerCase())) {
    return true;
  }
  const paths = [
    `admins/${uid}`,
    `roles/${uid}`,
    `userRoles/${uid}`,
    `staff/${uid}`,
    `gvcn/${uid}`,
    `gvcns/${uid}`
  ];
  const snaps = await Promise.all(paths.map(pathName => db.ref(pathName).once('value')));
  if (snaps[0].val() === true) return true;
  return snaps.slice(1).some(snap => {
    const value = snap.val();
    return value === true || ['admin', 'gvcn', 'teacher_admin'].includes(roleText(value));
  });
}

function sanitizeString(value, maxLength) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

function validKey(value) {
  return /^[A-Za-z0-9_-]{1,120}$/.test(String(value || ''));
}

function normalizeIp(value) {
  let ip = String(value || '').trim();
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (ip === '::1') return '127.0.0.1';
  return net.isIP(ip) ? ip : null;
}

function maskIp(ip) {
  if (!ip) return null;
  if (net.isIP(ip) === 4) {
    const p = ip.split('.');
    return `${p[0]}.${p[1]}.${p[2]}.xxx`;
  }
  const segments = ip.split(':').filter(Boolean);
  return segments.slice(0, 3).join(':') + ':…';
}

function requestIp(req) {
  // Never accept an IP supplied in the request body. Use Express's proxy-aware req.ip.
  return normalizeIp(req.ip || req.socket.remoteAddress);
}

function getConsent(uid) {
  return db.ref(`privacyConsents/${uid}`).once('value').then(snap => snap.val() || {});
}

function activityPayload(req, user, event, details, ipConsent, account) {
  const ip = ipConsent ? requestIp(req) : null;
  return {
    uid: user.uid,
    email: user.email || null,
    displayName: account && account.displayName ? account.displayName : (user.name || null),
    event,
    postKey: validKey(details.postKey) ? details.postKey : null,
    commentId: validKey(details.commentId) ? details.commentId : null,
    reaction: ['like', 'love', 'haha', 'wow', 'support'].includes(details.reaction) ? details.reaction : null,
    createdAt: Date.now(),
    ip,
    ipMasked: ip ? maskIp(ip) : null,
    ipCollected: Boolean(ip),
    consentVersion: ipConsent ? CONSENT_VERSION : null,
    userAgent: sanitizeString(req.headers['user-agent'], 240)
  };
}

const allowedEvents = new Set([
  'login', 'logout', 'register',
  'comment_create', 'comment_delete',
  'reaction_set', 'reaction_remove'
]);

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: '12A7 Member API',
    firebaseConfigured: firebaseReady,
    retentionDays: RETENTION_DAYS
  });
});

app.post('/api/activity', requireFirebase, activityLimiter, requireUser, async (req, res) => {
  try {
    const event = sanitizeString(req.body && req.body.event, 40);
    if (!allowedEvents.has(event)) return res.status(400).json({ error: 'Loại hoạt động không hợp lệ.' });
    const details = req.body && req.body.details && typeof req.body.details === 'object' ? req.body.details : {};
    const consent = await getConsent(req.user.uid);
    let account = null;
    try { account = await auth.getUser(req.user.uid); } catch (_) {}
    const payload = activityPayload(req, req.user, event, details, consent.ipAudit === true, account);
    const ref = db.ref('activityLogs').push();
    await ref.set(payload);

    // A login creates a small security notice in the user's own notification inbox.
    if (event === 'login' && !req.user.firebase?.sign_in_provider?.includes('anonymous')) {
      const notice = db.ref(`notifications/${req.user.uid}`).push();
      await notice.set({
        type: 'security',
        title: 'Đăng nhập thành công',
        message: 'Tài khoản 12A7 vừa đăng nhập vào cổng thông tin.',
        createdAt: Date.now(),
        readAt: null,
        href: 'thongbao.html'
      });
    }

    res.status(201).json({ ok: true, id: ref.key, ipCollected: payload.ipCollected });
  } catch (error) {
    console.error('[12A7] activity write failed:', error.message);
    res.status(500).json({ error: 'Không ghi được nhật ký hoạt động.' });
  }
});

app.get('/api/activity/me', requireFirebase, reportLimiter, requireUser, async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(200, Number(req.query.limit || 100)));
    const snap = await db.ref('activityLogs').orderByChild('uid').equalTo(req.user.uid).limitToLast(limit).once('value');
    const records = [];
    snap.forEach(child => {
      const value = child.val() || {};
      records.push({
        id: child.key,
        event: value.event,
        postKey: value.postKey,
        reaction: value.reaction,
        createdAt: value.createdAt
      });
    });
    records.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    res.json({ records });
  } catch (error) {
    console.error('[12A7] personal activity read failed:', error.message);
    res.status(500).json({ error: 'Không tải được lịch sử hoạt động.' });
  }
});

app.get('/api/activity', requireFirebase, reportLimiter, requireUser, async (req, res) => {
  try {
    if (!(await isStaff(req.user.uid, req.user))) return res.status(403).json({ error: 'Bạn không có quyền xem nhật ký quản trị.' });
    const limit = Math.max(1, Math.min(2000, Number(req.query.limit || 500)));
    const from = Number(req.query.from || 0);
    const to = Number(req.query.to || Date.now());
    let query = db.ref('activityLogs').orderByChild('createdAt');
    if (Number.isFinite(from) && from > 0) query = query.startAt(from);
    if (Number.isFinite(to) && to > 0) query = query.endAt(to);
    query = query.limitToLast(limit);
    const snap = await query.once('value');
    const uidOrEmail = sanitizeString(req.query.user, 140).toLowerCase();
    const eventFilter = sanitizeString(req.query.event, 40);
    const includeIp = req.query.includeIp === '1';
    const records = [];
    snap.forEach(child => {
      const value = child.val() || {};
      if (eventFilter && value.event !== eventFilter) return;
      if (uidOrEmail && !String(value.uid || '').toLowerCase().includes(uidOrEmail) &&
          !String(value.email || '').toLowerCase().includes(uidOrEmail)) return;
      const record = {
        id: child.key,
        uid: value.uid || '',
        email: value.email || '',
        displayName: value.displayName || '',
        event: value.event || '',
        postKey: value.postKey || '',
        commentId: value.commentId || '',
        reaction: value.reaction || '',
        createdAt: value.createdAt || 0,
        ipMasked: value.ipMasked || '',
        ipCollected: value.ipCollected === true,
        userAgent: value.userAgent || ''
      };
      if (includeIp) record.ip = value.ip || '';
      records.push(record);
    });
    records.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    res.json({ records });
  } catch (error) {
    console.error('[12A7] staff activity read failed:', error.message);
    res.status(500).json({ error: 'Không tải được nhật ký quản trị.' });
  }
});

app.get('/api/staff/me', requireFirebase, requireUser, async (req, res) => {
  try {
    res.json({ isStaff: await isStaff(req.user.uid, req.user) });
  } catch (error) {
    res.status(500).json({ error: 'Không xác minh được quyền quản trị.' });
  }
});

app.get('/api/privacy/status', requireFirebase, requireUser, async (req, res) => {
  const consent = await getConsent(req.user.uid);
  res.json({ ipAudit: consent.ipAudit === true, version: consent.version || null });
});

app.post('/api/privacy/consent', requireFirebase, requireUser, async (req, res) => {
  try {
    const ipAudit = req.body && req.body.ipAudit === true;
    const ref = db.ref(`privacyConsents/${req.user.uid}`);
    const existing = (await ref.once('value')).val() || {};
    const now = Date.now();
    await ref.set({
      ipAudit,
      version: CONSENT_VERSION,
      updatedAt: now,
      acceptedAt: ipAudit ? (existing.acceptedAt || now) : (existing.acceptedAt || null),
      revokedAt: ipAudit ? null : now
    });

    if (!ipAudit) {
      // Revoke means future events omit IP and already-stored IP is cleared for this UID.
      const snap = await db.ref('activityLogs').orderByChild('uid').equalTo(req.user.uid).once('value');
      const updates = {};
      snap.forEach(child => {
        updates[`${child.key}/ip`] = null;
        updates[`${child.key}/ipMasked`] = null;
        updates[`${child.key}/ipCollected`] = false;
        updates[`${child.key}/consentVersion`] = null;
      });
      if (Object.keys(updates).length) await db.ref('activityLogs').update(updates);
    }
    res.json({ ok: true, ipAudit });
  } catch (error) {
    console.error('[12A7] privacy consent update failed:', error.message);
    res.status(500).json({ error: 'Không lưu được lựa chọn bảo mật.' });
  }
});

app.post('/api/notifications/broadcast', requireFirebase, broadcastLimiter, requireUser, async (req, res) => {
  try {
    if (!(await isStaff(req.user.uid, req.user))) return res.status(403).json({ error: 'Bạn không có quyền gửi thông báo.' });
    const title = sanitizeString(req.body && req.body.title, 100);
    const message = sanitizeString(req.body && req.body.message, 800);
    let href = sanitizeString(req.body && req.body.href, 180);
    if (!title || !message) return res.status(400).json({ error: 'Tiêu đề và nội dung thông báo là bắt buộc.' });
    if (href && (!href.startsWith('/') || href.startsWith('//'))) {
      // permit simple local HTML paths without a leading slash
      if (!/^[A-Za-z0-9_./?=&%-]+$/.test(href) || href.includes('..')) {
        return res.status(400).json({ error: 'Liên kết phải là đường dẫn nội bộ của website.' });
      }
    }
    const announcementRef = db.ref('announcements').push();
    const announcement = {
      title, message, href: href || 'thongbao.html',
      createdAt: Date.now(),
      createdBy: req.user.uid
    };
    await announcementRef.set(announcement);

    let sent = 0;
    let pageToken;
    do {
      const page = await auth.listUsers(1000, pageToken);
      const updates = {};
      for (const account of page.users) {
        if (account.disabled || !account.email) continue;
        const key = db.ref(`notifications/${account.uid}`).push().key;
        updates[`notifications/${account.uid}/${key}`] = {
          type: 'announcement',
          announcementId: announcementRef.key,
          title,
          message,
          href: href || 'thongbao.html',
          createdAt: announcement.createdAt,
          readAt: null
        };
        sent++;
      }
      if (Object.keys(updates).length) await db.ref().update(updates);
      pageToken = page.pageToken;
    } while (pageToken);
    res.status(201).json({ ok: true, id: announcementRef.key, sent });
  } catch (error) {
    console.error('[12A7] broadcast failed:', error.message);
    res.status(500).json({ error: 'Không gửi được thông báo toàn lớp.' });
  }
});

// Purge old audit rows in bounded batches. Runs at startup and once per day while the Render service is awake.
async function purgeOldActivityLogs() {
  if (!firebaseReady || !db) return;
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  try {
    let removedTotal = 0;
    for (let batch = 0; batch < 10; batch++) {
      const snap = await db.ref('activityLogs').orderByChild('createdAt').endAt(cutoff).limitToFirst(500).once('value');
      if (!snap.exists()) break;
      const updates = {};
      snap.forEach(child => { updates[child.key] = null; });
      const count = Object.keys(updates).length;
      if (!count) break;
      await db.ref('activityLogs').update(updates);
      removedTotal += count;
      if (count < 500) break;
    }
    if (removedTotal) console.log(`[12A7] purged ${removedTotal} audit rows older than ${RETENTION_DAYS} days.`);
  } catch (error) {
    console.warn('[12A7] log retention cleanup failed:', error.message);
  }
}
purgeOldActivityLogs();
const cleanupTimer = setInterval(purgeOldActivityLogs, 24 * 60 * 60 * 1000);
if (cleanupTimer.unref) cleanupTimer.unref();

// Serve the portal from /public. Keep server files, service credentials and .env outside the public root.
app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html'],
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  }
}));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'API endpoint không tồn tại.' });
  res.status(404).sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`[12A7] portal + API listening on ${PORT}`));
