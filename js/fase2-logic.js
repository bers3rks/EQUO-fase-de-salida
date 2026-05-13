/**
 * ============================================================
 *  EQUO | fase2-logic.js  — Lógica completa del Panel Emprendedor
 *  Requiere: firebase-init.js cargado antes (expone window.db, window.auth)
 *  Requiere: window.appData, window.currM, window.save, window.showToast,
 *            window.t, window.currentUser, window.ensurePhase2Data
 *            definidos en el archivo principal (Bussines_V7.html)
 * ============================================================
 */

document.addEventListener('DOMContentLoaded', function () {

    /* ── Utilidad Global ── */
    window.$ = id => document.getElementById(id);

    /* ── Bridge (Autonomía) ── */
    if (window !== window.parent) {
        try {
            window.appData = window.parent.appData;
            window.save = window.parent.save;
            window.currM = window.parent.currM;
            window.currentUser = window.parent.currentUser;
            window.showToast = window.parent.showToast;
        } catch (e) {
            console.warn('Bridge cross-origin blocado (normal en file://). Fase 2 operará de forma autónoma.');
        }
    }

    /* ── Autonomía y Conexión Firebase ── */
    window.currentLang = window.currentLang || 'es';
    window.translations = window.translations || {
        es: {
            months: ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"],
            monthsShort: ["Do", "Lu", "Ma", "Mi", "Ju", "Vi", "Sa"],
            saveBtn: 'Registrar',
            editBtn: 'Actualizar'
        }
    };
    window.t = window.t || function (k) { return window.translations[window.currentLang] ? (window.translations[window.currentLang][k] || k) : k; };
    window.currM = typeof window.currM !== 'undefined' ? window.currM : new Date().getMonth();
    window.currentUser = window.currentUser || null;

    const buildDefault = () => ({
        year: new Date().getFullYear(),
        inventory: [], bizSales: [], bizReceivables: [], combos: [], prestamos: [], suppliers: [], months: Array.from({ length: 12 }, (_, i) => ({ id: i }))
    });

    // Se asigna appData, si el padre lo pasó se usa ese (hasta que Firebase cargue el propio).
    window.appData = window.appData || buildDefault();
    var appData = window.appData; // Alias local para uso dentro de las funciones

    window.showToast = window.showToast || function (type, title, msg) { console.log(`[Toast ${type}] ${title}: ${msg}`); };

    // ==========================================
    // LÓGICA DE CONEXIÓN Y PERSISTENCIA A FIREBASE
    // ==========================================

    let _saveTimer = null;
    window.save = function () {
        if (!window.currentUser || !window.appData) return;
        clearTimeout(_saveTimer);
        _saveTimer = setTimeout(() => {
            if (window.db) {
                window.db.collection("users").doc(window.currentUser.uid)
                    .set(window.appData, { merge: true })
                    .catch(e => console.error("Error al guardar Fase 2 en Firebase:", e));
            }
            if (typeof window.renderAdvancedAnalysis === 'function') {
                const tab = document.getElementById('biz-analisis-avanzado-section');
                if (tab && !tab.classList.contains('hidden')) {
                    window.renderAdvancedAnalysis();
                }
            }
        }, 800);
    };

    async function loadUserData(uid) {
        try {
            if (!window.db) return;
            const doc = await window.db.collection("users").doc(uid).get();
            if (doc.exists) {
                window.appData = doc.data();
                appData = window.appData; // Sincroniza el alias local
                window.ensurePhase2Data();

                // Cargar subcolección de préstamos y sus abonos
                try {
                    const prestamosSnap = await window.db.collection("users").doc(uid).collection("prestamos").get();
                    const prestamosList = [];
                    prestamosSnap.forEach(pDoc => {
                        let pData = pDoc.data();
                        pData.id = parseInt(pDoc.id, 10) || pDoc.id;
                        prestamosList.push(pData);
                    });

                    for (let pData of prestamosList) {
                        const abonosSnap = await window.db.collection("users").doc(uid).collection("prestamos").doc(String(pData.id)).collection("abonos").get();
                        const abonosList = [];
                        abonosSnap.forEach(aDoc => {
                            let aData = aDoc.data();
                            aData.id = parseInt(aDoc.id, 10) || aDoc.id;
                            abonosList.push(aData);
                        });
                        pData.abonos = abonosList;
                    }

                    if (prestamosList.length > 0) {
                        window.appData.prestamos = prestamosList;
                    }
                } catch (err) {
                    console.error("Error cargando subcolección préstamos:", err);
                }

                console.log("[EQUO Fase 2] Datos cargados exitosamente de Firebase.");
            } else {
                window.appData = buildDefault();
                appData = window.appData;
                await window.db.collection("users").doc(uid).set(window.appData, { merge: true });
            }
        } catch (e) {
            console.error("Error al descargar datos de Firebase:", e);
            window.appData = buildDefault();
            appData = window.appData;
        } finally {
            // Garantizamos inyección al DOM (tanto en éxito como en fallo)
            if (typeof renderInventory === 'function') renderInventory();
            if (typeof renderSales === 'function') renderSales();
            if (typeof renderCxC === 'function') renderCxC();
            if (typeof renderCaja === 'function') renderCaja();
            if (typeof renderSuppliers === 'function') renderSuppliers();
            if (typeof renderCombos === 'function') renderCombos();
            if (typeof window.renderPrestamos === 'function') window.renderPrestamos();
            if (typeof window.renderDateSelectors === 'function') window.renderDateSelectors();
            if (typeof window.verificarAlertasGlobales === 'function') window.verificarAlertasGlobales();
        }
    }

    if (window.auth) {
        window.auth.onAuthStateChanged(async (u) => {
            window.currentUser = u;
            if (u) {
                await loadUserData(u.uid);
            }
        });
    }

    /**
     * window.initFase2()
     * Hook público llamado por switchPanel() en MyEQUO_V15.html después de
     * inyectar dinámicamente el DOM de fase2.html en #panel-negocios.
     * Re-ejecuta todos los renders para poblar el DOM recién disponible.
     */
    /**
     * window.applyThemeToFase2()
     * Sincroniza el modo claro/oscuro del body con el panel de negocios.
     * Se llama: (a) al inicializar initFase2, (b) desde el MutationObserver
     * cuando toggleTheme() cambia la clase del body, y (c) opcionalmente desde
     * toggleTheme() en index.html como hook explícito.
     */
    window.applyThemeToFase2 = function () {
        const isLight = document.body.classList.contains('light-mode');
        const bizDash = document.getElementById('business-dashboard');
        if (!bizDash) return;

        // 1. Sincronizar la clase en el contenedor raíz del panel
        if (isLight) {
            bizDash.classList.add('light-mode');
        } else {
            bizDash.classList.remove('light-mode');
        }

        // 2. Propagar a modales del panel que se insertan en document.body
        //    (no son hijos de #business-dashboard, pero deben heredar el tema)
        const panelModals = [
            'product-modal', 'supplier-modal', 'combo-modal', 'sale-modal',
            'sale-edit-modal', 'encargo-modal', 'cxc-modal', 'cxc-payment-modal',
            'prestamo-modal', 'centered-alert-modal', 'premium-confirm-modal'
        ];
        panelModals.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            if (isLight) el.classList.add('light-mode');
            else         el.classList.remove('light-mode');
        });

        // 3. Re-renderizar componentes dinámicos para que el HTML generado
        //    recoja las nuevas clases CSS (inventario, CxC, Caja generan HTML con colores hardcoded).
        //    Usamos requestAnimationFrame para no bloquear el ciclo de pintura.
        requestAnimationFrame(() => {
            if (typeof renderInventory === 'function') renderInventory();
            if (typeof renderCxC       === 'function') renderCxC();
            if (typeof renderCaja      === 'function') renderCaja();
            if (typeof renderSales     === 'function') renderSales();
        });

        console.log(`[EQUO] applyThemeToFase2() — modo ${isLight ? 'claro' : 'oscuro'} aplicado ✓`);
    };

    window.initFase2 = function () {
        window._syncFxRates && window._syncFxRates(); // sincronizar tasas FX
        if (typeof window.renderDateSelectors === 'function') window.renderDateSelectors();
        if (typeof renderInventory     === 'function') renderInventory();
        if (typeof renderSales         === 'function') renderSales();
        if (typeof renderCxC           === 'function') renderCxC();
        if (typeof renderCaja          === 'function') renderCaja();
        if (typeof renderSuppliers     === 'function') renderSuppliers();
        if (typeof renderCombos        === 'function') renderCombos();
        if (typeof window.renderPrestamos === 'function') window.renderPrestamos();
        if (typeof window.calculateAdvancedAnalytics === 'function') window.calculateAdvancedAnalytics();
        if (typeof window.verificarAlertasGlobales   === 'function') window.verificarAlertasGlobales();

        // ── Sincronizar tema inmediatamente al inicializar ──────────────────
        window.applyThemeToFase2();

        // ── MutationObserver: reacciona a toggleTheme() en el body raíz ────
        if (!window._themeObserverFase2) {
            window._themeObserverFase2 = new MutationObserver((mutations) => {
                for (const m of mutations) {
                    if (m.type === 'attributes' && m.attributeName === 'class') {
                        window.applyThemeToFase2();
                        break;
                    }
                }
            });
            window._themeObserverFase2.observe(document.body, { attributes: true, attributeFilter: ['class'] });
        }

        // ── Bottom Nav móvil: inicializar si aún no está definido ───────────
        // (Los scripts de fase2.html son eliminados al inyectar via fetch en app.html,
        //  así que estas funciones deben vivir aquí para garantizar su disponibilidad)
        if (typeof window.bnavGo !== 'function') {
            (function () {
                var _moreTabs  = { encargos: 1, cxc: 1, suppliers: 1, 'analisis-avanzado': 1 };
                var _directIds = ['inventory', 'sales', 'caja', 'prestamos'];
                var _moreOpen  = false;

                window.bnavGo = function (tab) {
                    bnavCloseMore();
                    if (typeof window.switchBizTab === 'function') window.switchBizTab(tab);
                    bnavSetActive(tab);
                };

                window.bnavToggleMore = function () {
                    _moreOpen ? bnavCloseMore() : bnavOpenMore();
                };

                window.syncBnavActive = function (tab) {
                    bnavSetActive(tab);
                };

                function bnavOpenMore() {
                    _moreOpen = true;
                    var menu = document.getElementById('bnav-more-menu');
                    var icon = document.getElementById('bnav-more-icon');
                    if (menu) menu.style.display = 'block';
                    if (icon) { icon.classList.remove('fa-ellipsis'); icon.classList.add('fa-xmark'); }
                    setTimeout(function () {
                        document.addEventListener('click',    _outsideClose, { once: true, capture: true });
                        document.addEventListener('touchend', _outsideClose, { once: true, capture: true });
                    }, 80);
                }

                function bnavCloseMore() {
                    _moreOpen = false;
                    var menu = document.getElementById('bnav-more-menu');
                    var icon = document.getElementById('bnav-more-icon');
                    if (menu) menu.style.display = 'none';
                    if (icon) { icon.classList.remove('fa-xmark'); icon.classList.add('fa-ellipsis'); }
                }

                function _outsideClose(e) {
                    var nav = document.getElementById('bottom-nav');
                    if (nav && !nav.contains(e.target)) bnavCloseMore();
                }

                function bnavSetActive(tab) {
                    var activeColor    = '#38bdf8';
                    var idleIconColor  = '#94a3b8';
                    var idleLabelColor = '#64748b';
                    _directIds.forEach(function (t) {
                        var btn = document.getElementById('bnav-btn-' + t);
                        if (!btn) return;
                        var icon  = btn.querySelector('.bnav-icon');
                        var label = btn.querySelector('.bnav-label');
                        var isActive = (t === tab);
                        btn.classList.toggle('bnav-active', isActive);
                        if (icon)  icon.style.color  = isActive ? activeColor : idleIconColor;
                        if (label) label.style.color = isActive ? activeColor : idleLabelColor;
                    });
                    var moreBtn      = document.getElementById('bnav-btn-more');
                    var moreIsActive = !!_moreTabs[tab];
                    if (moreBtn) {
                        moreBtn.classList.toggle('bnav-active', moreIsActive);
                        var mIcon  = moreBtn.querySelector('#bnav-more-icon') || moreBtn.querySelector('.bnav-icon');
                        var mLabel = moreBtn.querySelector('.bnav-label');
                        if (mIcon)  mIcon.style.color  = moreIsActive ? activeColor : idleIconColor;
                        if (mLabel) mLabel.style.color = moreIsActive ? activeColor : idleLabelColor;
                    }
                }

                // Establecer estado inicial del nav
                bnavSetActive('inventory');
            })();
        }

        console.log('[EQUO] initFase2() — Panel de Negocios inicializado ✓');
    };

    /**
     * window.forceRefreshFase2()
     * Soft-reset del Panel de Negocios: re-sincroniza el alias local de appData
     * con el nuevo window.appData (post confirmReset) y re-renderiza todo.
     * Llamado por confirmReset() en MyEQUO_V15.html sin recargar la página.
     */
    window.forceRefreshFase2 = function () {
        // Re-sincronizar alias local con el nuevo objeto appData del Panel Personal
        appData = window.appData;
        // Garantizar que los arrays de Fase 2 existan en el nuevo objeto
        if (typeof window.ensurePhase2Data === 'function') window.ensurePhase2Data();
        // Re-renderizar todos los módulos
        if (typeof renderInventory     === 'function') renderInventory();
        if (typeof renderSales         === 'function') renderSales();
        if (typeof renderCxC           === 'function') renderCxC();
        if (typeof renderCaja          === 'function') renderCaja();
        if (typeof renderSuppliers     === 'function') renderSuppliers();
        if (typeof renderCombos        === 'function') renderCombos();
        if (typeof window.renderPrestamos            === 'function') window.renderPrestamos();
        if (typeof window.calculateAdvancedAnalytics === 'function') window.calculateAdvancedAnalytics();
        if (typeof window.verificarAlertasGlobales   === 'function') window.verificarAlertasGlobales();
        if (typeof window.renderDateSelectors        === 'function') window.renderDateSelectors();
        console.log('[EQUO] forceRefreshFase2() — Panel de Negocios reiniciado en caliente ✓');
    };

    /* ── helpers locales ── */
    const $ = id => document.getElementById(id);

    /* ──────────────────────────────────────────────
       BLOQUE 1: utilidades generales Fase 2
    ────────────────────────────────────────────── */

    window.ensurePhase2Data = function () {
        if (typeof appData !== 'undefined') {
            appData.inventory = appData.inventory || [];
            appData.bizSales = appData.bizSales || [];
            appData.bizReceivables = appData.bizReceivables || [];
            appData.suppliers = appData.suppliers || [];
            appData.combos = appData.combos || [];
            appData.prestamos = appData.prestamos || [];
            appData.encargos = appData.encargos || [];
        }
    };

    window.getRate = function (id) {
        const el = document.getElementById(id);
        if (el) { const v = parseFloat(el.innerText); return isNaN(v) ? 1 : v; }
        return 1;
    };

    window.switchDashboard = function (view) {
        const pDash = $('personal-dashboard');
        const bDash = $('business-dashboard');
        ensurePhase2Data();
        if (view === 'personal') {
            if (pDash) pDash.classList.remove('hidden');
            if (bDash) bDash.classList.add('hidden');
        } else {
            if (pDash) pDash.classList.add('hidden');
            if (bDash) bDash.classList.remove('hidden');
            if (typeof renderInventory === 'function') renderInventory();
            if (typeof renderSuppliers === 'function') renderSuppliers();
            if (typeof renderCombos === 'function') renderCombos();
            if (typeof renderSales === 'function') renderSales();
            if (typeof renderCxC === 'function') renderCxC();
        }
    };

    /* ── Alertas y confirmaciones premium ── */
    window.showBlockingAlert = function (title, msg) {
        const t = $('alert-title'), m = $('alert-msg'), modal = $('centered-alert-modal');
        if (t) t.innerText = title;
        if (m) m.innerText = msg;
        if (modal) modal.classList.remove('hidden');
    };
    window.closeBlockingAlert = function () {
        const modal = $('centered-alert-modal');
        if (modal) modal.classList.add('hidden');
    };

    let _customConfirmCb = null;
    window.openCustomConfirm = function (title, msg, cb) {
        const t = $('premium-confirm-title'), m = $('premium-confirm-msg'), modal = $('premium-confirm-modal');
        if (t) t.innerHTML = `<i class="fa-solid fa-circle-question"></i> <span>${title}</span>`;
        if (m) m.innerText = msg;
        _customConfirmCb = cb;
        if (modal) modal.classList.remove('hidden');
    };
    window.closeCustomConfirm = function () {
        const modal = $('premium-confirm-modal');
        if (modal) modal.classList.add('hidden');
        _customConfirmCb = null;
    };
    window.executeCustomConfirm = function () {
        if (_customConfirmCb) { try { _customConfirmCb(); } catch (e) { console.error(e); } }
        closeCustomConfirm();
    };

    /* ──────────────────────────────────────────────
       BLOQUE 2: Tabs de negocio + Año
    ────────────────────────────────────────────── */

    window.switchBizTab = function (tab) {
        const tabs = ['inventory', 'sales', 'encargos', 'cxc', 'caja', 'prestamos', 'suppliers', 'analisis-avanzado'];
        const aliases = { 'caja': 'cash', 'analisis-avanzado': 'advanalysis' };
        tabs.forEach(t => {
            const sec = $(`biz-${t}-section`); if (sec) sec.classList.add('hidden');
            const btn = $(`tab-btn-${t}`);
            if (btn) { btn.classList.remove('text-white', 'border-sky-400'); btn.classList.add('text-gray-400', 'border-transparent'); }
            if (aliases[t]) {
                const aS = $(`biz-${aliases[t]}-section`); if (aS) aS.classList.add('hidden');
                const aB = $(`tab-btn-${aliases[t]}`);
                if (aB) { aB.classList.remove('text-white', 'border-sky-400'); aB.classList.add('text-gray-400', 'border-transparent'); }
            }
        });
        let sec = $(`biz-${tab}-section`);
        if (!sec && aliases[tab]) sec = $(`biz-${aliases[tab]}-section`);
        if (sec) sec.classList.remove('hidden');
        let btn = $(`tab-btn-${tab}`);
        if (!btn && aliases[tab]) btn = $(`tab-btn-${aliases[tab]}`);
        if (btn) { btn.classList.remove('text-gray-400', 'border-transparent'); btn.classList.add('text-white', 'border-sky-400'); }
        if (window.gsap) {
            const at = $(`biz-${tab}-section`) ? `#biz-${tab}-section` : (aliases[tab] ? `#biz-${aliases[tab]}-section` : `#biz-${tab}-section`);
            gsap.fromTo(at, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' });
        }
        if (tab === 'caja' && typeof renderCaja === 'function') renderCaja();
        if (tab === 'prestamos' && typeof renderPrestamos === 'function') renderPrestamos();
        if (tab === 'encargos' && typeof renderEncargos === 'function') renderEncargos();
        if (tab === 'analisis-avanzado' && typeof renderAdvancedAnalysis === 'function') renderAdvancedAnalysis();

        // Inyección de datos garantizada tras cambio de vista
        if (typeof window.renderDateSelectors === 'function') window.renderDateSelectors();

        // Sincronizar estado activo del bottom nav móvil
        if (typeof window.syncBnavActive === 'function') window.syncBnavActive(tab);
    };

    let _yearDDOpen = false;
    let _monthDDOpen = false;

    window.closeAllDropdowns = function () {
        _yearDDOpen = false;
        _monthDDOpen = false;
        document.querySelectorAll('.custom-dropdown-menu').forEach(d => {
            d.classList.add('hidden');
            d.classList.remove('flex', 'liquid-bounce');
        });
        // Resetear iconos biz-
        const yIcon = $('biz-year-drop-icon');  if (yIcon) yIcon.style.transform = 'rotate(0deg)';
        const mIcon = $('biz-month-drop-icon'); if (mIcon) mIcon.style.transform = 'rotate(0deg)';
    };

    // Cerrar al hacer clic fuera y delegación unificada
    document.addEventListener('click', (e) => {
        // 1. Delegación para botón de Mes (Panel Negocios: id biz-month-dropdown-btn)
        const isMonthBtn = e.target.closest('#biz-month-dropdown-btn');
        if (isMonthBtn) {
            e.stopPropagation();
            if (_monthDDOpen) {
                window.closeAllDropdowns();
            } else {
                window.closeAllDropdowns();
                _monthDDOpen = true;
                const menu = $('biz-month-dropdown-menu');
                const icon = $('biz-month-drop-icon');
                if (menu) { menu.classList.remove('hidden'); menu.classList.add('flex', 'liquid-bounce'); }
                if (icon) icon.style.transform = 'rotate(180deg)';
            }
            return;
        }

        // 2. Delegación para botón de Año (Panel Negocios: id biz-year-dropdown-btn)
        const isYearBtn = e.target.closest('#biz-year-dropdown-btn');
        if (isYearBtn) {
            e.stopPropagation();
            if (_yearDDOpen) {
                window.closeAllDropdowns();
            } else {
                window.closeAllDropdowns();
                _yearDDOpen = true;
                const menu = $('biz-year-dropdown-menu');
                const icon = $('biz-year-drop-icon');
                if (menu) { menu.classList.remove('hidden'); menu.classList.add('flex', 'liquid-bounce'); }
                if (icon) icon.style.transform = 'rotate(180deg)';
            }
            return;
        }

        // 3. Delegación para Custom Selects ('Editar ventas', 'Registrar venta')
        const toggleBtn = e.target.closest('[onclick^="toggleCustomSelect"]');
        if (toggleBtn) {
            // Se maneja a través de la función global toggleCustomSelect, pero prevenimos cierre automático
            return;
        }

        // 4. Lógica de Click-Outside para cerrar todo
        const isDropdownMenu = e.target.closest('.custom-dropdown-menu');
        if (!isDropdownMenu) {
            window.closeAllDropdowns();
        }
    });

    // Sobrescribimos y unificamos la lógica de los menús atascados (reemplazando el de fase2.html)
    window.toggleCustomSelect = function (dropdownId) {
        const drop = document.getElementById(dropdownId);
        if (!drop) return;
        const isHidden = drop.classList.contains('hidden');

        window.closeAllDropdowns();

        if (isHidden) {
            drop.classList.remove('hidden');
            drop.classList.add('flex', 'flex-col', 'liquid-bounce');
            // Limpiar inline styles problemáticos de HTML heredado
            drop.style.display = '';
            drop.style.flexDirection = '';
        }
        if (window.event) window.event.stopPropagation();
    };

    window.selectCustomOption = function (inputId, value, textKey) {
        const input = document.getElementById(inputId);
        const textEl = document.getElementById(inputId + '-text');
        const drop = document.getElementById(inputId + '-dropdown');
        if (input) input.value = value;
        if (textEl) textEl.innerText = textKey || value;
        if (drop) {
            drop.classList.add('hidden');
            drop.classList.remove('flex', 'flex-col', 'liquid-bounce');
            drop.style.display = '';
        }
        
        // Auto-fill precio de venta al seleccionar un artículo
        if (inputId === 'sale-item') {
            const ty = document.getElementById('sale-type') ? document.getElementById('sale-type').value : 'product';
            let price = 0;
            if (ty === 'product' && window.appData && window.appData.inventory) {
                const p = window.appData.inventory.find(x => String(x.id) === String(value));
                if (p) price = p.price || 0;
            } else if (ty === 'combo' && window.appData && window.appData.combos) {
                const c = window.appData.combos.find(x => String(x.id) === String(value));
                if (c) price = c.price || 0;
            }
            if (document.getElementById('sale-price')) {
                document.getElementById('sale-price').value = price;
            }
            if (typeof window.updateSalePreview === 'function') window.updateSalePreview();
        }
    };

    const GLOBAL_MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    const GLOBAL_YEARS = [2024, 2025, 2026, 2027, 2028];

    window.renderDateSelectors = function () {
        // ── Selectores del Panel de Negocios (IDs con prefijo biz-) ──
        const monthMenu = $('biz-month-dropdown-menu');
        if (monthMenu) {
            monthMenu.innerHTML = '';
            GLOBAL_MONTHS.forEach((m, i) => {
                const btn = document.createElement('button');
                btn.className = `w-full text-left px-3 py-2 rounded-lg hover:bg-white/10 text-xs text-white/70 hover:text-white transition-colors cursor-pointer ${i === window.currM ? 'bg-sky-500/20 !text-sky-400 font-bold' : ''}`;
                btn.innerText = m;
                btn.addEventListener('click', () => { window.selectMonth(i); });
                monthMenu.appendChild(btn);
            });
        }
        const monthTxt = $('biz-current-month-text');
        if (monthTxt) monthTxt.innerText = GLOBAL_MONTHS[window.currM];

        const currentY = window.appData ? window.appData.year : new Date().getFullYear();
        const yearMenu = $('biz-year-dropdown-menu');
        if (yearMenu) {
            yearMenu.innerHTML = '';
            GLOBAL_YEARS.forEach(y => {
                const btn = document.createElement('button');
                btn.className = `w-full text-left px-3 py-2 rounded-lg hover:bg-white/10 text-xs text-white/70 hover:text-white transition-colors cursor-pointer ${y === currentY ? 'bg-sky-500/20 !text-sky-400 font-bold' : ''}`;
                btn.innerText = y;
                btn.addEventListener('click', () => { window.selectYear(y); });
                yearMenu.appendChild(btn);
            });
        }
        const yearTxt = $('biz-current-year-text');
        if (yearTxt) yearTxt.innerText = currentY;

        console.log('[EQUO] renderDateSelectors — selectores biz- poblados ✓');

        // Sincronización de Flatpickr con idioma persistente
        if (typeof flatpickr !== 'undefined') {
            const currentLangData = window.translations[window.currentLang] || window.translations['es'];
            const customLocale = {
                firstDayOfWeek: 1,
                weekdays: {
                    shorthand: currentLangData.monthsShort || ["Do", "Lu", "Ma", "Mi", "Ju", "Vi", "Sa"],
                    longhand: ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"]
                },
                months: {
                    shorthand: ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"],
                    longhand: typeof GLOBAL_MONTHS !== 'undefined' ? GLOBAL_MONTHS : currentLangData.months
                }
            };
            flatpickr("#encargo-fecha, #cxc-date, #prestamo-fecha-inicio", {
                dateFormat: "d/m/Y",
                disableMobile: "true",
                defaultDate: "today",
                locale: customLocale
            });
        }
    };

    window.selectMonth = function (idx) {
        window.currM = parseInt(idx);
        // Actualizar texto del selector biz (Panel de Negocios)
        const txt = $('biz-current-month-text');
        if (txt) txt.innerText = GLOBAL_MONTHS[window.currM];
        if (typeof save === 'function') save();
        if (typeof renderInventory === 'function') renderInventory();
        if (typeof renderSales === 'function') renderSales();
        if (typeof renderCxC === 'function') renderCxC();
        if (typeof renderCaja === 'function') renderCaja();
        window.closeAllDropdowns();
        window.renderDateSelectors();
        // Sincronizar préstamos con nueva fecha
        if (typeof window.renderPrestamos === 'function') window.renderPrestamos();
        // Recalcular análisis avanzado con la nueva fechaReferencia (fin del mes seleccionado)
        if (typeof window.calculateAdvancedAnalytics === 'function') window.calculateAdvancedAnalytics();
    };

    window.selectYear = function (y) {
        if (!window.appData) return;
        window.appData.year = parseInt(y);
        if (typeof save === 'function') save();
        // Actualizar texto del selector biz (Panel de Negocios)
        const txt = $('biz-current-year-text');
        if (txt) txt.innerText = window.appData.year;
        if (typeof renderInventory === 'function') renderInventory();
        if (typeof renderSales === 'function') renderSales();
        if (typeof renderCxC === 'function') renderCxC();
        if (typeof renderCaja === 'function') renderCaja();
        window.closeAllDropdowns();
        window.renderDateSelectors();
        // Sincronizar préstamos con nuevo año
        if (typeof window.renderPrestamos === 'function') window.renderPrestamos();
        // Recalcular análisis avanzado con el nuevo año de referencia
        if (typeof window.calculateAdvancedAnalytics === 'function') window.calculateAdvancedAnalytics();
    };
    window.performDataMaintenance = function () {
        try {
            const cutoff = Date.now() - (3 * 365 * 24 * 60 * 60 * 1000);
            if (Array.isArray(appData.bizSales)) appData.bizSales = appData.bizSales.filter(s => !s.id || s.id >= cutoff);
            if (Array.isArray(appData.bizReceivables)) appData.bizReceivables = appData.bizReceivables.filter(r => !r.id || r.id >= cutoff);
            if (Array.isArray(appData.combos)) appData.combos = appData.combos.filter(c => !c.id || c.id >= cutoff);
            if (typeof save === 'function') save();
            if (typeof showToast === 'function') showToast('info', 'Mantenimiento', 'Registros antiguos eliminados.');
        } catch (e) { console.error(e); }
    };

    /* ──────────────────────────────────────────────
       BLOQUE 3: Inventario
    ────────────────────────────────────────────── */

    window.syncPriceRef = function (val) {
        const el = $('prod-price-ref'); if (el) el.value = val;
    };

    window.openProductModal = function (id = null) {
        ensurePhase2Data();
        try {
            if (id) {
                const p = appData.inventory.find(x => x.id === id);
                if (p) {
                    $('prod-id').value = p.id; $('prod-name').value = p.name;
                    $('prod-cat').value = p.category || ''; $('prod-brand').value = p.brand || '';
                    $('prod-stock').value = p.stock; $('prod-cost').value = p.cost; $('prod-price').value = p.price;
                    $('prod-sup-disc').value = p.supDisc || ''; $('prod-sale-disc').value = p.saleDisc || '';
                    syncPriceRef(p.price);
                    if (typeof selectCustomOption === 'function') {
                        selectCustomOption('prod-cur', p.currency || 'USD', null);
                        selectCustomOption('prod-meth', p.paymentMethod || 'Zelle', null);
                    }
                    $('prod-modal-title').innerHTML = `<i class="fa-solid fa-pen text-sky-400"></i> <span>Editar Producto</span>`;
                    $('btn-save-prod').innerText = typeof t === 'function' ? t('editBtn') : 'Actualizar';
                }
            } else {
                $('prod-id').value = ''; $('prod-name').value = ''; $('prod-cat').value = ''; $('prod-brand').value = '';
                $('prod-stock').value = ''; $('prod-cost').value = ''; $('prod-price').value = '';
                $('prod-sup-disc').value = ''; $('prod-sale-disc').value = ''; syncPriceRef('');
                if (typeof selectCustomOption === 'function') {
                    selectCustomOption('prod-cur', 'USD', null); selectCustomOption('prod-meth', 'Zelle', null);
                }
                $('prod-modal-title').innerHTML = `<i class="fa-solid fa-box text-sky-400"></i> <span>Añadir Producto</span>`;
                $('btn-save-prod').innerText = typeof t === 'function' ? t('saveBtn') : 'Registrar';
            }
            $('product-modal').classList.remove('hidden');
        } catch (e) { console.error(e); }
    };

    window.saveProduct = function () {
        ensurePhase2Data();
        try {
            const id = $('prod-id').value;
            const n = $('prod-name').value, cat = $('prod-cat').value, b = $('prod-brand').value;
            const s = parseInt($('prod-stock').value), c = parseFloat($('prod-cost').value), p = parseFloat($('prod-price').value);
            const cur = $('prod-cur').value, meth = $('prod-meth').value;
            const sDisc = parseFloat($('prod-sup-disc').value) || 0, slDisc = parseFloat($('prod-sale-disc').value) || 0;
            if (!n || !cat || isNaN(s) || isNaN(c) || isNaN(p) || s < 0 || c < 0 || p < 0)
                return showBlockingAlert('Error de Validación', 'Verifica que todos los datos del producto sean correctos.');

            // ── NOTA CRÍTICA: serverTimestamp() NO puede vivir dentro de un array en Firestore.
            // Si se guarda como FieldValue dentro de appData.inventory[], Firestore lo escribe como null.
            // Solución: siempre almacenar ISO string en el array local → el UI lo parsea de inmediato.
            // Luego se hace un .update() atómico a nivel de campo en el documento del usuario
            // para que Firestore registre la marca de tiempo exacta del servidor.
            const nowISO = new Date().toISOString(); // Timestamp local para escritura en array

            if (id) {
                const obj = appData.inventory.find(x => x.id == id);
                if (obj) {
                    const stockCambio = s !== obj.stock;
                    obj.name = n; obj.category = cat; obj.brand = b; obj.stock = s;
                    obj.cost = c; obj.price = p; obj.currency = cur;
                    obj.paymentMethod = meth; obj.supDisc = sDisc; obj.saleDisc = slDisc;
                    if (stockCambio) {
                        // 1) Guarda ISO en el array local (parseable inmediatamente por el UI)
                        obj.ultima_reposicion = nowISO;
                    }
                }
            } else {
                // 1) Guarda ISO en el array local — siempre parseable
                appData.inventory.push({
                    id: Date.now(),
                    entryMonth: typeof currM !== 'undefined' ? currM : new Date().getMonth(),
                    fecha_entrada: nowISO,
                    name: n, category: cat, brand: b, stock: s, cost: c, price: p,
                    currency: cur, paymentMethod: meth, supDisc: sDisc, saleDisc: slDisc
                });
            }
            $('product-modal').classList.add('hidden');
            if (typeof save === 'function') save();
            renderInventory();
            if (typeof showToast === 'function') showToast('success', 'Éxito', 'Producto registrado.');
        } catch (e) { console.error(e); }
    };

    window.removeProduct = function (id) {
        openCustomConfirm('Eliminar Producto', '¿Eliminar este producto? La acción no se deshace.', () => {
            try { appData.inventory = appData.inventory.filter(p => p.id !== id); if (typeof save === 'function') save(); renderInventory(); } catch (e) { }
        });
    };

    // ── Restock: reponer stock de un producto agotado ──────────────────────────
    window.openRestockModal = function (id) {
        const prod = (appData.inventory || []).find(p => p.id === id);
        if (!prod) return;
        // Mini-modal inline con SweetAlert-style usando el sistema de confirm existente
        const modalHtml = `
            <div id="restock-modal" class="fixed inset-0 z-[99999] flex items-center justify-center bg-black/70 backdrop-blur-sm">
                <div class="glass-card p-6 w-80 flex flex-col gap-4 border border-emerald-500/30 shadow-[0_0_40px_rgba(16,185,129,0.15)]">
                    <div class="flex items-center gap-3">
                        <div class="w-9 h-9 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
                            <i class="fa-solid fa-boxes-stacking text-emerald-400 text-sm"></i>
                        </div>
                        <div>
                            <p class="text-white font-bold text-sm">Reponer Stock</p>
                            <p class="text-white/50 text-[11px] truncate max-w-[190px]">${prod.name}</p>
                        </div>
                    </div>
                    <div class="flex flex-col gap-1">
                        <label class="text-[10px] text-white/50 uppercase tracking-wider">Cantidad a Reponer</label>
                        <input id="restock-qty-input" type="number" min="1" placeholder="Ej: 10"
                            class="glass-input text-white text-sm" />
                    </div>
                    <div class="flex gap-2">
                        <button onclick="document.getElementById('restock-modal').remove()"
                            class="flex-1 text-xs py-2 rounded-lg border border-white/10 text-white/50 hover:text-white hover:border-white/30 transition">
                            Cancelar
                        </button>
                        <button onclick="confirmRestock(${id})"
                            class="flex-1 text-xs py-2 rounded-lg bg-emerald-600/80 hover:bg-emerald-500 border border-emerald-500/40 text-white font-bold transition shadow-[0_0_12px_rgba(16,185,129,0.3)]">
                            <i class="fa-solid fa-check mr-1"></i>Confirmar
                        </button>
                    </div>
                </div>
            </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        setTimeout(() => document.getElementById('restock-qty-input')?.focus(), 100);
    };

    window.confirmRestock = function (id) {
        const qty = parseInt(document.getElementById('restock-qty-input')?.value || '0');
        if (isNaN(qty) || qty <= 0) {
            if (typeof showToast === 'function') showToast('warn', 'Atención', 'Ingresa una cantidad válida mayor a 0.');
            return;
        }
        const prod = (appData.inventory || []).find(p => p.id === id);
        if (!prod) return;
        prod.stock = (parseInt(prod.stock) || 0) + qty;

        // ── NOTA CRÍTICA: serverTimestamp() falla silenciosamente dentro de arrays Firestore.
        // Almacenamos ISO string en el objeto local → el UI lo muestra de inmediato.
        // Después, save() persiste el array completo con la cadena ISO (legible por tsToDate).
        prod.ultima_reposicion = new Date().toISOString();

        document.getElementById('restock-modal')?.remove();
        if (typeof save === 'function') save();
        renderInventory();
        if (typeof showToast === 'function') showToast('success', 'Restock', `+${qty} unidades añadidas a "${prod.name}".`);
    };

    window.renderInventory = function () {
        ensurePhase2Data();
        const cats = [...new Set(appData.inventory.map(p => p.category))];
        const brandList = [...new Set(appData.inventory.map(p => p.brand))];
        if ($('cat-list')) $('cat-list').innerHTML = cats.map(c => `<option value="${c}">`).join('');
        if ($('brand-list')) $('brand-list').innerHTML = brandList.map(b => `<option value="${b}">`).join('');
        const term = ($('inv-search')?.value || '').toLowerCase();
        const cm = typeof currM !== 'undefined' ? currM : new Date().getMonth();
        // Mostrar: productos del mes actual (con o sin stock) + productos anteriores con stock > 0
        const filtered = appData.inventory.filter(p =>
            (p.entryMonth === cm || (p.entryMonth <= cm && p.stock > 0) || (p.entryMonth <= cm && p.stock <= 0)) &&
            (p.name.toLowerCase().includes(term) || (p.category || '').toLowerCase().includes(term) || (p.brand || '').toLowerCase().includes(term))
        );
        const rUsd = getRate('tick-usd'), rEur = getRate('tick-eur'), rUsdt = getRate('tick-usdt');
        $('inventory-container').innerHTML = filtered.map(p => {
            const netCostRaw = p.cost * (1 - ((p.supDisc || 0) / 100));
            let netCostUSD = netCostRaw;
            if (p.currency === 'EUR') netCostUSD = (netCostRaw * rEur) / rUsd;
            const netPriceUSD = p.price * (1 - ((p.saleDisc || 0) / 100));
            const profit = netPriceUSD - netCostUSD, margin = netPriceUSD > 0 ? (profit / netPriceUSD) * 100 : 0;
            const priceBsBCV = netPriceUSD * rUsd, priceBsEUR = netPriceUSD * rEur, priceBsUSDT = netPriceUSD * rUsdt;
            const isOut = parseInt(p.stock) <= 0;

            // Badge ANTIGUO solo en productos con stock y de mes anterior
            const oldBadge = !isOut && p.entryMonth < cm
                ? `<span class="absolute top-3 left-3 bg-amber-900/80 border border-amber-500/50 text-amber-200 text-[9px] font-bold px-2 py-0.5 rounded-full z-[25] uppercase tracking-widest pointer-events-none shadow-[0_0_8px_rgba(251,191,36,0.5)]">ANTIGUO</span>`
                : '';

            // Badge SIN STOCK para productos agotados
            const sinStockBadge = isOut
                ? `<span class="badge-sin-stock">SIN STOCK</span>`
                : '';

            // Botón de acción inferior: Reponer si agotado, nada (solo trash) si con stock
            const accionBtn = isOut
                ? `<button onclick="openRestockModal(${p.id})" class="btn-reponer pointer-events-auto">
                        <i class="fa-solid fa-boxes-stacking mr-1"></i>Reponer Stock
                   </button>`
                : '';

            return `<div class="glass-card p-5 relative flex flex-col justify-between border transition-colors group${isOut ? ' agotado' : ' border-white/10 hover:border-sky-500/30'}">
                ${sinStockBadge}${oldBadge}
                <div class="mb-3 relative z-20 flex justify-between items-start gap-2 pt-6">
                    <div class="min-w-0 flex-1 flex flex-col items-start gap-1">
                        <span class="text-[9px] font-bold uppercase tracking-wider ${isOut ? 'text-gray-500' : 'text-sky-400'}">${p.category} | ${p.brand}</span>
                        <h3 class="font-bold ${isOut ? 'text-gray-400' : 'text-white'} text-sm truncate w-full" title="${p.name}">${p.name}</h3>
                        <span class="text-[9px] font-medium text-sky-300/60 flex items-center gap-1">${(() => {
                            // Convierte Firestore Timestamp (.toDate()), {seconds:N}, ISO string o Number a Date
                            const tsToDate = (v) => {
                                try {
                                    if (!v) return null;
                                    if (typeof v === 'object' && typeof v.toDate === 'function') return v.toDate();
                                    if (typeof v === 'object' && typeof v.seconds === 'number') return new Date(v.seconds * 1000);
                                    const d = new Date(v);
                                    return isNaN(d.getTime()) ? null : d;
                                } catch(e) { return null; }
                            };
                            // Prioridad: ultima_reposicion > fecha_entrada > hoy (nunca 'Sin fecha')
                            const hasRepos = !!p.ultima_reposicion;
                            const ref = tsToDate(p.ultima_reposicion) || tsToDate(p.fecha_entrada) || new Date();
                            const dd   = String(ref.getDate()).padStart(2, '0');
                            const mm   = String(ref.getMonth() + 1).padStart(2, '0');
                            const yy   = String(ref.getFullYear()).slice(-2); // DD/MM/YY
                            // Etiqueta exacta según especificación: 'Repos: DD/MM/YY' | 'Entrada: DD/MM/YY'
                            const label = hasRepos ? 'Repos' : 'Entrada';
                            const icono = hasRepos ? '↺' : '↑';
                            return icono + ' ' + label + ': ' + dd + '/' + mm + '/' + yy;
                        })()}</span>
                    </div>
                    <div class="flex items-center gap-1.5 flex-shrink-0 absolute top-3 right-3">
                        <button onclick="openProductModal(${p.id})" class="text-gray-400 hover:text-sky-400 transition bg-white/5 px-2 py-1 rounded shadow-inner pointer-events-auto z-[25]" title="Editar"><i class="fa-solid fa-pen text-[10px]"></i></button>
                    </div>
                </div>
                <div class="grid grid-cols-2 gap-2 mb-3 relative z-10">
                    <div class="bg-black/30 rounded p-2 border border-white/10 text-center">
                        <p class="text-[9px] text-white/50 uppercase">Stock</p>
                        <p class="font-bold ${isOut ? 'text-red-400' : 'text-white'} text-xs">${p.stock} und.</p>
                    </div>
                    <div class="bg-black/30 rounded p-2 border border-white/10 text-center">
                        <p class="text-[9px] text-white/50 uppercase">Precio Venta</p>
                        <p class="font-bold ${isOut ? 'text-gray-500' : 'text-white'} text-xs">$${netPriceUSD.toFixed(2)}</p>
                    </div>
                </div>
                ${isOut ? '' : `
                <div class="rounded p-3 border border-sky-500/20 mb-3 relative overflow-hidden z-10" style="background:rgba(56,189,248,0.06)">
                    <div class="flex justify-between items-end mb-1"><p class="text-[10px] text-white/60 uppercase font-bold">Venta USD</p><p class="text-lg font-extrabold text-white leading-none">$${netPriceUSD.toFixed(2)}</p></div>
                    <div class="flex flex-col gap-1 text-[9px] text-white/50 border-t border-white/10 pt-2 mt-2">
                        <div class="flex justify-between"><span>Bs BCV (USD):</span><span class="font-bold text-sky-300">Bs ${priceBsBCV.toFixed(2)}</span></div>
                        <div class="flex justify-between"><span>Bs BCV (EUR):</span><span class="font-bold text-sky-300">Bs ${priceBsEUR.toFixed(2)}</span></div>
                        <div class="flex justify-between"><span>USDT:</span><span class="font-bold text-emerald-300">Bs ${priceBsUSDT.toFixed(2)}</span></div>
                    </div>
                </div>`}
                <div class="flex justify-between items-center border-t border-white/10 pt-2 relative z-20 pointer-events-auto">
                    <div class="flex gap-2 items-center flex-1">
                        ${accionBtn}
                        ${!isOut ? `<span class="text-[10px] ${profit >= 0 ? 'text-emerald-400' : 'text-red-400'} font-semibold"><i class="fa-solid fa-arrow-trend-up mr-1"></i>$${profit.toFixed(2)}</span><span class="text-[10px] text-sky-400 font-semibold"><i class="fa-solid fa-percent mr-1"></i>${margin.toFixed(1)}%</span>` : ''}
                    </div>
                    <button onclick="removeProduct(${p.id})" class="text-gray-500 hover:text-red-400 transition pointer-events-auto ml-2"><i class="fa-solid fa-trash text-xs"></i></button>
                </div>
            </div>`;
        }).join('') || `<div class="col-span-full text-center py-10 text-white/40 text-xs italic">No hay productos registrados.</div>`;
        updateBizAnalysis(filtered);
    };

    window.updateBizAnalysis = function (filteredInventory) {
        let totalInv = 0, totalRev = 0, totalStockItems = 0, agingStockItems = 0;
        const cm = typeof currM !== 'undefined' ? currM : new Date().getMonth();
        const rUsd = getRate('tick-usd'), rEur = getRate('tick-eur');
        filteredInventory.forEach(p => {
            let netCostRaw = p.cost * (1 - ((p.supDisc || 0) / 100));
            let netCostUSD = netCostRaw;
            if (p.currency === 'EUR') netCostUSD = (netCostRaw * rEur) / rUsd;
            const netPriceUSD = p.price * (1 - ((p.saleDisc || 0) / 100));
            totalInv += (netCostUSD * p.stock); totalRev += (netPriceUSD * p.stock);
            totalStockItems += p.stock;
            if (p.entryMonth < cm && p.stock > 0) agingStockItems += p.stock;
        });
        let grossIncome = 0, realProfit = 0;
        appData.bizSales.filter(s => s.month <= (typeof currM !== 'undefined' ? currM : new Date().getMonth())).forEach(s => { grossIncome += (s.price * s.qty); realProfit += s.profit; });
        let cxcProfit = 0;
        appData.bizReceivables.filter(r => r.startMonth <= (typeof currM !== 'undefined' ? currM : new Date().getMonth())).forEach(r => { grossIncome += r.total; r.payments?.forEach(py => { cxcProfit += py.amount; }); });
        let agingVal = 0;
        filteredInventory.filter(p => p.entryMonth < (typeof currM !== 'undefined' ? currM : new Date().getMonth()) && p.stock > 0).forEach(p => { let c = p.cost * (1 - ((p.supDisc || 0) / 100)); if (p.currency === 'EUR') c = (c * rEur) / rUsd; agingVal += (c * p.stock); });
        const el = (id, v) => { const n = $(id); if (n) n.innerText = '$' + parseFloat(Number(v).toFixed(2)).toFixed(2); };
        if ($('inv-metric-total-stock')) $('inv-metric-total-stock').innerText = totalStockItems;
        if ($('inv-metric-total-stock-val')) $('inv-metric-total-stock-val').innerText = '$' + totalInv.toFixed(2);
        if ($('inv-metric-aging-stock')) $('inv-metric-aging-stock').innerText = agingStockItems;
        if ($('inv-metric-aging-stock-val')) $('inv-metric-aging-stock-val').innerText = '$' + agingVal.toFixed(2);
        if ($('inv-metric-investment')) $('inv-metric-investment').innerText = '$' + totalInv.toFixed(2);
        if ($('inv-metric-gross-income')) $('inv-metric-gross-income').innerText = '$' + grossIncome.toFixed(2);
        if ($('inv-metric-profit-sales')) $('inv-metric-profit-sales').innerText = '$' + realProfit.toFixed(0);
        if ($('inv-metric-profit-cxc')) $('inv-metric-profit-cxc').innerText = '$' + cxcProfit.toFixed(0);
    };

    /* ──────────────────────────────────────────────
       BLOQUE 4: Proveedores + Combos
    ────────────────────────────────────────────── */

    window.openSupplierModal = function (id = null) {
        ensurePhase2Data();
        try {
            if (id) {
                const s = appData.suppliers.find(x => x.id === id);
                if (s) { $('sup-id').value = s.id; $('sup-name').value = s.name; $('sup-contact').value = s.contact; $('sup-prods').value = s.products; }
            } else { $('sup-id').value = ''; $('sup-name').value = ''; $('sup-contact').value = ''; $('sup-prods').value = ''; }
            $('supplier-modal').classList.remove('hidden');
        } catch (e) { }
    };
    window.saveSupplier = function () {
        try {
            const id = $('sup-id').value, n = $('sup-name').value, c = $('sup-contact').value, p = $('sup-prods').value;
            if (!n) return showBlockingAlert('Error', 'El nombre del aliado es requerido.');
            if (id) { const obj = appData.suppliers.find(x => x.id == id); if (obj) { obj.name = n; obj.contact = c; obj.products = p; } }
            else { appData.suppliers.push({ id: Date.now(), name: n, contact: c, products: p }); }
            $('supplier-modal').classList.add('hidden');
            if (typeof save === 'function') save(); renderSuppliers();
            if (typeof showToast === 'function') showToast('success', 'Guardado', 'Aliado registrado.');
        } catch (e) { }
    };
    window.removeSupplier = function (id) {
        openCustomConfirm('Desvincular Aliado', '¿Eliminar a este proveedor?', () => {
            try { appData.suppliers = appData.suppliers.filter(s => s.id !== id); if (typeof save === 'function') save(); renderSuppliers(); } catch (e) { }
        });
    };
    window.renderSuppliers = function () {
        ensurePhase2Data();
        $('suppliers-container').innerHTML = appData.suppliers.map(s => `
            <div class="glass-card p-4 relative flex flex-col justify-between hover:border-violet-500/30 transition-colors">
                <div class="mb-3 flex justify-between items-start"><div class="flex items-center gap-2"><i class="fa-solid fa-building text-violet-400 text-lg"></i><h3 class="font-bold text-white text-sm">${s.name}</h3></div><button onclick="openSupplierModal(${s.id})" class="text-gray-400 hover:text-violet-400 transition bg-white/5 px-2 py-1 rounded shadow-inner"><i class="fa-solid fa-pen text-[10px]"></i></button></div>
                <div class="bg-black/20 rounded p-2 border border-white/5 mb-2"><p class="text-[9px] text-gray-400 uppercase"><i class="fa-solid fa-address-book mr-1"></i>Contacto</p><p class="font-medium text-gray-200 text-xs truncate">${s.contact || '--'}</p></div>
                <div class="bg-black/20 rounded p-2 border border-white/5 mb-3"><p class="text-[9px] text-gray-400 uppercase"><i class="fa-solid fa-box mr-1"></i>Notas</p><p class="font-medium text-gray-200 text-xs truncate">${s.products || '--'}</p></div>
                <div class="flex justify-end border-t border-white/10 pt-2"><button onclick="removeSupplier(${s.id})" class="text-gray-500 hover:text-red-400 transition"><i class="fa-solid fa-trash text-xs"></i></button></div>
            </div>`).join('') || `<div class="col-span-full text-center py-10 text-gray-500 text-xs italic">No hay aliados vinculados.</div>`;
    };

    window.openComboModal = function () {
        ensurePhase2Data();
        try {
            $('combo-name').value = ''; $('combo-price').value = '';
            const validProds = appData.inventory.filter(p => p.stock > 0);
            $('combo-prod-list').innerHTML = validProds.map(p => `
                <div class="flex items-center justify-between hover:bg-white/10 p-1.5 rounded transition">
                    <span class="text-white font-semibold text-[11px]">${p.name} <span class="text-gray-400 font-normal">($${p.price})</span></span>
                    <input type="number" id="combo-qty-${p.id}" class="glass-input !py-1 !px-2 text-[10px] w-12 text-center" value="0" min="0" max="${p.stock}">
                </div>`).join('') || '<p class="text-[10px] text-gray-500 italic">No hay productos en stock.</p>';
            $('combo-modal').classList.remove('hidden');
        } catch (e) { console.error(e); }
    };
    window.saveCombo = function () {
        try {
            const n = $('combo-name').value, p = parseFloat($('combo-price').value);
            const validProds = appData.inventory.filter(pr => pr.stock > 0);
            const comps = []; validProds.forEach(pr => { const q = parseInt($(`combo-qty-${pr.id}`)?.value) || 0; if (q > 0) comps.push({ id: pr.id, qty: q }); });
            if (!n || isNaN(p) || p <= 0 || comps.length === 0) return showBlockingAlert('Error', 'Nombre, precio y al menos un producto requeridos.');
            appData.combos.push({ id: Date.now(), name: n, price: p, components: comps });
            $('combo-modal').classList.add('hidden');
            if (typeof save === 'function') save(); renderCombos(); buildSaleItemOptions();
            if (typeof showToast === 'function') showToast('success', 'Éxito', 'Combo creado.');
        } catch (e) { console.error(e); }
    };
    window.deleteCombo = function (id) {
        openCustomConfirm('Eliminar Combo', '¿Deshacer este combo?', () => {
            try { appData.combos = appData.combos.filter(c => c.id !== id); if (typeof save === 'function') save(); renderCombos(); buildSaleItemOptions(); } catch (e) { }
        });
    };
    window.renderCombos = function () {
        ensurePhase2Data();
        if (!appData.combos || appData.combos.length === 0) { if ($('combos-wrapper')) $('combos-wrapper').classList.add('hidden'); return; }
        if ($('combos-wrapper')) $('combos-wrapper').classList.remove('hidden');
        $('active-combos-container').innerHTML = appData.combos.map(c => {
            const prodList = c.components.map(comp => { const p = appData.inventory.find(x => x.id === comp.id); return p ? `${comp.qty}x ${p.name}` : 'Prod. Eliminado'; }).join(', ');
            return `<div class="bg-black/20 border border-white/5 p-3 rounded-lg flex justify-between items-center transition hover:border-violet-500/30">
                <div><h4 class="font-bold text-white text-xs">${c.name}</h4><p class="text-[9px] text-gray-400 mt-0.5">${prodList}</p><p class="text-violet-400 font-extrabold text-xs mt-1">$${c.price.toFixed(2)}</p></div>
                <button onclick="deleteCombo(${c.id})" class="text-gray-500 hover:text-red-400 transition ml-2 p-1"><i class="fa-solid fa-trash text-xs"></i></button>
            </div>`;
        }).join('');
    };

    /* ──────────────────────────────────────────────
       BLOQUE 5: Ventas
    ────────────────────────────────────────────── */

    window._saleCart = [];
    
    window.addItemToSaleCart = function() {
        try {
            ensurePhase2Data();
            const ty = $('sale-type').value, it = parseInt($('sale-item').value), q = parseInt($('sale-qty').value) || 1;
            if (!it) return showBlockingAlert('Datos Faltantes', 'Seleccione un artículo válido.');
            const finalP = parseFloat($('sale-price').value) || 0;
            
            let itemCost = 0, name = '';
            const rUsd = (window.fx && window.fx.usd_bcv) ? window.fx.usd_bcv : (typeof getRate === 'function' ? getRate('tick-usd') : 1);
            const rEur = (window.fx && window.fx.eur_bcv) ? window.fx.eur_bcv : (typeof getRate === 'function' ? getRate('tick-eur') : 1);
            
            if (ty === 'product') {
                const p = appData.inventory.find(x => x.id === it);
                if (!p || p.stock < q) return showBlockingAlert('Stock Insuficiente', 'El inventario no cubre la cantidad.');
                let netCostRaw = p.cost * (1 - ((p.supDisc || 0) / 100));
                itemCost = p.currency === 'EUR' ? (netCostRaw * rEur) / rUsd : netCostRaw;
                name = p.name; 
            } else {
                const c = appData.combos.find(x => x.id === it); if (!c) return;
                for (const comp of c.components) { const cp = appData.inventory.find(x => x.id === comp.id); if (!cp || cp.stock < (comp.qty * q)) return showBlockingAlert('Stock Insuficiente', 'Inventario insuficiente para el combo.'); }
                for (const comp of c.components) { const cp = appData.inventory.find(x => x.id === comp.id); let cC = cp.cost * (1 - ((cp.supDisc || 0) / 100)); if (cp.currency === 'EUR') cC = (cC * rEur) / rUsd; itemCost += (cC * comp.qty); }
                name = 'Combo: ' + c.name;
            }
            
            const profit = (finalP * q) - (itemCost * q), totalUSD = finalP * q;
            window._saleCart.push({ id: Date.now() + Math.random(), type: ty, itemId: it, name, qty: q, price: finalP, cost: itemCost, profit, totalUSD });
            
            $('sale-qty').value = '1';
            
            updateSalePreview();
            renderSaleCart();
        } catch (e) { console.error(e); }
    };

    window.removeItemFromSaleCart = function(index) {
        window._saleCart.splice(index, 1);
        updateSalePreview();
        renderSaleCart();
    };

    window.renderSaleCart = function() {
        const container = $('sale-cart-list');
        if (!container) return;
        if (window._saleCart.length === 0) {
            container.innerHTML = '';
            return;
        }
        container.innerHTML = window._saleCart.map((item, idx) => `
            <div class="flex justify-between items-center bg-black/20 p-2 rounded border border-white/5">
                <div class="flex flex-col">
                    <span class="text-xs text-white font-bold">${item.name}</span>
                    <span class="text-[10px] text-gray-400">${item.qty} und x $${item.price.toFixed(2)}</span>
                </div>
                <div class="flex items-center gap-3">
                    <span class="text-emerald-400 font-bold text-xs">$${item.totalUSD.toFixed(2)}</span>
                    <button type="button" onclick="removeItemFromSaleCart(${idx})" class="text-gray-500 hover:text-red-400"><i class="fa-solid fa-xmark"></i></button>
                </div>
            </div>
        `).join('');
    };

    window.openSaleModal = function () {
        try {
            window._saleCart = [];
            $('sale-qty').value = '1'; $('sale-price').value = '';
            if (typeof selectCustomOption === 'function') { selectCustomOption('sale-cur', 'USD', null); selectCustomOption('sale-type', 'product', 'Producto'); }
            updateSaleMethodUI(); buildSaleItemOptions();
            $('sale-modal').classList.remove('hidden'); updateSalePreview(); renderSaleCart();
        } catch (e) { console.error(e); }
    };
    window.updateSaleMethodUI = function () {
        const cur = $('sale-cur').value;
        if (cur === 'USD') {
            $('sale-usd-method-container').style.display = 'block'; $('sale-bs-method-container').style.display = 'none';
            if (typeof selectCustomOption === 'function') selectCustomOption('sale-usd-method', 'Zelle', null);
        } else {
            $('sale-usd-method-container').style.display = 'none'; $('sale-bs-method-container').style.display = 'block';
            if (typeof selectCustomOption === 'function') { selectCustomOption('sale-ref', 'USD', 'bcvUsd'); selectCustomOption('sale-bs-method', 'Pago Movil', null); }
        }
        updateSalePreview();
    };
    window.buildSaleItemOptions = function () {
        ensurePhase2Data();
        const ty = $('sale-type').value;
        let opts = ty === 'product' ? appData.inventory.filter(p => p.stock > 0).map(p => ({ v: p.id, t: p.name + ` ($${p.price})` })) : appData.combos.map(c => ({ v: c.id, t: c.name + ` ($${c.price})` }));
        $('sale-item-dropdown').innerHTML = opts.map(o => `<div class="p-2 hover:bg-white/10 cursor-pointer text-white" onclick="selectCustomOption('sale-item','${o.v}',null);document.getElementById('sale-item-text').innerText='${o.t.split('(')[0]}';">${o.t}</div>`).join('') || `<div class="p-2 text-gray-500 italic text-center">Sin items disponibles</div>`;
        if (opts.length > 0) { if (typeof selectCustomOption === 'function') selectCustomOption('sale-item', opts[0].v, null); $('sale-item-text').innerText = opts[0].t.split('(')[0]; }
        else { $('sale-item').value = ''; $('sale-item-text').innerText = '--'; }
    };
    window.updateSalePreview = function () {
        const cur = document.getElementById('sale-cur') ? document.getElementById('sale-cur').value : 'USD';
        const ref = document.getElementById('sale-ref') ? document.getElementById('sale-ref').value : 'BCV USD';
        
        let totalUSD = window._saleCart.reduce((sum, item) => sum + item.totalUSD, 0);
        
        if (cur === 'BS') {
            let rateUsed = 1;
            if (ref === 'bcvUsd' && window.fx && window.fx.usd_bcv) rateUsed = window.fx.usd_bcv;
            else if (ref === 'bcvEur' && window.fx && window.fx.eur_bcv) rateUsed = window.fx.eur_bcv;
            else if (ref === 'usdt' && window.fx && window.fx.usd_paralelo) rateUsed = window.fx.usd_paralelo;
            else if (typeof getRate === 'function') rateUsed = getRate(ref === 'bcvUsd' ? 'tick-usd' : (ref === 'bcvEur' ? 'tick-eur' : 'tick-usdt'));
            
            let totalBs = totalUSD * rateUsed;
            if($('sale-total-display')) $('sale-total-display').innerText = `Bs ${totalBs.toFixed(2)} (~$${totalUSD.toFixed(2)})`;
        } else { 
            if($('sale-total-display')) $('sale-total-display').innerText = `$${totalUSD.toFixed(2)}`; 
        }
    };
    window.processSale = function () {
        try {
            ensurePhase2Data();
            if (window._saleCart.length === 0) return showBlockingAlert('Carrito Vacío', 'Debe añadir al menos un artículo al carrito.');
            
            const cur = $('sale-cur').value, usdMethod = $('sale-usd-method').value, bsMethod = $('sale-bs-method').value, bsRef = $('sale-ref').value;
            const methStr = cur === 'USD' ? usdMethod : (bsMethod + ' (' + bsRef + ')');
            const cm = typeof currM !== 'undefined' ? currM : new Date().getMonth();
            let totalUSD = 0, totalBs = 0, rateUsed = 0;

            window._saleCart.forEach(item => {
                if (item.type === 'product') {
                    const p = appData.inventory.find(x => x.id === item.itemId);
                    if (p) p.stock -= item.qty;
                } else {
                    const c = appData.combos.find(x => x.id === item.itemId);
                    if (c) {
                        for (const comp of c.components) {
                            const cp = appData.inventory.find(x => x.id === comp.id);
                            if (cp) cp.stock -= (comp.qty * item.qty);
                        }
                    }
                }
                appData.bizSales.push({ id: Date.now() + Math.random(), month: cm, type: item.type, name: item.name, qty: item.qty, price: item.price, cost: item.cost, currency: cur, method: methStr, profit: item.profit });
                totalUSD += item.totalUSD;
            });

            if (cur === 'BS') { 
                if (bsRef === 'bcvUsd' && window.fx && window.fx.usd_bcv) rateUsed = window.fx.usd_bcv;
                else if (bsRef === 'bcvEur' && window.fx && window.fx.eur_bcv) rateUsed = window.fx.eur_bcv;
                else if (bsRef === 'usdt' && window.fx && window.fx.usd_paralelo) rateUsed = window.fx.usd_paralelo;
                else if (typeof getRate === 'function') rateUsed = getRate(bsRef === 'bcvUsd' ? 'tick-usd' : (bsRef === 'bcvEur' ? 'tick-eur' : 'tick-usdt'));
                totalBs = totalUSD * rateUsed;
            }
            
            let itemsCount = window._saleCart.length;
            $('sale-modal').classList.add('hidden');
            window._saleCart = [];
            
            if (typeof save === 'function') save(); 
            if (typeof renderInventory === 'function') renderInventory(); 
            if (typeof renderSales === 'function') renderSales();
            
            let receiptMsg = `<b>Venta procesada:</b> ${itemsCount} artículo(s)<br><b>Método:</b> ${methStr}<br><b>Total:</b> ${cur === 'BS' ? 'Bs ' + totalBs.toFixed(2) : '$' + totalUSD.toFixed(2)}`;
            if (cur === 'BS') receiptMsg += `<br><span class="text-sky-300">Tasa: ${rateUsed.toFixed(2)}</span>`;
            if (typeof showToast === 'function') showToast('success', 'Venta Exitosa', receiptMsg);
        } catch (e) { console.error(e); showBlockingAlert('Error Interno', 'Error al procesar la venta.'); }
    };
    window.openEditSaleModal = function (id) {
        try {
            const s = appData.bizSales.find(x => x.id === id); if (!s) return;
            $('edit-sale-id').value = s.id; $('edit-sale-price').value = s.price;
            if (typeof selectCustomOption === 'function') { selectCustomOption('edit-sale-cur', s.currency, null); updateEditSaleMethodUI(); selectCustomOption('edit-sale-method', s.method.split(' (')[0], null); }
            $('sale-edit-modal').classList.remove('hidden');
        } catch (e) { }
    };
    window.updateEditSaleMethodUI = function () {
        const cur = $('edit-sale-cur').value, drop = $('edit-sale-method-dropdown');
        if (cur === 'USD') {
            drop.innerHTML = `<div class="p-2 hover:bg-white/10 cursor-pointer" onclick="selectCustomOption('edit-sale-method','Zelle',null)">Zelle</div><div class="p-2 hover:bg-white/10 cursor-pointer" onclick="selectCustomOption('edit-sale-method','Binance',null)">Binance</div><div class="p-2 hover:bg-white/10 cursor-pointer" onclick="selectCustomOption('edit-sale-method','Efectivo',null)">Efectivo</div>`;
            if (typeof selectCustomOption === 'function') selectCustomOption('edit-sale-method', 'Zelle', null);
        } else {
            drop.innerHTML = `<div class="p-2 hover:bg-white/10 cursor-pointer" onclick="selectCustomOption('edit-sale-method','Pago Movil',null)">Pago Movil</div><div class="p-2 hover:bg-white/10 cursor-pointer" onclick="selectCustomOption('edit-sale-method','Transferencia',null)">Transferencia</div>`;
            if (typeof selectCustomOption === 'function') selectCustomOption('edit-sale-method', 'Pago Movil', null);
        }
    };
    window.saveEditSale = function () {
        try {
            const id = parseInt($('edit-sale-id').value), p = parseFloat($('edit-sale-price').value);
            const cur = $('edit-sale-cur').value, method = $('edit-sale-method').value;
            const s = appData.bizSales.find(x => x.id === id);
            if (s && p >= 0) { const diff = p - s.price; s.price = p; s.currency = cur; s.method = method; s.profit += (diff * s.qty); if (typeof save === 'function') save(); renderSales(); renderInventory(); $('sale-edit-modal').classList.add('hidden'); if (typeof showToast === 'function') showToast('success', 'Éxito', 'Venta actualizada.'); }
        } catch (e) { console.error(e); }
    };
    window.renderSales = function () {
        ensurePhase2Data();
        const cm = typeof currM !== 'undefined' ? currM : new Date().getMonth();
        $('sales-container').innerHTML = appData.bizSales.filter(s => s.month === cm).map(s => `
            <div class="glass-card p-5 relative flex flex-col justify-between border border-white/10 hover:border-emerald-500/25 transition-colors group">
                <div class="mb-3 relative z-20 flex justify-between items-start gap-2">
                    <div class="min-w-0 flex-1 flex flex-col items-start gap-1">
                        <span class="text-[9px] font-bold uppercase tracking-wider text-emerald-400">Venta · ${s.currency || 'USD'}</span>
                        <h3 class="font-bold text-white text-sm truncate w-full">${s.name}</h3>
                    </div>
                    <div class="flex items-center gap-1.5 flex-shrink-0">
                        <span class="bg-emerald-500/20 text-emerald-400 text-[9px] font-bold px-2 py-0.5 rounded-full border border-emerald-500/40">${s.qty} und.</span>
                        <button onclick="openEditSaleModal(${s.id})" class="text-gray-400 hover:text-sky-400 transition bg-white/5 px-2 py-1 rounded shadow-inner"><i class="fa-solid fa-pen text-[10px]"></i></button>
                    </div>
                </div>
                <div class="grid grid-cols-2 gap-2 mb-3">
                    <div class="bg-black/20 rounded p-2 border border-white/5 text-center"><p class="text-[9px] text-gray-400 uppercase">Fecha</p><p class="font-bold text-gray-200 text-[10px]">${new Date(s.id).toLocaleDateString()}</p></div>
                    <div class="bg-black/20 rounded p-2 border border-white/5 text-center"><p class="text-[9px] text-gray-400 uppercase">Método</p><p class="font-bold text-sky-300 text-[10px] truncate">${s.method}</p></div>
                </div>
                <div class="rounded p-3 border border-emerald-500/20 mb-3 bg-emerald-900/10">
                    <div class="flex justify-between items-end"><p class="text-[10px] text-emerald-300 uppercase font-bold">Total Venta</p><p class="text-lg font-extrabold text-white leading-none">$${(s.price * s.qty).toFixed(2)}</p></div>
                </div>
                <div class="flex justify-between items-center border-t border-white/10 pt-2">
                    <span class="text-[10px] ${s.profit >= 0 ? 'text-emerald-400' : 'text-red-400'} font-semibold"><i class="fa-solid fa-arrow-trend-up mr-1"></i>Ganancia: $${s.profit.toFixed(2)}</span>
                    <button onclick="event.stopPropagation(); window.openCustomConfirm('Eliminar Venta', '¿Eliminar esta venta?', () => { appData.bizSales=appData.bizSales.filter(x=>x.id!==${s.id}); if(typeof save==='function')save(); renderSales(); renderInventory(); });" class="text-gray-500 hover:text-red-400 transition"><i class="fa-solid fa-trash text-xs"></i></button>
                </div>
            </div>`).join('') || `<div class="col-span-full text-center py-10 text-gray-500 text-xs italic">No hay ventas registradas este mes.</div>`;
    };

    /* ──────────────────────────────────────────────
       BLOQUE 6: CxC (Cobrador)
    ────────────────────────────────────────────── */

    window.openCxCModal = function () {
        try {
            $('cxc-name').value = ''; $('cxc-desc').value = ''; $('cxc-total').value = ''; $('cxc-init').value = ''; $('cxc-inst').value = '1';
            if (typeof selectCustomOption === 'function') selectCustomOption('cxc-freq', 'monthly', 'monthly');
            if (typeof calSelectedDate !== 'undefined') window.calSelectedDate = null;
            $('dp-text-cxc').innerText = typeof t === 'function' ? t('selectDateLbl') : 'Selec. Fecha';
            $('dp-text-cxc').classList.remove('text-white', 'font-bold'); 
            if ($('cxc-date')._flatpickr) $('cxc-date')._flatpickr.clear();
            else $('cxc-date').value = '';
            buildCxCItemOptions(); updateCxCPreview();
            $('cxc-modal').classList.remove('hidden');
        } catch (e) { console.error(e); }
    };
    window.buildCxCItemOptions = function () {
        ensurePhase2Data();
        const opts = appData.inventory.filter(p => p.stock > 0).map(p => ({ v: p.id, t: p.name + ` ($${p.price})` }));
        $('cxc-item-dropdown').innerHTML = opts.map(o => `<div class="p-2 hover:bg-white/10 cursor-pointer text-white" onclick="selectCustomOption('cxc-item','${o.v}',null);document.getElementById('cxc-item-text').innerText='${o.t.split('(')[0]}';">${o.t}</div>`).join('') || `<div class="p-2 text-gray-500 italic text-center">Sin stock en inventario</div>`;
        if (opts.length > 0) { if (typeof selectCustomOption === 'function') selectCustomOption('cxc-item', opts[0].v, null); $('cxc-item-text').innerText = opts[0].t.split('(')[0]; }
        else { $('cxc-item').value = ''; $('cxc-item-text').innerText = '--'; }
    };
    window.updateCxCPreview = function () {
        const tot = parseFloat($('cxc-total').value) || 0, ini = parseFloat($('cxc-init').value) || 0, inst = parseInt($('cxc-inst').value) || 1;
        const rem = tot - ini, amt = rem > 0 ? rem / inst : 0;
        $('cxc-preview-amt').innerText = '$' + amt.toFixed(2);
    };
    window.saveCxC = function () {
        try {
            const n = $('cxc-name').value, d = $('cxc-desc').value, total = parseFloat($('cxc-total').value);
            const payInit = parseFloat($('cxc-init').value) || 0, inst = parseInt($('cxc-inst').value) || 1;
            const f = $('cxc-freq').value, sDate = $('cxc-date').value;
            const it = parseInt($('cxc-item').value), q = parseInt($('cxc-qty').value) || 1;
            if (!it) return showBlockingAlert('Error', 'Seleccione un producto vinculado.');
            const p = appData.inventory.find(x => x.id === it);
            if (!p || p.stock < q) return showBlockingAlert('Stock Insuficiente', 'El inventario no cubre la cantidad del crédito.');
            if (!n || isNaN(total) || total <= 0 || !sDate) return showBlockingAlert('Faltan Datos', 'Nombre, Total y Fecha Inicial son obligatorios.');
            p.stock -= q;
            const amt = (total - payInit) / inst;
            const cm = typeof currM !== 'undefined' ? currM : new Date().getMonth();
            appData.bizReceivables.push({ id: Date.now(), startMonth: cm, name: n, desc: d, total, paid: payInit, installments: inst, instAmount: amt, frequency: f, startDate: sDate, payments: payInit > 0 ? [{ amount: payInit, method: 'Inicial', date: new Date().toISOString() }] : [], completed: false });
            $('cxc-modal').classList.add('hidden');
            if (typeof save === 'function') save(); renderCxC(); renderInventory();
            if (typeof showToast === 'function') showToast('success', 'Éxito', 'Cuenta registrada y stock rebajado.');
        } catch (e) { console.error(e); }
    };
    window.getNextPaymentDateStr = function (startDate, freq, paymentsMade) {
        if (!startDate) return '--';
        const d = new Date(startDate + 'T12:00:00');
        if (freq === 'weekly') d.setDate(d.getDate() + (7 * paymentsMade));
        else if (freq === 'biweekly') d.setDate(d.getDate() + (15 * paymentsMade));
        else if (freq === 'monthly') d.setMonth(d.getMonth() + paymentsMade);
        return d.toLocaleDateString();
    };
    window.openCxCPaymentModal = function (id) {
        try {
            const r = appData.bizReceivables.find(x => x.id === id); if (!r) return;
            $('cxc-pay-id').value = id; $('cxc-pay-sugg').innerText = '$' + r.instAmount.toFixed(2); $('cxc-pay-amount').value = '';
            if (typeof selectCustomOption === 'function') selectCustomOption('cxc-pay-cur', 'USD', null);
            updateCxCPaymentUI();
            $('cxc-payment-modal').classList.remove('hidden');
        } catch (e) { }
    };
    window.updateCxCPaymentUI = function () {
        const cur = $('cxc-pay-cur').value, amt = parseFloat($('cxc-pay-amount').value) || 0, ref = $('cxc-pay-ref').value;
        if (cur === 'USD') {
            $('cxc-pay-usd-method-container').style.display = 'block'; $('cxc-pay-bs-method-container').style.display = 'none';
            $('cxc-pay-preview-usd').innerText = '$' + amt.toFixed(2);
        } else {
            $('cxc-pay-usd-method-container').style.display = 'none'; $('cxc-pay-bs-method-container').style.display = 'flex';
            const rUsd = getRate('tick-usd'), rEur = getRate('tick-eur'), rUsdt = getRate('tick-usdt');
            let rate = rUsd; if (ref === 'EUR') rate = rEur; else if (ref === 'USDT') rate = rUsdt;
            const usdEq = rate > 0 ? amt / rate : 0;
            $('cxc-pay-preview-usd').innerText = '$' + usdEq.toFixed(2);
        }
    };
    window.processCxCPayment = function () {
        try {
            const id = parseInt($('cxc-pay-id').value), cur = $('cxc-pay-cur').value, amt = parseFloat($('cxc-pay-amount').value) || 0;
            const ref = $('cxc-pay-ref').value;
            const meth = cur === 'USD' ? $('cxc-pay-usd-meth').value : ($('cxc-pay-bs-meth').value + ' (' + ref + ')');
            if (amt <= 0) return showBlockingAlert('Error', 'El monto debe ser mayor a cero.');
            let usdEq = amt;
            if (cur === 'BS') { const rUsd = getRate('tick-usd'), rEur = getRate('tick-eur'), rUsdt = getRate('tick-usdt'); let rate = rUsd; if (ref === 'EUR') rate = rEur; else if (ref === 'USDT') rate = rUsdt; usdEq = amt / rate; }
            const r = appData.bizReceivables.find(x => x.id === id); if (!r) return;
            const rem = r.total - r.paid; if (usdEq > rem) usdEq = rem;
            r.paid += usdEq; if (!r.payments) r.payments = []; r.payments.push({ amount: usdEq, method: meth, date: new Date().toISOString() });
            if (r.paid >= r.total - 0.01) { r.completed = true; if (typeof showToast === 'function') showToast('success', 'Éxito', `Cuenta de ${r.name} saldada.`); }
            else { if (typeof showToast === 'function') showToast('success', 'Abono', `Se abonaron $${usdEq.toFixed(2)} a ${r.name}`); }
            $('cxc-payment-modal').classList.add('hidden');
            if (typeof save === 'function') save(); renderCxC(); renderInventory();
        } catch (e) { console.error(e); }
    };
    window.deleteCxC = function (id) {
        openCustomConfirm('Eliminar Cuenta', '¿Eliminar esta cuenta? No restaurará el inventario.', () => {
            try { appData.bizReceivables = appData.bizReceivables.filter(r => r.id !== id); if (typeof save === 'function') save(); renderCxC(); renderInventory(); } catch (e) { }
        });
    };
    window.renderCxC = function () {
        ensurePhase2Data();
        const cm = typeof currM !== 'undefined' ? currM : new Date().getMonth();
        $('cxc-container').innerHTML = appData.bizReceivables.filter(r => !r.completed || (r.completed && r.startMonth === cm)).map(r => {
            const progress = Math.min(100, (r.paid / r.total) * 100), isDone = r.completed, colorCls = isDone ? 'emerald' : 'amber';
            const paymentsMade = r.payments ? r.payments.length : 0, nextDate = isDone ? '--' : getNextPaymentDateStr(r.startDate, r.frequency, paymentsMade);
            const pbColor = isDone ? 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.8)]' : 'theme-bg-gradient shadow-[0_0_10px_var(--t-primary)]';
            return `<div class="glass-card p-5 relative flex flex-col justify-between border border-white/10 hover:border-${colorCls}-500/25 transition-colors">
                <div class="mb-3 flex justify-between items-start gap-2">
                    <div class="min-w-0 flex-1">
                        <span class="text-[9px] font-bold uppercase tracking-wider text-${colorCls}-400">CxC · ${r.frequency || 'mensual'}</span>
                        <h3 class="font-bold text-white text-sm truncate">${r.name}</h3>
                        <p class="text-[10px] text-gray-400 mt-0.5">${r.desc || ''}</p>
                    </div>
                    <button onclick="deleteCxC(${r.id})" class="text-gray-500 hover:text-red-400 transition bg-white/5 px-2 py-1 rounded shadow-inner"><i class="fa-solid fa-trash text-[10px]"></i></button>
                </div>
                <div class="rounded p-3 border border-${colorCls}-500/20 mb-3 bg-${colorCls}-900/10">
                    <div class="flex justify-between items-end mb-1"><p class="text-[10px] text-${colorCls}-300 uppercase font-bold">Saldo Pendiente</p><p class="text-lg font-extrabold text-white leading-none">$${(r.total - r.paid).toFixed(2)}</p></div>
                    <div class="flex justify-between items-center text-[9px] text-gray-300 border-t border-${colorCls}-500/10 pt-2 mt-1">
                        <span>Total: $${r.total.toFixed(2)}</span><span>Pagado: $${r.paid.toFixed(2)}</span><span class="font-bold text-${colorCls}-300">${progress.toFixed(0)}%</span>
                    </div>
                </div>
                <div class="progress-bar-bg mb-3"><div class="progress-bar-fill ${pbColor}" style="width:${progress}%"></div></div>
                ${!isDone ? `<div class="flex justify-between items-center border-t border-white/10 pt-2"><span class="text-[9px] text-gray-400">Próx: <span class="font-bold text-white">${nextDate}</span></span><button onclick="openCxCPaymentModal(${r.id})" class="btn-float py-1.5 px-3 rounded-lg bg-${colorCls}-500/20 text-${colorCls}-300 text-[10px] font-bold shadow-lg border border-${colorCls}-500/30"><i class="fa-solid fa-hand-holding-dollar mr-1"></i>Cobrar</button></div>` : `<div class="text-center text-[10px] font-bold text-emerald-400 border-t border-white/10 pt-2"><i class="fa-solid fa-check-double mr-1"></i>Cuenta Saldada</div>`}
            </div>`;
        }).join('') || `<div class="col-span-full text-center py-10 text-gray-500 text-xs italic">No hay cuentas por cobrar.</div>`;
    };

    /* ──────────────────────────────────────────────
       BLOQUE 7: Caja
    ────────────────────────────────────────────── */

    window.renderCaja = function () {
        ensurePhase2Data();
        const cm = typeof currM !== 'undefined' ? currM : new Date().getMonth();
        const rUsd = getRate('tick-usd') || 1;
        const fxBs = Number(appData?.fx?.bs) > 0 ? Number(appData.fx.bs) : rUsd;
        let totalUSD = 0;
        const methods = {};
        (Array.isArray(appData.bizSales) ? appData.bizSales : []).filter(s => s && s.month === cm).forEach(s => {
            const qty = s.qty || 1, raw = (s.price || 0) * qty, amountUSD = raw;
            totalUSD += amountUSD;
            const m = (s.method || 'Otros').split(' (')[0];
            if (!methods[m]) methods[m] = { total: 0, items: [] };
            methods[m].total += amountUSD;
            methods[m].items.push({ date: new Date(s.id).toLocaleString(), amountUSD, amountBS: amountUSD * fxBs, raw, currency: (s.currency || 'USD').toUpperCase(), desc: s.itemName || s.name || 'Venta', method: m });
        });
        const usdEl = $('caja-balance-usd'); if (usdEl) usdEl.innerText = '$' + totalUSD.toFixed(2);
        const bsEl = $('caja-balance-bs'); if (bsEl) bsEl.innerText = 'Bs ' + (totalUSD * fxBs).toFixed(2);
        const mcEl = $('caja-method-count'); if (mcEl) mcEl.innerText = Object.keys(methods).length;
        const tcEl = $('caja-trans-count'); if (tcEl) tcEl.innerText = Object.values(methods).reduce((a, v) => a + v.items.length, 0);
        const grid = $('cash-methods-grid');
        if (grid) {
            if (Object.keys(methods).length === 0) { grid.innerHTML = `<div class="col-span-full text-center py-8 text-slate-400 italic">No hay movimientos para el mes seleccionado.</div>`; }
            else {
                grid.innerHTML = Object.entries(methods).map(([k, v]) => `
                    <button type="button" class="glass-card p-4 relative flex flex-col justify-between hover:border-sky-500/30 transition-colors group cash-method-card border border-white/10 text-left" data-method="${k}">
                        <div class="mb-3 relative z-20 flex justify-between items-start gap-2 pt-1">
                            <div class="min-w-0 flex-1 flex flex-col items-start gap-1">
                                <span class="text-[9px] font-bold uppercase tracking-wider text-sky-400">Método de Pago</span>
                                <h3 class="font-bold text-white text-sm truncate w-full text-left">${k}</h3>
                            </div>
                            <i class="fa-solid fa-chevron-right text-gray-400 group-hover:text-sky-400 transition text-xs mt-1"></i>
                        </div>
                        <div class="bg-sky-900/10 rounded p-3 border border-sky-500/20 mb-3">
                            <div class="flex justify-between items-end mb-1"><p class="text-[10px] text-sky-300 uppercase font-bold">Venta USD</p><p class="text-lg font-extrabold text-white leading-none">$${v.total.toFixed(2)}</p></div>
                            <div class="flex flex-col gap-1 text-[9px] text-gray-300 border-t border-sky-500/10 pt-2 mt-2">
                                <div class="flex justify-between"><span>Bs (FX):</span><span class="font-bold text-sky-200">Bs ${(v.total * fxBs).toFixed(2)}</span></div>
                                <div class="flex justify-between"><span>Movimientos:</span><span class="font-bold text-emerald-300">${v.items.length}</span></div>
                            </div>
                        </div>
                    </button>`).join('');
                document.querySelectorAll('.cash-method-card').forEach(card => {
                    card.onclick = () => openCajaDetail(card.getAttribute('data-method') || '', methods, fxBs);
                });
            }
        }
        window.__cajaMethodsData = methods;
        closeCajaDetail(true);
    };

    window.openCajaDetail = function (methodName, methodsMap, fxBs) {
        const data = methodsMap && methodsMap[methodName] ? methodsMap[methodName] : null;
        const viewEl = $('caja-detail-view'), panelEl = $('caja-detail-panel');
        const titleEl = $('caja-detail-title'), subEl = $('caja-detail-sub'), bodyEl = $('caja-detail-body');
        const searchEl = $('caja-history-search');
        if (!viewEl || !panelEl || !titleEl || !subEl || !bodyEl || !data) return;
        const items = Array.isArray(data.items) ? [...data.items].sort((a, b) => new Date(b.date) - new Date(a.date)) : [];
        window.__cajaDetailItems = items;
        titleEl.innerHTML = `<i class="fa-solid fa-clock-rotate-left text-sky-400"></i> Historial detallado - ${methodName}`;
        subEl.innerText = `${items.length} movimiento(s) • Total USD: $${data.total.toFixed(2)} • Bs ${(data.total * fxBs).toFixed(2)}`;
        if (searchEl) searchEl.value = '';
        renderCajaDetailItems(items);
        const dashEl = $('caja-dashboard-view'); if (dashEl) dashEl.classList.add('hidden');
        viewEl.classList.remove('hidden');
        requestAnimationFrame(() => { panelEl.classList.remove('translate-y-6'); });
    };
    window.renderCajaDetailItems = function (items) {
        const bodyEl = $('caja-detail-body'); if (!bodyEl) return;
        if (!Array.isArray(items) || items.length === 0) { bodyEl.innerHTML = `<div class="text-sm text-slate-400 italic text-center py-8">No se encontraron movimientos.</div>`; return; }
        bodyEl.innerHTML = items.map(it => `
            <div class="glass-card w-full rounded-xl border border-white/10 p-5 flex items-start justify-between gap-3">
                <div class="min-w-0"><p class="text-sm font-semibold text-white truncate">${it.desc || 'Venta'}</p><p class="text-[11px] text-white/50 mt-1">${it.date} &bull; ${it.method || ''} &bull; ${it.currency}</p></div>
                <div class="text-right shrink-0"><p class="text-xl font-extrabold text-white leading-none">$${Number(it.amountUSD || 0).toFixed(2)}</p><p class="text-[10px] font-bold mt-1 text-sky-400">Bs ${Number(it.amountBS || 0).toFixed(2)}</p></div>
            </div>`).join('');
    };
    window.filterCajaDetail = function () {
        const searchEl = $('caja-history-search');
        const q = (searchEl && searchEl.value ? searchEl.value : '').trim().toLowerCase();
        const all = Array.isArray(window.__cajaDetailItems) ? window.__cajaDetailItems : [];
        if (!q) return renderCajaDetailItems(all);
        renderCajaDetailItems(all.filter(it => `${it.desc || ''} ${it.date || ''} ${it.currency || ''} ${it.method || ''}`.toLowerCase().includes(q)));
    };
    window.closeCajaDetail = function (immediate) {
        const viewEl = $('caja-detail-view'), panelEl = $('caja-detail-panel'), dashEl = $('caja-dashboard-view');
        if (!viewEl || !panelEl) return;
        const hide = () => { viewEl.classList.add('hidden'); if (dashEl) dashEl.classList.remove('hidden'); };
        panelEl.classList.add('translate-y-6');
        if (immediate) hide(); else setTimeout(hide, 200);
    };
    window.renderCashOverview = function () {
        ensurePhase2Data();
        const cm = typeof currM !== 'undefined' ? currM : new Date().getMonth();
        const methods = {};
        appData.bizSales.filter(s => s.month === cm).forEach(s => { const m = (s.method || '').split(' (')[0]; methods[m] = (methods[m] || 0) + (s.price * (s.qty || 1)); });
        const container = $('cash-methods-container'); if (!container) return;
        container.innerHTML = Object.keys(methods).length === 0 ? `<div class="col-span-full text-center py-10 text-gray-500 text-xs italic">No hay movimientos registrados.</div>` : Object.entries(methods).map(([k, v]) => `
            <div class="glass-card p-4 relative transition-all overflow-hidden cash-item" onclick="this.classList.toggle('expanded')">
                <div class="flex justify-between items-center mb-2"><h3 class="font-bold text-white text-sm">${k}</h3><span class="font-extrabold text-white">$${v.toFixed(2)}</span></div>
                <div class="cash-details max-h-0 overflow-hidden transition-all duration-400">
                    ${appData.bizSales.filter(s => (s.method || '').split(' (')[0] === k && s.month === cm).map(s => `<div class="text-[12px] text-gray-300 flex justify-between py-1"><span>${new Date(s.id).toLocaleDateString()}</span><span>$${(s.price * (s.qty || 1)).toFixed(2)}</span></div>`).join('')}
                </div>
            </div>`).join('');
    };
    window.renderAdvancedAnalysis = function () {
        window.calculateAdvancedAnalytics();
    };

    window.calculateAdvancedAnalytics = function() {
        window.ensurePhase2Data();

        const currentMonth = typeof window.currM !== 'undefined' ? window.currM : new Date().getMonth();
        const currentYear = window.appData && window.appData.year ? window.appData.year : new Date().getFullYear();

        let utilidadNeta = 0;
        let costoTotalVendido = 0;
        let ingresosTotales = 0;
        let balanceCaja = 0;

        let incomesByMonth = new Array(12).fill(0);
        let expensesByMonth = new Array(12).fill(0);
        let catSales = {};
        
        let qtyVendidosMap = {}; 
        let totalDiasRotacion = 0;
        let totalItemsVendidos = 0;

        const parseSaleDateStrict = (dateStr, idTs) => {
            if (dateStr) {
                if (dateStr.includes('/')) {
                    const [d, m, y] = dateStr.split('/');
                    return { m: parseInt(m, 10) - 1, y: parseInt(y, 10), ts: new Date(y, m - 1, d).getTime() };
                } else if (dateStr.includes('-')) {
                    const parts = dateStr.split('-');
                    if (parts.length === 3) {
                        return { m: parseInt(parts[1], 10) - 1, y: parseInt(parts[0], 10), ts: new Date(parts[0], parts[1] - 1, parts[2]).getTime() };
                    }
                }
            }
            const dObj = new Date(idTs || Date.now());
            return { m: dObj.getMonth(), y: dObj.getFullYear(), ts: dObj.getTime() };
        };

        if (window.appData && Array.isArray(window.appData.bizSales)) {
            window.appData.bizSales.forEach(sale => {
                // Prioridad 1: campo 'month' explícito (como lo almacena EQUO)
                // Prioridad 2: campo 'date' string, Prioridad 3: timestamp del id
                let sMonth, sYear, sTs;
                if (typeof sale.month === 'number') {
                    sMonth = sale.month;
                    sYear  = (sale.id > 946684800000) ? new Date(sale.id).getFullYear() : currentYear;
                    sTs    = sale.id || Date.now();
                } else {
                    const sInfo = parseSaleDateStrict(sale.date, sale.id);
                    sMonth = sInfo.m; sYear = sInfo.y; sTs = sInfo.ts;
                }

                let priceItem = parseFloat(sale.price || 0);
                let qty       = parseFloat(sale.qty   || 1);
                let totalUSD  = priceItem * qty;

                const cur = (sale.currency || '').toUpperCase();
                if (cur === 'BS' || cur === 'BS.') {
                    const rate = parseFloat(sale.rate || (window.fx && window.fx.usd_bcv ? window.fx.usd_bcv : 1));
                    totalUSD = totalUSD / (rate > 0 ? rate : 1);
                }

                if (sYear === currentYear) {
                    let costoItem = 0, category = 'General';
                    if (Array.isArray(window.appData.inventory)) {
                        let invItem = window.appData.inventory.find(i => String(i.id) === String(sale.itemId));
                        if (!invItem && sale.name) {
                            const lname = String(sale.name).trim().toLowerCase();
                            invItem = window.appData.inventory.find(i => String(i.name).trim().toLowerCase() === lname);
                        }
                        if (invItem) {
                            costoItem = parseFloat(invItem.cost || 0);
                            category  = invItem.category || 'General';
                            qtyVendidosMap[String(invItem.id)] = (qtyVendidosMap[String(invItem.id)] || 0) + qty;

                            // ── Rotación Dinámica: reinicio de ciclo desde la última reposición ──
                            // Helper robusto: Firestore Timestamp (.toDate()), {seconds}, ISO, ms
                            const toJsTs = (v) => {
                                if (!v) return null;
                                try {
                                    if (typeof v === 'object' && typeof v.toDate === 'function') return v.toDate().getTime();
                                    if (typeof v === 'object' && typeof v.seconds === 'number') return v.seconds * 1000;
                                    const d = new Date(v); return isNaN(d.getTime()) ? null : d.getTime();
                                } catch(e) { return null; }
                            };
                            // Regla: si hay ultima_reposicion, los días se cuentan DESDE ESA FECHA
                            // Esto asegura que la rotación refleja la mercancía más reciente
                            const entradaTs = toJsTs(invItem.ultima_reposicion)
                                           || toJsTs(invItem.fecha_entrada)
                                           || (invItem.id > 946684800000 ? invItem.id : null);
                            if (entradaTs && sTs > entradaTs) {
                                const dias = (sTs - entradaTs) / 86400000;
                                if (dias > 0) { totalDiasRotacion += dias * qty; totalItemsVendidos += qty; }
                            }
                        } else {
                            costoItem = parseFloat(sale.cost || 0);
                        }
                    }

                    const costoVentaUSD = costoItem * qty;
                    incomesByMonth[sMonth]  += totalUSD;
                    expensesByMonth[sMonth] += costoVentaUSD;

                    if (sMonth === currentMonth) {
                        ingresosTotales   += totalUSD;
                        costoTotalVendido += costoVentaUSD;
                        utilidadNeta      += (totalUSD - costoVentaUSD);
                        catSales[category] = (catSales[category] || 0) + totalUSD;
                        balanceCaja       += totalUSD;
                    }
                }
            });
        }

        // ── Análisis de Riesgo (Préstamos) — Motor Dinámico de Fechas ────────
        //
        // fechaReferencia = último instante del mes seleccionado en el dashboard.
        // Ejemplo: usuario selecciona "Abril 2026" → ref = 2026-04-30 23:59:59.999
        // Esto hace que la mora sea sensible al calendario del dashboard.
        const diasEnMes = new Date(currentYear, currentMonth + 1, 0).getDate();
        const fechaReferencia = new Date(currentYear, currentMonth, diasEnMes, 23, 59, 59, 999);
        const fechaRef32D    = new Date(fechaReferencia.getTime() + 32 * 86400000); // +32 días

        // Helper: parsea 'DD/MM/YYYY' | 'YYYY-MM-DD' | ISO → Date (o null)
        const parseCuotaFecha = (str) => {
            if (!str) return null;
            try {
                const s = String(str).trim();
                if (s.indexOf('/') !== -1) {
                    const [d, m, y] = s.split('/');
                    const dt = new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10), 12);
                    return isNaN(dt.getTime()) ? null : dt;
                }
                if (s.indexOf('-') !== -1) {
                    const [y, m, d] = s.split('-');
                    const dt = new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10), 12);
                    return isNaN(dt.getTime()) ? null : dt;
                }
            } catch(e) {}
            return null;
        };

        let totalCapitalActivo   = 0;   // Saldo capital de préstamos activos
        let totalCapitalPrestado = 0;   // Capital original de préstamos activos
        let totalAbonosCapital   = 0;   // Capital total cobrado en abonos (todos los préstamos)
        let capitalEnMora        = 0;   // Suma del capital de cuotas vencidas no pagadas
        let interesProyectado30D = 0;   // Interés de la próxima cuota a cobrar (≤ 32 días)
        let prestamosActivos     = 0;   // Cantidad de préstamos activos
        let prestamosConMora     = 0;   // Préstamos con al menos una cuota vencida no pagada

        // Tasa de cambio para conversiones BS → USD
        const fxRate = (window.fx && window.fx.usd_bcv > 0) ? window.fx.usd_bcv : 1;

        if (Array.isArray(window.appData.prestamos)) {
            window.appData.prestamos.forEach(p => {
                const esFin         = p.estado === 'Finalizado' || p.estado === 'Pagado';
                const montoOriginal = parseFloat(p.montoCapital || p.capital || 0);
                const saldoActual   = parseFloat(p.saldoCapital  || 0);

                // ① Acumular abonos de TODOS los préstamos (incluyendo finalizados)
                (p.abonos || []).forEach(ab => {
                    totalAbonosCapital += parseFloat(ab.capitalAbonado || 0);
                });

                if (esFin) return; // Finalizado: no suma a activos ni mora

                prestamosActivos++;
                totalCapitalActivo   += saldoActual;
                totalCapitalPrestado += montoOriginal;

                // ② Mora Dinámica: recorre p.plan[] buscando cuotas vencidas no pagadas
                //    Condición: cuota.pagada === false && fechaCuota < fechaReferencia
                const planActivo = Array.isArray(p.plan) && p.plan.length > 0
                    ? p.plan
                    : (typeof window.calcularPlanPagos === 'function' ? window.calcularPlanPagos(p) : []);

                let tieneMora = false;
                let proximaCuotaInteresContada = false; // solo sumar 1 cuota de interés por préstamo

                planActivo.forEach(cuota => {
                    const fCuota = parseCuotaFecha(cuota.fecha);
                    const esPagada = cuota.pagado === true || cuota.pagada === true;

                    if (!esPagada && fCuota && fCuota < fechaReferencia) {
                        // Cuota vencida no pagada → mora
                        capitalEnMora += parseFloat(cuota.capital || 0);
                        tieneMora = true;
                    }

                    // ③ Proyección de interés: primera cuota no pagada dentro de +32D
                    if (!esPagada && !proximaCuotaInteresContada && fCuota
                        && fCuota >= fechaReferencia && fCuota <= fechaRef32D) {
                        interesProyectado30D += parseFloat(cuota.interes || 0);
                        proximaCuotaInteresContada = true;
                    }
                });

                // Fallback: si el préstamo no tiene plan con fechas, usar tasa mensual sobre saldo
                if (planActivo.length === 0 || planActivo.every(c => !c.fecha)) {
                    const tasaMensual = window.prestamoPeriodRate
                        ? window.prestamoPeriodRate(p.tasaInteres || 0, 'mensual', p.tasaFrecuencia || 'anual')
                        : parseFloat(p.tasaInteres || 0) / 100 / 12;
                    interesProyectado30D += parseFloat((saldoActual * tasaMensual).toFixed(4));
                    // Fallback mora: usar campo estado si no hay plan de fechas
                    if (String(p.estado || '').trim() === 'Mora') tieneMora = true;
                }

                if (tieneMora) prestamosConMora++;
            });
        }

        // ── KPIs de Riesgo finales ─────────────────────────────────────────────
        // Índice de Mora: monto de capital vencido no pagado (en USD)
        // Si capitalEnMora > 0 también calculamos el % de préstamos afectados como señal de alerta
        const indiceMora = prestamosActivos > 0
            ? parseFloat(((prestamosConMora / prestamosActivos) * 100).toFixed(2))
            : 0;

        // Tasa de Recuperación: cuánto del capital prestado ha regresado a mano
        const tasaRecuperacion = totalCapitalPrestado > 0
            ? parseFloat((Math.min((totalAbonosCapital / totalCapitalPrestado) * 100, 100)).toFixed(2))
            : 0;

        // ── Balance de Caja Total (Dinero en Mano del mes) ─────────────────────
        // balanceCaja ya tiene las ventas del mes acumuladas en el loop de bizSales
        // Agregar: abonos de préstamos del mes + abonos de encargos del mes

        // Helper local para parsear fecha de abono (DD/MM/YYYY | YYYY-MM-DD | ISO)
        const parseAbonFecha = (f) => {
            if (!f) return null;
            if (typeof f === 'number') { const d = new Date(f); return isNaN(d) ? null : d; }
            const s = String(f).trim();
            if (s.indexOf('/') !== -1) {
                const pts = s.split('/');
                if (pts.length === 3) {
                    const d = new Date(parseInt(pts[2],10), parseInt(pts[1],10)-1, parseInt(pts[0],10));
                    return isNaN(d) ? null : d;
                }
            }
            if (s.length >= 10 && s.indexOf('-') !== -1) {
                const d = new Date(parseInt(s.slice(0,4),10), parseInt(s.slice(5,7),10)-1, parseInt(s.slice(8,10),10));
                return isNaN(d) ? null : d;
            }
            return null;
        };

        // Abonos de préstamos del mes
        if (Array.isArray(window.appData.prestamos)) {
            window.appData.prestamos.forEach(p => {
                (p.abonos || []).forEach(ab => {
                    const abDate = parseAbonFecha(ab.fecha);
                    if (!abDate) return;
                    if (abDate.getMonth() !== currentMonth || abDate.getFullYear() !== currentYear) return;
                    let monto = parseFloat(ab.monto || 0);
                    // .toUpperCase() para no ignorar registros con 'bs', 'Bs', 'USD', 'usd'
                    const cur = (ab.currency || 'USD').toUpperCase().trim();
                    if (cur === 'BS' || cur === 'BS.' || cur === 'BsF') monto = monto / (fxRate > 0 ? fxRate : 1);
                    balanceCaja += monto;
                });
            });
        }

        // Abonos de encargos del mes
        if (Array.isArray(window.appData.encargos)) {
            window.appData.encargos.forEach(enc => {
                (enc.pagos || enc.abonos || []).forEach(pg => {
                    const pgDate = parseAbonFecha(pg.fecha);
                    if (!pgDate) return;
                    if (pgDate.getMonth() !== currentMonth || pgDate.getFullYear() !== currentYear) return;
                    let monto = parseFloat(pg.monto || pg.amount || 0);
                    const cur = (pg.currency || 'USD').toUpperCase().trim();
                    if (cur === 'BS' || cur === 'BS.' || cur === 'BsF') monto = monto / (fxRate > 0 ? fxRate : 1);
                    balanceCaja += monto;
                });
            });
        }

        // ── KPIs de Inventario y Rendimiento ──────────────────────────────────
        const roi              = costoTotalVendido > 0 ? (ingresosTotales / costoTotalVendido) * 100 : 0;
        const dineroEstancado  = (window.appData.inventory || []).reduce((acc, inv) => {
            if (!inv.id || inv.id <= 946684800000) return acc;
            if (parseFloat(inv.stock || 0) <= 0) return acc; // ignorar sin stock

            // ── Dinero Estancado: prioriza ultima_reposicion para reinicio de ciclo ──
            // Helper robusto: Firestore Timestamp (.toDate()), {seconds}, ISO string o ms
            const toJsDate = (v) => {
                if (!v) return null;
                try {
                    if (typeof v === 'object' && typeof v.toDate === 'function') return v.toDate();
                    if (typeof v === 'object' && typeof v.seconds === 'number') return new Date(v.seconds * 1000);
                    const d = new Date(v); return isNaN(d.getTime()) ? null : d;
                } catch(e) { return null; }
            };

            // Regla: si existe ultima_reposicion, los días se cuentan DESDE ESA FECHA
            // Si no, se usa fecha_entrada; solo como último recurso se usa el id
            const refDate = toJsDate(inv.ultima_reposicion)
                         || toJsDate(inv.fecha_entrada)
                         || new Date(inv.id);

            if (!refDate || isNaN(refDate.getTime())) return acc; // guardia anti-NaN

            // invFechaRef: primer día del mes seleccionado (inventario usa inicio de mes)
            const invFechaRef = new Date(currentYear, currentMonth, 1);
            const diasDesdeEntrada = (invFechaRef.getTime() - refDate.getTime()) / 86400000;

            return diasDesdeEntrada > 30
                ? acc + parseFloat(inv.cost || 0) * parseFloat(inv.stock)
                : acc;
        }, 0);
        const encargosPendientes = (window.appData.encargos || []).reduce(
            (acc, e) => e.estado !== 'Entregado' ? acc + parseFloat(e.saldo || 0) : acc, 0
        );
        const promedioRotacion = totalItemsVendidos > 0 ? totalDiasRotacion / totalItemsVendidos : 0;

        // Helper anti-NaN: formatea número a 2 decimales, muestra '0.00' si no es número
        const fmt2 = v => (isNaN(v) || v === null || v === undefined) ? '0.00' : parseFloat(v).toFixed(2);
        const fmt1 = v => (isNaN(v) || v === null || v === undefined) ? '0.0'  : parseFloat(v).toFixed(1);

        // ── Inyección DOM — métricas superiores ────────────────────────────────
        if ($('adv-metric-utilidad')) $('adv-metric-utilidad').innerText = '$' + fmt2(utilidadNeta);
        if ($('adv-metric-flujo'))    $('adv-metric-flujo').innerText    = '$' + fmt2(totalCapitalActivo + encargosPendientes);
        if ($('adv-metric-roi'))      $('adv-metric-roi').innerText      = fmt1(roi) + '%';

        // ── Inyección DOM — métricas de riesgo ─────────────────────────────────
        if ($('ana-balance'))      $('ana-balance').innerText      = '$' + fmt2(balanceCaja);
        // ana-mora: monto en USD de capital en mora + % de préstamos afectados
        if ($('ana-mora')) {
            if (capitalEnMora > 0) {
                $('ana-mora').innerText = '$' + fmt2(capitalEnMora);
            } else {
                $('ana-mora').innerText = fmt1(indiceMora) + '%';
            }
        }
        if ($('ana-intereses'))    $('ana-intereses').innerText    = '$' + fmt2(interesProyectado30D);
        if ($('ana-recuperacion')) $('ana-recuperacion').innerText = fmt1(tasaRecuperacion) + '%';

        // ── Inyección DOM — inteligencia de inventario ─────────────────────────
        if ($('ana-rotacion'))  $('ana-rotacion').innerText  = Math.round(isNaN(promedioRotacion) ? 0 : promedioRotacion) + ' Días';
        if ($('ana-estancado')) $('ana-estancado').innerText = '$' + fmt2(dineroEstancado);

        // ── Dots de alerta semafórica — Mora (sensible al capital vencido) ──────
        const dotMora = $('adv-metric-mora-dot');
        if (dotMora) {
            dotMora.className = 'w-2.5 h-2.5 rounded-full animate-pulse';
            // Verde: sin mora | Ambar: mora < $100 o < 15% préstamos | Rojo: mora crítica
            if      (capitalEnMora === 0 && indiceMora < 5)   { dotMora.classList.add('bg-emerald-500'); dotMora.style.boxShadow = '0 0 8px rgba(16,185,129,0.8)'; }
            else if (capitalEnMora < 100 || indiceMora <= 15) { dotMora.classList.add('bg-amber-500');   dotMora.style.boxShadow = '0 0 8px rgba(245,158,11,0.8)'; }
            else                                              { dotMora.classList.add('bg-rose-500');    dotMora.style.boxShadow = '0 0 8px rgba(244,63,94,0.8)'; }
        }

        // ── Dots de alerta semafórica — Estancado ──────────────────────────────
        const dotEst = $('adv-metric-estancado-dot');
        if (dotEst) {
            dotEst.className = 'w-2.5 h-2.5 rounded-full animate-pulse';
            if      (dineroEstancado === 0)  { dotEst.classList.add('bg-emerald-500'); dotEst.style.boxShadow = '0 0 8px rgba(16,185,129,0.8)'; }
            else if (dineroEstancado < 500)  { dotEst.classList.add('bg-amber-500');   dotEst.style.boxShadow = '0 0 8px rgba(245,158,11,0.8)'; }
            else                             { dotEst.classList.add('bg-rose-500');    dotEst.style.boxShadow = '0 0 8px rgba(244,63,94,0.8)'; }
        }

        // ── Top 5 — Más Vendidos ────────────────────────────────────────────────
        const cV = $('adv-top-vendidos');
        if (cV) {
            const arrVendidos = Object.entries(qtyVendidosMap)
                .map(([idStr, qty]) => {
                    const inv = (window.appData.inventory || []).find(x => String(x.id) === idStr);
                    return { name: inv ? inv.name : 'Descatalogado', qty: parseFloat(qty) };
                })
                .filter(x => x.qty > 0)
                .sort((a, b) => b.qty - a.qty)
                .slice(0, 5);
            const maxQty = arrVendidos.length > 0 ? arrVendidos[0].qty : 1;
            cV.innerHTML = arrVendidos.length > 0
                ? arrVendidos.map((it, i) => {
                    const pct = Math.round((it.qty / maxQty) * 100);
                    const colors = ['#38bdf8','#10b981','#f59e0b','#8b5cf6','#f43f5e'];
                    const col = colors[i % colors.length];
                    return `<div class="flex flex-col gap-1 py-1.5 border-b border-white/5 last:border-0">
                        <div class="flex justify-between items-center">
                            <span class="text-[11px] text-gray-200 truncate max-w-[70%]">${it.name}</span>
                            <span class="text-[10px] font-bold px-2 py-0.5 rounded" style="background:${col}22;color:${col}">${it.qty} u</span>
                        </div>
                        <div class="w-full bg-white/5 rounded-full h-1.5 overflow-hidden">
                            <div class="h-full rounded-full transition-all duration-700" style="width:${pct}%;background:${col};box-shadow:0 0 6px ${col}88"></div>
                        </div>
                    </div>`;
                }).join('')
                : '<p class="text-xs text-gray-500 italic text-center py-3">Sin ventas registradas.</p>';
        }

        // ── Top 5 — Mayor Margen ────────────────────────────────────────────────
        const cM = $('adv-top-margen');
        if (cM) {
            const invConMargen = (window.appData.inventory || [])
                .filter(inv => parseFloat(inv.cost || 0) > 0 && parseFloat(inv.price || 0) > 0)
                .map(inv => {
                    const c = parseFloat(inv.cost), p = parseFloat(inv.price);
                    const margin = ((p - c) / c) * 100;
                    return { name: inv.name || 'Sin nombre', margin };
                })
                .sort((a, b) => b.margin - a.margin)
                .slice(0, 5);
            const maxMargin = invConMargen.length > 0 ? invConMargen[0].margin : 1;
            cM.innerHTML = invConMargen.length > 0
                ? invConMargen.map((it, i) => {
                    const pct = Math.round((it.margin / (maxMargin || 1)) * 100);
                    const col = it.margin >= 50 ? '#10b981' : it.margin >= 20 ? '#f59e0b' : '#f43f5e';
                    return `<div class="flex flex-col gap-1 py-1.5 border-b border-white/5 last:border-0">
                        <div class="flex justify-between items-center">
                            <span class="text-[11px] text-gray-200 truncate max-w-[70%]">${it.name}</span>
                            <span class="text-[10px] font-bold px-2 py-0.5 rounded" style="background:${col}22;color:${col}">${it.margin.toFixed(0)}%</span>
                        </div>
                        <div class="w-full bg-white/5 rounded-full h-1.5 overflow-hidden">
                            <div class="h-full rounded-full transition-all duration-700" style="width:${pct}%;background:${col};box-shadow:0 0 6px ${col}88"></div>
                        </div>
                    </div>`;
                }).join('')
                : '<p class="text-xs text-gray-500 italic text-center py-3">Sin datos de margen.</p>';
        }

        if (typeof window.renderAdvancedCharts === 'function') {
            window.renderAdvancedCharts(incomesByMonth, expensesByMonth, catSales);
        }
    };



    window.renderAdvancedCharts = function(incomesByMonth, expensesByMonth, catSales) {
        // Esta función es ahora sólo un alias: la implementación real está en la definición
        // anterior (línea ~1460). Esta declaración sobrescribe correctamente.
        if (!window.Chart) return;
        const catLabels = Object.keys(catSales || {});
        const catData   = Object.values(catSales || {});
        const ctxFlujo = document.getElementById('adv-chart-flujo');
        if (ctxFlujo) {
            if (window.advChartFlujo) { try { window.advChartFlujo.destroy(); } catch(e){} window.advChartFlujo = null; }
            window.advChartFlujo = new Chart(ctxFlujo.getContext('2d'), {
                type: 'bar',
                data: {
                    labels: ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'],
                    datasets: [
                        { label: 'Ingresos',    data: incomesByMonth,  backgroundColor: 'rgba(56,189,248,0.75)', borderRadius: 5 },
                        { label: 'Costo/Gasto', data: expensesByMonth, backgroundColor: 'rgba(244,63,94,0.65)',  borderRadius: 5 }
                    ]
                },
                options: {
                    responsive: true, maintainAspectRatio: false, animation: { duration: 600 },
                    plugins: { legend: { labels: { color: '#cbd5e1', font: { family: 'Outfit', size: 11 } } } },
                    scales: {
                        y: { ticks: { color: '#94a3b8', font: { family: 'Outfit' } }, grid: { color: 'rgba(255,255,255,0.05)' } },
                        x: { ticks: { color: '#94a3b8', font: { family: 'Outfit' } }, grid: { display: false } }
                    }
                }
            });
        }
        const ctxDist = document.getElementById('adv-chart-distribucion');
        if (ctxDist) {
            if (window.advChartDist) { try { window.advChartDist.destroy(); } catch(e){} window.advChartDist = null; }
            window.advChartDist = new Chart(ctxDist.getContext('2d'), {
                type: 'doughnut',
                data: {
                    labels: catLabels.length > 0 ? catLabels : ['Sin ventas'],
                    datasets: [{ data: catData.length > 0 ? catData : [1], backgroundColor: ['#38bdf8','#10b981','#f43f5e','#f59e0b','#8b5cf6','#ec4899','#14b8a6'], borderWidth: 0, hoverOffset: 8 }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false, animation: { duration: 600 },
                    plugins: { legend: { position: 'right', labels: { color: '#cbd5e1', font: { family: 'Outfit', size: 11 }, boxWidth: 12 } } },
                    cutout: '72%'
                }
            });
        }
    };

    /* ──────────────────────────────────────────────
       BLOQUE 8: Préstamos
    ────────────────────────────────────────────── */

    let _prestamoWaContext = { loanId: null, abonoId: null };

    window.prestamosPeriodsPerYear = function (freq) {
        if (freq === 'diario') return 365;
        if (freq === 'semanal') return 52;
        if (freq === 'anual') return 1;
        return 12; // mensual
    };

    window.prestamoPeriodRate = function (tasaInteres, frecuenciaPago, tasaFrecuencia) {
        const R = parseFloat((Number(tasaInteres) || 0) / 100);
        const ppY = window.prestamosPeriodsPerYear(frecuenciaPago || 'mensual');
        const ratePY = window.prestamosPeriodsPerYear(tasaFrecuencia || 'anual');
        return parseFloat((R * (ratePY / ppY)).toFixed(10));
    };

    window.calcularPlanPagos = function (p) {
        const C = parseFloat(Number(p.montoCapital).toFixed(2));
        const n = Math.max(1, parseInt(p.cuotasTotales, 10) || 1);
        const metodo = String(p.metodo || 'Cuota Fija').trim();
        const tipo = String(p.tipoInteres || 'simple').toLowerCase() === 'compuesto' ? 'compuesto' : 'simple';
        const i = window.prestamoPeriodRate(p.tasaInteres, p.frecuencia, p.tasaFrecuencia || 'anual');
        const plan = [];
        
        const fInicio = p.fechaInicio || new Date().toISOString().slice(0, 10);
        const freqStr = p.frecuencia || 'mensual';
        const getFechaStr = (idx) => {
            if (typeof window.siguienteFechaCuotaISO === 'function') {
                const iso = window.siguienteFechaCuotaISO(fInicio, freqStr, idx);
                const [y, m, d] = iso.split('-');
                return `${d}/${m}/${y}`;
            }
            return '';
        };

        if (metodo === 'Cuota Fija') {
            if (tipo === 'compuesto') {
                let saldo = C;
                let cuota = 0;
                if (i <= 0) cuota = parseFloat((C / n).toFixed(2));
                else cuota = parseFloat(((C * i * Math.pow(1 + i, n)) / (Math.pow(1 + i, n) - 1)).toFixed(2));
                for (let k = 0; k < n; k++) {
                    const interes = parseFloat((saldo * i).toFixed(2));
                    let capital = parseFloat((cuota - interes).toFixed(2));
                    if (capital > saldo) capital = parseFloat(saldo.toFixed(2));
                    saldo = parseFloat((saldo - capital).toFixed(2));
                    if (saldo < 0) saldo = 0;
                    plan.push({ periodo: k + 1, fecha: getFechaStr(k + 1), cuota: parseFloat((interes + capital).toFixed(2)), capital, interes, saldoDespues: saldo, pagado: false });
                }
            } else {
                const totalInteres = parseFloat((C * i * n).toFixed(2));
                const interesPorCuota = n > 0 ? parseFloat((totalInteres / n).toFixed(2)) : 0;
                const capitalPorCuota = parseFloat((C / n).toFixed(2));
                let saldo = C;
                for (let k = 0; k < n; k++) {
                    const cap = k === n - 1 ? parseFloat(saldo.toFixed(2)) : capitalPorCuota;
                    const int = interesPorCuota;
                    saldo = parseFloat((saldo - cap).toFixed(2));
                    if (saldo < 0) saldo = 0;
                    plan.push({ periodo: k + 1, fecha: getFechaStr(k + 1), cuota: parseFloat((cap + int).toFixed(2)), capital: cap, interes: int, saldoDespues: saldo, pagado: false });
                }
            }
        } else {
            const capitalPorCuota = parseFloat((C / n).toFixed(2));
            let saldo = C;
            for (let k = 0; k < n; k++) {
                const interes = parseFloat((saldo * i).toFixed(2));
                const cap = k === n - 1 ? parseFloat(saldo.toFixed(2)) : Math.min(capitalPorCuota, saldo);
                saldo = parseFloat((saldo - cap).toFixed(2));
                if (saldo < 0) saldo = 0;
                plan.push({ periodo: k + 1, fecha: getFechaStr(k + 1), cuota: parseFloat((cap + interes).toFixed(2)), capital: cap, interes, saldoDespues: saldo, pagado: false });
            }
        }
        return plan;
    };

    window.siguienteFechaCuotaISO = function (fechaInicio, freq, cuotaIndex) {
        const d = new Date((fechaInicio || new Date().toISOString().slice(0, 10)) + 'T12:00:00');
        if (freq === 'diario') d.setDate(d.getDate() + cuotaIndex);
        else if (freq === 'semanal') d.setDate(d.getDate() + 7 * cuotaIndex);
        else d.setMonth(d.getMonth() + cuotaIndex);
        return d.toISOString().slice(0, 10);
    };

    window.actualizarEstadoPrestamo = function (p) {
        const saldo = parseFloat(Number(p.saldoCapital || 0).toFixed(2));
        if (saldo <= 0.01) { p.estado = 'Finalizado'; p.fechaProximaCuota = ''; return; }
        const fp = Math.min(p.cuotasPagadas || 0, p.cuotasTotales || 1);
        p.fechaProximaCuota = window.siguienteFechaCuotaISO(p.fechaInicio, p.frecuencia || 'mensual', fp + 1);
        const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
        const fv = new Date((p.fechaProximaCuota || '') + 'T12:00:00');
        p.estado = fv < hoy ? 'Mora' : 'Al día';
    };

    window.prestamosInteresesPendientesProyectados = function (p) {
        if (!p.plan || p.plan.length === 0 || p.estado === 'Finalizado') return 0;
        const start = Math.min(p.cuotasPagadas || 0, p.plan.length);
        let s = 0;
        for (let i = start; i < p.plan.length; i++) s += Number(p.plan[i].interes) || 0;
        return parseFloat(s.toFixed(2));
    };

    window.syncPrestamoFirestore = async function (loan, lastAbono) {
        try {
            if (!window.currentUser || !loan || !loan.id || !window.db) return;
            const pref = window.db.collection('users').doc(window.currentUser.uid).collection('prestamos').doc(String(loan.id));
            const _g = loan.garantia || {};
            await pref.set({
                cliente: loan.cliente || '',
                montoCapital: parseFloat(Number(loan.montoCapital || 0).toFixed(2)),
                tasaInteres: parseFloat(Number(loan.tasaInteres || 0).toFixed(4)),
                tasaFrecuencia: loan.tasaFrecuencia || 'anual',
                frecuencia: loan.frecuencia || 'mensual',
                metodo: loan.metodo || 'Cuota Fija',
                tipoInteres: loan.tipoInteres || 'simple',
                cuotasTotales: loan.cuotasTotales || 0,
                cuotasPagadas: loan.cuotasPagadas || 0,
                garantia: { descripcion: _g.descripcion || '', valor: _g.valor || 0, fotoDataUrl: _g.fotoDataUrl || '', hasFoto: !!(_g.fotoDataUrl && String(_g.fotoDataUrl).length > 30) },
                estado: loan.estado || 'Al día',
                saldoCapital: parseFloat(Number(loan.saldoCapital || 0).toFixed(2)),
                fechaInicio: loan.fechaInicio || '',
                fechaProximaCuota: loan.fechaProximaCuota || '',
                updatedAt: window.db.FieldValue ? window.db.FieldValue.serverTimestamp() : new Date()
            }, { merge: true });

            if (lastAbono && lastAbono.id) {
                await pref.collection('abonos').doc(String(lastAbono.id)).set({
                    fecha: lastAbono.fecha,
                    monto: parseFloat(Number(lastAbono.monto).toFixed(2)),
                    capitalAbonado: parseFloat(Number(lastAbono.capitalAbonado).toFixed(2)),
                    interesPagado: parseFloat(Number(lastAbono.interesPagado).toFixed(2))
                }, { merge: true });
            }
        } catch (e) { console.warn('syncPrestamoFirestore', e); }
    };

    window.registrarAbono = function (loanId, montoIn, cobroMetodo) {
        window.ensurePhase2Data();
        const p = appData.prestamos.find(x => x.id === loanId);
        if (!p) { window.showToast('error', 'Error', 'Préstamo no encontrado'); return false; }
        if (p.estado === 'Finalizado') { window.showToast('warning', 'Préstamo', 'El préstamo ya está finalizado'); return false; }
        let monto = parseFloat(Number(montoIn).toFixed(2));
        if (!monto || monto <= 0) { window.showToast('error', 'Error', 'Monto inválido'); return false; }

        let saldoCap = parseFloat(Number(p.saldoCapital).toFixed(2));
        if (!p.plan || p.plan.length === 0) p.plan = window.calcularPlanPagos(p);
        const plan = p.plan;
        const idx = Math.min(p.cuotasPagadas || 0, plan.length - 1);
        const row = plan[idx];
        let interesEsperado = row ? parseFloat(Number(row.interes).toFixed(2)) : parseFloat((saldoCap * window.prestamoPeriodRate(p.tasaInteres, p.frecuencia, p.tasaFrecuencia || 'anual')).toFixed(2));
        let interesPagado = parseFloat(Math.min(monto, interesEsperado).toFixed(2));
        let resto = parseFloat((monto - interesPagado).toFixed(2));
        let capitalAbonado = parseFloat(Math.min(resto, saldoCap).toFixed(2));

        saldoCap = parseFloat((saldoCap - capitalAbonado).toFixed(2));
        if (saldoCap < 0) saldoCap = 0;
        p.saldoCapital = saldoCap;

        const cuotaProg = row ? parseFloat(Number(row.cuota).toFixed(2)) : monto;
        if (row && monto + 0.005 >= cuotaProg) {
            p.cuotasPagadas = Math.min((p.cuotasPagadas || 0) + 1, p.cuotasTotales);
            
            // Sincronizar cuotas pagadas con el plan
            if (p.plan && Array.isArray(p.plan)) {
                for (let i = 0; i < p.cuotasPagadas; i++) {
                    if (p.plan[i]) p.plan[i].pagado = true;
                }
            }
        }

        const abonoId = Date.now();
        const abono = { id: abonoId, fecha: new Date().toISOString().slice(0, 10), monto, capitalAbonado, interesPagado };
        p.abonos = p.abonos || []; p.abonos.push(abono);

        window.actualizarEstadoPrestamo(p);
        if (parseFloat(Number(p.saldoCapital).toFixed(2)) <= 0.01) { p.estado = 'Finalizado'; p.saldoCapital = 0; }

        const cm = typeof window.currM !== 'undefined' ? window.currM : new Date().getMonth();
        const meth = cobroMetodo || 'Efectivo';
        const baseName = p.cliente || 'Cliente';
        const tsBase = Date.now();

        if (capitalAbonado > 0) {
            appData.bizSales.push({ id: tsBase, month: cm, type: 'prestamo_capital', itemName: `Préstamo capital · ${baseName}`, name: `Préstamo capital · ${baseName}`, qty: 1, price: parseFloat(capitalAbonado.toFixed(2)), cost: 0, currency: 'USD', method: meth, profit: 0, loanId: p.id, abonoId: abono.id });
        }
        if (interesPagado > 0) {
            appData.bizSales.push({ id: tsBase + 7, month: cm, type: 'prestamo_interes', itemName: `Préstamo intereses · ${baseName}`, name: `Préstamo intereses · ${baseName}`, qty: 1, price: parseFloat(interesPagado.toFixed(2)), cost: 0, currency: 'USD', method: meth, profit: parseFloat(interesPagado.toFixed(2)), loanId: p.id, abonoId: abono.id });
        }

        if (typeof window.save === 'function') window.save();
        window.syncPrestamoFirestore(p, abono);
        _prestamoWaContext = { loanId: p.id, abonoId: abono.id };
        if (typeof window.renderPrestamos === 'function') window.renderPrestamos();
        if (typeof window.renderCaja === 'function') window.renderCaja();
        window.showToast('success', 'Abono registrado', `Capital $${capitalAbonado.toFixed(2)} · Interés $${interesPagado.toFixed(2)}`);
        return true;
    };

    window.prestamoGarantiaPreview = function (input) {
        const prev = document.getElementById('prestamo-garantia-preview');
        if (!input || !input.files || !input.files[0]) { if (prev) { prev.classList.add('hidden'); prev.removeAttribute('src'); } return; }
        const f = input.files[0];
        if (f.size > 1500000) { window.showToast('warning', 'Imagen', 'Usa una imagen más pequeña (máx ~1.5MB).'); input.value = ''; return; }
        const r = new FileReader();
        r.onload = e => { let u = e.target.result; if (prev) { prev.src = u; prev.classList.remove('hidden'); } };
        r.readAsDataURL(f);
    };

    window.openPrestamoModal = function (id = null) {
        window.ensurePhase2Data();
        const m = $('prestamo-modal');
        if (!m) return;
        $('prestamo-id').value = '';
        $('prestamo-cliente').value = '';
        $('prestamo-capital').value = '';
        $('prestamo-tasa').value = '';
        $('prestamo-tasa-freq').value = 'anual';
        $('prestamo-frecuencia').value = 'mensual';
        $('prestamo-tipo-interes').value = 'simple';
        if ($('prestamo-tipo-cuota')) $('prestamo-tipo-cuota').value = 'Cuota Fija';
        if ($('prestamo-tasa-freq-text')) $('prestamo-tasa-freq-text').innerText = 'Anual';
        if ($('prestamo-frecuencia-text')) $('prestamo-frecuencia-text').innerText = 'Mensual';
        if ($('prestamo-tipo-interes-text')) $('prestamo-tipo-interes-text').innerText = 'Interés Simple';
        if ($('prestamo-tipo-cuota-text')) $('prestamo-tipo-cuota-text').innerText = 'Cuota Fija';
        $('prestamo-cuotas').value = '';
        if ($('prestamo-fecha-inicio')._flatpickr) {
            $('prestamo-fecha-inicio')._flatpickr.setDate(new Date());
        } else {
            $('prestamo-fecha-inicio').value = new Date().toISOString().slice(0, 10);
        }
        if ($('prestamo-garantia')) $('prestamo-garantia').value = '';
        if ($('prestamo-garantia-desc')) $('prestamo-garantia-desc').value = '';
        if ($('prestamo-garantia-valor')) $('prestamo-garantia-valor').value = '';
        if ($('prestamo-garantia-foto')) $('prestamo-garantia-foto').value = '';
        if ($('prestamo-file-name')) $('prestamo-file-name').innerText = 'Seleccionar archivo';
        const pv = $('prestamo-garantia-preview');
        if (pv) { pv.classList.add('hidden'); pv.removeAttribute('src'); }
        if ($('prestamo-smart-preview')) $('prestamo-smart-preview').classList.add('hidden');

        const titleEl = m.querySelector('h2');
        const btnEl = $('btn-save-prestamo');
        if (titleEl) titleEl.innerHTML = '<i class="fa-solid fa-file-contract text-sky-400 mr-2"></i> Nuevo Préstamo';
        if (btnEl) btnEl.innerText = 'Guardar préstamo';

        if (id !== null) {
            const p = window.appData.prestamos.find(x => x.id === id);
            if (p) {
                if (titleEl) titleEl.innerHTML = '<i class="fa-solid fa-pen text-sky-400 mr-2"></i> Editar Préstamo';
                if (btnEl) btnEl.innerText = 'Actualizar';
                
                $('prestamo-id').value = p.id;
                $('prestamo-cliente').value = p.cliente || '';
                $('prestamo-capital').value = p.montoCapital || '';
                $('prestamo-tasa').value = p.tasaInteres || '';
                
                if (p.tasaFrecuencia) {
                    $('prestamo-tasa-freq').value = p.tasaFrecuencia;
                    if ($('prestamo-tasa-freq-text')) $('prestamo-tasa-freq-text').innerText = p.tasaFrecuencia.charAt(0).toUpperCase() + p.tasaFrecuencia.slice(1);
                }
                if (p.frecuencia) {
                    $('prestamo-frecuencia').value = p.frecuencia;
                    if ($('prestamo-frecuencia-text')) $('prestamo-frecuencia-text').innerText = p.frecuencia.charAt(0).toUpperCase() + p.frecuencia.slice(1);
                }
                if (p.tipoInteres) {
                    $('prestamo-tipo-interes').value = p.tipoInteres;
                    if ($('prestamo-tipo-interes-text')) $('prestamo-tipo-interes-text').innerText = p.tipoInteres === 'compuesto' ? 'Interés Compuesto' : 'Interés Simple';
                }
                if (p.metodo) {
                    if ($('prestamo-tipo-cuota')) $('prestamo-tipo-cuota').value = p.metodo;
                    if ($('prestamo-tipo-cuota-text')) $('prestamo-tipo-cuota-text').innerText = p.metodo;
                }
                
                $('prestamo-cuotas').value = p.cuotasTotales || '';
                if ($('prestamo-fecha-inicio')._flatpickr) {
                    $('prestamo-fecha-inicio')._flatpickr.setDate(p.fechaInicio || new Date());
                } else {
                    $('prestamo-fecha-inicio').value = p.fechaInicio || new Date().toISOString().slice(0, 10);
                }
                
                if (p.garantia) {
                    if (p.garantia.descripcion) {
                        const parts = p.garantia.descripcion.split(' - ');
                        if ($('prestamo-garantia')) $('prestamo-garantia').value = parts[0] || '';
                        if ($('prestamo-garantia-desc') && parts.length > 1) $('prestamo-garantia-desc').value = parts.slice(1).join(' - ');
                    }
                    if ($('prestamo-garantia-valor')) $('prestamo-garantia-valor').value = p.garantia.valor || '';
                    if (p.garantia.fotoDataUrl && pv) {
                        pv.src = p.garantia.fotoDataUrl;
                        pv.classList.remove('hidden');
                    }
                }
                if (typeof window.actualizarPreviewPrestamo === 'function') window.actualizarPreviewPrestamo();
            }
        }
        
        m.classList.remove('hidden');
    };

    window.actualizarPreviewPrestamo = function () {
        const cap = parseFloat($('prestamo-capital')?.value || '0');
        const tasa = parseFloat($('prestamo-tasa')?.value || '0');
        const tasaFreq = $('prestamo-tasa-freq')?.value || 'anual';
        const freqRaw = $('prestamo-frecuencia')?.value || 'mensual';
        const tipoInteres = $('prestamo-tipo-interes')?.value || 'simple';
        const metodo = $('prestamo-tipo-cuota')?.value || 'Cuota Fija';
        const nStr = ($('prestamo-cuotas')?.value || '').trim();

        // Normalizar frecuencia de cobro
        const freq = (freqRaw === 'anual') ? 'mensual' : freqRaw;

        // Labels dinámicos según frecuencia
        const labels = {
            semanal:  { cantidad: 'Semanas', por: 'Semanal', int: 'Semana' },
            mensual:  { cantidad: 'Meses',   por: 'Mensual', int: 'Mes'    },
            anual:    { cantidad: 'Años',     por: 'Anual',   int: 'Año'    }
        };
        const lbl = labels[freq] || labels.mensual;

        const cuotasInput = $('prestamo-cuotas');
        if (cuotasInput) cuotasInput.placeholder = lbl.cantidad;

        const previewContainer = $('prestamo-smart-preview');
        if (!previewContainer) return;

        // Ocultar preview si faltan datos obligatorios
        const n = parseInt(nStr, 10);
        if (cap <= 0 || tasa <= 0 || !nStr || isNaN(n) || n < 1) {
            previewContainer.classList.add('hidden');
            return;
        }

        // ─── TASA POR PERIODO (i) ─────────────────────────────────────────
        // Regla: convertir siempre la tasa a la frecuencia de cobro.
        // Ejemplo: 30% Anual → Mensual = 30/12 = 2.5% por mes
        //          30% Mensual → Mensual = 30% por mes  ← caso correcto
        //          30% Mensual → Semanal = 30/4.33 ≈ 6.92% por semana
        const tasaDecimal = tasa / 100;
        const periodosAnualesTasa = (tasaFreq === 'mensual') ? 12 : (tasaFreq === 'semanal') ? 52 : 1;
        const periodosAnualesCobro = (freq === 'mensual') ? 12 : (freq === 'semanal') ? 52 : 1;
        const i = tasaDecimal * (periodosAnualesTasa / periodosAnualesCobro);

        // ─── INTERÉS SIMPLE (Cuota Fija) ─────────────────────────────────
        // Fórmula: I_total = C * i * n  →  $10,000 × 0.30 × 3 = $9,000 ✓
        let totalInt, totalPag, cuotaDisplay, interesPorPeriodo;

        interesPorPeriodo = parseFloat((cap * i).toFixed(2));

        if (tipoInteres === 'simple' && metodo === 'Cuota Fija') {
            totalInt      = parseFloat((interesPorPeriodo * n).toFixed(2));
            totalPag      = parseFloat((cap + totalInt).toFixed(2));
            cuotaDisplay  = parseFloat((totalPag / n).toFixed(2));
        } else {
            // Interés compuesto o sobre saldo: usar el motor de plan de pagos
            const tempLoan = { montoCapital: cap, tasaInteres: tasa, tasaFrecuencia: tasaFreq, frecuencia: freq, metodo, tipoInteres, cuotasTotales: n };
            const plan = window.calcularPlanPagos(tempLoan);
            totalInt     = parseFloat(plan.reduce((s, r) => s + r.interes, 0).toFixed(2));
            totalPag     = parseFloat(plan.reduce((s, r) => s + r.cuota,   0).toFixed(2));
            cuotaDisplay = plan[0] ? parseFloat(Number(plan[0].cuota).toFixed(2)) : 0;
        }

        // Inyectar al DOM
        if ($('preview-total-pagar'))    $('preview-total-pagar').innerText    = '$' + totalPag.toFixed(2);
        if ($('preview-intereses'))      $('preview-intereses').innerText      = '$' + totalInt.toFixed(2);
        if ($('preview-freq-int-lbl'))   $('preview-freq-int-lbl').innerText   = lbl.int;
        if ($('preview-interes-periodo'))$('preview-interes-periodo').innerText = '$' + interesPorPeriodo.toFixed(2);
        if ($('preview-freq-lbl'))       $('preview-freq-lbl').innerText       = lbl.por;
        if ($('preview-cuota'))          $('preview-cuota').innerText          = '$' + cuotaDisplay.toFixed(2);

        previewContainer.classList.remove('hidden');
    };

    window.savePrestamoForm = async function () {
        window.ensurePhase2Data();

        const parseUIDate = (str) => {
            if (!str) return new Date().toISOString().slice(0, 10);
            if (str.includes('/')) {
                const parts = str.split('/');
                if (parts.length === 3) {
                    const d = parts[0].padStart(2, '0');
                    const m = parts[1].padStart(2, '0');
                    const y = parts[2];
                    return `${y}-${m}-${d}`;
                }
            }
            return str;
        };

        const cliente = (document.getElementById('prestamo-cliente').value || '').trim();
        const cap = parseFloat(document.getElementById('prestamo-capital').value) || 0;
        const tasa = parseFloat(document.getElementById('prestamo-tasa').value) || 0;
        const tasaFreq = document.getElementById('prestamo-tasa-freq').value || 'anual';
        let n = Math.max(1, parseInt(document.getElementById('prestamo-cuotas').value) || 1);
        if (!cliente || cap <= 0) { window.showToast('error', 'Datos incompletos', 'Cliente y capital son obligatorios.'); return; }

        let freq = document.getElementById('prestamo-frecuencia').value || 'mensual';
        if (freq === 'anual') { freq = 'mensual'; n = 12; }
        const tipoInteres = document.getElementById('prestamo-tipo-interes').value || 'simple';
        const metodo = document.getElementById('prestamo-tipo-cuota').value || 'Cuota Fija';

        const pv = document.getElementById('prestamo-garantia-preview');
        let foto = '';
        try {
            if (pv && !pv.classList.contains('hidden') && pv.src) {
                foto = pv.src.slice(0, 1500000);
            }
        } catch (e) {
            console.warn('Error capturando foto', e);
            foto = '';
        }

        const inputGarantia = document.getElementById('prestamo-garantia');
        const inputGarDesc = document.getElementById('prestamo-garantia-desc');
        const inputGarValor = document.getElementById('prestamo-garantia-valor');
        
        const garTitulo = inputGarantia ? inputGarantia.value.trim() : '';
        const garDesc = inputGarDesc ? inputGarDesc.value.trim() : '';
        const garValorStr = inputGarValor ? inputGarValor.value : '0';
        const garValor = parseFloat(garValorStr) || 0;
        const fullGar = [garTitulo, garDesc].filter(Boolean).join(' - ');

        const inputId = document.getElementById('prestamo-id');
        const isEdit = inputId && !!inputId.value;
        const loanId = isEdit ? parseInt(inputId.value, 10) : Date.now();
        
        const inputFecha = document.getElementById('prestamo-fecha-inicio');
        const rawDate = inputFecha ? inputFecha.value : '';
        const fechaInicio = parseUIDate(rawDate);

        let loan = {
            id: loanId,
            cliente, 
            montoCapital: parseFloat(cap.toFixed(2)), 
            tasaInteres: parseFloat(Number(tasa).toFixed(4)), 
            tasaFrecuencia: tasaFreq,
            frecuencia: freq, 
            metodo, 
            tipoInteres, 
            cuotasTotales: n, 
            cuotasPagadas: 0,
            garantia: { descripcion: fullGar, fotoDataUrl: foto, valor: garValor },
            estado: 'Al día', 
            saldoCapital: parseFloat(cap.toFixed(2)),
            fechaInicio: fechaInicio,
            abonos: []
        };
        
        loan.plan = window.calcularPlanPagos(loan);
        loan.cuotaPlaneada = loan.plan[0] ? parseFloat(Number(loan.plan[0].cuota).toFixed(2)) : 0;
        window.actualizarEstadoPrestamo(loan);
        window.appData.prestamos = window.appData.prestamos || [];
        
        if (isEdit) {
            const idx = window.appData.prestamos.findIndex(x => String(x.id) === String(loanId));
            if (idx > -1) {
                const oldLoan = window.appData.prestamos[idx];
                loan.abonos = oldLoan.abonos || [];
                loan.cuotasPagadas = oldLoan.cuotasPagadas || 0;
                
                let nSaldo = loan.montoCapital;
                loan.abonos.forEach(ab => { nSaldo -= (parseFloat(ab.capitalAbonado) || 0); });
                loan.saldoCapital = nSaldo > 0 ? parseFloat(nSaldo.toFixed(2)) : 0;
                if (loan.saldoCapital <= 0.01) loan.estado = 'Finalizado';
                else window.actualizarEstadoPrestamo(loan);
                
                Object.assign(window.appData.prestamos[idx], loan);
                window.showToast('success', 'Actualizado', `${cliente} · Datos modificados correctamente.`);
            } else {
                window.appData.prestamos.push(loan);
                window.showToast('success', 'Préstamo', `${cliente} · Plan ${n} cuotas · Cuota ref. $${(loan.cuotaPlaneada || 0).toFixed(2)}`);
            }
        } else {
            window.appData.prestamos.push(loan);
            window.showToast('success', 'Préstamo', `${cliente} · Plan ${n} cuotas · Cuota ref. $${(loan.cuotaPlaneada || 0).toFixed(2)}`);
        }
        
        if (typeof window.save === 'function') await window.save();
        window.syncPrestamoFirestore(loan, null);
        const modalEl = document.getElementById('prestamo-modal');
        if (modalEl) modalEl.classList.add('hidden');
        if (typeof window.renderPrestamos === 'function') window.renderPrestamos();
        if (typeof window.calculateAdvancedAnalytics === 'function') window.calculateAdvancedAnalytics();
    };

    window.openPrestamoAbonoModal = function (loanId) {
        window.ensurePhase2Data();
        const p = appData.prestamos.find(x => x.id === loanId);
        if (!p || p.estado === 'Finalizado') { window.showToast('warning', 'Préstamo', 'No se puede abonar'); return; }
        _prestamoWaContext = { loanId: p.id, abonoId: null };
        document.getElementById('prestamo-abono-loan-id').value = String(loanId);
        document.getElementById('prestamo-abono-monto').value = '';
        document.getElementById('prestamo-abono-metodo').value = 'Efectivo';
        let hint = `Saldo capital: $${parseFloat(Number(p.saldoCapital).toFixed(2)).toFixed(2)}`;
        const ipc = p.cuotasPagadas || 0;
        if (p.plan && ipc < p.plan.length) {
            const r = p.plan[ipc];
            hint += ` · Cuota sugerida $${parseFloat(Number(r.cuota).toFixed(2)).toFixed(2)}`;
        }
        document.getElementById('prestamo-abono-hint').innerText = hint;
        document.getElementById('prestamo-abono-modal').classList.remove('hidden');
    };

    window.submitPrestamoAbono = function () {
        const id = parseInt(document.getElementById('prestamo-abono-loan-id').value, 10);
        const mont = parseFloat(document.getElementById('prestamo-abono-monto').value || '0');
        const meth = document.getElementById('prestamo-abono-metodo').value;
        if (!window.registrarAbono(id, mont, meth)) return;
        document.getElementById('prestamo-abono-modal').classList.add('hidden');
        if (typeof window.calculateAdvancedAnalytics === 'function') window.calculateAdvancedAnalytics();
    };

    window.whatsappUltimoAbono = function () {
        const loanId = _prestamoWaContext.loanId;
        const abonoId = _prestamoWaContext.abonoId;
        if (!loanId) { window.showToast('info', 'WhatsApp', 'Registra primero un abono.'); return; }
        const p = appData.prestamos.find(x => x.id === loanId);
        if (!p) return;
        const ab = abonoId ? (p.abonos || []).find(a => a.id === abonoId) : (p.abonos || []).slice(-1)[0];
        if (!ab) { window.showToast('info', 'WhatsApp', 'No hay abonos registrados.'); return; }
        const msg = [
            '🧾 *Recibo abono préstamo*', `Cliente: ${p.cliente}`, `Fecha: ${ab.fecha}`,
            `Total abono: $${parseFloat(Number(ab.monto).toFixed(2)).toFixed(2)}`,
            `└ Capital: $${parseFloat(Number(ab.capitalAbonado).toFixed(2)).toFixed(2)}`,
            `└ Interés: $${parseFloat(Number(ab.interesPagado).toFixed(2)).toFixed(2)}`, '',
            `*Saldo capital restante:* $${parseFloat(Number(p.saldoCapital).toFixed(2)).toFixed(2)}`,
            `Estado: ${p.estado}`, '', '_Mensaje generado por EQUO._'
        ].join('%0A');
        window.open('https://wa.me/?text=' + msg, '_blank');
    };

    window.prestamoBadgeClass = function (estado) {
        if (estado === 'Finalizado') return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50';
        if (estado === 'Mora') return 'bg-red-500/20 text-red-400 border-red-500/60 shadow-[0_0_12px_rgba(248,113,113,0.45)]';
        return 'bg-sky-500/20 text-sky-300 border-sky-500/45';
    };

    window.borrarPrestamo = function (id) {
        window.openCustomConfirm('Eliminar préstamo', 'Se eliminará el préstamo y su historial. ¿Continuar?', () => {
            window.ensurePhase2Data();
            appData.prestamos = (appData.prestamos || []).filter(x => x.id !== id);
            if (typeof window.save === 'function') window.save();
            if (window.currentUser && window.db) {
                window.db.collection('users').doc(window.currentUser.uid).collection('prestamos').doc(String(id)).delete().catch(() => { });
            }
            window.renderPrestamos();
            window.showToast('info', 'Listo', 'Préstamo eliminado');
        });
    };

    window.calcularMontoMora = function (prestamo, fechaReferencia) {
        /*
         * Algoritmo correcto de mora:
         * Recorre el plan cuota por cuota en orden cronológico.
         * Por cada cuota cuya fecha de vencimiento es ANTERIOR a fechaReferencia,
         * descuenta del saldo de abonos disponible.
         * Lo que no alcanza a cubrirse = mora real.
         */
        if (!prestamo.plan || prestamo.plan.length === 0) return 0;
        if (!prestamo.fechaInicio) return 0;

        // Saldo de abonos disponible para descontar (en orden FIFO)
        let saldoAbonos = 0;
        (prestamo.abonos || []).forEach(a => {
            saldoAbonos += parseFloat(Number(a.monto || 0).toFixed(2));
        });

        let mora = 0;

        prestamo.plan.forEach((cuotaObj, idx) => {
            // Fecha de vencimiento de esta cuota
            const fC = new Date(prestamo.fechaInicio + 'T12:00:00');
            if (prestamo.frecuencia === 'semanal')  fC.setDate(fC.getDate() + (idx + 1) * 7);
            else if (prestamo.frecuencia === 'mensual') fC.setMonth(fC.getMonth() + (idx + 1));
            else if (prestamo.frecuencia === 'anual')   fC.setFullYear(fC.getFullYear() + (idx + 1));
            fC.setHours(0, 0, 0, 0);

            // Solo procesar cuotas VENCIDAS (fecha anterior a la de referencia)
            if (fC.getTime() >= fechaReferencia.getTime()) return;

            const montoCuota = parseFloat(Number(cuotaObj.cuota).toFixed(2));

            if (saldoAbonos >= montoCuota) {
                // Esta cuota está cubierta: descontar del saldo
                saldoAbonos = parseFloat((saldoAbonos - montoCuota).toFixed(2));
            } else {
                // Cubierta parcialmente o nada: la diferencia es mora
                const descubierto = parseFloat((montoCuota - saldoAbonos).toFixed(2));
                mora = parseFloat((mora + descubierto).toFixed(2));
                saldoAbonos = 0;
            }
        });

        return mora > 0 ? mora : 0;
    };

    window.renderPrestamos = function () {
        window.ensurePhase2Data();
        const escapeHtmlShort = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\"/g, '&quot;').replace(/'/g, '&#39;');
        const container = document.getElementById('prestamos-list-container');
        if (!container) return;

        // Resetear contadores DESDE CERO en cada ejecución
        let capitalCalle = 0, interesesCobrar = 0, moraMonto = 0, recuperado = 0, totalGarantias = 0;
        
        // --- FECHA DE REFERENCIA DINÁMICA ---
        // Usa el mes seleccionado (currM) y el año seleccionado (appData.year)
        // new Date(year, month + 1, 0) obtiene el ÚLTIMO día de ese mes.
        const rYear = (window.appData && window.appData.year) ? parseInt(window.appData.year) : new Date().getFullYear();
        const rMonth = (window.currM !== undefined) ? parseInt(window.currM) : new Date().getMonth();
        const fechaReferencia = new Date(rYear, rMonth + 1, 0, 23, 59, 59);
        const hoyDate = new Date(); 
        hoyDate.setHours(0, 0, 0, 0);

        // Limpiar el contador de mora en el DOM inmediatamente
        const moraEl = document.getElementById('prest-resumen-mora');
        if (moraEl) moraEl.innerText = '$0.00';

        (window.appData.prestamos || []).forEach(pr => {
            // Reconstruir plan si falta (datos migrados o nuevos)
            if (!pr.plan || pr.plan.length === 0) pr.plan = window.calcularPlanPagos(pr);

            // Actualizar estado antes de cualquier cálculo
            window.actualizarEstadoPrestamo(pr);

            if (pr.estado !== 'Finalizado') {
                capitalCalle += parseFloat(Number(pr.saldoCapital || 0).toFixed(2));
                interesesCobrar += window.prestamosInteresesPendientesProyectados(pr);

                // Mora: cuotas vencidas no cubiertas calculadas HASTA la fechaReferencia
                const mora = window.calcularMontoMora(pr, fechaReferencia);
                if (mora > 0) moraMonto = parseFloat((moraMonto + mora).toFixed(2));
                
                // Garantías: sumar valor si el préstamo está activo
                if (pr.garantia && pr.garantia.valor) {
                    totalGarantias += parseFloat(Number(pr.garantia.valor || 0).toFixed(2));
                }
            }

            // Recuperado: suma TODOS los abonos sin importar estado
            (pr.abonos || []).forEach(a => {
                recuperado += parseFloat(Number(a.monto || 0).toFixed(2));
            });
        });

        const el = (id, v) => {
            const node = document.getElementById(id);
            if (node) node.innerText = '$' + parseFloat(Number(v).toFixed(2)).toFixed(2);
        };
        el('prest-resumen-calle', capitalCalle);
        el('prest-resumen-intereses', interesesCobrar);
        el('prest-resumen-mora', moraMonto);
        el('prest-resumen-recuperado', recuperado);
        el('prest-resumen-garantias', totalGarantias);

        if (window.appData.prestamos.length === 0) {
            container.innerHTML = '<div class="col-span-full text-center py-10 text-slate-400 text-xs italic border border-white/10 rounded-xl backdrop-blur-xl">Sin préstamos. Crea el primero con «Nuevo Préstamo».</div>';
            console.log('Mora calculada (Ref: ' + fechaReferencia.toLocaleDateString() + '):', moraMonto);
            return;
        }

        container.innerHTML = window.appData.prestamos.map(p => {
            const saldo = parseFloat(Number(p.saldoCapital || 0).toFixed(2));
            const prog = p.cuotasTotales ? Math.min(100, parseFloat((((p.cuotasPagadas || 0) / p.cuotasTotales) * 100).toFixed(2))) : 0;
            const _cp = p.cuotasPagadas || 0;
            const sug = (p.plan && _cp < p.plan.length) ? p.plan[_cp] : null;
            const cuotaLbl = sug ? `$${parseFloat(Number(sug.cuota).toFixed(2)).toFixed(2)}` : '—';
            const bc = window.prestamoBadgeClass(p.estado);
            let gar = '';
            if (p.garantia && p.garantia.descripcion) {
                let valStr = (p.garantia.valor > 0) ? `<br><span class="text-sky-400 font-bold"><i class="fa-solid fa-vault mr-1"></i>Valuada en: $${parseFloat(p.garantia.valor).toFixed(2)}</span>` : '';
                gar = `<span class="text-[9px] text-slate-400 mt-1 border-t border-white/5 pt-1 block leading-relaxed line-clamp-3">Garantía: ${escapeHtmlShort(p.garantia.descripcion)}${valStr}</span>`;
            }
            let imgGar = (p.garantia && p.garantia.fotoDataUrl) ? `<img src="${p.garantia.fotoDataUrl}" alt="" class="w-full max-h-24 object-cover rounded-lg border border-white/10 mt-1"/>` : '';

            // SMART ALERTS & PROXIMO PAGO
            let baseDateStr = p.fechaInicio;
            if (p.abonos && p.abonos.length > 0) baseDateStr = p.abonos[p.abonos.length - 1].fecha;
            if (!baseDateStr) baseDateStr = new Date().toISOString().slice(0, 10);

            const baseD = new Date(baseDateStr + 'T12:00:00');
            const proximoD = new Date(baseD);
            if (p.frecuencia === 'semanal') proximoD.setDate(proximoD.getDate() + 7);
            else if (p.frecuencia === 'mensual') proximoD.setMonth(proximoD.getMonth() + 1);
            else if (p.frecuencia === 'anual') proximoD.setFullYear(proximoD.getFullYear() + 1);

            const proximoIso = proximoD.toISOString().slice(0, 10);
            const proximoDateNormalized = new Date(proximoIso + 'T12:00:00');
            proximoDateNormalized.setHours(0, 0, 0, 0);
            
            // Aquí usamos hoyDate (fecha actual real) para saber si ES hoy
            const esHoyCobro = (proximoDateNormalized.getTime() === hoyDate.getTime());

            let vencimientoFinal = new Date(p.fechaInicio + 'T12:00:00');
            if (p.frecuencia === 'semanal') vencimientoFinal.setDate(vencimientoFinal.getDate() + (p.cuotasTotales * 7));
            else if (p.frecuencia === 'mensual') vencimientoFinal.setMonth(vencimientoFinal.getMonth() + p.cuotasTotales);
            else if (p.frecuencia === 'anual') vencimientoFinal.setFullYear(vencimientoFinal.getFullYear() + p.cuotasTotales);
            vencimientoFinal.setHours(0, 0, 0, 0);

            // Usar fechaReferencia para la alerta de vencimiento
            const diffVencimiento = Math.ceil((vencimientoFinal.getTime() - fechaReferencia.getTime()) / (1000 * 60 * 60 * 24));

            let alertHtml = '';
            if (diffVencimiento < 0 && saldo > 0) {
                alertHtml = `<div class="mt-2 text-[10px] font-bold text-red-400 bg-red-900/20 border border-red-500/30 rounded p-1.5 animate-pulse flex items-center gap-1.5"><i class="fa-solid fa-gavel"></i> EJECUTAR GARANTÍA</div>`;
            } else if (esHoyCobro && saldo > 0) {
                alertHtml = `<div class="mt-2 text-[10px] font-bold text-sky-400 bg-sky-900/20 border border-sky-500/30 rounded p-1.5 flex items-center gap-1.5"><i class="fa-solid fa-hand-holding-dollar"></i> COBRO PENDIENTE HOY</div>`;
            } else if (diffVencimiento <= 7 && diffVencimiento >= 0 && saldo > 0) {
                alertHtml = `<div class="mt-2 text-[10px] font-bold text-amber-400 bg-amber-900/20 border border-amber-500/30 rounded p-1.5 flex items-center gap-1.5"><i class="fa-solid fa-triangle-exclamation"></i> POR FINALIZAR</div>`;
            }

            const textColor = esHoyCobro ? 'text-sky-400 font-bold' : 'text-gray-400';
            const proximoCobroHtml = saldo > 0 ? `<div class="mt-2 text-[10px] ${textColor} flex items-center gap-1.5 border-t border-white/5 pt-2"><i class="fa-solid fa-calendar-day"></i> Próximo Pago: ${proximoIso}</div>` : '';

            return `<div class="glass-card p-5 relative flex flex-col justify-between border border-white/10 hover:border-sky-500/25 transition-colors group">
                <div class="mb-3 flex justify-between items-start gap-2">
                    <div class="min-w-0 flex-1">
                        <span class="text-[9px] font-bold uppercase tracking-wider text-sky-400">Préstamo USD · ${p.frecuencia}</span>
                        <h3 class="font-bold text-white text-sm truncate">${escapeHtmlShort(p.cliente)}</h3>
                    </div>
                    <span class="text-[9px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${bc}">${p.estado}</span>
                </div>
                <div class="grid grid-cols-2 gap-2 mb-2 relative z-10">
                    <div class="bg-black/20 rounded p-2 border border-white/5 text-center"><p class="text-[9px] text-slate-400 uppercase">Cuotas</p><p class="font-bold text-gray-200 text-xs">${p.cuotasPagadas || 0}/${p.cuotasTotales}</p></div>
                    <div class="bg-black/20 rounded p-2 border border-white/5 text-center"><p class="text-[9px] text-slate-400 uppercase">Sugerida</p><p class="font-bold text-gray-200 text-xs">${cuotaLbl}</p></div>
                </div>
                ${alertHtml}
                ${proximoCobroHtml}
                ${gar}${imgGar}
                <div class="rounded p-3 border border-sky-500/20 mb-3 mt-2 bg-sky-900/10 relative overflow-hidden z-10">
                    <div class="flex justify-between items-end mb-1"><p class="text-[10px] text-sky-300 uppercase font-bold">Saldo Capital</p><p class="text-lg font-extrabold text-white leading-none">$${saldo.toFixed(2)}</p></div>
                    <div class="flex flex-col gap-1 text-[9px] text-gray-300 border-t border-sky-500/10 pt-2 mt-2">
                        <div class="flex justify-between"><span>Capital inicial:</span><span class="font-bold text-sky-200">$${parseFloat(Number(p.montoCapital).toFixed(2)).toFixed(2)}</span></div>
                        <div class="flex justify-between"><span>Tasa:</span><span class="font-bold text-sky-200">${parseFloat(Number(p.tasaInteres || 0).toFixed(2)).toFixed(2)}% · ${p.metodo}</span></div>
                    </div>
                </div>
                <div class="mb-3">
                    <div class="flex justify-between text-[9px] text-slate-400 mb-1"><span>Progreso</span><span>${prog.toFixed(0)}%</span></div>
                    <div class="progress-bar-bg"><div class="progress-bar-fill theme-bg-gradient shadow-[0_0_10px_var(--t-primary)]" style="width:${prog}%"></div></div>
                </div>
                <div class="flex flex-wrap gap-2 border-t border-white/10 pt-2 mt-auto">
                    <button type="button" onclick="openPrestamoAbonoModal(${p.id})" class="flex-1 min-w-[100px] py-2 rounded-lg theme-bg-gradient text-white text-[10px] font-bold shadow-lg"><i class="fa-solid fa-coins mr-1"></i>Abono</button>
                    <button type="button" onclick="_prestamoWaContext.loanId=${p.id};_prestamoWaContext.abonoId=null;whatsappUltimoAbono()" class="py-2 px-2 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-[10px] font-bold" title="Último abono"><i class="fa-brands fa-whatsapp"></i></button>
                    <button type="button" onclick="window.openPrestamoModal(${p.id})" class="py-2 px-2 rounded-lg bg-white/10 border border-white/10 text-gray-400 hover:text-sky-400 text-[10px]" title="Editar Préstamo"><i class="fa-solid fa-pen"></i></button>
                    <button type="button" onclick="borrarPrestamo(${p.id})" class="py-2 px-2 rounded-lg bg-white/10 border border-white/10 text-gray-400 hover:text-red-500 text-[10px]"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>`;
        }).join('');
        
        console.log('Mora calculada (Ref: ' + fechaReferencia.toLocaleDateString() + '):', moraMonto);
    };

    // ─── BLOQUE 8b: Alertas Globales ─────────────────────────────────────
    window.verificarAlertasGlobales = function () {
        if (!window.appData || !window.appData.prestamos) return;
        
        let cobrosHoy = 0;
        let clientesEnMora = 0;
        
        // Determinar fecha de referencia según calendario para mora
        const rYear = (window.appData && window.appData.year) ? parseInt(window.appData.year) : new Date().getFullYear();
        const rMonth = (window.currM !== undefined) ? parseInt(window.currM) : new Date().getMonth();
        const fechaReferencia = new Date(rYear, rMonth + 1, 0, 23, 59, 59);

        const hoyDate = new Date();
        hoyDate.setHours(0, 0, 0, 0);

        window.appData.prestamos.forEach(p => {
            if (p.estado === 'Finalizado') return;
            
            // Reconstruir plan si falta (prevención)
            if (!p.plan || p.plan.length === 0) p.plan = window.calcularPlanPagos(p);

            // 1. Contabilizar Mora (usando mes que el usuario está viendo)
            const mora = window.calcularMontoMora(p, fechaReferencia);
            if (mora > 0) clientesEnMora++;

            // 2. Contabilizar Cobros de HOY (fecha real de hoy siempre)
            let baseDateStr = p.fechaInicio;
            if (p.abonos && p.abonos.length > 0) baseDateStr = p.abonos[p.abonos.length - 1].fecha;
            if (!baseDateStr) baseDateStr = new Date().toISOString().slice(0, 10);

            const baseD = new Date(baseDateStr + 'T12:00:00');
            const proximoD = new Date(baseD);
            if (p.frecuencia === 'semanal') proximoD.setDate(proximoD.getDate() + 7);
            else if (p.frecuencia === 'mensual') proximoD.setMonth(proximoD.getMonth() + 1);
            else if (p.frecuencia === 'anual') proximoD.setFullYear(proximoD.getFullYear() + 1);

            const proximoIso = proximoD.toISOString().slice(0, 10);
            const proximoDateNormalized = new Date(proximoIso + 'T12:00:00');
            proximoDateNormalized.setHours(0, 0, 0, 0);

            if (proximoDateNormalized.getTime() === hoyDate.getTime()) {
                cobrosHoy++;
            }
        });

        if (cobrosHoy > 0 || clientesEnMora > 0) {
            window.showToast('warning', 'Resumen de Cobros', `¡Atención! Tienes ${cobrosHoy} cobros para hoy y ${clientesEnMora} clientes en mora.`);
        }
    };

    /* ──────────────────────────────────────────────
       BLOQUE 9: Cursor Premium y Partículas
    ────────────────────────────────────────────── */
    const cursor = $('premium-cursor');
    const _isTouchDevice = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    if (cursor && !_isTouchDevice) {
        let mx = window.innerWidth / 2, my = window.innerHeight / 2, cx = mx, cy = my;
        window.addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; });
        function renderCursor() {
            cx += (mx - cx) * 0.15;
            cy += (my - cy) * 0.15;
            cursor.style.left = `${cx}px`;
            cursor.style.top = `${cy}px`;
            requestAnimationFrame(renderCursor);
        }
        renderCursor();
        document.addEventListener('mouseover', e => {
            if (e.target.closest('button, input, select, label, .toast-card, a, i, .cursor-pointer, .cal-day, .glass-card, .flatpickr-day, .flatpickr-prev-month, .flatpickr-next-month, .flatpickr-monthDropdown-months, .numInputWrapper')) {
                cursor.classList.add('hovering');
            }
        });
        document.addEventListener('mouseout', e => {
            if (e.target.closest('button, input, select, label, .toast-card, a, i, .cursor-pointer, .cal-day, .glass-card, .flatpickr-day, .flatpickr-prev-month, .flatpickr-next-month, .flatpickr-monthDropdown-months, .numInputWrapper')) {
                cursor.classList.remove('hovering');
            }
        });
    }

    const canvas = $('particles');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        let pArray = Array.from({ length: 45 }, () => ({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            size: Math.random() * 1.5 + 0.5,
            sx: (Math.random() - 0.5) * 0.2,
            sy: (Math.random() - 1) * 0.4 - 0.1
        }));
        function animParticles() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = document.body.classList.contains('light-mode') ? 'rgba(2, 132, 199, 0.25)' : 'rgba(56,189,248,0.25)';
            for (let p of pArray) {
                p.x += p.sx;
                p.y += p.sy;
                if (p.x < 0) p.x = canvas.width;
                if (p.x > canvas.width) p.x = 0;
                if (p.y < 0) p.y = canvas.height;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                ctx.fill();
            }
            requestAnimationFrame(animParticles);
        }
        animParticles();
        window.addEventListener('resize', () => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        });
    }

    /* ── Fetch Tasas de Cambio ── */
    async function fetchCurrencyRates() {
        try {
            const [r1, r2, r3] = await Promise.all([
                fetch('https://ve.dolarapi.com/v1/dolares/oficial'),
                fetch('https://ve.dolarapi.com/v1/euros/oficial'),
                fetch('https://ve.dolarapi.com/v1/dolares/paralelo')
            ]);
            const [d1, d2, d3] = await Promise.all([r1.json(), r2.json(), r3.json()]);
            if ($('tick-usd')) $('tick-usd').innerText = d1.promedio.toFixed(2);
            if ($('tick-eur')) $('tick-eur').innerText = d2.promedio.toFixed(2);
            if ($('tick-usdt')) $('tick-usdt').innerText = d3.promedio.toFixed(2);
        } catch (e) {
            console.warn('FX fetch error', e);
        }
    }
    fetchCurrencyRates();
    setInterval(fetchCurrencyRates, 60000);

    // Alertas globales integradas con switchMonth
    window.verificarAlertasGlobales = function () {
        if (!window.appData || !window.appData.prestamos) return;
        const hoyDate = new Date(); hoyDate.setHours(0, 0, 0, 0);
        let cobrosHoy = 0;
        let clientesEnMora = 0;

        window.appData.prestamos.forEach(p => {
            const saldo = parseFloat(Number(p.saldoCapital || 0).toFixed(2));
            if (saldo <= 0 || p.estado === 'Finalizado') return;

            let baseDateStr = p.fechaInicio;
            if (p.abonos && p.abonos.length > 0) baseDateStr = p.abonos[p.abonos.length - 1].fecha;
            if (!baseDateStr) baseDateStr = new Date().toISOString().slice(0, 10);

            const baseD = new Date(baseDateStr + 'T12:00:00');
            const proximoD = new Date(baseD);
            if (p.frecuencia === 'semanal') proximoD.setDate(proximoD.getDate() + 7);
            else if (p.frecuencia === 'mensual') proximoD.setMonth(proximoD.getMonth() + 1);
            else if (p.frecuencia === 'anual') proximoD.setFullYear(proximoD.getFullYear() + 1);

            const proximoDateNormalized = new Date(proximoD.toISOString().slice(0, 10) + 'T12:00:00');
            proximoDateNormalized.setHours(0, 0, 0, 0);
            if (proximoDateNormalized.getTime() === hoyDate.getTime()) cobrosHoy++;

            if (!p.plan || p.plan.length === 0) p.plan = window.calcularPlanPagos(p);
            let totalVencido = 0;
            let totalPagado = 0;
            p.plan.forEach((cuotaObj, idx) => {
                let fC = new Date(p.fechaInicio + 'T12:00:00');
                if (p.frecuencia === 'semanal') fC.setDate(fC.getDate() + ((idx + 1) * 7));
                else if (p.frecuencia === 'mensual') fC.setMonth(fC.getMonth() + (idx + 1));
                else if (p.frecuencia === 'anual') fC.setFullYear(fC.getFullYear() + (idx + 1));
                fC.setHours(0, 0, 0, 0);
                if (fC.getTime() < hoyDate.getTime()) {
                    totalVencido += cuotaObj.cuota;
                }
            });
            (p.abonos || []).forEach(ab => { totalPagado += parseFloat(Number(ab.monto).toFixed(2)); });
            let montoEnMora = totalVencido - totalPagado;

            let vencimientoFinal = new Date(p.fechaInicio + 'T12:00:00');
            if (p.frecuencia === 'semanal') vencimientoFinal.setDate(vencimientoFinal.getDate() + (p.cuotasTotales * 7));
            else if (p.frecuencia === 'mensual') vencimientoFinal.setMonth(vencimientoFinal.getMonth() + p.cuotasTotales);
            else if (p.frecuencia === 'anual') vencimientoFinal.setFullYear(vencimientoFinal.getFullYear() + p.cuotasTotales);
            vencimientoFinal.setHours(0, 0, 0, 0);

            if (montoEnMora > 0 || vencimientoFinal < hoyDate) clientesEnMora++;
        });

        if (cobrosHoy > 0 || clientesEnMora > 0) {
            window.showToast('warning', 'Aviso Préstamos', `Tienes ${cobrosHoy} cobro(s) hoy y ${clientesEnMora} cliente(s) en mora.`);
        }
    };

    // Monkey patch switchMonth global
    const _originalSwitchMonth = window.switchMonth;
    window.switchMonth = function (offset) {
        if (typeof _originalSwitchMonth === 'function') _originalSwitchMonth(offset);
        window.verificarAlertasGlobales();
    };

    // Ejecución inicial segura
    if (typeof window.renderDateSelectors === 'function') {
        window.renderDateSelectors();
    }

    // Inicialización de Flatpickr se maneja en renderDateSelectors() para persistencia

    // Inyección de Estilos para inputs de fecha nativos (Bordes Neón y Fondo Oscuro)
    const dateStyle = document.createElement('style');
    dateStyle.innerHTML = `
        input[type="date"] {
            background-color: #0f172a !important;
            color: white !important;
            border: 1px solid rgba(56, 189, 248, 0.5) !important;
            box-shadow: 0 0 10px rgba(56, 189, 248, 0.1) !important;
            border-radius: 0.5rem;
            appearance: none;
            -webkit-appearance: none;
            font-family: 'Outfit', sans-serif !important;
            padding: 0.5rem !important;
        }
        input[type="date"]::-webkit-calendar-picker-indicator {
            filter: invert(1) sepia(1) saturate(5) hue-rotate(175deg);
            cursor: pointer;
        }
    `;
    document.head.appendChild(dateStyle);

    /* ──────────────────────────────────────────────
       BLOQUE 10: Encargos (SHEIN / Importaciones)
    ────────────────────────────────────────────── */

    window._encargoCart = [];

    window.openEncargoModal = function (id = null) {
        window.ensurePhase2Data();
        window._encargoCart = [];
        const m = $('encargo-modal');
        if (!m) return;
        
        $('encargo-id').value = '';
        $('encargo-cliente').value = '';
        if ($('encargo-fecha')._flatpickr) {
            $('encargo-fecha')._flatpickr.setDate(new Date());
        } else {
            $('encargo-fecha').value = new Date().toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
        }
        $('encargo-item-name').value = '';
        $('encargo-item-link').value = '';
        $('encargo-item-price').value = '';
        $('encargo-abono').value = '';
        $('encargo-total-display').innerText = '$0.00';
        $('encargo-saldo-display').innerText = '$0.00';
        
        if (typeof selectCustomOption === 'function') {
            selectCustomOption('encargo-priority', 'Normal', 'Normal');
            selectCustomOption('encargo-status', 'Pedido', 'Pedido');
        }
        
        const titleEl = $('encargo-modal-title');
        if (titleEl) titleEl.innerHTML = '<i class="fa-solid fa-box-open text-sky-400 mr-2"></i> Nuevo Encargo';

        if (id !== null) {
            const enc = window.appData.encargos.find(x => x.id === id);
            if (enc) {
                if (titleEl) titleEl.innerHTML = '<i class="fa-solid fa-pen text-sky-400 mr-2"></i> Editar Encargo';
                $('encargo-id').value = enc.id;
                $('encargo-cliente').value = enc.cliente || '';
                if ($('encargo-fecha')._flatpickr) {
                    $('encargo-fecha')._flatpickr.setDate(enc.fecha || new Date());
                } else {
                    $('encargo-fecha').value = enc.fecha || new Date().toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
                }
                $('encargo-abono').value = enc.abono || 0;
                window._encargoCart = enc.items ? JSON.parse(JSON.stringify(enc.items)) : [];
                if (typeof selectCustomOption === 'function') {
                    selectCustomOption('encargo-priority', enc.prioridad, enc.prioridad);
                    selectCustomOption('encargo-status', enc.estado, enc.estado);
                }
            }
        }
        
        window.renderEncargoCart();
        window.updateEncargoPayments();
        m.classList.remove('hidden');
    };

    window.addEncargoItem = function() {
        const name = $('encargo-item-name').value.trim();
        const link = $('encargo-item-link').value.trim();
        const price = parseFloat($('encargo-item-price').value) || 0;
        
        if (!name || price <= 0) {
            if (typeof window.showBlockingAlert === 'function') window.showBlockingAlert('Datos Faltantes', 'El nombre y el precio son obligatorios y mayores a 0.');
            return;
        }
        
        window._encargoCart.push({ id: Date.now() + Math.random(), name, link, price });
        
        $('encargo-item-name').value = '';
        $('encargo-item-link').value = '';
        $('encargo-item-price').value = '';
        
        window.renderEncargoCart();
        window.updateEncargoPayments();
    };

    window.removeEncargoItem = function(idx) {
        window._encargoCart.splice(idx, 1);
        window.renderEncargoCart();
        window.updateEncargoPayments();
    };

    window.renderEncargoCart = function() {
        const container = $('encargo-cart-list');
        if (!container) return;
        if (window._encargoCart.length === 0) {
            container.innerHTML = '';
            return;
        }
        container.innerHTML = window._encargoCart.map((item, idx) => `
            <div class="flex justify-between items-center bg-black/20 p-2 rounded border border-white/5">
                <div class="flex flex-col flex-1 min-w-0 pr-2">
                    <span class="text-xs text-white font-bold truncate">${item.name}</span>
                    ${item.link ? `<a href="${item.link}" target="_blank" class="text-[9px] text-sky-400 hover:underline truncate w-full inline-block"><i class="fa-solid fa-link mr-1"></i>${item.link}</a>` : ''}
                </div>
                <div class="flex items-center gap-3">
                    <span class="text-emerald-400 font-bold text-xs">$${item.price.toFixed(2)}</span>
                    <button type="button" onclick="removeEncargoItem(${idx})" class="text-gray-500 hover:text-red-400"><i class="fa-solid fa-xmark"></i></button>
                </div>
            </div>
        `).join('');
    };

    window.updateEncargoPayments = function() {
        const total = window._encargoCart.reduce((sum, item) => sum + item.price, 0);
        const abono = parseFloat($('encargo-abono').value) || 0;
        const saldo = total - abono;
        
        if ($('encargo-total-display')) $('encargo-total-display').innerText = '$' + total.toFixed(2);
        if ($('encargo-saldo-display')) $('encargo-saldo-display').innerText = '$' + (saldo > 0 ? saldo.toFixed(2) : '0.00');
    };

    window.saveEncargo = function () {
        window.ensurePhase2Data();
        const idStr = $('encargo-id').value;
        const cliente = $('encargo-cliente').value.trim();
        const fecha = $('encargo-fecha').value;
        const prioridad = $('encargo-priority').value;
        const estado = $('encargo-status').value;
        const abono = parseFloat($('encargo-abono').value) || 0;
        const items = window._encargoCart;
        
        if (!cliente || items.length === 0) {
            if (typeof window.showBlockingAlert === 'function') window.showBlockingAlert('Incompleto', 'Se requiere el nombre del cliente y al menos un artículo en el encargo.');
            return;
        }
        
        const montoTotal = items.reduce((sum, it) => sum + it.price, 0);
        const saldo = Math.max(0, montoTotal - abono);
        
        const encargoData = {
            id: idStr ? parseInt(idStr) : Date.now(),
            cliente, fecha, prioridad, estado, abono, saldo, montoTotal,
            items: JSON.parse(JSON.stringify(items))
        };
        
        if (idStr) {
            const idx = window.appData.encargos.findIndex(x => x.id === encargoData.id);
            if (idx > -1) {
                window.appData.encargos[idx] = encargoData;
                if (typeof window.showToast === 'function') window.showToast('success', 'Actualizado', 'El encargo ha sido actualizado.');
            }
        } else {
            window.appData.encargos.push(encargoData);
            if (typeof window.showToast === 'function') window.showToast('success', 'Guardado', 'El encargo ha sido registrado exitosamente.');
        }
        
        if (typeof window.save === 'function') window.save();
        $('encargo-modal').classList.add('hidden');
        window.renderEncargos();
    };

    window.updateEncargoStatus = function(id, newStatus) {
        const enc = window.appData.encargos.find(x => x.id === id);
        if (enc) {
            enc.estado = newStatus;
            if (typeof window.save === 'function') window.save();
            window.renderEncargos();
        }
    };

    window.addEncargoAbono = function(id) {
        window.ensurePhase2Data();
        const enc = window.appData.encargos.find(e => e.id === id);
        if (!enc) return;
        const modal = $('custom-abono-modal');
        if (modal) {
            $('custom-abono-id').value = enc.id;
            $('custom-abono-desc').innerText = `Cliente: ${enc.cliente} | Saldo actual: $${parseFloat(enc.saldo || 0).toFixed(2)}`;
            $('custom-abono-monto').value = '';
            modal.classList.remove('hidden');
            setTimeout(() => $('custom-abono-monto').focus(), 100);
        }
    };

    window.executeCustomAbono = function() {
        const idStr = $('custom-abono-id').value;
        if (!idStr) return;
        const id = parseInt(idStr);
        const montoStr = $('custom-abono-monto').value;
        const enc = window.appData.encargos.find(e => e.id === id);
        if (enc && montoStr && !isNaN(montoStr)) {
            const monto = parseFloat(montoStr);
            if (monto > 0) {
                enc.abono = (parseFloat(enc.abono) || 0) + monto;
                enc.saldo = Math.max(0, (parseFloat(enc.montoTotal) || 0) - enc.abono);
                if (typeof window.save === 'function') window.save();
                window.renderEncargos();
                if (typeof showToast === 'function') window.showToast('success', 'Abono Registrado', `Se abonaron $${monto.toFixed(2)} al encargo de ${enc.cliente}.`);
                $('custom-abono-modal').classList.add('hidden');
            } else {
                if (typeof showBlockingAlert === 'function') window.showBlockingAlert('Error', 'El monto debe ser mayor a 0.');
            }
        }
    };

    window.renderEncargos = function () {
        window.ensurePhase2Data();
        const container = $('encargos-container');
        if (!container) return;

        let totalMonto = 0;
        let totalRecibido = 0;
        let totalDeuda = 0;
        let activosCount = 0;

        window.appData.encargos.forEach(enc => {
            if (enc.estado !== 'Entregado') {
                totalMonto += parseFloat(enc.montoTotal || 0);
                totalRecibido += parseFloat(enc.abono || 0);
                totalDeuda += parseFloat(enc.saldo || 0);
                activosCount++;
            }
        });

        if ($('encargos-metric-total')) $('encargos-metric-total').innerText = '$' + totalMonto.toFixed(2);
        if ($('encargos-metric-abonos')) $('encargos-metric-abonos').innerText = '$' + totalRecibido.toFixed(2);
        if ($('encargos-metric-debt')) $('encargos-metric-debt').innerText = '$' + totalDeuda.toFixed(2);
        if ($('encargos-metric-active')) $('encargos-metric-active').innerText = activosCount;

        if (window.appData.encargos.length === 0) {
            container.innerHTML = '<div class="col-span-full text-center py-10 text-gray-500 text-xs italic border border-white/10 rounded-xl backdrop-blur-xl">No hay encargos registrados.</div>';
            return;
        }

        // Ordenar por ID inverso (más nuevos primero)
        const sortedEncargos = [...window.appData.encargos].sort((a, b) => b.id - a.id);

        container.innerHTML = sortedEncargos.map(enc => {
            // Estilos de estado
            let statusColor = 'text-amber-400 bg-amber-500/20 border-amber-500/40';
            let statusIcon = 'fa-clock';
            let nextStatus = 'En Camino';
            if (enc.estado === 'En Camino') {
                statusColor = 'text-sky-400 bg-sky-500/20 border-sky-500/40';
                statusIcon = 'fa-plane';
                nextStatus = 'Entregado';
            } else if (enc.estado === 'Entregado') {
                statusColor = 'text-emerald-400 bg-emerald-500/20 border-emerald-500/40';
                statusIcon = 'fa-check-double';
                nextStatus = 'Pedido';
            }

            // Barra de progreso
            let prog = 33;
            if (enc.estado === 'En Camino') prog = 66;
            if (enc.estado === 'Entregado') prog = 100;

            const itemsHtml = (enc.items || []).map(it => `<div class="flex justify-between text-[10px] text-gray-300 border-b border-white/5 py-1.5 last:border-0"><span class="truncate pr-2"><i class="fa-solid fa-angle-right text-[8px] text-sky-500/50 mr-1"></i>${it.name}</span><span class="font-bold text-sky-200">$${parseFloat(it.price).toFixed(2)}</span></div>`).join('');

            return `<div class="glass-card p-5 relative flex flex-col justify-between border border-white/10 hover:border-sky-500/25 transition-colors group">
                <div class="mb-3 flex justify-between items-start gap-2">
                    <div class="min-w-0 flex-1">
                        <span class="text-[9px] font-bold uppercase tracking-wider text-sky-400">Encargo · ${enc.prioridad}</span>
                        <h3 class="font-bold text-white text-sm truncate">${enc.cliente}</h3>
                    </div>
                    <span class="text-[9px] font-bold px-2 py-0.5 rounded border whitespace-nowrap cursor-pointer hover:opacity-80 transition-opacity ${statusColor}" onclick="window.updateEncargoStatus(${enc.id}, '${nextStatus}')" title="Clic para avanzar estado"><i class="fa-solid ${statusIcon} mr-1"></i>${enc.estado}</span>
                </div>
                
                <div class="mb-3 text-[10px] text-gray-400"><i class="fa-regular fa-calendar mr-1"></i>${enc.fecha}</div>
                
                <div class="rounded p-2 border border-sky-500/20 mb-3 bg-black/20 max-h-28 overflow-y-auto custom-scrollbar">
                    ${itemsHtml}
                </div>

                <div class="grid grid-cols-3 gap-2 mb-3 text-center">
                    <div class="bg-white/5 rounded p-1.5 border border-white/5"><p class="text-[8px] text-slate-400 uppercase font-bold">Total</p><p class="font-bold text-white text-[10px]">$${parseFloat(enc.montoTotal||0).toFixed(2)}</p></div>
                    <div class="bg-white/5 rounded p-1.5 border border-white/5 relative group cursor-pointer hover:bg-emerald-500/10 transition-colors" onclick="window.addEncargoAbono(${enc.id})" title="Registrar Abono"><p class="text-[8px] text-slate-400 uppercase font-bold">Abono <i class="fa-solid fa-plus text-emerald-400 ml-0.5 opacity-50 group-hover:opacity-100"></i></p><p class="font-bold text-emerald-400 text-[10px]">$${parseFloat(enc.abono||0).toFixed(2)}</p></div>
                    <div class="bg-amber-900/20 rounded p-1.5 border border-amber-500/30"><p class="text-[8px] text-amber-500/70 uppercase font-bold">Saldo</p><p class="font-bold text-amber-400 text-[10px]">$${parseFloat(enc.saldo||0).toFixed(2)}</p></div>
                </div>

                <div class="mb-3">
                    <div class="flex justify-between text-[9px] text-slate-400 mb-1"><span>Progreso</span><span>${prog}%</span></div>
                    <div class="progress-bar-bg"><div class="progress-bar-fill theme-bg-gradient shadow-[0_0_10px_var(--t-primary)] transition-all duration-500" style="width:${prog}%"></div></div>
                </div>

                <div class="flex flex-wrap gap-2 border-t border-white/10 pt-2 mt-auto">
                    <button type="button" onclick="window.addEncargoAbono(${enc.id})" class="flex-[0.5] py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 text-[10px] font-bold transition-colors" title="Registrar Abono"><i class="fa-solid fa-money-bill-transfer"></i></button>
                    <button type="button" onclick="window.openEncargoModal(${enc.id})" class="flex-1 py-2 rounded-lg bg-white/10 border border-white/10 text-white hover:text-sky-400 text-[10px] font-bold transition-colors"><i class="fa-solid fa-pen mr-1"></i>Editar</button>
                    <button type="button" onclick="window.open('https://wa.me/?text=Hola%20${encodeURIComponent(enc.cliente)}%2C%20tu%20encargo%20est%C3%A1%20${encodeURIComponent(enc.estado)}.%20Saldo%20restante%3A%20%24${parseFloat(enc.saldo||0).toFixed(2)}', '_blank')" class="py-2 px-3 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30 text-[10px] font-bold transition-colors" title="WhatsApp"><i class="fa-brands fa-whatsapp"></i></button>
                    <button type="button" onclick="window.openCustomConfirm('Eliminar Encargo', '¿Eliminar este encargo de forma permanente?', () => { window.appData.encargos = window.appData.encargos.filter(x => x.id !== ${enc.id}); if(typeof window.save==='function') window.save(); window.renderEncargos(); })" class="py-2 px-3 rounded-lg bg-white/10 border border-white/10 text-gray-400 hover:bg-red-500/20 hover:text-red-400 text-[10px] transition-colors"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>`;
        }).join('');
    };

}); /* fin DOMContentLoaded */
