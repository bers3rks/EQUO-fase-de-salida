/**
 * ============================================================
 *  EQUO | firebase-init.js
 *  Inicialización centralizada de Firebase para el proyecto.
 *  Requiere que los scripts de Firebase compat estén cargados
 *  en el HTML antes de este archivo:
 *
 *    <script src="https://www.gstatic.com/firebasejs/10.8.1/firebase-app-compat.js"></script>
 *    <script src="https://www.gstatic.com/firebasejs/10.8.1/firebase-auth-compat.js"></script>
 *    <script src="https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore-compat.js"></script>
 *
 *  Expone globalmente:
 *    window.db        → instancia de Firestore
 *    window.auth      → instancia de Firebase Auth
 *    window.userRole  → rol del usuario ('admin' | 'user' | null)
 *
 *  Hook:
 *    window._onRoleReady(role) — se llama una vez que el rol
 *    está disponible. Sobrescríbelo desde index.html o fase2-logic.js
 *    para reaccionar a cambios de rol sin race conditions.
 * ============================================================
 */

(function () {
    'use strict';

    // ── Configuración del proyecto Firebase ─────────────────────────────────────
    const firebaseConfig = {
        apiKey: "AIzaSyBjDnhux11n1FLrfdjQ7qwaBDsiTkYb-CU",
        authDomain: "equo-7ed4d.firebaseapp.com",
        projectId: "equo-7ed4d",
        storageBucket: "equo-7ed4d.firebasestorage.app",
        messagingSenderId: "1019870804475",
        appId: "1:1019870804475:web:963831fdad13a04569f35e"
    };

    // ── Inicializar Firebase (guard: evitar doble inicialización) ────────────────
    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
    }

    // ── Exponer instancias como globales ─────────────────────────────────────────
    window.db   = firebase.firestore();
    window.auth = firebase.auth();

    // ── Role inicial en null hasta que Auth confirme sesión ─────────────────────
    window.userRole = null;

    // ── Leer el rol del usuario desde Firestore al iniciar sesión ───────────────
    window.auth.onAuthStateChanged(async function (user) {
        if (user) {
            try {
                const snap = await window.db.collection('users').doc(user.uid).get();
                window.userRole = (snap.exists && snap.data().role) ? snap.data().role : 'user';
            } catch (e) {
                console.warn('[EQUO] No se pudo leer el rol del usuario:', e.message);
                window.userRole = 'user';
            }
        } else {
            window.userRole = null;
        }

        // Disparar hook para que el resto de la app reaccione al rol
        if (typeof window._onRoleReady === 'function') {
            try { window._onRoleReady(window.userRole); } catch(e) {}
        }

        console.log(`[EQUO] Rol de usuario establecido: ${window.userRole}`);
    });

    console.log('[EQUO] Firebase inicializado correctamente ✓');
})();
