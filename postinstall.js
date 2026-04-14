#!/usr/bin/env node
'use strict';

/* =====================================================================
   MMM-Pawmote — postinstall.js
   Message affiché après "npm install" pour guider l'utilisateur
   ===================================================================== */

const c = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  green:  '\x1b[32m',
  cyan:   '\x1b[36m',
  yellow: '\x1b[33m',
  white:  '\x1b[97m',
  dim:    '\x1b[2m',
};

const line  = `${c.dim}${'─'.repeat(60)}${c.reset}`;
const blank = '';

const steps = [
  blank,
  line,
  `${c.bold}${c.green}  ✅  MMM-Pawmote installé avec succès !${c.reset}`,
  line,
  blank,
  `${c.bold}${c.white}  Pour terminer la configuration, suivez ces étapes :${c.reset}`,
  blank,
  `  ${c.cyan}${c.bold}Étape 1${c.reset} — Ajoutez le module dans votre ${c.yellow}config/config.js${c.reset} :`,
  blank,
  `  ${c.dim}    {`,
  `  ${c.dim}      module: "MMM-Pawmote",`,
  `  ${c.dim}      position: "bottom_left",`,
  `  ${c.dim}      config: {}`,
  `  ${c.dim}    }${c.reset}`,
  blank,
  `  ${c.cyan}${c.bold}Étape 2${c.reset} — Redémarrez MagicMirror :`,
  blank,
  `  ${c.dim}    docker restart magic-mirror${c.reset}`,
  blank,
  `  ${c.cyan}${c.bold}Étape 3${c.reset} — Ouvrez la page de configuration dans votre navigateur :`,
  blank,
  `  ${c.bold}${c.yellow}    http://<IP-de-votre-MagicMirror>:8080/MMM-Pawmote/config${c.reset}`,
  blank,
  line,
  blank,
];

steps.forEach(s => console.log(s));
