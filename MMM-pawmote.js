/* =====================================================================
   MMM-pawmote — Module frontend MagicMirror²
   Pawnote rewrite-2.0
   ===================================================================== */
'use strict';

Module.register('MMM-pawmote', {

  requiresVersion: '2.13.0',

  defaults: {
    debug: false,
    language: null,           // null = utilise config.language de MagicMirror
    updateInterval: '15m',

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
      showFrom: '00:00',
      showUntil: '23:59'
    },

    Homeworks: {
      display: true,
      displayDone: true,       // afficher les devoirs faits (cochés)
      displayDescription: true,
      searchDays: 14,          // chercher les devoirs dans les N prochains jours
      showFrom: '00:00',
      showUntil: '23:59'
    },

    Grades: {
      display: true,
      displayDuration: 30,     // afficher les notes des N derniers jours
      number: 10,              // nombre maximum de notes à afficher
      showFrom: '00:00',
      showUntil: '23:59'
    },

    Absences: {
      display: true,
      displayDuration: 60,     // afficher les absences des N derniers jours
      number: 5,
      showFrom: '00:00',
      showUntil: '23:59'
    },

    Delays: {
      display: true,
      displayDuration: 60,
      number: 5,
      showFrom: '00:00',
      showUntil: '23:59'
    },

    Punishments: {
      display: true,
      displayDuration: 60,
      number: 5,
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
      return {
        error:     this.error || { message: 'Aucune donnée', configUrl: '/MMM-pawmote/config' },
        configUrl: (this.error && this.error.configUrl) || '/MMM-pawmote/config'
      };
    }
    return {
      config:   this.config,
      userData: this.userData,
      vis: {
        Timetable:   this._isVisible(this.config.Timetable),
        Homeworks:   this._isVisible(this.config.Homeworks),
        Grades:      this._isVisible(this.config.Grades),
        Absences:    this._isVisible(this.config.Absences),
        Delays:      this._isVisible(this.config.Delays),
        Punishments: this._isVisible(this.config.Punishments)
      }
    };
  },

  /* ── Visibilité horaire ─────────────────────────────────────────── */
  _isVisible (sectionCfg) {
    if (!sectionCfg || !sectionCfg.display) return false;
    const from  = sectionCfg.showFrom  || '00:00';
    const until = sectionCfg.showUntil || '23:59';
    const now   = new Date();
    const hhmm  = now.getHours().toString().padStart(2, '0') + ':' +
                  now.getMinutes().toString().padStart(2, '0');
    return hhmm >= from && hhmm <= until;
  },

  /* ── Notifications MagicMirror ──────────────────────────────────── */
  notificationReceived (notification) {
    if (notification === 'ALL_MODULES_STARTED') {
      this.sendSocketNotification('SET_CONFIG', this.config);
    }
  },

  /* ── Notifications socket (NodeHelper) ─────────────────────────── */
  socketNotificationReceived (notification, payload) {
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
          configUrl: '/MMM-pawmote/config'
        };
        this.updateDom();
        break;
    }
  }
});
