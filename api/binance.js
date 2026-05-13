/**
 * EQUO — Vercel Serverless Function
 * Pasarela de pagos Binance Pay (server-side seguro)
 *
 * Variables de entorno (Vercel Dashboard → Settings → Environment Variables):
 *   BINANCE_API_KEY       = Certificate SN / API Key de Binance Pay
 *   BINANCE_SECRET_KEY    = Secret Key de Binance Pay
 *   FIREBASE_PROJECT_ID   = Project ID de Firebase
 *   FIREBASE_CLIENT_EMAIL = Service Account email
 *   FIREBASE_PRIVATE_KEY  = Service Account private key
 *
 * Endpoints:
 *   POST /api/binance?action=createOrder   → crea orden Binance Pay
 *   POST /api/binance?action=queryPayment  → consulta estado + activa plan
 */

'use strict';

const crypto = require('crypto');
const https  = require('https');

// ── Diagnóstico de variables de entorno (SIN exponer valores completos) ───────
// Se ejecuta una sola vez al arrancar la función serverless.
(function checkEnvVars() {
  const vars = [
    'BINANCE_API_KEY',
    'BINANCE_SECRET_KEY',
    'FIREBASE_PROJECT_ID',
    'FIREBASE_CLIENT_EMAIL',
    'FIREBASE_PRIVATE_KEY',
  ];
  vars.forEach((name) => {
    const val = process.env[name];
    if (!val) {
      console.error(`[EQUO ENV] ${name} está UNDEFINED o vacía.`);
    } else {
      const masked = val.length > 10
        ? `${val.slice(0, 6)}...${val.slice(-4)}`
        : '******';
      console.log(`[EQUO ENV] ${name} presente (${masked}) len=${val.length}`);
    }
  });
})();

// ── Firebase Admin (inicialización lazy) ──────────────────────────────────────
let _db    = null;
let _admin = null;

function getAdmin() {
  if (_admin) return _admin;
  _admin = require('firebase-admin');

  if (!_admin.apps.length) {
    // Vercel puede almacenar \n literales → normalizarlos
    const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

    _admin.initializeApp({
      credential: _admin.credential.cert({
        projectId:   process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey,
      }),
    });
    console.log('[EQUO Firebase] Admin SDK inicializado correctamente.');
  }

  return _admin;
}

function getDb() {
  if (_db) return _db;
  _db = getAdmin().firestore();
  return _db;
}

// ── Configuración de Binance Pay ──────────────────────────────────────────────
const BINANCE_HOST = 'bpay.binanceapi.com';

// Leídas en tiempo de ejecución (no en módulo-scope) para garantizar que
// las variables estén inyectadas antes del primer uso real.
function getBinanceKeys() {
  const apiKey = process.env.BINANCE_API_KEY;
  const secret = process.env.BINANCE_SECRET_KEY;

  if (!apiKey || !secret) {
    throw new Error('BINANCE_API_KEY o BINANCE_SECRET_KEY no están configuradas en las variables de entorno de Vercel.');
  }

  return { apiKey, secret };
}

// Planes disponibles
const PLANS = {
  personal:     { amount: '9.99',  currency: 'USDT', label: 'Plan Personal EQUO' },
  entrepreneur: { amount: '19.99', currency: 'USDT', label: 'Plan Emprendedor EQUO' },
};

// ── Utilidades de firma ───────────────────────────────────────────────────────

/**
 * Genera un nonce alfanumérico de 32 caracteres.
 * Binance Pay exige: [A-Za-z0-9], máx 32 chars.
 * crypto.randomBytes(16).toString('hex') → exactamente 32 chars hex
 */
function generateNonce() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Construye la firma HMAC-SHA512 según la documentación oficial de Binance Pay v2.
 *
 * Formato del mensaje a firmar (exactamente):
 *   {timestamp}\n{nonce}\n{bodyPayload}\n
 *
 * - timestamp : milisegundos Unix como string
 * - nonce     : string alfanumérico ≤ 32 chars
 * - bodyPayload: JSON.stringify del body (mismo string que se envía en la petición)
 *
 * El resultado debe ir en mayúsculas en el header BinancePay-Signature.
 */
function buildBinanceSignature(timestamp, nonce, bodyPayload, secret) {
  // El salto de línea final (\n) después del payload es OBLIGATORIO.
  const message = `${timestamp}\n${nonce}\n${bodyPayload}\n`;

  console.log('[EQUO Signature] Mensaje a firmar (primeros 120 chars):', message.slice(0, 120));

  return crypto
    .createHmac('sha512', secret)
    .update(message, 'utf8')
    .digest('hex')
    .toUpperCase();   // Binance exige MAYÚSCULAS
}

/**
 * Realiza una petición HTTPS POST autenticada a la API de Binance Pay.
 *
 * Flujo de firma correcto:
 *  1. Serializar el body a JSON (bodyPayload)
 *  2. Generar timestamp con pequeño offset para absorber desfase horario
 *  3. Generar nonce
 *  4. Firmar con HMAC-SHA512(timestamp + nonce + bodyPayload)
 *  5. Enviar headers con la firma y el mismo bodyPayload como body
 */
function binanceRequest(path, body) {
  return new Promise((resolve, reject) => {
    const { apiKey, secret } = getBinanceKeys();

    // 1. Serializar el body — DEBE ser el mismo string que firmamos y enviamos.
    const bodyPayload = JSON.stringify(body);

    // 2. Timestamp con offset de +500ms para compensar posible desfase de reloj
    //    entre el servidor de Vercel y los servidores de Binance.
    //    Binance tolera ±1000ms de diferencia.
    const timestamp = (Date.now() + 500).toString();

    // 3. Nonce único por petición
    const nonce = generateNonce();

    // 4. Firma HMAC-SHA512
    const signature = buildBinanceSignature(timestamp, nonce, bodyPayload, secret);

    // Log de diagnóstico (sin exponer la firma completa)
    console.log(`[EQUO Binance] POST ${path} | ts=${timestamp} | nonce=${nonce} | sig=${signature.slice(0, 12)}...`);

    const options = {
      hostname: BINANCE_HOST,
      port:     443,
      path,
      method:  'POST',
      headers: {
        // 5. Headers requeridos por Binance Pay v2
        'Content-Type':              'application/json',
        'Content-Length':            Buffer.byteLength(bodyPayload, 'utf8'),
        'BinancePay-Timestamp':      timestamp,
        'BinancePay-Nonce':          nonce,
        // BinancePay-Signature: HMAC-SHA512 en MAYÚSCULAS
        'BinancePay-Signature':      signature,
        // BinancePay-Certificate-SN: tu API Key / Certificate Serial Number
        'BinancePay-Certificate-SN': apiKey,
      },
    };

    const req = https.request(options, (httpsRes) => {
      let data = '';
      httpsRes.on('data', (chunk) => { data += chunk; });
      httpsRes.on('end', () => {
        console.log(`[EQUO Binance] Respuesta HTTP ${httpsRes.statusCode}:`, data.slice(0, 200));
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('Binance response parse error: ' + data));
        }
      });
    });

    req.on('error', (err) => {
      console.error('[EQUO Binance] Request error:', err.message);
      reject(err);
    });

    // Escribir el payload (mismo string serializado, NO re-stringify)
    req.write(bodyPayload);
    req.end();
  });
}

// ── Helpers de respuesta ──────────────────────────────────────────────────────

function sendJSON(res, status, data) {
  res.status(status).json(data);
}

function sendError(res, status, message) {
  console.error(`[EQUO] Error ${status}: ${message}`);
  res.status(status).json({ error: message });
}

// ── CORS ──────────────────────────────────────────────────────────────────────

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// ── Handler principal ─────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return sendError(res, 405, 'Método no permitido. Usa POST.');
  }

  const action = req.query.action || req.body?.action;
  console.log(`[EQUO] Acción recibida: "${action}"`);

  // ── Autenticación via Firebase ID Token ──────────────────────────────────
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return sendError(res, 401, 'No autenticado. Envía el Firebase ID Token en Authorization: Bearer <token>.');
  }

  const idToken = authHeader.slice(7).trim();
  let uid;

  try {
    const admin   = getAdmin();
    const decoded = await admin.auth().verifyIdToken(idToken);
    uid = decoded.uid;
    console.log(`[EQUO Auth] Token válido. uid=${uid}`);
  } catch (authErr) {
    console.error('[EQUO Auth] Token inválido:', authErr.code, authErr.message);
    return sendError(res, 401, `Token de autenticación inválido: ${authErr.code || authErr.message}`);
  }

  // ── Enrutamiento ─────────────────────────────────────────────────────────
  if (action === 'createOrder')  return handleCreateOrder(req, res, uid);
  if (action === 'queryPayment') return handleQueryPayment(req, res, uid);

  return sendError(res, 400, `Acción desconocida: "${action}". Usa "createOrder" o "queryPayment".`);
};

// ─────────────────────────────────────────────────────────────────────────────
// Acción 1: createOrder
// ─────────────────────────────────────────────────────────────────────────────
async function handleCreateOrder(req, res, uid) {
  const { plan } = req.body;

  if (!PLANS[plan]) {
    return sendError(res, 400, `Plan desconocido: "${plan}". Usa "personal" o "entrepreneur".`);
  }

  const planInfo        = PLANS[plan];
  const merchantOrderId = `EQUO-${uid.slice(0, 8)}-${Date.now()}`;

  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL
    || process.env.VERCEL_URL
    || 'equo.app';

  const body = {
    env:             { terminalType: 'WEB' },
    merchantTradeNo: merchantOrderId,
    orderAmount:     planInfo.amount,
    currency:        planInfo.currency,
    description:     planInfo.label,
    goods: {
      goodsType:        '02',
      goodsCategory:    'Z000',
      referenceGoodsId: plan,
      goodsName:        planInfo.label,
    },
    returnUrl: `https://${host}/app?action=login`,
    cancelUrl: `https://${host}/app`,
  };

  try {
    const response = await binanceRequest('/binancepay/openapi/v2/order', body);

    if (response.status !== 'SUCCESS') {
      console.error('[EQUO] Binance createOrder falló:', JSON.stringify(response));
      return sendError(res, 502, `Binance Pay error: ${response.errorMessage || response.status}`);
    }

    // Guardar orden en Firestore — plan y uid quedan inmutables del lado servidor
    await getDb().collection('payments').doc(merchantOrderId).set({
      uid,
      plan,
      amount:          planInfo.amount,
      currency:        planInfo.currency,
      prepayId:        response.data.prepayId,
      merchantOrderId,
      status:          'PENDING',
      createdAt:       new Date().toISOString(),
    });

    return sendJSON(res, 200, {
      prepayId:        response.data.prepayId,
      qrcodeLink:      response.data.qrcodeLink,
      checkoutUrl:     response.data.checkoutUrl,
      deeplink:        response.data.universalUrl || response.data.checkoutUrl,
      merchantOrderId,
      amount:          planInfo.amount,
      currency:        planInfo.currency,
      label:           planInfo.label,
    });

  } catch (err) {
    console.error('[EQUO] handleCreateOrder error:', err);
    return sendError(res, 500, err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Acción 2: queryPayment
// ─────────────────────────────────────────────────────────────────────────────
async function handleQueryPayment(req, res, uid) {
  const { prepayId, merchantOrderId } = req.body;

  if (!prepayId || !merchantOrderId) {
    return sendError(res, 400, 'prepayId y merchantOrderId son requeridos.');
  }

  try {
    const response = await binanceRequest('/binancepay/openapi/v2/order/query', {
      prepayId,
      merchantTradeNo: merchantOrderId,
    });

    if (response.status !== 'SUCCESS') {
      console.error('[EQUO] Binance queryPayment falló:', JSON.stringify(response));
      return sendError(res, 502, `Binance query error: ${response.errorMessage || response.status}`);
    }

    const orderStatus = response.data?.status; // INITIAL | PENDING | PAID | CANCELED | ERROR

    if (orderStatus === 'PAID') {
      const db = getDb();

      // ── Verificación de propiedad del pago (anti-hijacking) ────────────────
      // Leer la orden desde Firestore para validar que pertenece al uid
      // que hace la petición y obtener el plan real (no confiar en el cliente).
      const paymentDoc = await db.collection('payments').doc(merchantOrderId).get();

      if (!paymentDoc.exists) {
        console.error(`[EQUO Auth] Orden ${merchantOrderId} no encontrada en Firestore.`);
        return sendError(res, 404, 'Orden de pago no encontrada.');
      }

      const paymentData = paymentDoc.data();

      if (paymentData.uid !== uid) {
        console.error(`[EQUO Auth] Intento de hijacking: uid=${uid} intentó activar orden de uid=${paymentData.uid}`);
        return sendError(res, 403, 'Esta orden de pago no pertenece a tu cuenta.');
      }

      // Usar el plan registrado en Firestore, NO el enviado por el cliente
      const planKey = paymentData.plan;
      if (!PLANS[planKey]) {
        console.error(`[EQUO] Plan inválido en orden Firestore: "${planKey}"`);
        return sendError(res, 400, 'Plan inválido registrado en la orden.');
      }

      // Verificar que la orden no fue activada previamente (idempotencia)
      if (paymentData.status === 'PAID') {
        console.log(`[EQUO] Orden ${merchantOrderId} ya fue procesada anteriormente.`);
        return sendJSON(res, 200, { orderStatus: 'PAID', planActivated: false, alreadyProcessed: true });
      }

      const now    = new Date().toISOString();
      const subEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      await db.collection('users').doc(uid).set({
        isPaid:              true,
        plan:                planKey,
        planStatus:          planKey,
        selectedPlan:        planKey,
        trialEndDate:        null,
        subscriptionDate:    now,
        subscriptionEndDate: subEnd,
        paidAt:              now,
        lastPaymentId:       merchantOrderId,
      }, { merge: true });

      await db.collection('payments').doc(merchantOrderId).set(
        { status: 'PAID', paidAt: now },
        { merge: true }
      );

      console.log(`[EQUO] Pago confirmado. uid=${uid} plan=${planKey}`);
      return sendJSON(res, 200, { orderStatus: 'PAID', planActivated: true });
    }

    return sendJSON(res, 200, {
      orderStatus:   orderStatus || 'PENDING',
      planActivated: false,
    });

  } catch (err) {
    console.error('[EQUO] handleQueryPayment error:', err);
    return sendError(res, 500, err.message);
  }
}
