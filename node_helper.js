'use strict';

/* =====================================================================
   MMM-pawmote — node_helper.js
   Backend MagicMirror² — Pawnote rewrite-2.0
   ===================================================================== */

const NodeHelper = require('node_helper');
const path       = require('path');
const fs         = require('fs');
const { promisify } = require('util');
const zlib       = require('zlib');
const deflateRaw = promisify(zlib.deflateRaw);
const inflateRaw = promisify(zlib.inflateRaw);

const MODULE_NAME  = 'MMM-pawmote';
const TOKEN_FILE   = path.join(__dirname, 'cache', 'tokens.json');
const UUID_FILE    = path.join(__dirname, 'cache', 'device_uuid.txt');
const PAWNOTE_DIR  = path.join(__dirname, 'node_modules', 'pawnote');

/* ── Logging avec fichier:ligne ─────────────────────────────────── */
function _getCallerLoc(depth) {
  const err   = new Error();
  const stack = (err.stack || '').split('\n');
  for (let i = depth; i < Math.min(stack.length, depth + 6); i++) {
    const line = stack[i] || '';
    if (!line || line.includes('node:') || line.includes('node_modules') || line.includes('timers')) continue;
    const m = line.match(/\(([^)]+):(\d+):\d+\)/) || line.match(/at (?:\S+ )?\(?([^):\s]+\.js):(\d+):\d+\)?/);
    if (m) return `[${path.basename(m[1])}:${m[2]}] `;
  }
  return '';
}

let _debugEnabled = false;

const Log = {
  log:   (...a) => { if (_debugEnabled) console.log(`[${MODULE_NAME}]`, ...a); },
  info:  (...a) => console.log(`[${MODULE_NAME}]`, ...a),
  warn:  (...a) => { const loc = _getCallerLoc(3); console.warn(`[${MODULE_NAME}] ${loc}`, ...a); },
  error: (...a) => { const loc = _getCallerLoc(3); console.error(`[${MODULE_NAME}] ${loc}`, ...a); }
};

/* ── Calcul semaine Pronote (1er lundi de septembre) ─────────────── */
function getPronoteWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const year      = d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1;
  const sep1      = new Date(year, 8, 1);
  const dow       = sep1.getDay();
  const firstMon  = new Date(sep1);
  if      (dow === 0) firstMon.setDate(sep1.getDate() + 1);
  else if (dow !== 1) firstMon.setDate(sep1.getDate() + (8 - dow));
  return Math.max(1, Math.floor((d.getTime() - firstMon.getTime()) / (7 * 24 * 3600 * 1000)) + 1);
}

/* ── Simple body-parser JSON (sans dépendance express) ──────────── */
function jsonBodyMiddleware(req, res, next) {
  if ((req.headers['content-type'] || '').includes('application/json')) {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end',  ()    => {
      try { req.body = JSON.parse(body); } catch { req.body = {}; }
      next();
    });
  } else {
    req.body = {};
    next();
  }
}

/* ── Requête brute Pronote (grades & carnet — non exposés en rewrite-2.0) */
async function rawPronoteRequest(session, funcName, data, signature) {
  const {
    bytesToHex, utf8ToBytes, hexToBytes, bytesToUtf8
  } = require(require.resolve('@noble/ciphers/utils.js', { paths: [PAWNOTE_DIR] }));

  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 PRONOTE Mobile APP Version/2.0.11';

  return session.api.queue.run(async () => {
    session.api.order++;
    const order = bytesToHex(session.aes.encrypt(session.api.order));
    const url   = `${session.url}/appelfonction/${session.homepage.webspace}/${session.homepage.id}/${order}`;
    const props = session.api.properties;

    const properties = {};
    if (data)      properties[props.data]      = data;
    if (signature) properties[props.signature] = signature;

    let payload;
    if (!session.api.skipCompression || !session.api.skipEncryption) {
      payload = utf8ToBytes(JSON.stringify(properties));
    }
    if (!session.api.skipCompression) {
      const hexed = utf8ToBytes(bytesToHex(payload));
      payload = new Uint8Array(await deflateRaw(Buffer.from(hexed)));
    }
    if (!session.api.skipEncryption) {
      payload = session.aes.encrypt(payload);
    }
    const secureData = payload ? bytesToHex(payload) : properties;
    const body = JSON.stringify({
      [props.orderNumber]: order,
      [props.requestId]:   funcName,
      [props.secureData]:  secureData,
      [props.session]:     session.homepage.id
    });

    const resp = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body
    });
    const content = await resp.text();

    session.api.order++;
    const json = JSON.parse(content);
    if (json.Erreur) throw new Error(json.Erreur.Titre || 'Erreur serveur Pronote');

    let respData = json[props.secureData];
    if (typeof respData === 'string') {
      let bytes = hexToBytes(respData);
      if (!session.api.skipEncryption)  bytes = session.aes.decrypt(bytes);
      if (!session.api.skipCompression) bytes = new Uint8Array(await inflateRaw(Buffer.from(bytes)));
      respData = JSON.parse(bytesToUtf8(bytes));
    }
    if (respData[props.signature]?.Erreur) throw new Error(respData[props.signature].MessageErreur);
    return respData[props.data];
  });
}

/* ── Décodeurs helpers ───────────────────────────────────────────── */
function decodeGradeValue(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const parts = v.split('|');
    if (parts.length >= 2 && parseInt(parts[1]) === 1) return null;
    const n = parseFloat(v.replace(',', '.'));
    return isNaN(n) ? null : n;
  }
  return null;
}
function decodePronoteDate(v) {
  if (!v) return null;
  const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}
function encodePronoteDate(date) {
  const d = date.getDate().toString().padStart(2, '0');
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  return `${d}/${m}/${date.getFullYear()} 00:00:00`;
}
function formatTime(d, lang) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return '';
  return dt.toLocaleTimeString(lang || 'fr-FR', { hour: '2-digit', minute: '2-digit', hour12: false });
}
function formatDate(d, lang, opts) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString(lang || 'fr-FR', opts || {});
}
function getCurrentPeriod(user, today) {
  const periods = user.parameters?.periods || [];
  return periods.find(p =>
    p.startDate && p.endDate &&
    today >= new Date(p.startDate) && today <= new Date(p.endDate)
  ) || periods[periods.length - 1] || null;
}
function isCancelled(e) {
  if (typeof e.isLesson === 'function') return e.isLesson() && !!(e.canceled || e.cancelled);
  return !!(e.canceled || e.cancelled || (e.status && /annul/i.test(e.status)));
}
function mapTimetableEntry(e, lang) {
  const isLsn = typeof e.isLesson === 'function' ? e.isLesson() : (e.is === 'lesson');
  return {
    subject:   isLsn ? (e.subject?.name || '') : (e.title || ''),
    teacher:   Array.isArray(e.teachers)    ? e.teachers.join(', ')    : (Array.isArray(e.teacherNames) ? e.teacherNames.join(', ') : ''),
    room:      Array.isArray(e.rooms)       ? e.rooms.join(', ')       : (Array.isArray(e.classrooms)   ? e.classrooms.join(', ')   : ''),
    start:     formatTime(e.startDate, lang),
    end:       formatTime(e.endDate,   lang),
    cancelled: isCancelled(e),
    isDetention: typeof e.isDetention === 'function' ? e.isDetention() : (e.is === 'detention'),
    status:    e.status || ''
  };
}

/* ======================================================================
   NODE HELPER
   ====================================================================== */
module.exports = NodeHelper.create({

  /* ── Initialisation ──────────────────────────────────────────────── */
  start () {
    this.config       = null;
    this.updateTimer  = null;
    this.isConnecting = false;
    this.pawnote      = null;
    Log.info('Node helper started');
    this._setupRoutes();
  },

  /* ── Express — page de configuration ─────────────────────────────── */
  _setupRoutes () {
    const app = this.expressApp;

    /* Page HTML de configuration */
    app.get('/MMM-pawmote/config', (req, res) => {
      res.sendFile(path.join(__dirname, 'config-page', 'index.html'));
    });

    /* API — statut du token */
    app.get('/MMM-pawmote/api/status', (req, res) => {
      const t = this._loadTokens();
      res.json({
        hasTokens:  !!t,
        hasPrimary: !!(t?.primary?.token),
        hasBackup:  !!(t?.backup?.token),
        url:         t?.pronote_url || '',
        username:    t?.username    || '',
        isParent:    t?.isParent    || false,
        childName:   t?.childName   || '',
        children:    t?.children    || []
      });
    });

    /* API — connexion initiale QR Code */
    app.post('/MMM-pawmote/api/setup-qr', jsonBodyMiddleware, async (req, res) => {
      try {
        const { qrToken, pin, url, childName } = req.body;
        if (!qrToken || !pin) return res.status(400).json({ error: 'qrToken et pin requis' });

        const qrData = typeof qrToken === 'string' ? JSON.parse(qrToken) : qrToken;
        const pronoteUrl = String(url || qrData.url || qrData.pronote_url || '')
          .replace(/\/mobile\.[^/]+\.html.*$/, '');

        if (!pronoteUrl) return res.status(400).json({ error: 'URL Pronote non détectée dans le QR Code' });
        if (!/^\d{4}$/.test(String(pin))) return res.status(400).json({ error: 'PIN invalide (4 chiffres requis)' });

        Log.info('Setup QR Code — URL:', pronoteUrl);
        const result = await this._connectQR({ qrData, pin: String(pin), pronoteUrl, childName });
        res.json({ ok: true, username: result.username, isParent: result.isParent, children: result.children });

        /* Déclenche la collecte de données */
        this.sendSocketNotification('TOKEN_SAVED', { username: result.username });
        setTimeout(() => this._connectAndFetch(), 500);
      } catch (e) {
        Log.error('Setup QR:', e.message);
        res.status(500).json({ error: e.message });
      }
    });

    /* API — connexion par identifiants */
    app.post('/MMM-pawmote/api/setup-credentials', jsonBodyMiddleware, async (req, res) => {
      try {
        const { url, username, password, isParent, childName } = req.body;
        if (!url || !username || !password) return res.status(400).json({ error: 'url, username et password requis' });

        Log.info('Setup credentials — URL:', url);
        const result = await this._connectCredentials({ url, username, password, isParent: !!isParent, childName });
        res.json({ ok: true, username: result.username, isParent: result.isParent, children: result.children });

        this.sendSocketNotification('TOKEN_SAVED', { username: result.username });
        setTimeout(() => this._connectAndFetch(), 500);
      } catch (e) {
        Log.error('Setup credentials:', e.message);
        res.status(500).json({ error: e.message });
      }
    });

    /* API — effacer les tokens */
    app.post('/MMM-pawmote/api/clear', (req, res) => {
      try {
        if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE);
        res.json({ ok: true });
        this.sendSocketNotification('TOKEN_CLEARED', {});
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });
  },

  /* ── Chargement de Pawnote ────────────────────────────────────────── */
  _loadPawnote () {
    if (this.pawnote) return this.pawnote;
    if (!fs.existsSync(PAWNOTE_DIR)) {
      throw new Error('Module pawnote absent — lancez npm install dans le dossier MMM-pawmote');
    }
    try {
      this.pawnote = require(PAWNOTE_DIR);
      Log.info('Pawnote chargé (CJS)');
      return this.pawnote;
    } catch (e) {
      Log.error('Impossible de charger pawnote:', e.message);
      throw e;
    }
  },

  /* ── UUID appareil persistant ─────────────────────────────────────── */
  _getOrCreateDeviceUUID () {
    const cacheDir = path.join(__dirname, 'cache');
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
    if (fs.existsSync(UUID_FILE)) return fs.readFileSync(UUID_FILE, 'utf8').trim();
    const uuid = 'mmm-pawmote-' + ([...Array(8)].map(() => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('')) + '-' + Date.now();
    fs.writeFileSync(UUID_FILE, uuid, 'utf8');
    return uuid;
  },

  /* ── Tokens ───────────────────────────────────────────────────────── */
  _loadTokens () {
    try {
      if (fs.existsSync(TOKEN_FILE)) return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    } catch (e) { Log.error('Lecture tokens:', e.message); }
    return null;
  },

  _saveTokens (tokens) {
    try {
      const dir = path.dirname(TOKEN_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2), 'utf8');
    } catch (e) { Log.error('Sauvegarde tokens:', e.message); }
  },

  _rotateToken (tokens, newToken) {
    /* Rotation : ancien primary → backup, nouveau → primary */
    const updated = { ...tokens };
    if (tokens.primary?.token) {
      updated.backup = { token: tokens.primary.token, updatedAt: tokens.primary.updatedAt };
    }
    updated.primary = { token: newToken, updatedAt: new Date().toISOString() };
    this._saveTokens(updated);
    return updated;
  },

  /* ── Connexion initiale QR Code ───────────────────────────────────── */
  async _connectQR ({ qrData, pin, pronoteUrl, childName }) {
    const pw = this._loadPawnote();
    const deviceUUID = this._getOrCreateDeviceUUID();
    const isParent   = pronoteUrl.toLowerCase().includes('parent');
    const instance   = pw.Instance.fromURL(pronoteUrl);
    const portal     = isParent ? new pw.ParentLoginPortal(instance) : new pw.StudentLoginPortal(instance);

    const auth = await portal.qrCode(qrData.jeton, qrData.login || undefined, pin, deviceUUID);

    if (auth.shouldCustomDoubleAuthMode) {
      if (auth.hasIgnoreMode) auth.useIgnoreMode();
      else if (auth.hasNotificationMode) auth.useNotificationMode();
    }
    if (auth.shouldRegisterSource) await auth.source('MMM-pawmote');

    const user     = await portal.finish(auth);
    const children = isParent ? (user.children || []).map(c => ({ id: c.id || '', name: c.name || '' })).filter(c => c.name) : [];

    const tokens = {
      pronote_url: instance.base || pronoteUrl,
      username:    user.username || '',
      deviceUUID,
      isParent,
      childName:   childName || (children.length === 1 ? children[0].name : ''),
      children,
      primary:  { token: user.token || '', updatedAt: new Date().toISOString() },
      backup:   null
    };
    this._saveTokens(tokens);
    Log.info(`QR OK — ${tokens.username} (parent:${isParent})`);
    return { username: tokens.username, isParent, children };
  },

  /* ── Connexion par identifiants ───────────────────────────────────── */
  async _connectCredentials ({ url, username, password, isParent, childName }) {
    const pw       = this._loadPawnote();
    const deviceUUID = this._getOrCreateDeviceUUID();
    const instance = pw.Instance.fromURL(url);
    const portal   = isParent ? new pw.ParentLoginPortal(instance) : new pw.StudentLoginPortal(instance);

    const auth = await portal.credentials(username, password, deviceUUID);

    if (auth.shouldCustomDoubleAuthMode) {
      if (auth.hasIgnoreMode) auth.useIgnoreMode();
      else if (auth.hasNotificationMode) auth.useNotificationMode();
    }
    if (auth.shouldRegisterSource) await auth.source('MMM-pawmote');

    const user     = await portal.finish(auth);
    const detectedParent = isParent || url.toLowerCase().includes('parent');
    const children = detectedParent ? (user.children || []).map(c => ({ id: c.id || '', name: c.name || '' })).filter(c => c.name) : [];

    const tokens = {
      pronote_url: instance.base || url,
      username:    user.username || username,
      deviceUUID,
      isParent:    detectedParent,
      childName:   childName || (children.length === 1 ? children[0].name : ''),
      children,
      primary:  { token: user.token || '', updatedAt: new Date().toISOString() },
      backup:   null
    };
    this._saveTokens(tokens);
    Log.info(`Credentials OK — ${tokens.username} (parent:${detectedParent})`);
    return { username: tokens.username, isParent: detectedParent, children };
  },

  /* ── Connexion via token ─────────────────────────────────────────── */
  async _loginWithToken (tokenData, tokenEntry) {
    const pw       = this._loadPawnote();
    const instance = pw.Instance.fromURL(tokenData.pronote_url);
    const portal   = tokenData.isParent ? new pw.ParentLoginPortal(instance) : new pw.StudentLoginPortal(instance);

    const auth = await portal.token(tokenData.username, tokenEntry.token, tokenData.deviceUUID);

    if (auth.shouldCustomDoubleAuthMode) {
      if (auth.hasIgnoreMode) auth.useIgnoreMode();
      else if (auth.hasNotificationMode) auth.useNotificationMode();
    }
    if (auth.shouldRegisterSource) await auth.source('MMM-pawmote');

    const user = await portal.finish(auth);
    /* Rotation du token */
    const updatedTokens = this._rotateToken(tokenData, user.token || tokenEntry.token);
    return { user, tokens: updatedTokens };
  },

  /* ── Connexion + collecte principale ────────────────────────────── */
  async _connectAndFetch () {
    if (this.isConnecting) { Log.log('Connexion déjà en cours, ignorée'); return; }
    this.isConnecting = true;
    try {
      const tokenData = this._loadTokens();
      if (!tokenData || !tokenData.primary?.token) {
        Log.warn('Aucun token de connexion');
        this.sendSocketNotification('ERROR', {
          type:      'no_tokens',
          message:   'Aucun token configuré. Configurez le module via la page web.',
          configUrl: '/MMM-pawmote/config'
        });
        return;
      }

      let user   = null;
      let tokens = null;

      /* Essai primary */
      try {
        Log.info('Connexion avec token primary…');
        const r = await this._loginWithToken(tokenData, tokenData.primary);
        user   = r.user;
        tokens = r.tokens;
        Log.info('Connecté via token primary');
      } catch (e1) {
        Log.warn('Token primary échoué:', e1.message);

        if (!tokenData.backup?.token) {
          Log.error('Pas de token backup disponible');
          this.sendSocketNotification('ERROR', {
            type:      'auth_failed',
            message:   'Connexion impossible (token expiré). Reconfigurez le module.',
            configUrl: '/MMM-pawmote/config'
          });
          return;
        }

        /* Essai backup */
        try {
          Log.info('Connexion avec token backup…');
          const r = await this._loginWithToken(tokenData, tokenData.backup);
          user   = r.user;
          tokens = r.tokens;
          Log.info('Connecté via token backup');
        } catch (e2) {
          Log.error('Token backup aussi échoué:', e2.message);
          this.sendSocketNotification('ERROR', {
            type:      'auth_failed',
            message:   `Connexion impossible (les deux tokens ont échoué : ${e2.message}). Reconfigurez le module.`,
            configUrl: '/MMM-pawmote/config'
          });
          return;
        }
      }

      /* Collecte des données */
      const data = await this._fetchAllData(user, tokens);
      this.sendSocketNotification('PRONOTE_UPDATED', data);

    } catch (e) {
      Log.error('Erreur connexion/collecte:', e.message);
      this.sendSocketNotification('ERROR', {
        type:      'error',
        message:   `Erreur inattendue : ${e.message}`,
        configUrl: '/MMM-pawmote/config'
      });
    } finally {
      this.isConnecting = false;
    }
  },

  /* ── Collecte des données ────────────────────────────────────────── */
  async _fetchAllData (user, tokens) {
    const today    = new Date();
    const weekNum  = getPronoteWeek(today);
    const isParent = tokens.isParent;
    const lang     = this.config?.language || 'fr-FR';
    const data     = {};

    /* ---- Sélection du sujet (élève ou enfant parent) ---- */
    let subject;
    if (isParent) {
      const childName = tokens.childName || '';
      const children  = user.children || [];
      subject = childName
        ? children.find(c => c.name?.toLowerCase().includes(childName.toLowerCase()))
        : null;
      if (!subject && children.length > 0) subject = children[0];
      if (!subject) throw new Error('Aucun enfant disponible dans le compte parent');
      Log.info('Enfant sélectionné:', subject.name);

      data.name          = subject.name || '';
      data.className     = subject.studentClass || '';
      data.establishment = subject.school || '';
    } else {
      subject            = user;
      data.name          = user.username || '';
      data.className     = user.user?.resource?.classeEleve?.name   || '';
      data.establishment = user.user?.resource?.etablissement?.name || '';
    }

    Log.info(`Élève : ${data.name} — ${data.className} — ${data.establishment}`);

    /* ---- Emploi du temps ---- */
    data.timetableToday   = [];
    data.timetableNextDay = { day: '', classes: [] };
    try {
      const tt = await subject.administration.getTimetableFromWeek(weekNum);
      let allEntries;
      try { allEntries = tt.filter ? tt.filter() : (tt.entries || []); }
      catch { allEntries = tt.entries || []; }

      const todayStr     = today.toDateString();
      const todayEntries = allEntries.filter(e => e.startDate && new Date(e.startDate).toDateString() === todayStr);

      /* Filtrer les cours passés si configuré */
      const showFromNow   = this.config?.Timetable?.showOnlyFuture ?? false;
      const filteredToday = showFromNow
        ? todayEntries.filter(e => !e.endDate || new Date(e.endDate) >= today)
        : todayEntries;

      data.timetableToday = filteredToday.map(e => mapTimetableEntry(e, lang));
      data.cancelledToday = data.timetableToday.filter(c => c.cancelled).length;

      const sortedToday = [...todayEntries].sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
      data.todayStart = sortedToday.length ? formatTime(sortedToday[0].startDate, lang) : '';
      data.todayEnd   = sortedToday.length ? formatTime(sortedToday[sortedToday.length - 1].endDate, lang) : '';

      /* Prochain jour scolaire */
      const weekCache = { [weekNum]: allEntries };
      let nextEntries = [], nextDate = null;
      for (let i = 1; i <= 14; i++) {
        const d  = new Date(today); d.setDate(today.getDate() + i);
        const wn = getPronoteWeek(d);
        let wEntries;
        if (weekCache[wn]) {
          wEntries = weekCache[wn];
        } else {
          try {
            const wt = await subject.administration.getTimetableFromWeek(wn);
            try { wEntries = wt.filter ? wt.filter() : (wt.entries || []); }
            catch { wEntries = wt.entries || []; }
            weekCache[wn] = wEntries;
          } catch { break; }
        }
        const dayEntries = wEntries.filter(e => e.startDate && new Date(e.startDate).toDateString() === d.toDateString() && !isCancelled(e));
        if (dayEntries.length > 0) { nextEntries = dayEntries; nextDate = d; break; }
      }

      const dayLabel   = nextDate
        ? formatDate(nextDate, lang, { weekday: 'long', day: 'numeric', month: 'long' })
        : '';
      const sortedNext = [...nextEntries].sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
      data.timetableNextDay = {
        day:     dayLabel,
        start:   sortedNext.length ? formatTime(sortedNext[0].startDate, lang) : '',
        end:     sortedNext.length ? formatTime(sortedNext[sortedNext.length - 1].endDate, lang) : '',
        classes: nextEntries.map(e => mapTimetableEntry(e, lang))
      };
      Log.info(`EDT aujourd'hui: ${data.timetableToday.length} cours | prochain jour: ${data.timetableNextDay.classes.length} cours`);
    } catch (e) {
      Log.error('EDT:', e.message);
    }

    /* ---- Devoirs ---- */
    data.homeworks = [];
    try {
      const hwList     = await subject.homework.getAssignmentsFromWeek(weekNum);
      const searchDays = this.config?.Homeworks?.searchDays ?? 14;
      const limitDate  = new Date(today.getTime() + searchDays * 24 * 3600 * 1000);

      data.homeworks = hwList
        .filter(h => {
          const d = h.deadline || h.dueDate;
          if (!d) return false;
          const dt = d instanceof Date ? d : new Date(d);
          return dt >= today && dt <= limitDate;
        })
        .sort((a, b) => {
          const da = a.deadline || a.dueDate; const db = b.deadline || b.dueDate;
          return new Date(da) - new Date(db);
        })
        .map(h => ({
          subject:     h.subject?.name || '',
          description: h.description  || h.content || '',
          done:        !!(h.done || h.isDone),
          deadline:    formatDate(h.deadline || h.dueDate, lang, { weekday: 'short', day: 'numeric', month: 'short' })
        }));
      Log.info(`Devoirs: ${data.homeworks.length} (${data.homeworks.filter(h => !h.done).length} non faits)`);
    } catch (e) {
      Log.error('Devoirs:', e.message);
    }

    /* ---- Notes (protocole brut DernieresNotes) ---- */
    data.grades = [];
    try {
      const session = user.session;
      const period  = getCurrentPeriod(user, today);
      if (!period) throw new Error('Aucune période disponible');
      const periodePayload = { N: period.id, G: period.kind, L: period.name };
      const sig = { onglet: 198 };
      if (isParent && subject) sig.membre = { G: subject.kind, N: subject.id };
      const notesData       = await rawPronoteRequest(session, 'DernieresNotes', { Periode: periodePayload }, sig);
      const displayDuration = (this.config?.Grades?.displayDuration ?? 30) * 24 * 3600 * 1000;
      const cutoff          = new Date(today.getTime() - displayDuration);

      data.grades = (notesData.listeDevoirs?.V || [])
        .filter(g => {
          const dt = decodePronoteDate(g.date?.V);
          return !dt || new Date(dt) >= cutoff;
        })
        .map(g => ({
          subject:       g.service?.V?.L || '',
          value:         decodeGradeValue(g.note?.V),
          outOf:         decodeGradeValue(g.bareme?.V) ?? 20,
          average:       g.moyenne ? decodeGradeValue(g.moyenne.V) : null,
          date:          decodePronoteDate(g.date?.V),
          formattedDate: decodePronoteDate(g.date?.V) ? formatDate(new Date(decodePronoteDate(g.date.V)), lang) : '',
          comment:       g.commentaire || '',
          coefficient:   g.coefficient || 1
        }));
      Log.info(`Notes: ${data.grades.length}`);
    } catch (e) {
      Log.warn('Notes:', e.message);
    }

    /* ---- Carnet (absences, retards, punitions) via PagePresence brut ---- */
    data.absences    = [];
    data.delays      = [];
    data.punishments = [];
    try {
      const session      = user.session;
      const carnetPeriod = subject?.administration?.getCorrespondenceNotebookDefaultPeriod?.() || getCurrentPeriod(user, today);
      if (!carnetPeriod) throw new Error('Aucune période carnet disponible');
      const periodePayload = { N: carnetPeriod.id, G: carnetPeriod.kind, L: carnetPeriod.name };
      const sig = { onglet: 73 };
      if (isParent && subject) sig.membre = { G: subject.kind, N: subject.id };

      const carnetData = await rawPronoteRequest(session, 'PagePresence', {
        periode:   periodePayload,
        DateDebut: { _T: 7, V: encodePronoteDate(new Date(carnetPeriod.startDate)) },
        DateFin:   { _T: 7, V: encodePronoteDate(new Date(carnetPeriod.endDate)) }
      }, sig);

      const absenceDays    = (this.config?.Absences?.displayDuration    ?? 60) * 24 * 3600 * 1000;
      const delayDays      = (this.config?.Delays?.displayDuration      ?? 60) * 24 * 3600 * 1000;
      const punishmentDays = (this.config?.Punishments?.displayDuration ?? 60) * 24 * 3600 * 1000;
      const absenceCutoff    = new Date(today.getTime() - absenceDays);
      const delayCutoff      = new Date(today.getTime() - delayDays);
      const punishmentCutoff = new Date(today.getTime() - punishmentDays);

      const maxAbsences    = this.config?.Absences?.number    ?? 5;
      const maxDelays      = this.config?.Delays?.number      ?? 5;
      const maxPunishments = this.config?.Punishments?.number ?? 5;

      for (const item of carnetData.listeAbsences?.V || []) {
        switch (item.G) {
          case 13: { /* Absence */
            const date = decodePronoteDate(item.dateDebut?.V);
            if (date && new Date(date) >= absenceCutoff && data.absences.length < maxAbsences) {
              data.absences.push({
                date:          date,
                endDate:       decodePronoteDate(item.dateFin?.V),
                formattedDate: formatDate(new Date(date), lang, { day: 'numeric', month: 'short', year: 'numeric' }),
                reason:        item.estMotifNonEncoreConnu ? 'Motif à venir' : (item.listeMotifs?.V?.[0]?.L || 'Non renseigné'),
                justified:     !!(item.justifie),
                hours:         item.NbrHeures || '',
                days:          item.NbrJours  || 0
              });
            }
            break;
          }
          case 14: { /* Retard */
            const date = decodePronoteDate(item.date?.V);
            if (date && new Date(date) >= delayCutoff && data.delays.length < maxDelays) {
              data.delays.push({
                date:          date,
                formattedDate: formatDate(new Date(date), lang, { day: 'numeric', month: 'short', year: 'numeric' }),
                duration:      item.duree || 0,
                justified:     !!(item.justifie),
                reason:        item.estMotifNonEncoreConnu ? 'Motif à venir' : (item.listeMotifs?.V?.[0]?.L || '')
              });
            }
            break;
          }
          case 41: { /* Punition */
            const date = decodePronoteDate(item.dateDemande?.V);
            if (date && new Date(date) >= punishmentCutoff && data.punishments.length < maxPunishments) {
              data.punishments.push({
                date:          date,
                formattedDate: formatDate(new Date(date), lang, { day: 'numeric', month: 'short', year: 'numeric' }),
                type:          item.nature?.V?.L || 'Punition',
                reason:        (item.listeMotifs?.V || []).map(m => m.L).filter(Boolean).join(', ')
              });
            }
            break;
          }
        }
      }
      Log.info(`Absences:${data.absences.length} | Retards:${data.delays.length} | Punitions:${data.punishments.length}`);
    } catch (e) {
      Log.warn('Carnet:', e.message);
    }

    return data;
  },

  /* ── Réception des notifications socket ─────────────────────────── */
  socketNotificationReceived (notification, payload) {
    switch (notification) {
      case 'SET_CONFIG':
        this.config   = payload;
        _debugEnabled = !!payload.debug;
        Log.info('Configuration reçue, démarrage du cycle de mise à jour');
        this._startUpdateCycle();
        break;
    }
  },

  /* ── Cycle de mise à jour ────────────────────────────────────────── */
  _startUpdateCycle () {
    clearInterval(this.updateTimer);
    this.sendSocketNotification('INITIALIZED', {});
    this._connectAndFetch();
    const interval = this._parseInterval(this.config?.updateInterval || '15m');
    this.updateTimer = setInterval(() => this._connectAndFetch(), interval);
    Log.info(`Mise à jour toutes les ${this.config?.updateInterval || '15m'}`);
  },

  _parseInterval (str) {
    const m = String(str).match(/^(\d+)([smhd])$/);
    if (!m) return 15 * 60 * 1000;
    const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
    return parseInt(m[1]) * (multipliers[m[2]] || 60000);
  }
});
