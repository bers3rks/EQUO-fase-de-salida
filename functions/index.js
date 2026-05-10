/**
 * EQUO — Firebase Cloud Functions v2
 * Pasarela de pagos Binance Pay (server-side seguro)
 *
 * Variables de entorno requeridas (firebase functions:config:set):
 *   binance.api_key    = tu API Key
 *   binance.secret_key = tu Secret Key
 *
 * Deploy: firebase deploy --only functions
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { setGlobalOptions }   = require('firebase-functions/v2');
const { initializeApp }      = require('firebase-admin/app');
const { getFirestore }       = require('firebase-admin/firestore');
const crypto                 = require('crypto');
const https                  = require('https');

// ── Configuración global ──────────────────────────────────────────────────
setGlobalOptions({ region: 'us-central1' });
initializeApp();
const db = getFirestore();

// ── Configuración de Binance Pay ──────────────────────────────────────────
const BINANCE_HOST    = 'bpay.binanceapi.com';
const BINANCE_API_KEY = process.env.BINANCE_API_KEY;   // inyectado por Secret Manager
const BINANCE_SECRET  = process.env.BINANCE_SECRET_KEY;

// Planes disponibles
const PLANS = {
  personal:     { amount: '9.99',  currency: 'USDT', label: 'Plan Personal EQUO' },
  entrepreneur: { amount: '19.99', currency: 'USDT', label: 'Plan Emprendedor EQUO' },
};

// ── Utilidades de firma ───────────────────────────────────────────────────

/**
 * Genera la firma HMAC-SHA512 requerida por Binance Pay.
 * Formato del mensaje: timestamp\nnonce\npayload\n
 */
function buildBinanceSignature(timestamp, nonce, payload) {
  const message = `${timestamp}\n${nonce}\n${payload}\n`;
  return crypto
    .createHmac('sha512', BINANCE_SECRET)
    .update(message)
    .digest('hex')
    .toUpperCase();
}

/**
 * Genera un nonce aleatorio de 32 caracteres.
 */
function generateNonce() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Realiza una petición HTTPS a la API de Binance Pay.
 */
function binanceRequest(path, body) {
  return new Promise((resolve, reject) => {
    const payload   = JSON.stringify(body);
    const timestamp = Date.now().toString();
    const nonce     = generateNonce();
    const signature = buildBinanceSignature(timestamp, nonce, payload);

    const options = {
      hostname: BINANCE_HOST,
      path,
      method: 'POST',
      headers: {
        'Content-Type':           'application/json',
        'BinancePay-Timestamp':   timestamp,
        'BinancePay-Nonce':       nonce,
        'BinancePay-Signature':   signature,
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

// ─────────────────────────────────────────────────────────────────────────
// Cloud Function 1: createBinanceOrder
// Crea una orden de pago en Binance Pay y devuelve el QR + checkoutUrl.
// ─────────────────────────────────────────────────────────────────────────
exports.createBinanceOrder = onCall({ enforceAppCheck: false }, async (request) => {
  // Validar autenticación
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión para pagar.');
  }

  const { plan } = request.data; // 'personal' | 'entrepreneur'
  if (!PLANS[plan]) {
    throw new HttpsError('invalid-argument', `Plan desconocido: ${plan}`);
  }

  const uid      = request.auth.uid;
  const planInfo = PLANS[plan];

  // Referencia de orden única para rastreo
  const merchantOrderId = `EQUO-${uid.slice(0, 8)}-${Date.now()}`;

  const body = {
    env: { terminalType: 'WEB' },
    merchantTradeNo: merchantOrderId,
    orderAmount:     planInfo.amount,
    currency:        planInfo.currency,
    description:     planInfo.label,
    goods: {
      goodsType:     '02',  // virtual goods
      goodsCategory: 'Z000',
      referenceGoodsId: plan,
      goodsName:     planInfo.label,
    },
    // Webhook para confirmación automática (opcional pero recomendado)
    returnUrl: 'https://tu-dominio.web.app/app.html?action=login',
    cancelUrl: 'https://tu-dominio.web.app/app.html',
  };

  try {
    const response = await binanceRequest('/binancepay/openapi/v2/order', body);

    if (response.status !== 'SUCCESS') {
      console.error('[EQUO] Binance error:', response);
      throw new HttpsError('internal', `Binance Pay error: ${response.errorMessage || response.status}`);
    }

    // Guardar la orden pendiente en Firestore para reconciliación
    await db.collection('payments').doc(merchantOrderId).set({
      uid,
      plan,
      amount:      planInfo.amount,
      currency:    planInfo.currency,
      prepayId:    response.data.prepayId,
      merchantOrderId,
      status:      'PENDING',
      createdAt:   new Date().toISOString(),
    });

    // Devolver solo los datos necesarios al cliente (nunca las claves)
    return {
      prepayId:    response.data.prepayId,
      qrcodeLink:  response.data.qrcodeLink,
      checkoutUrl: response.data.checkoutUrl,
      deeplink:    response.data.universalUrl || response.data.checkoutUrl,
      merchantOrderId,
      amount:      planInfo.amount,
      currency:    planInfo.currency,
      label:       planInfo.label,
    };

  } catch (err) {
    console.error('[EQUO] createBinanceOrder error:', err);
    throw new HttpsError('internal', err.message);
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Cloud Function 2: queryBinancePayment
// Verifica el estado de una orden existente y activa el plan si fue pagado.
// ─────────────────────────────────────────────────────────────────────────
exports.queryBinancePayment = onCall({ enforceAppCheck: false }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'No autenticado.');
  }

  const { prepayId, merchantOrderId, plan } = request.data;
  if (!prepayId || !merchantOrderId) {
    throw new HttpsError('invalid-argument', 'prepayId y merchantOrderId son requeridos.');
  }

  const uid = request.auth.uid;

  try {
    const response = await binanceRequest('/binancepay/openapi/v2/order/query', {
      prepayId,
      merchantTradeNo: merchantOrderId,
    });

    if (response.status !== 'SUCCESS') {
      throw new HttpsError('internal', `Binance query error: ${response.errorMessage}`);
    }

    const orderStatus = response.data?.status; // 'INITIAL', 'PENDING', 'PAID', 'CANCELED', 'ERROR'

    if (orderStatus === 'PAID') {
      // ✅ Pago confirmado — activar plan en Firestore
      const planKey   = plan || 'entrepreneur';
      const now       = new Date().toISOString();
      const subEnd    = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 días exactos

      await db.collection('users').doc(uid).set({
        isPaid:              true,
        plan:                planKey,
        planStatus:          planKey,
        selectedPlan:        planKey,
        trialEndDate:        null,    // eliminar restricción de prueba
        subscriptionDate:    now,     // fecha de pago
        subscriptionEndDate: subEnd,  // vencimiento en 30 días
        paidAt:              now,
        lastPaymentId:       merchantOrderId,
      }, { merge: true });

      // Actualizar registro de pago
      await db.collection('payments').doc(merchantOrderId).set({
        status: 'PAID', paidAt: now,
      }, { merge: true });

      return { orderStatus: 'PAID', planActivated: true };
    }

    // No pagado aún: devolver estado actual
    return { orderStatus: orderStatus || 'PENDING', planActivated: false };

  } catch (err) {
    console.error('[EQUO] queryBinancePayment error:', err);
    throw new HttpsError('internal', err.message);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// Cloud Function 3: adminDeleteUser
// Elimina un usuario de Firebase Auth desde el servidor (Admin SDK).
// Solo puede ser llamada por usuarios con role:'admin' en Firestore.
// ───────────────────────────────────────────────────────────────────────────
const { getAuth } = require('firebase-admin/auth');

exports.adminDeleteUser = onCall({ enforceAppCheck: false }, async (request) => {
  // 1. Verificar que quien llama está autenticado
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'No autenticado.');
  }

  // 2. Verificar que quien llama es admin en Firestore (server-side, no confiar en el cliente)
  const callerSnap = await db.collection('users').doc(request.auth.uid).get();
  const callerRole = (callerSnap.exists && callerSnap.data().role) || 'user';
  if (callerRole !== 'admin') {
    throw new HttpsError('permission-denied', 'Solo administradores pueden eliminar usuarios.');
  }

  const { uid } = request.data;
  if (!uid) {
    throw new HttpsError('invalid-argument', 'uid es requerido.');
  }

  // 3. Eliminar de Firebase Auth (Admin SDK)
  try {
    await getAuth().deleteUser(uid);
    console.log(`[EQUO Admin] Usuario ${uid} eliminado de Auth por ${request.auth.uid}`);
    return { success: true, message: `Usuario ${uid} eliminado.` };
  } catch (err) {
    console.error('[EQUO Admin] Error al eliminar usuario:', err);
    throw new HttpsError('internal', err.message);
  }
});
