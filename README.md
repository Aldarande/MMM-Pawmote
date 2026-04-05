# MMM-pawmote

> Module [MagicMirror²](https://magicmirror.builders/) pour afficher les données scolaires **Pronote** via la bibliothèque **[Pawnote rewrite-2.0](https://github.com/LiterateInk/Pawnote)**.

---

## Sommaire

- [Fonctionnalités](#fonctionnalités)
- [Prérequis](#prérequis)
- [Installation](#installation)
- [Première connexion](#première-connexion)
  - [Via QR Code (recommandé)](#option-1--qr-code-recommandé)
  - [Via identifiants](#option-2--identifiants)
  - [Compte parent](#compte-parent)
- [Configuration complète](#configuration-complète)
  - [Référence de toutes les options](#référence-de-toutes-les-options)
  - [Plages horaires d'affichage](#plages-horaires-daffichage)
  - [Exemples de configurations](#exemples-de-configurations)
- [Système de tokens](#système-de-tokens)
- [Page de configuration](#page-de-configuration)
- [Dépannage](#dépannage)
- [Structure des fichiers](#structure-des-fichiers)
- [Crédits](#crédits)

---

## Fonctionnalités

| Section | Ce qui est affiché |
|---|---|
| 📅 **Emploi du temps** | Cours du jour restants + prochain cours (jour, heure, matière) si aucun cours aujourd'hui |
| 📝 **Devoirs** | Liste groupée par date limite, avec statut fait/à faire |
| 📊 **Notes** | Dernières notes avec barème, moyenne de classe et coefficient |
| 🚫 **Absences** | Absences justifiées / non justifiées avec motif |
| ⏱ **Retards** | Retards avec durée et motif |
| ⚖ **Punitions** | Punitions avec type et motif |
| ⏰ **Plages horaires** | Chaque section peut être masquée selon l'heure (`showFrom` / `showUntil`) |
| 👨‍👩‍👧 **Multi-comptes** | Élève ou parent — sélection automatique de l'enfant à la configuration |
| 🔒 **Double token** | Rotation automatique primary → backup, reconnexion transparente |
| ⚙ **Page de config** | Interface web avec statut d'authentification en direct et exemple de config généré |

---

## Prérequis

| Logiciel | Version minimale |
|---|---|
| [MagicMirror²](https://magicmirror.builders/) | 2.13.0 |
| Node.js | 18.x |
| npm | 8.x |

---

## Installation

### 1. Cloner le module

```bash
cd ~/MagicMirror/modules
git clone https://github.com/Aldarande/MMM-Pawmote MMM-pawmote
cd MMM-pawmote
```

### 2. Installer les dépendances

```bash
npm install
```

> Cela installe **Pawnote** (la bibliothèque de communication avec Pronote) dans `node_modules/`.

### 3. Ajouter le module à MagicMirror

Ouvrez `~/MagicMirror/config/config.js` et ajoutez ce bloc dans le tableau `modules` :

```javascript
{
  module: "MMM-pawmote",
  position: "top_left",
  config: {
    updateInterval: "15m"
  }
}
```

### 4. Redémarrer MagicMirror

```bash
pm2 restart MagicMirror
# ou
npm start
```

Le module affiche un écran de chargement avec le logo Pronote. Vous devez maintenant effectuer la **première connexion**.

---

## Première connexion

MagicMirror² fonctionne sans clavier ni souris. La connexion à votre compte Pronote se fait depuis un autre appareil (téléphone, PC) via la **page web de configuration intégrée**.

### Accéder à la page de configuration

```
http://<adresse-ip-du-miroir>:8080/MMM-pawmote/config
```

Remplacez `<adresse-ip-du-miroir>` par l'adresse IP locale de votre Raspberry Pi (ex. `192.168.1.100`).

---

### Option 1 — QR Code (recommandé)

Le QR Code est la méthode **la plus sûre** : votre mot de passe ne transite jamais.

**Sur votre téléphone (app Pronote officielle) :**

1. Allez dans **Mon profil** (icône en bas à droite)
2. Appuyez sur **Connexion avec QR Code**
3. Choisissez un **PIN** à 4 chiffres et notez-le
4. Un QR Code s'affiche sur l'écran

**Sur la page de configuration :**

5. Allez dans l'onglet **QR Code**
6. Choisissez la méthode de saisie :
   - **Coller JSON** : décryptez le QR Code avec une app tierce, copiez le JSON et collez-le
   - **Image** : glissez/déposez ou collez une capture du QR Code
   - **Scanner** : si votre appareil a une caméra, pointez-la vers le QR Code
7. Saisissez votre **PIN** dans la modale qui apparaît
8. Cliquez sur **✅ Valider**

> ⚠️ Le QR Code Pronote n'est valable que **quelques minutes**. Effectuez l'opération rapidement.

---

### Option 2 — Identifiants

1. Sur la page de config, cliquez sur l'onglet **Identifiants**
2. Renseignez l'**URL** de votre portail Pronote

   > L'URL ressemble à `https://monlycee.index-education.net/pronote/`. Elle se trouve dans l'email d'inscription de votre établissement. Veillez à choisir la bonne URL selon votre profil :
   > - Élève : URL contenant `/eleve`
   > - Parent : URL contenant `/parent`

3. Saisissez votre **identifiant** et **mot de passe** Pronote
4. Sélectionnez le type de compte (**Élève** ou **Parent**)
5. Cliquez sur **Se connecter**

---

### Compte parent

Si vous avez un compte **parent** avec **plusieurs enfants**, la page de configuration affiche automatiquement les enfants sous forme de cartes après la connexion. Cliquez sur l'enfant souhaité pour voir un exemple de configuration `config.js` prêt à copier-coller.

> Vous n'avez pas besoin de renseigner le nom de l'enfant manuellement : il est détecté automatiquement depuis votre compte Pronote.

---

## Configuration complète

### Référence de toutes les options

```javascript
{
  module: "MMM-pawmote",
  position: "top_left",   // top_left | top_center | top_right | ...
  config: {

    // ── Global ─────────────────────────────────────────────────────
    debug:          false,     // true = logs détaillés dans la console
    language:       null,      // null = reprend config.language de MagicMirror (recommandé)
    updateInterval: "15m",     // fréquence de mise à jour : "30s", "5m", "1h", "1d"
    childName:      null,      // null = premier enfant du token ; "Clara" = enfant ciblé

    // ── En-tête ────────────────────────────────────────────────────
    Header: {
      displayEstablishmentName: true,  // nom de l'établissement (false pour masquer)
      displayStudentName:       true,  // prénom + nom de l'élève
      displayStudentClass:      true,  // classe (ex : 3ème B) (false pour masquer)
    },

    // ── Emploi du temps ────────────────────────────────────────────
    // Si aucun cours aujourd'hui, affiche automatiquement le prochain cours
    // (jour, heure, matière, salle) au lieu de "Plus de cours aujourd'hui".
    Timetable: {
      display:        true,    // activer la section
      displayToday:   true,    // cours du jour restants
      displayNextDay: true,    // emploi du temps du prochain jour scolaire
      displayTeacher: true,    // nom du professeur
      displayRoom:    true,    // salle de cours
      showOnlyFuture: false,   // true = masque les cours déjà terminés aujourd'hui
      showFrom:       "00:00", // n'afficher qu'à partir de cette heure
      showUntil:      "23:59"  // masquer après cette heure
    },

    // ── Devoirs ────────────────────────────────────────────────────
    Homeworks: {
      display:            true,  // activer la section
      displayDone:        true,  // afficher les devoirs déjà cochés (✓)
      displayDescription: true,  // afficher l'énoncé du devoir
      searchDays:         14,    // chercher les devoirs dans les N prochains jours
      showFrom:           "00:00",
      showUntil:          "23:59"
    },

    // ── Notes ──────────────────────────────────────────────────────
    Grades: {
      display:         true,  // activer la section
      displayDuration: 30,    // afficher les notes des N derniers JOURS (0 = toutes)
      number:          10,    // nombre maximum de notes à lister
      showFrom:        "00:00",
      showUntil:       "23:59"
    },

    // ── Absences ───────────────────────────────────────────────────
    Absences: {
      display:         true,
      displayDuration: 60,    // afficher les absences des N derniers JOURS
      number:          5,     // nombre maximum d'absences à lister
      showFrom:        "00:00",
      showUntil:       "23:59"
    },

    // ── Retards ────────────────────────────────────────────────────
    Delays: {
      display:         true,
      displayDuration: 60,    // N derniers JOURS
      number:          5,
      showFrom:        "00:00",
      showUntil:       "23:59"
    },

    // ── Punitions ──────────────────────────────────────────────────
    Punishments: {
      display:         true,
      displayDuration: 60,    // N derniers JOURS
      number:          5,
      showFrom:        "00:00",
      showUntil:       "23:59"
    }
  }
}
```

---

### Plages horaires d'affichage

Chaque section peut être limitée à une ou plusieurs tranches horaires.

#### Tranche unique — `showFrom` / `showUntil`

```javascript
Timetable: {
  display: true,
  showFrom:  "06:30",
  showUntil: "18:00"
}
```

#### Plusieurs tranches — `showRanges`

Utilisez `showRanges` pour définir plusieurs créneaux d'affichage dans la journée. La section est visible dès qu'au moins une tranche est active.

```javascript
Homeworks: {
  display: true,
  showRanges: [
    { from: "06:30", until: "08:30" },
    { from: "16:00", until: "22:00" }
  ]
}
```

> Si `showRanges` est défini, il prend la priorité sur `showFrom`/`showUntil`.  
> Si `display: false`, la section est **toujours masquée**, quelle que soit l'heure.

---

### Exemples de configurations

#### Compte parent — deux enfants

```javascript
// Instance Clara (top_left)
{
  module: "MMM-pawmote",
  position: "top_left",
  config: {
    childName:      "Clara",
    updateInterval: "15m",
    Header: {
      displayEstablishmentName: false,
      displayStudentName:       true,
      displayStudentClass:      false
    },
    Timetable:   { display: true,  displayToday: true, displayNextDay: true,
                   displayTeacher: true, displayRoom: true },
    Homeworks:   { display: true,  searchDays: 14 },
    Grades:      { display: true,  displayDuration: 30, number: 10 },
    Absences:    { display: true,  displayDuration: 60, number: 5 },
    Delays:      { display: true,  displayDuration: 60, number: 5 },
    Punishments: { display: true,  displayDuration: 60, number: 5 }
  }
},
// Instance Rafael (top_center)
{
  module: "MMM-pawmote",
  position: "top_center",
  config: {
    childName:      "Rafael",
    updateInterval: "15m",
    Header: {
      displayEstablishmentName: false,
      displayStudentName:       true,
      displayStudentClass:      false
    },
    Timetable:   { display: true,  displayToday: true, displayNextDay: true,
                   displayTeacher: true, displayRoom: true },
    Homeworks:   { display: true,  searchDays: 14 },
    Grades:      { display: true,  displayDuration: 30, number: 10 },
    Absences:    { display: true,  displayDuration: 60, number: 5 },
    Delays:      { display: true,  displayDuration: 60, number: 5 },
    Punishments: { display: true,  displayDuration: 60, number: 5 }
  }
}
```

#### Avec plages horaires multiples

```javascript
{
  module: "MMM-pawmote",
  position: "top_left",
  config: {
    childName: "Clara",
    Timetable: {
      display: true,
      showOnlyFuture: true,
      showRanges: [
        { from: "06:30", until: "09:00" },
        { from: "11:00", until: "18:00" }
      ]
    },
    Homeworks: {
      display: true,
      searchDays: 14,
      showRanges: [
        { from: "06:30", until: "08:30" },
        { from: "16:00", until: "22:00" }
      ]
    },
    Grades:      { display: true, displayDuration: 30, number: 5 },
    Absences:    { display: true, displayDuration: 30, number: 3 },
    Delays:      { display: true, displayDuration: 30, number: 3 },
    Punishments: { display: false }
  }
}
```

#### Debug

```javascript
{
  module: "MMM-pawmote",
  position: "top_left",
  config: {
    debug: true,
    updateInterval: "2m"
  }
}
```

---

## Système de tokens

Pronote invalide un token après **chaque utilisation** — il fonctionne comme un ticket à usage unique. Le module gère automatiquement la rotation sans aucune intervention manuelle.

### Rotation automatique

```
Cycle de mise à jour (ex. toutes les 15 min)
        │
        ▼
  pw.loginToken(primary) → Pronote retourne un NOUVEAU token
        │
        ▼
  ancien primary → devient backup
  nouveau token  → devient primary (sauvegardé sur disque)
```

### Fallback sur le backup

Le token backup n'est utilisé **qu'en cas d'expiration réelle** (erreur d'authentification Pronote). Il ne sera jamais consommé pour une erreur réseau passagère — le primary reste intact et sera réessayé au prochain cycle.

```
primary expiré (SessionExpiredError / AuthenticateError)
        │
        ▼
  pw.loginToken(backup) → renouvelle les deux tokens
        │
        └── backup expiré → message d'erreur → ré-authentification requise
```

### Multi-instances (plusieurs enfants)

Quand Clara et Rafael tournent simultanément, un **mutex** garantit qu'ils ne lisent jamais le même token en même temps. Le second enfant attend que le premier ait terminé sa rotation avant de lire les tokens du disque — il récupère directement les tokens déjà renouvelés.

Les tokens sont stockés dans `cache/tokens.json` (exclu du git). Pour les supprimer : page de configuration → **🗑 Supprimer les tokens**.

---

## Page de configuration

Accessible à l'adresse :

```
http://<adresse-ip-du-miroir>:8080/MMM-pawmote/config
```

### Fonctionnalités de la page de config

| Indicateur | Signification |
| --- | --- |
| ✅ **Connecté** | Le module communique avec Pronote sans erreur |
| ⏳ **Token présent** | Token sauvegardé, connexion en cours ou pas encore effectuée |
| ⚠️ **Token expiré** | Les deux tokens ont échoué — reconfigurer le module |
| ❌ **Aucun token** | Première utilisation — s'authentifier |

Après une authentification réussie :

- **Compte élève** : un exemple de bloc `config.js` complet est affiché directement.
- **Compte parent** : les enfants apparaissent sous forme de cartes. Cliquez sur un enfant pour afficher le bloc `config.js` correspondant.

La documentation complète est accessible via le lien **📖 Documentation** en haut de la page.

---

## Dépannage

### ❌ "Aucun token configuré"
→ Rendez-vous sur `http://<ip>:8080/MMM-pawmote/config` et authentifiez-vous.

### ❌ "Connexion impossible (token expiré)"
→ Les deux tokens ont expiré. La page de configuration affiche le message ⚠️ Token expiré avec le détail de l'erreur. Reconfigurez le module.

### ❌ L'emploi du temps ne s'affiche pas
→ Vérifiez `Timetable.display: true` et que l'heure est dans la plage `showFrom`/`showUntil`.

### ❌ Les notes ou absences ne s'affichent pas
→ Ces données utilisent le protocole brut Pronote. Activez `debug: true` et consultez les logs.

### ❌ Module bloqué sur l'écran de chargement
→ Vérifiez que `npm install` a bien été exécuté et que le dossier `node_modules/pawnote` existe.

### ❌ "Pas de cours à venir" s'affiche à la place du prochain cours

→ Soit il n'y a effectivement plus de cours planifiés dans Pronote, soit les données n'ont pas encore été récupérées (attendre le prochain cycle de mise à jour).

---

## Structure des fichiers

```text
MMM-pawmote/
├── MMM-pawmote.js           # Module frontend (navigateur)
├── node_helper.js           # Backend Node.js (Pawnote + Pronote)
├── pawmote.css              # Feuille de style
├── package.json
├── config-page/
│   ├── index.html           # Page web de configuration
│   └── docs.html            # Documentation en ligne
├── templates/
│   ├── layout.njk
│   ├── loading.njk
│   ├── error.njk
│   └── includes/
│       ├── timetable.njk
│       ├── homeworks.njk
│       ├── grades.njk
│       ├── absences.njk
│       ├── delays.njk
│       └── punishments.njk
├── resources/
│   ├── pronote.png
│   └── icon.png
└── cache/                   # Généré automatiquement (gitignore)
    └── tokens.json
```

---

## Crédits

- **Aldarande** — Développement MMM-pawmote (Pawnote rewrite-2.0)
- **Julien "delphiki" Villetorte** — Module MMM-Pronote original
- **bugsounet** — Module MMM-Pronote original
- **[LiterateInk/Pawnote](https://github.com/LiterateInk/Pawnote)** — Bibliothèque de communication Pronote

Licence : **MIT**
