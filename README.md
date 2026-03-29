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
- [Dépannage](#dépannage)
- [Structure des fichiers](#structure-des-fichiers)
- [Crédits](#crédits)
- [Documentation développeur](docs/dev.md)

---

## Fonctionnalités

| Section | Ce qui est affiché |
|---|---|
| 📅 **Emploi du temps** | Cours du jour (restants) + prochain jour scolaire |
| 📝 **Devoirs** | Liste groupée par date limite, avec statut fait/à faire |
| 📊 **Notes** | Dernières notes avec barème, moyenne de classe et coefficient |
| 🚫 **Absences** | Absences justifiées / non justifiées avec motif |
| ⏱ **Retards** | Retards avec durée et motif |
| ⚖ **Punitions** | Punitions avec type et motif |
| ⏰ **Plages horaires** | Chaque section peut être masquée selon l'heure (`showFrom` / `showUntil`) |
| 👨‍👩‍👧 **Multi-comptes** | Élève ou parent (sélection d'enfant) |
| 🔒 **Double token** | Rotation automatique primary → backup, reconnexion transparente |
| ⚙ **Page de config** | Interface web pour QR Code + PIN ou identifiants |

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
   - **Scanner** : si votre appareil a une caméra, pointez-la vers le QR Code
   - **Coller JSON** : décryptez le QR Code avec une app tierce, copiez le JSON et collez-le
7. Saisissez votre **PIN** dans le champ prévu
8. Cliquez sur **Valider le QR Code**

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

Si vous avez un compte **parent** avec **plusieurs enfants**, la page de configuration affiche automatiquement un sélecteur après la connexion. Cliquez sur le nom de l'enfant à afficher sur le miroir.

---

## Configuration complète

### Référence de toutes les options

```javascript
{
  module: "MMM-pawmote",
  position: "top_left",   // top_left | top_center | top_right | ...
  config: {

    // ── Global ─────────────────────────────────────────────────────
    debug:          false,    // true = logs détaillés dans la console
    language:       null,     // null = reprend config.language de MagicMirror
    updateInterval: "15m",    // fréquence de mise à jour : "30s", "5m", "1h", "1d"

    // ── En-tête ────────────────────────────────────────────────────
    Header: {
      displayEstablishmentName: true,  // nom de l'établissement
      displayStudentName:       true,  // prénom + nom de l'élève
      displayStudentClass:      true,  // classe (ex : 3ème B)
    },

    // ── Emploi du temps ────────────────────────────────────────────
    Timetable: {
      display:        true,    // activer la section
      displayToday:   true,    // cours du jour
      displayNextDay: true,    // prochain jour scolaire
      displayTeacher: true,    // nom du professeur
      displayRoom:    true,    // salle de cours
      showOnlyFuture: false,   // true = masque les cours déjà passés aujourd'hui
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
      displayDuration: 30,    // afficher les notes des N derniers jours
      number:          10,    // nombre maximum de notes à lister
      showFrom:        "00:00",
      showUntil:       "23:59"
    },

    // ── Absences ───────────────────────────────────────────────────
    Absences: {
      display:         true,
      displayDuration: 60,    // afficher les absences des N derniers jours
      number:          5,
      showFrom:        "00:00",
      showUntil:       "23:59"
    },

    // ── Retards ────────────────────────────────────────────────────
    Delays: {
      display:         true,
      displayDuration: 60,
      number:          5,
      showFrom:        "00:00",
      showUntil:       "23:59"
    },

    // ── Punitions ──────────────────────────────────────────────────
    Punishments: {
      display:         true,
      displayDuration: 60,
      number:          5,
      showFrom:        "00:00",
      showUntil:       "23:59"
    }
  }
}
```

---

### Plages horaires d'affichage

Chaque section dispose de deux paramètres `showFrom` et `showUntil` (format `"HH:MM"`) pour n'afficher la section que pendant une certaine tranche horaire.

| Cas d'usage | showFrom | showUntil |
|---|---|---|
| Emploi du temps : matin seulement | `"06:00"` | `"12:00"` |
| Notes : soir seulement | `"17:00"` | `"22:00"` |
| Devoirs : toujours afficher | `"00:00"` | `"23:59"` |

> Si `display: false`, la section est **toujours masquée**, quelle que soit l'heure.

---

### Exemples de configurations

#### Famille (affichage par tranches)

```javascript
{
  module: "MMM-pawmote",
  position: "top_right",
  config: {
    updateInterval: "20m",
    Timetable: {
      display: true,
      showOnlyFuture: true,
      showFrom: "06:30",
      showUntil: "18:00"
    },
    Homeworks: {
      display: true,
      displayDone: false,
      searchDays: 7,
      showFrom: "16:00",
      showUntil: "22:00"
    },
    Grades: {
      display: true,
      displayDuration: 14,
      number: 5,
      showFrom: "17:00",
      showUntil: "22:00"
    },
    Absences:    { display: true,  number: 3 },
    Delays:      { display: true,  number: 3 },
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

Pronote invalide un token après chaque utilisation. Le module conserve automatiquement **deux tokens** (primary + backup) pour garantir la reconnexion même en cas d'incident.

```
Connexion réussie → token T₂ reçu
        │
        ▼
  primary = T₂  ← actif
  backup  = T₁  ← secours

Si T₂ échoue → utilise T₁ automatiquement
Si T₁ échoue → message d'erreur + lien vers la page de config
```

Les tokens sont stockés dans `cache/tokens.json` (exclu du git). Pour les supprimer : page de configuration → **🗑 Supprimer les tokens**.

---

## Dépannage

### ❌ "Aucun token configuré"
→ Rendez-vous sur `http://<ip>:8080/MMM-pawmote/config` et authentifiez-vous.

### ❌ "Connexion impossible (token expiré)"
→ Les deux tokens ont expiré. Reconfigurez le module via la page web.

### ❌ L'emploi du temps ne s'affiche pas
→ Vérifiez `Timetable.display: true` et que l'heure est dans la plage `showFrom`/`showUntil`.

### ❌ Les notes ou absences ne s'affichent pas
→ Ces données utilisent le protocole brut Pronote. Activez `debug: true` et consultez les logs.

### ❌ Module bloqué sur l'écran de chargement
→ Vérifiez que `npm install` a bien été exécuté et que le dossier `node_modules/pawnote` existe.

---

## Structure des fichiers

```
MMM-pawmote/
├── MMM-pawmote.js           # Module frontend (navigateur)
├── node_helper.js           # Backend Node.js (Pawnote + Pronote)
├── pawmote.css              # Feuille de style
├── package.json
├── config-page/
│   └── index.html           # Page web de configuration
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

---

📖 **[Documentation développeur →](docs/dev.md)**
