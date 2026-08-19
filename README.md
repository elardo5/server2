# GasyEcole – Application Desktop (Electron)

Application de gestion scolaire avec **activation en ligne liée à la machine**.

---

## 🌐 Activation en ligne

La licence est liée à l'ordinateur et validée par un serveur distant. La première
activation nécessite Internet. Le serveur signe un jeton Ed25519 que l'application
vérifie localement. Une période de grâce de 7 jours évite un blocage pendant une
panne temporaire du serveur.

### Démarrer le serveur
Copiez `.env.example` vers `.env`, puis renseignez le token administrateur :
```bash
cp .env.example .env
```
Sous Windows, créez simplement une copie nommée `.env`. Le fichier `.env` est
lu automatiquement au démarrage et ne doit jamais être envoyé dans l'archive
ou publié dans Git.

```bash
npm run server
```
Le serveur crée automatiquement `server/data/`. Ce dossier doit être sauvegardé
et `private-key.pem` ne doit jamais être publié.

### Valider une machine à distance
Vous pouvez maintenant ouvrir `http://localhost:8787/admin` dans un navigateur
sur la machine qui héberge le serveur, saisir `ADMIN_TOKEN`, puis activer ou
révoquer les machines depuis l'interface.

L'endpoint `/admin/requests` reste disponible pour les scripts et les appels API.

```bash
# Voir les demandes
curl -H "Authorization: Bearer VOTRE_TOKEN" http://localhost:8787/admin/requests

# Activer
curl -X POST -H "Authorization: Bearer VOTRE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"customerName":"Ecole exemple","expiresAt":"2027-08-19T00:00:00.000Z"}' \
  http://localhost:8787/admin/licenses/IDENTIFIANT_MACHINE/activate

# Révoquer
curl -X POST -H "Authorization: Bearer VOTRE_TOKEN" \
  http://localhost:8787/admin/licenses/IDENTIFIANT_MACHINE/revoke
```

Sur le poste de l'école, l'utilisateur clique sur « Demander l'activation », puis
« Vérifier l'activation » après votre validation.

Dans l'interface `/admin`, choisissez la durée en jours avant de cliquer sur
« Activer ». Le serveur génère alors automatiquement un jeton signé lié à
l'identifiant machine et à cette date d'expiration.

---

## 🚀 Installation & lancement

```bash
cd gasyecole-desktop
npm install
npm start        # lancer l'app
```

Configurez l'URL du serveur avant de compiler en modifiant
`src/config.js` (`activationApiUrl`). La variable d'environnement
`GASYECOLE_API_URL` peut aussi être utilisée pendant les tests.

## 📦 Créer un installateur

```bash
npm run build          # pour la plateforme courante (Windows → .exe, Linux → .AppImage)
npm run build:win      # Windows uniquement
npm run build:linux    # Linux uniquement
```
Les fichiers générés se trouvent dans `dist/`.

---

## 📁 Structure

```
gasyecole-desktop/
├── main.js              # Processus principal Electron
├── preload.js           # Bridge sécurisé (IPC)
├── package.json
├── server/
│   └── server.js          # API d'activation
├── src/
│   ├── index.html       # Application HTML complète (inchangée)
│   ├── activation.html  # Écran d'activation
│   └── license.js         # Client d'activation et vérification du jeton
└── .env.example
```

---

## ⚠️ Important

- Utilisez impérativement HTTPS lorsque le serveur est public.
- Ne mettez jamais `ADMIN_TOKEN` ou `server/data/private-key.pem` dans GitHub.
- Pour une vraie mise en production, placez l'API derrière un domaine HTTPS et
  remplacez le stockage JSON par PostgreSQL.
