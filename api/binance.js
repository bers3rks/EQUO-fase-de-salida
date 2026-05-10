/**
 * EQUO — Vercel Serverless Function
 * Pasarela de pagos Binance Pay (server-side seguro)
 *
 * Variables de entorno requeridas en Vercel Dashboard → Settings → Environment Variables:
 *   BINANCE_API_KEY      = tu API Key de Binance Pay
 *   BINANCE_SECRET_KEY   = tu Secret Key de Binance Pay
 *   FIREBASE_PROJECT_ID  = tu Project ID de Firebase
 *   FIREBASE_CLIENT_EMAIL = Service Account email
 *   FIREBASE_PRIVATE_KEY  = Service Account private key (con \n como saltos de línea)
 *
 * Endpoints (via ?action=):
 *   POST /api/binance?action=createOrder   → crea orden Binance Pay
 *   POST /api/binance?action=queryPayment  → consulta estado + activa plan
 */

const crypto  = require('crypto');
const https   = require('https');

// ── Firebase Admin (inicialización lazy para no romper en build) ──────────────
let _db = null;

function getDb() {
  if (_db) return _db;

  // Importación dinámica para compatibilidad con Vercel
  const admin = require('firebase-admin');

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId:   process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        // Vercel almacena \n literales en la variable → convertirlos
        privateKey:  (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      }),
    });
  }

  _db = admin.firestore();
  return _db;
}

// ── Configuración de Binance Pay ──────────────────────────────────────────────
const BINANCE_HOST    = 'bpay.binanceapi.com';
const BINANCE_API_KEY = process.env.BINANCE_API_KEY;
const BINANCE_SECRET  = process.env.BINANCE_SECRET_KEY;

// Planes disponibles
const PLANS = {
  personal:     { amount: '9.99',  currency: 'USDT', label: 'Plan Personal EQUO' },
  entrepreneur: { amount: '19.99', currency: 'USDT', label: 'Plan Emprendedor EQUO' },
};

// ── Utilidades de firma ───────────────────────────────────────────────────────

/** Genera la firma HMAC-SHA512 requerida por Binance Pay. */
function buildBinanceSignature(timestamp, nonce, payload) {
  const message = `${timestamp}\n${nonce}\n${payload}\n`;
  return crypto
    .createHmac('sha512', BINANCE_SECRET)
    .update(message)
    .digest('hex')
    .toUpperCase();
}

/** Genera un nonce aleatorio de 32 caracteres. */
function generateNonce() {
  return crypto.randomBytes(16).toString('hex');
}

/** Realiza una petición HTTPS POST a la API de Binance Pay. */
function binanceRequest(path, body) {
  return new Promise((resolve, reject) => {
    const payload   = JSON.stringify(body);
    const timestamp = Date.now().toString();
    const nonce     = generateNonce();
    const signature = buildBinanceSignature(timestamp, nonce, payload);

    const options = {
      hostname: BINANCE_HOST,
      path,
      method:  'POST',
      headers: {
        'Content-Type':              'application/json',
        'BinancePay-Timestamp':      timestamp,
        'BinancePay-Nonce':          nonce,
        'BinancePay-Signature':      signature,
        'BinancePay-Certificate-SN': BINANCE_API_KEY,
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Binance response parse error: ' + data)); }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── Helpers de respuesta ──────────────────────────────────────────────────────

function sendJSON(res, status, data) {
  res.status(status).json(data);
}

function sendError(res, status, message) {
  res.status(status).json({ error: message });
}

// ── CORS helper ───────────────────────────────────────────────────────────────

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// ── Handler principal ─────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  setCors(res);

  // Preflight OPTIONS
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return sendError(res, 405, 'Método no permitido. Usa POST.');
  }

  const action = req.query.action || req.body?.action;

  // ── Verificar autenticación Firebase (ID Token) ───────────────────────────
  // El cliente envía el ID Token de Firebase en el header Authorization.
  // Lo verificamos con firebase-admin para obtener el uid del usuario.
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return sendError(res, 401, 'No autenticado. Envía el Firebase ID Token en Authorization: Bearer <token>.');
  }

  const idToken = authHeader.split('Bearer ')[1];
  let uid;

  try {
    const admin = require('firebase-admin');
    // getDb() ya inicializó admin
    getDb();
    const decoded = await admin.auth().verifyIdToken(idToken);
    uid = decoded.uid;
  } catch (authErr) {
    console.error('[EQUO] Token inválido:', authErr.message);
    return sendError(res, 401, 'Token de autenticación inválido o expirado.');
  }

  // ── Enrutamiento por acción ───────────────────────────────────────────────
  if (action === 'createOrder') {
    return handleCreateOrder(req, res, uid);
  } else if (action === 'queryPayment') {
    return handleQueryPayment(req, res, uid);
  } else {
    return sendError(res, 400, `Acción desconocida: "${action}". Usa "createOrder" o "queryPayment".`);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Acción 1: createOrder
// Crea una orden de pago en Binance Pay y devuelve el QR + checkoutUrl.
// ─────────────────────────────────────────────────────────────────────────────
async function handleCreateOrder(req, res, uid) {
  const { plan } = req.body;

  if (!PLANS[plan]) {
    return sendError(res, 400, `Plan desconocido: ${plan}. Usa "personal" o "entrepreneur".`);
  }

  const planInfo        = PLANS[plan];
  const merchantOrderId = `EQUO-${uid.slice(0, 8)}-${Date.now()}`;

  const body = {
    env:             { terminalType: 'WEB' },
    merchantTradeNo: merchantOrderId,
    orderAmount:     planInfo.amount,
    currency:        planInfo.currency,
    description:     planInfo.label,
    goods: {
      goodsType:        '02',   // virtual goods
      goodsCategory:    'Z000',
      referenceGoodsId: plan,
      goodsName:        planInfo.label,
    },
    returnUrl: `https://${process.env.VERCEL_URL || 'equo.app'}/app?action=login`,
    cancelUrl: `https://${process.env.VERCEL_URL || 'equo.app'}/app`,
  };

  try {
    const response = await binanceRequest('/binancepay/openapi/v2/order', body);

    if (response.status !== 'SUCCESS') {
      console.error('[EQUO] Binance error createOrder:', response);
      return sendError(res, 502, `Binance Pay error: ${response.errorMessage || response.status}`);
    }

    // Guardar orden pendiente en Firestore para reconciliación
    const db = getDb();
    await db.collection('payments').doc(merchantOrderId).set({
      uid,
      plan,
      amount:          planInfo.amount,
      currency:        planInfo.currency,
      prepayId:        response.data.prepayId,
      merchantOrderId,
      status:          'PENDING',
      createdAt:       new Date().toISOString(),
    });

    // Devolver solo lo necesario al cliente (NUNCA las claves API)
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
// Verifica el estado de una orden y activa el plan en Firestore si fue pagado.
// ─────────────────────────────────────────────────────────────────────────────
async function handleQueryPayment(req, res, uid) {
  const { prepayId, merchantOrderId, plan } = req.body;

  if (!prepayId || !merchantOrderId) {
    return sendError(res, 400, 'prepayId y merchantOrderId son requeridos.');
  }

  try {
    const response = await binanceRequest('/binancepay/openapi/v2/order/query', {
      prepayId,
      merchantTradeNo: merchantOrderId,
    });

    if (response.status !== 'SUCCESS') {
      return sendError(res, 502, `Binance query error: ${response.errorMessage}`);
    }

    const orderStatus = response.data?.status; // 'INITIAL' | 'PENDING' | 'PAID' | 'CANCELED' | 'ERROR'

    if (orderStatus === 'PAID') {
      // ✅ Pago confirmado — activar plan en Firestore
      const planKey = plan || 'entrepreneur';
      const now     = new Date().toISOString();
      const subEnd  = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 días

      const db = getDb();

      await db.collection('users').doc(uid).set({
        isPaid:              true,
        plan:                planKey,
        planStatus:          planKey,
        selectedPlan:        planKey,
        trialEndDate:        null,    // eliminar restricción de prueba
        subscriptionDate:    now,
        subscriptionEndDate: subEnd,  // vencimiento en 30 días
        paidAt:              now,
        lastPaymentId:       merchantOrderId,
      }, { merge: true });

      // Actualizar registro de pago
      await db.collection('payments').doc(merchantOrderId).set(
        { status: 'PAID', paidAt: now },
        { merge: true }
      );

      return sendJSON(res, 200, { orderStatus: 'PAID', planActivated: true });
    }

    // No pagado aún — devolver estado actual sin modificar Firestore
    return sendJSON(res, 200, {
      orderStatus:   orderStatus || 'PENDING',
      planActivated: false,
    });

  } catch (err) {
    console.error('[EQUO] handleQueryPayment error:', err);
    return sendError(res, 500, err.message);
  }
}
