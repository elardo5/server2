/**
 * Serveur d'activation GasyEcole, sans dépendance externe.
 *
 * Démarrage :
 *   ADMIN_TOKEN="un-token-fort" PORT=8787 node server/server.js
 *
 * L'administrateur peut utiliser les exemples curl du README.
 */
const http = require('http')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

// Lecture volontairement minimale de .env, sans dépendance externe.
const envPath = path.join(__dirname, '..', '.env')
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
    }
  }
}

const PORT = Number(process.env.PORT || 8787)
const ADMIN_TOKEN = process.env.ADMIN_TOKEN

if (!ADMIN_TOKEN) {
  console.error('ADMIN_TOKEN est obligatoire. Exemple: ADMIN_TOKEN="..." npm run server')
  process.exit(1)
}

const dataDir = path.join(__dirname, 'data')
const dbPath = path.join(dataDir, 'licenses.json')
const privatePath = path.join(dataDir, 'private-key.pem')
const publicPath = path.join(dataDir, 'public-key.pem')

fs.mkdirSync(dataDir, { recursive: true })

if (!fs.existsSync(privatePath)) {
  const keys = crypto.generateKeyPairSync('ed25519')

  fs.writeFileSync(
    privatePath,
    keys.privateKey.export({
      type: 'pkcs8',
      format: 'pem'
    }),
    { mode: 0o600 }
  )

  fs.writeFileSync(
    publicPath,
    keys.publicKey.export({
      type: 'spki',
      format: 'pem'
    })
  )
}

let licenses = fs.existsSync(dbPath)
  ? JSON.parse(fs.readFileSync(dbPath, 'utf8'))
  : {}

const save = () => {
  fs.writeFileSync(dbPath, JSON.stringify(licenses, null, 2))
}

const privateKey = fs.readFileSync(privatePath, 'utf8')
const publicKey = fs.readFileSync(publicPath, 'utf8')

function send(res, status, value) {
  const body = JSON.stringify(value)

  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*'
  })

  res.end(body)
}

function tokenFor(record) {
  const payload = {
    machineId: record.machineId,
    product: 'GasyEcole',
    issuedAt: new Date().toISOString(),
    expiresAt: record.expiresAt || null,
    publicKey
  }

  const body = Buffer
    .from(JSON.stringify(payload))
    .toString('base64url')

  const signature = crypto
    .sign(null, Buffer.from(body), privateKey)
    .toString('base64url')

  return `${body}.${signature}`
}

function authorized(req) {
  return req.headers.authorization === `Bearer ${ADMIN_TOKEN}`
}

function body(req) {
  return new Promise((resolve, reject) => {
    let text = ''

    req.on('data', chunk => {
      text += chunk
    })

    req.on('end', () => {
      try {
        resolve(text ? JSON.parse(text) : {})
      } catch {
        reject(new Error('JSON invalide'))
      }
    })
  })
}

const adminHtml = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width">
<title>GasyEcole — Administration</title>

<style>
body {
  font: 15px Arial, sans-serif;
  background: #f1f5f9;
  color: #0f172a;
  margin: 0;
  padding: 32px;
}

main {
  max-width: 1100px;
  margin: auto;
  background: white;
  border-radius: 14px;
  padding: 28px;
  box-shadow: 0 8px 30px #0001;
}

h1 {
  color: #074528;
}

input,
button {
  padding: 10px;
  border-radius: 7px;
  border: 1px solid #cbd5e1;
}

input {
  width: 330px;
  max-width: 90%;
}

button {
  cursor: pointer;
  background: #0e623b;
  color: white;
  border: 0;
  margin: 3px;
}

table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 24px;
}

th,
td {
  text-align: left;
  padding: 11px;
  border-bottom: 1px solid #e2e8f0;
}

.pending {
  color: #b45309;
}

.active {
  color: #15803d;
}

.revoked {
  color: #dc2626;
}

.expired {
  color: #dc2626;
  font-weight: 700;
}

.muted {
  color: #64748b;
}

.countdown {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
</style>
</head>

<body>
<main>
  <h1>GasyEcole — Administration</h1>

  <p>Entrez le token administrateur du serveur.</p>

  <input
    id="token"
    type="password"
    placeholder="ADMIN_TOKEN"
  >

  <label style="margin-left: 12px">
    Durée :

    <input
      id="days"
      type="number"
      value="365"
      min="0"
      style="width: 80px"
    >
    jours

    <input
      id="hours"
      type="number"
      value="0"
      min="0"
      max="23"
      style="width: 65px"
    >
    heures
  </label>

  <button onclick="load()">
    Charger les demandes
  </button>

  <div id="message" class="muted"></div>

  <table>
    <thead>
      <tr>
        <th>Machine</th>
        <th>Client</th>
        <th>Statut</th>
        <th>Demandée le</th>
        <th>Expiration</th>
        <th>Actions</th>
      </tr>
    </thead>

    <tbody id="rows"></tbody>
  </table>
</main>

<script>
const esc = value =>
  String(value || '').replace(
    /[&<>"']/g,
    character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[character])
  )

let countdownTimer = null

function formatRemaining(expiresAt) {
  if (!expiresAt) {
    return '—'
  }

  const remaining = Date.parse(expiresAt) - Date.now()

  if (!Number.isFinite(remaining) || remaining <= 0) {
    return 'Expirée'
  }

  const totalSeconds = Math.floor(remaining / 1000)
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  return (
    (days ? days + 'j ' : '') +
    String(hours).padStart(2, '0') + 'h ' +
    String(minutes).padStart(2, '0') + 'm ' +
    String(seconds).padStart(2, '0') + 's'
  )
}

function refreshCountdowns() {
  document
    .querySelectorAll('[data-expires-at]')
    .forEach(element => {
      const value = formatRemaining(element.dataset.expiresAt)

      element.textContent = value
      element.classList.toggle('expired', value === 'Expirée')
    })
}

async function load() {
  const token = document.getElementById('token').value

  const response = await fetch('/admin/requests', {
    headers: {
      Authorization: 'Bearer ' + token
    }
  })

  if (!response.ok) {
    document.getElementById('message').textContent =
      'Token invalide ou serveur inaccessible.'
    return
  }

  const items = await response.json()

  document.getElementById('message').textContent =
    items.length + ' demande(s)'

  document.getElementById('rows').innerHTML = items
    .map(item => {
      const isExpired =
        item.expiresAt &&
        Date.parse(item.expiresAt) <= Date.now()

      const activateButton =
        item.status === 'pending' || item.status === 'revoked'
          ? '<button onclick="act(\\'' +
            esc(item.machineId) +
            '\\',\\'activate\\')">' +
            (item.status === 'revoked'
              ? 'Réactiver'
              : 'Activer') +
            '</button>'
          : ''

      const revokeButton =
        item.status === 'active'
          ? '<button onclick="act(\\'' +
            esc(item.machineId) +
            '\\',\\'revoke\\')">' +
            'Révoquer' +
            '</button>'
          : ''

      return (
        '<tr>' +
          '<td><code>' + esc(item.machineId) + '</code></td>' +
          '<td>' + esc(item.customerName || '—') + '</td>' +
          '<td class="' + esc(item.status) + '">' +
            esc(item.status) +
          '</td>' +
          '<td>' + esc(item.requestedAt) + '</td>' +
          '<td class="countdown ' +
            (isExpired ? 'expired' : '') +
            '" data-expires-at="' +
            esc(item.expiresAt || '') +
            '">' +
            formatRemaining(item.expiresAt) +
          '</td>' +
          '<td>' +
            activateButton +
            revokeButton +
          '</td>' +
        '</tr>'
      )
    })
    .join('')

  refreshCountdowns()

  if (countdownTimer) {
    clearInterval(countdownTimer)
  }

  countdownTimer = setInterval(refreshCountdowns, 1000)
}

async function act(id, action) {
  const token = document.getElementById('token').value

  const daysValue = Number(
    document.getElementById('days').value
  )

  const hoursValue = Number(
    document.getElementById('hours').value
  )

  const days =
    Number.isFinite(daysValue) && daysValue >= 0
      ? Math.floor(daysValue)
      : 0

  const hours =
    Number.isFinite(hoursValue) && hoursValue >= 0
      ? Math.min(23, Math.floor(hoursValue))
      : 0

  const totalHours = Math.max(
    1,
    days * 24 + hours
  )

  const expiresAt = new Date(
    Date.now() + totalHours * 60 * 60 * 1000
  ).toISOString()

  await fetch(
    '/admin/licenses/' +
      encodeURIComponent(id) +
      '/' +
      action,
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(
        action === 'activate'
          ? { expiresAt }
          : {}
      )
    }
  )

  load()
}
</script>
</body>
</html>`

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    return res.end()
  }

  const url = new URL(
    req.url,
    `http://${req.headers.host}`
  )

  try {
    if (
      req.method === 'GET' &&
      url.pathname === '/health'
    ) {
      return send(res, 200, { ok: true })
    }

    if (
      req.method === 'GET' &&
      url.pathname === '/v1/public-key'
    ) {
      return send(res, 200, { publicKey })
    }

    if (
      req.method === 'GET' &&
      url.pathname === '/admin'
    ) {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8'
      })

      return res.end(adminHtml)
    }

    const statusMatch = url.pathname.match(
      /^\/v1\/activation\/status\/([^/]+)$/
    )

    if (
      req.method === 'GET' &&
      statusMatch
    ) {
      const record =
        licenses[decodeURIComponent(statusMatch[1])]

      if (!record) {
        return send(res, 200, {
          status: 'not_found',
          message: 'Aucune demande pour cette machine.'
        })
      }

      if (record.status !== 'active') {
        return send(res, 200, {
          status: record.status
        })
      }

      if (
        record.expiresAt &&
        Date.now() >= Date.parse(record.expiresAt)
      ) {
        return send(res, 200, {
          status: 'expired',
          message: 'La licence a expiré.'
        })
      }

      return send(res, 200, {
        status: 'active',
        licenseToken: tokenFor(record)
      })
    }

    if (
      req.method === 'POST' &&
      url.pathname === '/v1/activation/request'
    ) {
      const input = await body(req)

      if (
        !/^[A-F0-9]{16}$/.test(
          input.machineId || ''
        )
      ) {
        return send(res, 400, {
          error: 'Identifiant machine invalide.'
        })
      }

      if (!licenses[input.machineId]) {
        licenses[input.machineId] = {
          machineId: input.machineId,
          appVersion: input.appVersion || null,
          status: 'pending',
          requestedAt: new Date().toISOString()
        }
      }

      save()

      const record = licenses[input.machineId]

      if (
        record.status === 'active' &&
        record.expiresAt &&
        Date.now() >= Date.parse(record.expiresAt)
      ) {
        return send(res, 200, {
          status: 'expired',
          message: 'La licence a expiré.'
        })
      }

      return send(
        res,
        200,
        record.status === 'active'
          ? {
              status: 'active',
              licenseToken: tokenFor(record)
            }
          : {
              status: 'pending',
              message:
                'Demande envoyée à l’administrateur.'
            }
      )
    }

    if (!authorized(req)) {
      return send(res, 401, {
        error: 'Accès administrateur requis.'
      })
    }

    if (
      req.method === 'GET' &&
      url.pathname === '/admin/requests'
    ) {
      return send(res, 200, Object.values(licenses))
    }

    const adminMatch = url.pathname.match(
      /^\/admin\/licenses\/([^/]+)\/(activate|revoke)$/
    )

    if (
      req.method === 'POST' &&
      adminMatch
    ) {
      const machineId =
        decodeURIComponent(adminMatch[1])

      if (!licenses[machineId]) {
        return send(res, 404, {
          error: 'Machine introuvable.'
        })
      }

      const action = adminMatch[2]
      const input = await body(req)

      licenses[machineId].status =
        action === 'activate'
          ? 'active'
          : 'revoked'

      if (input.customerName) {
        licenses[machineId].customerName =
          input.customerName
      }

      if (action === 'activate') {
        licenses[machineId].expiresAt =
          input.expiresAt || null
      }

      licenses[machineId].updatedAt =
        new Date().toISOString()

      save()

      return send(res, 200, licenses[machineId])
    }

    return send(res, 404, {
      error: 'Route inconnue.'
    })
  } catch (error) {
    return send(res, 500, {
      error: error.message
    })
  }
})

server.listen(PORT, () => {
  console.log(`Serveur d’activation GasyEcole actif sur le port \${PORT}`
  )
})