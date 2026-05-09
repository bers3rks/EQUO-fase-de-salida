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
 *    window.db   → instancia de Firestore
 *    window.auth → instancia de Firebase Auth
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

    console.log('[EQUO] Firebase inicializado correctamente ✓');
})();
