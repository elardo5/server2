/**
 * Activation en ligne GasyEcole.
 * Le serveur conserve la clé privée et signe les jetons de licence.
 * La première activation nécessite Internet. Un jeton déjà reçu peut
 * ensuite être vérifié hors ligne pendant la période de grâce.
 */
const crypto = require('crypto')
const os = require('os')
const fs = require('fs')
const path = require('path')
const http = require('http')
const https = require('https')
const config = require('./config')

// À remplacer par l'URL HTTPS de votre serveur avant la mise en production.
const API_URL = process.env.GASYECOLE_API_URL || config.activationApiUrl
const GRACE_DAYS = 7

function getMachineFingerprint() {
  const hostname = os.hostname()
  const cpu = (os.cpus()[0] || {}).model || 'no-cpu'
  let mac = 'no-mac'
  const ifaces = os.networkInterfaces()
  outer: for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
        mac = iface.mac
        break outer
      }
    }
  }
  return crypto.createHash('sha256')
    .update(`${hostname}||${cpu}||${mac}`)
    .digest('hex').slice(0, 16).toUpperCase()
}

function licensePath(app) {
  return path.join(app.getPath('userData'), 'activation.gasyecole.json')
}

function readLocal(app) {
  try { return JSON.parse(fs.readFileSync(licensePath(app), 'utf8')) } catch { return null }
}

function saveLocal(app, value) {
  fs.mkdirSync(path.dirname(licensePath(app)), { recursive: true })
  fs.writeFileSync(licensePath(app), JSON.stringify(value, null, 2), { mode: 0o600 })
}

function b64url(value) {
  return Buffer.from(value).toString('base64url')
}

function decodeToken(token) {
  const [body, signature] = String(token || '').split('.')
  if (!body || !signature) return null
  return { body, signature, payload: JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) }
}

function request(method, route, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(route, API_URL)
    const transport = url.protocol === 'https:' ? https : http
    const data = body === undefined ? null : JSON.stringify(body)
    const req = transport.request(url, {
      method,
      headers: { ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) },
      timeout: 10000
    }, res => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', chunk => { text += chunk })
      res.on('end', () => {
        let parsed = {}
        try { parsed = JSON.parse(text) } catch {}
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed)
        else reject(new Error(parsed.error || `Serveur HTTP ${res.statusCode}`))
      })
    })
    req.on('timeout', () => req.destroy(new Error('Délai de connexion dépassé')))
    req.on('error', reject)
    if (data) req.write(data)
    req.end()
  })
}

async function requestActivation(app) {
  try {
    const machineId = getMachineFingerprint()
    const result = await request('POST', '/v1/activation/request', { machineId, appVersion: '1.0.0' })
    if (result.licenseToken) {
      saveLocal(app, { machineId, licenseToken: result.licenseToken, lastOnlineCheck: new Date().toISOString() })
      return { success: true, status: 'active' }
    }
    return { success: true, status: result.status || 'pending', message: result.message }
  } catch (error) {
    return { success: false, error: `Impossible de contacter le serveur : ${error.message}` }
  }
}

async function checkActivation(app) {
  try {
    const machineId = getMachineFingerprint()
    const result = await request('GET', `/v1/activation/status/${encodeURIComponent(machineId)}`)
    if (result.licenseToken) {
      saveLocal(app, { machineId, licenseToken: result.licenseToken, lastOnlineCheck: new Date().toISOString() })
      return { success: true, status: 'active' }
    }
    return { success: true, status: result.status || 'pending', message: result.message }
  } catch (error) {
    return { success: false, error: `Impossible de contacter le serveur : ${error.message}` }
  }
}

function verifyToken(app) {
  const local = readLocal(app)
  if (!local || local.machineId !== getMachineFingerprint()) return false
  const decoded = decodeToken(local.licenseToken)
  if (!decoded || decoded.payload.machineId !== local.machineId) return false
  if (decoded.payload.expiresAt && Date.now() > Date.parse(decoded.payload.expiresAt)) return false
  const lastCheck = Date.parse(local.lastOnlineCheck || 0)
  if (lastCheck && Date.now() - lastCheck > GRACE_DAYS * 86400000) return false
  const publicKey = decoded.payload.publicKey
  if (!publicKey) return false
  return crypto.verify(null, Buffer.from(decoded.body), publicKey, Buffer.from(decoded.signature, 'base64url'))
}

function isActivated(app) {
  return verifyToken(app)
}

module.exports = { getMachineFingerprint, requestActivation, checkActivation, isActivated }