/* =====================================================================
   MMM-Pawmote — Module frontend MagicMirror²
   Pawnote rewrite-2.0
   ===================================================================== */
'use strict';

Module.register('MMM-Pawmote', {

  requiresVersion: '2.13.0',

  defaults: {
    debug: false,
    language: null,           // null = utilise config.language de MagicMirror
    updateInterval: '15m',
    childName: null,          // null = enfant par défaut du token (compte parent multi-enfants)

    Header: {
      displayEstablishmentName: true,
      displayStudentName: true,
      displayStudentClass: true,
      displayAvatar: false
    },

    Timetable: {
      display: true,
      displayToday: true,
      displayNextDay: true,
      displayTeacher: true,
      displayRoom: true,
      showOnlyFuture: false,  // n'affiche que les cours à venir
      showHolidays: false,    // remplace "Aujourd'hui" par un bloc vacances + countdown
      showFrom: '00:00',
      showUntil: '23:59'
    },

    Homeworks: {
      display: true,
      displayDone: true,       // afficher les devoirs faits (cochés)
      displayDescription: true,
      searchDays: 14,          // chercher les devoirs dans les N prochains jours
      showHolidays: true,      // afficher les devoirs pendant les vacances
      showFrom: '00:00',
      showUntil: '23:59'
    },

    Grades: {
      display: true,
      displayDuration: 30,     // afficher les notes des N derniers jours
      number: 10,              // nombre maximum de notes à afficher
      showHolidays: false,     // masquer les notes pendant les vacances
      showFrom: '00:00',
      showUntil: '23:59'
    },

    Absences: {
      display: true,
      displayDuration: 60,     // afficher les absences des N derniers jours
      number: 5,
      showHolidays: false,     // masquer les absences pendant les vacances
      showFrom: '00:00',
      showUntil: '23:59'
    },

    Delays: {
      display: true,
      displayDuration: 60,
      number: 5,
      showHolidays: false,     // masquer les retards pendant les vacances
      showFrom: '00:00',
      showUntil: '23:59'
    },

    Punishments: {
      display: true,
      displayDuration: 60,
      number: 5,
      showHolidays: false,     // masquer les punitions pendant les vacances
      showFrom: '00:00',
      showUntil: '23:59'
    }
  },

  /* ── Initialisation ─────────────────────────────────────────────── */
  start () {
    this.config   = configMerge({}, this.defaults, this.config);
    if (!this.config.language) this.config.language = config.language || 'fr-FR';
    this.userData = null;
    this.loading  = true;
    this.error    = null;
    Log.info(`[${this.name}] Module démarré`);
  },

  /* ── Styles ─────────────────────────────────────────────────────── */
  getStyles () {
    return ['pawmote.css'];
  },

  /* ── Template ───────────────────────────────────────────────────── */
  getTemplate () {
    if (this.loading)                 return 'templates/loading.njk';
    if (this.error || !this.userData) return 'templates/error.njk';
    return 'templates/layout.njk';
  },

  getTemplateData () {
    if (this.loading) {
      return { loading: 'Connexion à Pronote…' };
    }
    if (this.error || !this.userData) {
      const configPath = (this.error && this.error.configUrl) || '/MMM-Pawmote/config';
      return {
        error:         this.error || { message: 'Aucune donnée', configUrl: configPath },
        configUrl:     configPath,
        fullConfigUrl: window.location.origin + configPath
      };
    }
    const vis = {
      Timetable:   this._isVisible(this.config.Timetable),
      Homeworks:   this._isVisible(this.config.Homeworks),
      Grades:      this._isVisible(this.config.Grades),
      Absences:    this._isVisible(this.config.Absences),
      Delays:      this._isVisible(this.config.Delays),
      Punishments: this._isVisible(this.config.Punishments)
    };

    /* Logique colonnes — calculée ici pour garder les templates simples */
    const showToday     = (this.userData.timetableToday || []).length > 0;
    const showHomeworks = (this.userData.homeworks || []).filter(h => !h.done).length > 0;
    const colCount      = [showToday, true, showHomeworks].filter(Boolean).length;
    const colClass      = `pm-cols--${colCount}`;

    Log.info(`[${this.name}] vis=${JSON.stringify(vis)} grades=${this.userData.grades?.length} absences=${this.userData.absences?.length}`);
    const today = new Date();
    const todayLabel = today.toLocaleDateString(this.config.language || 'fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    return {
      config:       this.config,
      userData:     this.userData,
      vis,
      showToday,
      showHomeworks,
      colClass,
      todayLabel
    };
  },

  /* ── Visibilité horaire ─────────────────────────────────────────── */
  _isVisible (sectionCfg) {
    if (!sectionCfg || !sectionCfg.display) return false;
    const now  = new Date();
    const hhmm = now.getHours().toString().padStart(2, '0') + ':' +
                 now.getMinutes().toString().padStart(2, '0');

    /* Plusieurs tranches : showRanges: [{ from, until }, ...] */
    if (Array.isArray(sectionCfg.showRanges) && sectionCfg.showRanges.length > 0) {
      return sectionCfg.showRanges.some(r => hhmm >= (r.from || '00:00') && hhmm <= (r.until || '23:59'));
    }

    /* Tranche unique (rétrocompatibilité) : showFrom / showUntil */
    const from  = sectionCfg.showFrom  || '00:00';
    const until = sectionCfg.showUntil || '23:59';
    return hhmm >= from && hhmm <= until;
  },

  /* ── Notifications MagicMirror ──────────────────────────────────── */
  notificationReceived (notification) {
    if (notification === 'ALL_MODULES_STARTED') {
      this.sendSocketNotification('SET_CONFIG', { ...this.config, _instanceId: this.identifier });
    }
  },

  /* ── Notifications socket (NodeHelper) ─────────────────────────── */
  socketNotificationReceived (notification, payload) {
    /* Filtre les messages destinés à cette instance */
    if (payload && payload._instanceId && payload._instanceId !== this.identifier) return;

    switch (notification) {

      case 'INITIALIZED':
        Log.info(`[${this.name}] Initialisé`);
        break;

      case 'PRONOTE_UPDATED':
        this.loading  = false;
        this.error    = null;
        this.userData = payload;
        this.updateDom(500);
        this.sendNotification('PRONOTE_DATA', payload);
        break;

      case 'ERROR':
        this.loading  = false;
        this.error    = payload;
        this.userData = null;
        this.updateDom();
        break;

      case 'TOKEN_SAVED':
        Log.info(`[${this.name}] Token sauvegardé — ${payload.username || ''}`);
        this.loading  = true;
        this.error    = null;
        this.userData = null;
        this.updateDom();
        break;

      case 'TOKEN_CLEARED':
        this.loading  = false;
        this.userData = null;
        this.error    = {
          type:      'no_tokens',
          message:   'Les tokens ont été supprimés. Reconfigurez le module.',
          configUrl: '/MMM-Pawmote/config'
        };
        this.updateDom();
        break;

      default:
        Log.warn(`[${this.name}] Notification socket non gérée : ${notification}`);
    }
  }
});
