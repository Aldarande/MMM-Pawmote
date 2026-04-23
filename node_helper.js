'use strict';

/* =====================================================================
   MMM-Pawmote — node_helper.js
   Backend MagicMirror² — Pawnote functional API rewrite
   ===================================================================== */

const NodeHelper = require('node_helper');
const path       = require('path');
const fs         = require('fs');

const MODULE_NAME  = 'MMM-Pawmote';
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

/* Debug activé par instance (SET_CONFIG) — évite la contamination croisée */
const _debugInstances = new Set();

/* ── Buffer de logs circulaire (exposé via /api/logs) ──────────────── */
const _logBuffer = [];
function _addToBuffer (level, args) {
  const msg = args.map(a =>
    a === null ? 'null'
    : a === undefined ? 'undefined'
    : typeof a === 'object' ? (() => { try { return JSON.stringify(a); } catch { return String(a); } })()
    : String(a)
  ).join(' ');
  _logBuffer.push({ ts: Date.now(), level, msg });
  if (_logBuffer.length > 300) _logBuffer.shift();
}

const Log = {
  log:   (...a) => { if (_debugInstances.size > 0) { console.log(`[${MODULE_NAME}]`, ...a); _addToBuffer('log', a); } },
  info:  (...a) => { console.log(`[${MODULE_NAME}]`, ...a); _addToBuffer('info', a); },
  warn:  (...a) => { const loc = _getCallerLoc(3); console.warn(`[${MODULE_NAME}] ${loc}`, ...a); _addToBuffer('warn', [loc, ...a]); },
  error: (...a) => { const loc = _getCallerLoc(3); console.error(`[${MODULE_NAME}] ${loc}`, ...a); _addToBuffer('error', [loc, ...a]); }
};

/* ── Requête brute protocole Pronote (portage pawjote) ───────────── */
/* Nécessaire pour les comptes parents : les API publiques pawnote     */
/* n'ajoutent pas sig.membre → AccessDeniedError sur DernieresNotes    */
/* et PagePresence.                                                     */
/* Structure interne pawnote rewrite-2.0 :                             */
/*   session.information.{ order, id, accountKind, url,                */
/*     skipCompression, skipEncryption, aesKey, aesIV }               */
/*   session.queue.push(asyncFn) → Promise                             */
/*   session.fetcher({ url, method, headers, content }) → { content }  */
/*   W(session) → { data, orderNumber, secureData, requestId,          */
/*                  signature, session }                                */
/*   J.encrypt/decrypt (AES-CBC via node-forge)                        */
/*   Q(session[, firstOrder]) → { key, iv }  (forge buffers)          */
/*   pako.deflateRaw / pako.inflateRaw                                 */
async function rawPronoteRequest(pawnoteModule, session, funcName, data, signature) {
  /* Récupère les fonctions internes exposées par le module pawnote */
  const forge = require(require.resolve('node-forge', { paths: [require.resolve('pawnote')] }));
  const pako  = require(require.resolve('pako',       { paths: [require.resolve('pawnote')] }));

  /* Réplique de W(session) — property names selon la version Pronote */
  const ver = session.instance?.version;
  const isNew = ver && (ver[0] > 2024 || (ver[0] === 2024 && ver[1] >= 3));
  const props = isNew
    ? { data: 'data', orderNumber: 'no', secureData: 'dataSec', requestId: 'id', signature: 'Signature', session: 'session' }
    : { data: 'donneesSec',  orderNumber: 'numeroOrdre', secureData: 'crypTO', requestId: 'nom',    signature: 'genreErreur', session: 'session' };

  /* Réplique de Q(session, firstOrder) */
  const getKeys = (first = false) => {
    const iv  = forge.util.createBuffer(first ? '' : session.information.aesIV);
    const key = forge.util.createBuffer(session.information.aesKey);
    return { key, iv };
  };

  /* AES-CBC encrypt/decrypt via node-forge (réplique de J) */
  const aesEncrypt = (str) => {
    const { key, iv } = getKeys();
    const k2 = forge.md.md5.create().update(key.bytes()).digest();
    const i2 = iv.length() ? forge.md.md5.create().update(iv.bytes()).digest()
                            : forge.util.createBuffer().fillWithByte(0, 16);
    const buf = forge.util.createBuffer(str);
    const c = forge.cipher.createCipher('AES-CBC', k2);
    c.start({ iv: i2 }); c.update(buf); c.finish();
    return c.output.toHex();
  };

  const aesDecrypt = (hexStr) => {
    const { key, iv } = getKeys();
    const k2 = forge.md.md5.create().update(key.bytes()).digest();
    const i2 = iv.length() ? forge.md.md5.create().update(iv.bytes()).digest()
                            : forge.util.createBuffer().fillWithByte(0, 16);
    const buf = forge.util.createBuffer(forge.util.binary.hex.decode(hexStr));
    const c = forge.cipher.createDecipher('AES-CBC', k2);
    c.start({ iv: i2 }); c.update(buf); c.finish();
    return c.output.toString();
  };

  return session.queue.push(async () => {
    /* ── Envoi ── */
    session.information.order++;

    /* generateOrder : chiffre le numéro d'ordre (premier appel : IV vide) */
    const orderStr  = session.information.order.toString();
    const { key: ok, iv: oi } = getKeys(session.information.order === 1);
    const ok2 = forge.md.md5.create().update(ok.bytes()).digest();
    const oi2 = oi.length() ? forge.md.md5.create().update(oi.bytes()).digest()
                             : forge.util.createBuffer().fillWithByte(0, 16);
    const oc  = forge.cipher.createCipher('AES-CBC', ok2);
    oc.start({ iv: oi2 }); oc.update(forge.util.createBuffer(orderStr)); oc.finish();
    const order = oc.output.toHex();

    const url = new URL(`${session.information.url}/appelfonction/${session.information.accountKind}/${session.information.id}/${order}`);

    /* Construit le payload */
    const properties = {};
    if (data)      properties[props.data]      = data;
    if (signature) properties[props.signature] = signature;

    let secureData;
    if (!session.information.skipCompression || !session.information.skipEncryption) {
      let payload = forge.util.encodeUtf8(JSON.stringify(properties));
      if (!session.information.skipCompression) {
        /* JSON → hex string → utf8 bytes → deflateRaw */
        const hexStr  = forge.util.binary.hex.encode(forge.util.createBuffer(payload).bytes());
        const deflated = pako.deflateRaw(forge.util.binary.raw.decode(hexStr));
        payload = forge.util.binary.raw.encode(deflated);
      }
      if (!session.information.skipEncryption) {
        payload = aesEncrypt(payload);
      } else {
        payload = forge.util.binary.hex.encode(forge.util.createBuffer(payload).bytes());
      }
      secureData = payload;
    } else {
      secureData = properties;
    }

    const body = JSON.stringify({
      [props.orderNumber]: order,
      [props.requestId]:   funcName,
      [props.secureData]:  secureData,
      [props.session]:     session.information.id
    });

    const result = await session.fetcher({
      url,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 PRONOTE Mobile APP Version/2.0.11' },
      content: body
    });

    /* ── Réception ── */
    session.information.order++;
    const json = JSON.parse(result.content);
    if (json.Erreur) throw new Error(json.Erreur.Titre || 'Erreur serveur Pronote');

    let respData = json[props.secureData];
    if (typeof respData === 'string') {
      let decoded = aesDecrypt(respData);
      if (!session.information.skipCompression) {
        const bytes   = forge.util.binary.raw.decode(decoded);
        const hexStr  = forge.util.binary.hex.encode(bytes);
        const inflated = pako.inflateRaw(forge.util.binary.raw.decode(hexStr));
        decoded = forge.util.encodeUtf8(String.fromCharCode(...inflated));
      }
      respData = JSON.parse(decoded);
    }

    if (respData[props.signature]?.Erreur) throw new Error(respData[props.signature].MessageErreur || 'Erreur Pronote');
    return respData[props.data];
  });
}

/* ── Helpers protocole Pronote ───────────────────────────────────── */
function encodePronoteDate(date) {
  const d = date.getDate().toString().padStart(2, '0');
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  return `${d}/${m}/${date.getFullYear()} 00:00:00`;
}

function decodePronoteDate(v) {
  if (!v) return null;
  const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? new Date(`${m[3]}-${m[2]}-${m[1]}`) : null;
}

/* Parse "DD/MM/YYYY HH:MM:SS" (or date-only) → Date with correct local time */
function parsePronoteFullDate(v) {
  if (!v) return null;
  const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?/);
  if (!m) return null;
  const d = new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));
  if (m[4]) d.setHours(parseInt(m[4]), parseInt(m[5]), parseInt(m[6] || 0), 0);
  return d;
}

/* Parse raw ListeCours from PageEmploiDuTemps into pawnote-compatible entries */
function parseRawCourses(rawData, session) {
  return (rawData?.ListeCours || []).map(e => {
    const startDate = parsePronoteFullDate(e.DateDuCours?.V);
    if (!startDate) return null;

    let endDate;
    if (typeof e.DateDuCoursFin?.V === 'string') {
      endDate = parsePronoteFullDate(e.DateDuCoursFin.V) || startDate;
    } else {
      const place        = e.place || 0;
      const duree        = e.duree || 1;
      const endings      = session.instance?.endings || [];
      const blocksPerDay = session.instance?.blocksPerDay || 8;
      const endIdx       = (place % blocksPerDay) + duree - 1;
      const endSlot      = endings[Math.min(endIdx, endings.length - 1)];
      if (endSlot) {
        const [h, mn] = endSlot.split('h').map(Number);
        endDate = new Date(startDate);
        endDate.setHours(h, mn || 0, 0, 0);
      } else {
        endDate = new Date(startDate.getTime() + duree * 15 * 60 * 1000);
      }
    }

    let subjectName = '', teacherName = '', classroomName = '';
    for (const item of e.ListeContenus?.V || []) {
      switch (item.G) {
        case 16: subjectName    = item.L || ''; break;
        case 3:  if (!teacherName)   teacherName   = item.L || ''; break;
        case 17: if (!classroomName) classroomName = item.L || ''; break;
      }
    }

    return {
      is:           (typeof e.estRetenue !== 'undefined') ? 'detention' : 'lesson',
      subject:      subjectName ? { name: subjectName } : null,
      teacherNames: teacherName   ? [teacherName]   : [],
      classrooms:   classroomName ? [classroomName] : [],
      startDate,
      endDate,
      canceled:     !!e.estAnnule,
      status:       e.Statut || ''
    };
  }).filter(Boolean);
}

/* Parse raw ListeTravauxAFaire from PageCahierDeTexte */
function parseRawAssignments(rawData) {
  return (rawData?.ListeTravauxAFaire?.V || []).map(e => {
    const deadline = decodePronoteDate(e.PourLe?.V);
    if (!deadline) return null;
    let description = '';
    if (e.descriptif?.V) description = String(e.descriptif.V).replace(/<[^>]*>/g, '').trim();
    return {
      subject:     { name: e.Matiere?.V?.L || '' },
      description,
      done:        !!e.TAFFait,
      deadline
    };
  }).filter(Boolean);
}

function decodeGradeValue(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const parts = v.split('|');
    if (parts.length >= 2 && parseInt(parts[1]) === 1) return null; // absent/non noté
    const n = parseFloat(v.replace(',', '.'));
    return isNaN(n) ? null : n;
  }
  return null;
}

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

/* Détermine si une erreur Pawnote est due à une expiration de session/token
 * (dans ce cas le backup doit être utilisé) ou à un problème réseau/serveur
 * (dans ce cas le primary est encore valide et sera réessayé au prochain cycle). */
function _isAuthError (e) {
  if (!e) return false;
  const name = e.constructor?.name || '';
  const msg  = (e.message || '').toLowerCase();
  /* Classes d'erreur pawnote explicitement liées à l'auth */
  if (['SessionExpiredError', 'AuthenticateError', 'BadCredentialsError',
       'AccessDeniedError', 'AccountDisabledError'].includes(name)) return true;
  /* Mots-clés dans le message d'erreur */
  return /expir|invalid.*(token|session)|session.*invalid|connexion.*refus|auth/i.test(msg);
}

/* ── Simple body-parser JSON (sans dépendance express) ──────────── */
function jsonBodyMiddleware(req, res, next) {
  /* MagicMirror peut déjà avoir un express.json() qui a consommé le body.
   * Dans ce cas req.body est déjà défini → on passe directement. */
  if (req.body !== undefined) return next();

  if (!(req.headers['content-type'] || '').includes('application/json')) {
    req.body = {};
    return next();
  }

  const MAX_BODY = 2 * 1024 * 1024; // 2 MB — protection DoS
  let body = '';
  req.on('data',  chunk => {
    body += chunk.toString();
    if (body.length > MAX_BODY) { req.destroy(); res.status(413).end('Payload too large'); }
  });
  req.on('end',   ()    => {
    try { req.body = JSON.parse(body); } catch { req.body = {}; }
    next();
  });
  req.on('error', ()    => { req.body = {}; next(); });
}

/* ── Sanitize HTML entities (descriptions Pronote) ──────────────── */
function sanitizeHTML(str) {
  return (str || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/\s+/g,    ' ')
    .trim();
}

/* ── Formatters ─────────────────────────────────────────────────── */
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

function isCancelled(e) {
  return !!(e.canceled || (e.status && /annul/i.test(e.status)));
}

function mapTimetableEntry(e, lang) {
  const isLsn = e.is === 'lesson';
  return {
    subject:     isLsn ? (e.subject?.name || '') : (e.title || ''),
    teacher:     Array.isArray(e.teacherNames) ? e.teacherNames.join(', ') : '',
    room:        Array.isArray(e.classrooms)   ? e.classrooms.join(', ')   : '',
    start:       formatTime(e.startDate, lang),
    end:         formatTime(e.endDate,   lang),
    cancelled:   !!(e.canceled),
    isDetention: e.is === 'detention',
    status:      e.status || ''
  };
}

/* ======================================================================
   NODE HELPER
   ====================================================================== */
module.exports = NodeHelper.create({

  /* ── Initialisation ──────────────────────────────────────────────── */
  start () {
    this.instances    = new Map(); // instanceId → { config, timer, isConnecting }
    this.pawnote      = null;
    this.routesReady  = false;
    /* Mutex de rotation de token : garantit qu'une seule instance à la fois
     * effectue loginToken() pour éviter que Clara et Rafael n'utilisent
     * simultanément le même token primaire (qui serait brûlé deux fois). */
    this._tokenLock   = Promise.resolve();
    Log.info('Node helper started');
    this._setupRoutes();
  },

  /* ── Express — page de configuration ─────────────────────────────── */
  _setupRoutes () {
    if (this.routesReady) return;
    const app = this.expressApp;
    if (!app) {
      Log.warn('expressApp non disponible — nouvelle tentative dans 2s');
      setTimeout(() => this._setupRoutes(), 2000);
      return;
    }
    this.routesReady = true;
    Log.info('Routes Express enregistrées');

    /* Page HTML de configuration */
    app.get('/MMM-Pawmote/config', (req, res) => {
      res.sendFile(path.join(__dirname, 'config-page', 'index.html'));
    });

    /* Page de documentation */
    app.get('/MMM-Pawmote/docs', (req, res) => {
      res.sendFile(path.join(__dirname, 'config-page', 'docs.html'));
    });

    /* API — contenu brut du README (pour la page docs) */
    app.get('/MMM-Pawmote/api/readme', (req, res) => {
      const readmePath = path.join(__dirname, 'README.md');
      fs.readFile(readmePath, 'utf8', (err, data) => {
        if (err) return res.status(500).send('README introuvable');
        res.type('text/plain; charset=utf-8').send(data);
      });
    });

    /* API — statut du token + état module */
    app.get('/MMM-Pawmote/api/status', (req, res) => {
      const t = this._loadTokens();
      /* Collecte l'état de toutes les instances */
      let moduleError = null;
      let anyConnected = false;
      for (const [, state] of this.instances) {
        if (state.lastError && !moduleError) moduleError = state.lastError;
        if (state.isConnected) anyConnected = true;
      }
      res.json({
        hasTokens:   !!t,
        hasPrimary:  !!(t?.primary?.token),
        hasBackup:   !!(t?.backup?.token),
        url:          t?.pronote_url || '',
        username:     t?.username    || '',
        isParent:     t?.isParent    || false,
        childName:    t?.childName   || '',
        children:     t?.children    || [],
        moduleError,
        isConnected:  anyConnected
      });
    });

    /* API — connexion initiale QR Code */
    app.post('/MMM-Pawmote/api/setup-qr', jsonBodyMiddleware, async (req, res) => {
      try {
        const { qrToken, pin, childName } = req.body || {};
        Log.info(`Setup QR — body reçu : qrToken=${!!qrToken} pin=${!!pin} body_keys=${Object.keys(req.body||{}).join(',')}`);
        if (!qrToken || !pin) return res.status(400).json({ error: 'qrToken et pin requis' });
        if (!/^\d{4}$/.test(String(pin))) return res.status(400).json({ error: 'PIN invalide (4 chiffres requis)' });

        Log.info('Setup QR Code — appel loginQrCode…');
        const timeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timeout : Pronote ne répond pas (30s)')), 30_000)
        );
        const result = await Promise.race([
          this._connectQR({ qrToken, pin: String(pin), childName }),
          timeout
        ]);
        Log.info(`Setup QR OK — ${result.username}`);
        res.json({ ok: true, username: result.username, isParent: result.isParent, children: result.children });

        /* Notifie toutes les instances et déclenche leur collecte */
        for (const [id] of this.instances) {
          this.sendSocketNotification('TOKEN_SAVED', { username: result.username, _instanceId: id });
        }
        setTimeout(() => { for (const [id] of this.instances) this._connectAndFetch(id); }, 500);
      } catch (e) {
        Log.error('Setup QR:', e.message);
        res.status(500).json({ error: e.message });
      }
    });

    /* API — connexion par identifiants */
    app.post('/MMM-Pawmote/api/setup-credentials', jsonBodyMiddleware, async (req, res) => {
      try {
        const { url, username, password, isParent, childName } = req.body;
        if (!url || !username || !password) return res.status(400).json({ error: 'url, username et password requis' });

        Log.info('Setup credentials — URL:', url);
        const result = await this._connectCredentials({ url, username, password, isParent: !!isParent, childName });
        res.json({ ok: true, username: result.username, isParent: result.isParent, children: result.children });

        for (const [id] of this.instances) {
          this.sendSocketNotification('TOKEN_SAVED', { username: result.username, _instanceId: id });
        }
        setTimeout(() => { for (const [id] of this.instances) this._connectAndFetch(id); }, 500);
      } catch (e) {
        Log.error('Setup credentials:', e.message);
        res.status(500).json({ error: e.message });
      }
    });

    /* API — effacer les tokens */
    app.post('/MMM-Pawmote/api/clear', (req, res) => {
      try {
        if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE);
        res.json({ ok: true });
        for (const [id] of this.instances) {
          this.sendSocketNotification('TOKEN_CLEARED', { _instanceId: id });
        }
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    /* API — buffer de logs (polling depuis la page de config) */
    app.get('/MMM-Pawmote/api/logs', (req, res) => {
      const since = parseInt(req.query.since || '0', 10);
      const logs  = since
        ? _logBuffer.filter(l => l.ts > since)
        : _logBuffer.slice(-150);
      res.json({ logs, now: Date.now() });
    });
  },

  /* ── Chargement de Pawnote (API fonctionnelle) ───────────────────── */
  _loadPawnote () {
    if (this.pawnote) return this.pawnote;
    if (!fs.existsSync(PAWNOTE_DIR)) {
      throw new Error('Module pawnote absent — lancez npm install dans le dossier MMM-Pawmote');
    }
    try {
      const pw = require(PAWNOTE_DIR);
      const {
        createSessionHandle,
        loginQrCode,
        loginToken,
        loginCredentials,
        use,
        timetableFromWeek,
        parseTimetable,
        assignmentsFromWeek,
        gradesOverview,
        notebook,
        AccountKind,
        TabLocation,
        translateToWeekNumber
      } = pw;
      this.pawnote = {
        createSessionHandle,
        loginQrCode,
        loginToken,
        loginCredentials,
        use,
        timetableFromWeek,
        parseTimetable,
        assignmentsFromWeek,
        gradesOverview,
        notebook,
        AccountKind,
        TabLocation,
        translateToWeekNumber
      };
      Log.info('Pawnote chargé (API fonctionnelle)');
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

  _rotateToken (tokens, newToken, newNavigatorIdentifier) {
    const updated = { ...tokens };
    if (tokens.primary?.token) {
      updated.backup = {
        token:               tokens.primary.token,
        navigatorIdentifier: tokens.primary.navigatorIdentifier,
        updatedAt:           tokens.primary.updatedAt
      };
    }
    updated.primary = {
      token:               newToken,
      navigatorIdentifier: newNavigatorIdentifier || tokens.primary?.navigatorIdentifier,
      updatedAt:           new Date().toISOString()
    };
    this._saveTokens(updated);
    return updated;
  },

  /* ── Connexion initiale QR Code ───────────────────────────────────── */
  async _connectQR ({ qrToken, pin, childName }) {
    const pw = this._loadPawnote();
    const deviceUUID = this._getOrCreateDeviceUUID();
    const session    = pw.createSessionHandle();
    const qrData     = typeof qrToken === 'string' ? JSON.parse(qrToken) : qrToken;

    const refresh = await pw.loginQrCode(session, { deviceUUID, pin, qr: qrData });
    /* refresh = { url, token, username, kind, navigatorIdentifier } */

    const isParent = refresh.kind === pw.AccountKind.PARENT;
    const resources = session.user?.resources || [];
    const children  = resources.map(r => ({
      id:               r.id,
      kind:             r.kind,
      name:             r.name,
      className:        r.className        || '',
      establishmentName: r.establishmentName || ''
    }));

    if (isParent && resources.length > 0) {
      const child = childName
        ? resources.find(r => r.name.toLowerCase().includes(childName.toLowerCase()))
        : resources[0];
      pw.use(session, child || resources[0]);
    }

    const tokens = {
      pronote_url: refresh.url,
      username:    refresh.username,
      kind:        refresh.kind,
      deviceUUID,
      isParent,
      childName:   childName || (isParent && resources.length === 1 ? resources[0].name : ''),
      children,
      primary: {
        token:               refresh.token,
        navigatorIdentifier: refresh.navigatorIdentifier,
        updatedAt:           new Date().toISOString()
      },
      backup: null
    };
    this._saveTokens(tokens);
    Log.info(`QR OK — ${tokens.username} (parent:${isParent})`);
    return { username: tokens.username, isParent, children };
  },

  /* ── Connexion par identifiants ───────────────────────────────────── */
  async _connectCredentials ({ url, username, password, isParent, childName }) {
    const pw         = this._loadPawnote();
    const deviceUUID = this._getOrCreateDeviceUUID();
    const session    = pw.createSessionHandle();

    const cleanUrl   = url.replace(/\/mobile\.[^/]+\.html.*$/, '');
    const detectedParent = isParent || url.toLowerCase().includes('parent');
    const kind       = detectedParent ? pw.AccountKind.PARENT : pw.AccountKind.STUDENT;

    const refresh = await pw.loginCredentials(session, {
      url:      cleanUrl,
      kind,
      username,
      password,
      deviceUUID
    });

    const resources = session.user?.resources || [];
    const children  = resources.map(r => ({
      id:               r.id,
      kind:             r.kind,
      name:             r.name,
      className:        r.className        || '',
      establishmentName: r.establishmentName || ''
    }));

    if (detectedParent && resources.length > 0) {
      const child = childName
        ? resources.find(r => r.name.toLowerCase().includes(childName.toLowerCase()))
        : resources[0];
      pw.use(session, child || resources[0]);
    }

    const tokens = {
      pronote_url: refresh.url || cleanUrl,
      username:    refresh.username || username,
      kind:        refresh.kind,
      deviceUUID,
      isParent:    detectedParent,
      childName:   childName || (detectedParent && resources.length === 1 ? resources[0].name : ''),
      children,
      primary: {
        token:               refresh.token,
        navigatorIdentifier: refresh.navigatorIdentifier,
        updatedAt:           new Date().toISOString()
      },
      backup: null
    };
    this._saveTokens(tokens);
    Log.info(`Credentials OK — ${tokens.username} (parent:${detectedParent})`);
    return { username: tokens.username, isParent: detectedParent, children };
  },

  /* ── Connexion via token ─────────────────────────────────────────── */
  async _loginWithToken (tokenData, tokenEntry) {
    const pw      = this._loadPawnote();
    const session = pw.createSessionHandle();

    /* Backward compat: old tokens have isParent bool but no kind */
    const kind = tokenData.kind ?? (tokenData.isParent ? pw.AccountKind.PARENT : pw.AccountKind.STUDENT);

    const refresh = await pw.loginToken(session, {
      url:                 tokenData.pronote_url,
      kind,
      username:            tokenData.username,
      token:               tokenEntry.token,
      deviceUUID:          tokenData.deviceUUID,
      navigatorIdentifier: tokenEntry.navigatorIdentifier || undefined
    });

    /* Select child for parent accounts — tokenData.childName déjà surchargé par l'instance */
    if (tokenData.isParent) {
      const resources  = session.user?.resources || [];
      const targetName = tokenData.childName || '';
      const child = targetName
        ? resources.find(r => r.name.toLowerCase().includes(targetName.toLowerCase()))
        : resources[0];
      if (child) {
        pw.use(session, child);
        Log.info(`Enfant sélectionné : ${child.name}`);
      } else {
        Log.warn(`Enfant "${targetName}" non trouvé, utilisation du premier disponible`);
        if (resources[0]) pw.use(session, resources[0]);
      }
    }

    const updatedTokens = this._rotateToken(tokenData, refresh.token, refresh.navigatorIdentifier);
    return { session, tokens: updatedTokens };
  },

  /* ── Connexion + collecte principale (par instance) ─────────────── */
  async _connectAndFetch (instanceId) {
    const state = this.instances.get(instanceId);
    if (!state) return;
    if (state.isConnecting) { Log.log(`Instance ${instanceId} — connexion déjà en cours`); return; }
    state.isConnecting = true;

    const notify = (notif, payload) =>
      this.sendSocketNotification(notif, { ...payload, _instanceId: instanceId });

    /* ── Mutex de rotation ─────────────────────────────────────────
     * On attend que l'instance précédente ait fini sa rotation avant
     * de lire les tokens sur disque. Ainsi Clara et Rafael ne lisent
     * jamais le même token primaire simultanément.
     * Le verrou est libéré DÈS QUE le login est terminé (pas après
     * fetchAllData), pour ne pas bloquer l'autre instance trop longtemps. */
    const prevLock = this._tokenLock;
    let releaseLock;
    this._tokenLock = new Promise(r => { releaseLock = r; });

    try {
      await prevLock; // Attend la fin de la rotation précédente

      /* Re-lit les tokens depuis le disque : une autre instance a peut-être
       * déjà effectué la rotation et sauvegardé de nouveaux tokens. */
      const tokenData = this._loadTokens();
      if (!tokenData || !tokenData.primary?.token) {
        releaseLock();
        Log.warn(`Instance ${instanceId} — aucun token`);
        notify('ERROR', { type: 'no_tokens', message: 'Aucun token configuré.', configUrl: '/MMM-Pawmote/config' });
        return;
      }

      const instanceConfig     = state.config;
      const effectiveChildName = instanceConfig.childName || tokenData.childName || '';
      const tokenDataWithChild = { ...tokenData, childName: effectiveChildName };

      let session = null;
      let tokens  = null;

      /* Essai primary */
      try {
        Log.info(`Instance ${instanceId} — token primary (enfant: ${effectiveChildName || 'auto'})…`);
        const r = await this._loginWithToken(tokenDataWithChild, tokenData.primary);
        session = r.session; tokens = r.tokens;
        Log.info(`Instance ${instanceId} — connecté`);
      } catch (e1) {
        Log.warn(`Instance ${instanceId} — primary échoué:`, e1.message);

        /* Utilise le backup UNIQUEMENT en cas d'expiration de session/auth.
         * Pour une erreur réseau on relâche sans toucher au backup —
         * le prochain cycle réessaiera le même primary (encore valide). */
        const isAuthError = _isAuthError(e1);
        if (!isAuthError) {
          releaseLock();
          state.isConnected = false;
          state.lastError   = e1.message;
          notify('ERROR', { type: 'error', message: `Erreur réseau : ${e1.message}`, configUrl: '/MMM-Pawmote/config' });
          return;
        }

        if (!tokenData.backup?.token) {
          releaseLock();
          state.isConnected = false;
          state.lastError   = `Token expiré : ${e1.message}`;
          notify('ERROR', { type: 'auth_failed', message: 'Token expiré. Reconfigurez le module.', configUrl: '/MMM-Pawmote/config' });
          return;
        }

        /* Backup : tente de renouveler les tokens */
        try {
          Log.info(`Instance ${instanceId} — renouvellement via token backup…`);
          const r = await this._loginWithToken(tokenDataWithChild, tokenData.backup);
          session = r.session; tokens = r.tokens;
          Log.info(`Instance ${instanceId} — connecté via backup, tokens renouvelés`);
        } catch (e2) {
          releaseLock();
          Log.error(`Instance ${instanceId} — backup expiré:`, e2.message);
          state.isConnected = false;
          state.lastError   = `Tokens expirés : ${e2.message}`;
          notify('ERROR', { type: 'auth_failed', message: 'Tokens expirés. Reconfigurez le module.', configUrl: '/MMM-Pawmote/config' });
          return;
        }
      }

      /* Login terminé — libère le mutex pour que les autres instances puissent tourner */
      releaseLock();

      /* Collecte des données (hors section critique) */
      const data = await this._fetchAllData(session, tokens, tokenDataWithChild, instanceConfig);
      state.isConnected = true;
      state.lastError   = null;
      notify('PRONOTE_UPDATED', data);

    } catch (e) {
      releaseLock?.();
      Log.error(`Instance ${instanceId} — erreur:`, e.message);
      state.isConnected = false;
      state.lastError   = e.message;
      notify('ERROR', { type: 'error', message: `Erreur inattendue : ${e.message}`, configUrl: '/MMM-Pawmote/config' });
    } finally {
      state.isConnecting = false;
    }
  },

  /* ── Collecte des données ────────────────────────────────────────── */
  async _fetchAllData (session, tokens, tokenData, instanceConfig) {
    const cfg   = instanceConfig || {};
    const today = new Date();
    const lang  = cfg.language || 'fr-FR'; // fallback fr-FR si MagicMirror n'a pas de langue définie
    const pw    = this._loadPawnote();
    const data  = {};

    /* User info from active resource */
    const resource     = session.userResource;
    data.name          = resource?.name             || '';
    data.className     = resource?.className        || '';
    data.establishment = resource?.establishmentName || '';

    Log.info(`Élève : ${data.name} — ${data.className} — ${data.establishment}`);

    /* Week number using pawnote's firstMonday when available */
    const firstMonday = session.instance?.firstMonday;
    const weekNum = (firstMonday && pw.translateToWeekNumber)
      ? pw.translateToWeekNumber(today, firstMonday)
      : getPronoteWeek(today);

    /* Tabs disponibles sur la ressource active */
    const hasTimetable   = resource?.tabs?.has(pw.TabLocation.Timetable);
    const hasAssignments = resource?.tabs?.has(pw.TabLocation.Assignments);
    const hasGrades      = resource?.tabs?.has(pw.TabLocation.Grades ?? 198);
    const hasNotebook    = resource?.tabs?.has(pw.TabLocation.Notebook);
    Log.info(`Tabs — Timetable:${hasTimetable} Assignments:${hasAssignments} Grades:${hasGrades} Notebook:${hasNotebook}`);

    /* ── Membre (enfant) pour les requêtes brutes parent ────────────── */
    const childResource = session.userResource;
    const memberPayload = (tokenData.isParent && childResource)
      ? { G: childResource.kind, N: childResource.id }
      : null;

    /* ---- Emploi du temps ---- */
    data.timetableToday   = [];
    data.timetableNextDay = { day: '', classes: [] };

    /* Helper : récupère une semaine de cours, via protocole brut (parent) ou API publique (élève) */
    const fetchWeekEntries = async (wn) => {
      if (memberPayload) {
        const ttRaw = await rawPronoteRequest(pw, session, 'PageEmploiDuTemps', {
          estEDTAnnuel: false, estEDTPermanence: false,
          avecAbsencesEleve: false, avecRessourcesLibrePiedHoraire: false,
          avecAbsencesRessource: true, avecInfosPrefsGrille: true,
          avecConseilDeClasse: true, avecCoursSortiePeda: true,
          avecDisponibilites: true, avecRetenuesEleve: true,
          edt: { G: 16, L: 'Emploi du temps' },
          ressource: { G: childResource.kind, L: childResource.name, N: childResource.id },
          Ressource: { G: childResource.kind, L: childResource.name, N: childResource.id },
          numeroSemaine: wn, NumeroSemaine: wn
        }, { onglet: 16, membre: memberPayload });
        return parseRawCourses(ttRaw, session);
      } else {
        const tt = await pw.timetableFromWeek(session, wn);
        pw.parseTimetable(session, tt, { withCanceledClasses: true });
        return tt.classes || [];
      }
    };

    if (!hasTimetable && !memberPayload) {
      Log.warn('EDT: onglet non disponible pour ce compte (restriction établissement)');
    } else {
      try {
        const allEntries = await fetchWeekEntries(weekNum);

        const todayStr     = today.toDateString();
        const todayEntries = allEntries.filter(e => e.startDate && new Date(e.startDate).toDateString() === todayStr);

        const showFromNow   = cfg?.Timetable?.showOnlyFuture ?? false;
        const filteredToday = showFromNow
          ? todayEntries.filter(e => !e.endDate || new Date(e.endDate) >= today)
          : todayEntries;

        data.timetableToday = [...filteredToday]
          .sort((a, b) => new Date(a.startDate) - new Date(b.startDate))
          .map(e => mapTimetableEntry(e, lang));
        data.cancelledToday = data.timetableToday.filter(c => c.cancelled).length;

        const sortedToday = [...todayEntries].sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
        data.todayStart = sortedToday.length ? formatTime(sortedToday[0].startDate, lang) : '';
        data.todayEnd   = sortedToday.length ? formatTime(sortedToday[sortedToday.length - 1].endDate, lang) : '';

        /* Prochain jour scolaire (recherche jusqu'à 14 jours) */
        const weekCache = { [weekNum]: allEntries };
        let nextEntries = [], nextDate = null;
        for (let i = 1; i <= 14; i++) {
          const d  = new Date(today); d.setDate(today.getDate() + i);
          const wn = (firstMonday && pw.translateToWeekNumber)
            ? pw.translateToWeekNumber(d, firstMonday)
            : getPronoteWeek(d);
          let wEntries;
          if (weekCache[wn]) {
            wEntries = weekCache[wn];
          } else {
            try {
              wEntries = await fetchWeekEntries(wn);
              weekCache[wn] = wEntries;
            } catch { break; }
          }
          const dayEntries = wEntries.filter(e =>
            e.startDate &&
            new Date(e.startDate).toDateString() === d.toDateString() &&
            !isCancelled(e)
          );
          if (dayEntries.length > 0) { nextEntries = dayEntries; nextDate = d; break; }
        }

        const dayLabel   = nextDate
          ? formatDate(nextDate, lang, { weekday: 'long', day: 'numeric', month: 'long' })
          : '';
        const sortedNext = [...nextEntries].sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
        /* Calcul du nombre de jours jusqu'au prochain jour scolaire */
        const msPerDay   = 24 * 60 * 60 * 1000;
        const todayMid   = new Date(today); todayMid.setHours(0, 0, 0, 0);
        const daysUntil  = nextDate
          ? Math.round((new Date(nextDate).setHours(0,0,0,0) - todayMid.getTime()) / msPerDay)
          : null;

        data.timetableNextDay = {
          day:      dayLabel,
          start:    sortedNext.length ? formatTime(sortedNext[0].startDate, lang) : '',
          end:      sortedNext.length ? formatTime(sortedNext[sortedNext.length - 1].endDate, lang) : '',
          daysUntil,
          classes:  [...nextEntries]
            .sort((a, b) => new Date(a.startDate) - new Date(b.startDate))
            .map(e => mapTimetableEntry(e, lang))
        };
        /* Flag vacances : aucun cours aujourd'hui (week-end inclus) */
        data.noClassesToday = data.timetableToday.length === 0;
        Log.info(`EDT aujourd'hui: ${data.timetableToday.length} cours | prochain jour: ${data.timetableNextDay.classes.length} cours | vacances: ${data.noClassesToday}`);
      } catch (e) {
        Log.error('EDT:', e.message);
      }
    }

    /* ---- Devoirs ---- */
    data.homeworks = [];
    if (!hasAssignments && !memberPayload) {
      Log.warn('Devoirs: onglet non disponible pour ce compte (restriction établissement)');
    } else try {
      const searchDays = cfg?.Homeworks?.searchDays ?? 14;
      const limitDate  = new Date(today.getTime() + searchDays * 24 * 3600 * 1000);

      let hwList;
      if (memberPayload) {
        /* Parent : protocole brut avec sig.membre, plage de semaines */
        const endWeekNum = (firstMonday && pw.translateToWeekNumber)
          ? pw.translateToWeekNumber(limitDate, firstMonday)
          : getPronoteWeek(limitDate);
        const weekRange = weekNum === endWeekNum ? `[${weekNum}]` : `[${weekNum}..${endWeekNum}]`;
        const hwRaw = await rawPronoteRequest(pw, session, 'PageCahierDeTexte', {
          domaine: { _T: 8, V: weekRange }
        }, { onglet: 88, membre: memberPayload });
        hwList = parseRawAssignments(hwRaw);
      } else {
        hwList = await pw.assignmentsFromWeek(session, weekNum);
      }

      data.homeworks = hwList
        .filter(h => h.deadline && h.deadline >= today && h.deadline <= limitDate)
        .sort((a, b) => a.deadline - b.deadline)
        .map(h => ({
          subject:     h.subject?.name || '',
          description: sanitizeHTML(h.description),
          done:        !!h.done,
          deadline:    formatDate(h.deadline, lang, { weekday: 'short', day: 'numeric', month: 'short' })
        }));
      Log.info(`Devoirs: ${data.homeworks.length} (${data.homeworks.filter(h => !h.done).length} non faits)`);
    } catch (e) {
      Log.error('Devoirs:', e.message);
    }

    /* ── Helper : résout la période active d'un onglet ─────────────── */
    const getPeriodFromTab = (tab, fallback = null) =>
      tab?.defaultPeriod
      || tab?.periods?.find(p => p.startDate <= today && p.endDate >= today)
      || tab?.periods?.[tab.periods.length - 1]
      || fallback;

    /* ---- Période courante depuis l'onglet Notes (tab 198) ---- */
    const gradesTab      = resource?.tabs?.get(pw.TabLocation.Grades ?? 198);
    const gradePeriod    = getPeriodFromTab(gradesTab);

    /* Période pour le carnet (tab 19) — fallback sur gradePeriod */
    const notebookTab    = resource?.tabs?.get(pw.TabLocation.Notebook);
    const notebookPeriod = getPeriodFromTab(notebookTab, gradePeriod);

    /* ── Helper : construit le payload période Pronote ─────────────── */
    const makePeriodePayload = (p) => ({ N: p.id, G: p.kind, L: p.name });

    /* ---- Carnet (PagePresence — protocole brut, onglet 73) ---- */
    data.absences    = [];
    data.delays      = [];
    data.punishments = [];
    const carnetPeriod = notebookPeriod || gradePeriod;
    if (!carnetPeriod) {
      Log.warn('Carnet: aucune période disponible');
    } else {
      try {
        const sig = { onglet: 73 };
        if (memberPayload) sig.membre = memberPayload;
        const carnetData = await rawPronoteRequest(pw, session, 'PagePresence', {
          periode:   makePeriodePayload(carnetPeriod),
          DateDebut: { _T: 7, V: encodePronoteDate(new Date(carnetPeriod.startDate)) },
          DateFin:   { _T: 7, V: encodePronoteDate(new Date(carnetPeriod.endDate)) }
        }, sig);

        const absenceDays    = (cfg?.Absences?.displayDuration    ?? 60) * 24 * 3600 * 1000;
        const delayDays      = (cfg?.Delays?.displayDuration      ?? 60) * 24 * 3600 * 1000;
        const punishmentDays = (cfg?.Punishments?.displayDuration ?? 60) * 24 * 3600 * 1000;

        for (const item of carnetData?.listeAbsences?.V || []) {
          /* Sortie anticipée si toutes les limites sont atteintes */
          const absLimit   = cfg?.Absences?.number    ?? 5;
          const delayLimit = cfg?.Delays?.number      ?? 5;
          const punishLimit = cfg?.Punishments?.number ?? 5;
          if (data.absences.length >= absLimit && data.delays.length >= delayLimit && data.punishments.length >= punishLimit) break;

          switch (item.G) {
            case 13: { // Absence
              const start = decodePronoteDate(item.dateDebut?.V);
              if (!start || start < new Date(today.getTime() - absenceDays)) break;
              if (data.absences.length >= absLimit) break;
              data.absences.push({
                date:          start.toISOString(),
                endDate:       (decodePronoteDate(item.dateFin?.V) || start).toISOString(),
                formattedDate: formatDate(start, lang, { day: 'numeric', month: 'short', year: 'numeric' }),
                reason:        item.estMotifNonEncoreConnu ? 'Motif à venir' : (item.listeMotifs?.V?.[0]?.L || 'Non renseigné'),
                justified:     !!(item.justifie),
                hours:         item.NbrHeures || '',
                days:          item.NbrJours  || 0
              });
              break;
            }
            case 14: { // Retard
              const d = decodePronoteDate(item.date?.V);
              if (!d || d < new Date(today.getTime() - delayDays)) break;
              if (data.delays.length >= delayLimit) break;
              data.delays.push({
                date:          d.toISOString(),
                formattedDate: formatDate(d, lang, { day: 'numeric', month: 'short', year: 'numeric' }),
                duration:      item.duree || 0,
                justified:     !!(item.justifie),
                reason:        item.estMotifNonEncoreConnu ? 'Motif à venir' : (item.listeMotifs?.V?.[0]?.L || '')
              });
              break;
            }
            case 41: { // Punition
              const d = decodePronoteDate(item.dateDemande?.V);
              if (!d || d < new Date(today.getTime() - punishmentDays)) break;
              if (data.punishments.length >= punishLimit) break;
              data.punishments.push({
                date:          d.toISOString(),
                formattedDate: formatDate(d, lang, { day: 'numeric', month: 'short', year: 'numeric' }),
                type:          item.nature?.V?.L || 'Punition',
                reason:        (item.listeMotifs?.V || []).map(m => m.L).filter(Boolean).join(', ')
              });
              break;
            }
          }
        }
        Log.info(`Absences:${data.absences.length} | Retards:${data.delays.length} | Punitions:${data.punishments.length}`);
      } catch (e) {
        Log.warn('Carnet:', e.message);
      }
    }

    /* ---- Notes (DernieresNotes — protocole brut, onglet 198) ---- */
    data.grades = [];
    if (!gradePeriod) {
      Log.warn('Notes: aucune période disponible');
    } else {
      try {
        const sig = { onglet: 198 };
        if (memberPayload) sig.membre = memberPayload;
        const notesData = await rawPronoteRequest(pw, session, 'DernieresNotes',
          { Periode: makePeriodePayload(gradePeriod) }, sig);

        const displayDuration = (cfg?.Grades?.displayDuration ?? 30) * 24 * 3600 * 1000;
        const cutoff          = new Date(today.getTime() - displayDuration);

        data.grades = (notesData?.listeDevoirs?.V || [])
          .map(g => {
            const gDate = decodePronoteDate(g.date?.V);
            return {
              subject:       g.service?.V?.L || '',
              value:         decodeGradeValue(g.note?.V),
              outOf:         decodeGradeValue(g.bareme?.V) ?? 20,
              average:       g.moyenne  ? decodeGradeValue(g.moyenne.V)  : null,
              date:          gDate ? gDate.toISOString().split('T')[0] : '',
              formattedDate: gDate ? formatDate(gDate, lang) : '',
              comment:       g.commentaire || '',
              coefficient:   g.coefficient || 1
            };
          })
          .filter(g => g.date && new Date(g.date) >= cutoff)
          .slice(0, cfg?.Grades?.number ?? 10);

        Log.info(`Notes: ${data.grades.length}`);
      } catch (e) {
        Log.warn('Notes:', e.message);
      }
    }

    return data;
  },

  /* ── Réception des notifications socket ─────────────────────────── */
  socketNotificationReceived (notification, payload) {
    switch (notification) {
      case 'SET_CONFIG': {
        const instanceId = payload._instanceId;
        if (!instanceId) break;
        if (payload.debug) _debugInstances.add(instanceId);
        else _debugInstances.delete(instanceId);
        Log.info(`Instance ${instanceId} — config reçue (childName: ${payload.childName || 'auto'})`);
        this._startInstanceCycle(instanceId, payload);
        break;
      }
    }
  },

  /* ── Cycle de mise à jour par instance ──────────────────────────── */
  _startInstanceCycle (instanceId, config) {
    /* Arrête l'ancien timer si l'instance existait déjà */
    const existing = this.instances.get(instanceId);
    if (existing?.timer) clearInterval(existing.timer);

    const state = { config, timer: null, isConnecting: false, isConnected: false, lastError: null };
    this.instances.set(instanceId, state);

    this.sendSocketNotification('INITIALIZED', { _instanceId: instanceId });
    this._connectAndFetch(instanceId);
    const interval = this._parseInterval(config.updateInterval || '15m');
    state.timer = setInterval(() => this._connectAndFetch(instanceId), interval);
    Log.info(`Instance ${instanceId} — mise à jour toutes les ${config.updateInterval || '15m'}`);
  },

  _parseInterval (str) {
    const m = String(str).match(/^(\d+)([smhd])$/);
    if (!m) return 15 * 60 * 1000;
    const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
    return parseInt(m[1]) * (multipliers[m[2]] || 60000);
  }
});
