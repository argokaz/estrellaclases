/*
 * Red de seguridad de datos — evaluaciones y tareas
 *
 * Este archivo se carga antes de los failsafes históricos que quedaron dentro
 * de las páginas generadas. Al marcar sus dos banderas evitamos tener dos
 * colas compitiendo y dejamos un solo camino auditable para guardar datos.
 *
 * La base de datos sigue siendo la fuente de verdad. localStorage solo es una
 * cola de recuperación: la interfaz no debe confundir "guardado local" con
 * "confirmado por el servidor".
 */
(function () {
  'use strict';

  if (window.__dataSafetyV2) return;
  window.__dataSafetyV2 = true;
  window.__dataFailsafe = true;
  window.__evalNetInstalled = true;

  var path = location.pathname;
  var match = path.match(/\/(?:repaso|tarea)-(\d+)-([a-z0-9]+)\.html$/i);
  var SESSION = match ? String(match[1]).padStart(2, '0') : '';
  var GRADE = match ? match[2] : '';
  var isEval = /\/repaso-\d+-[a-z0-9]+\.html$/i.test(path);
  var isTask = /\/tarea-\d+-[a-z0-9]+\.html$/i.test(path);
  var EP_EVAL = '/.netlify/functions/submit-eval';
  var EP_TASK = '/.netlify/functions/submit-task';
  var EP_BONUS = '/.netlify/functions/add-bonus';
  var OUTBOX = 'dataOutboxV2';
  var LEGACY = ['dataOutboxV1', 'evalOutboxV2'];
  var nativeFetch = window.fetch.bind(window);
  var volatileQueue = [];
  var sending = false;
  var chip = null;
  var banner = null;
  var rosterByName = Object.create(null);
  var rosterReady = false;
  var rosterFailed = false;
  var identityReady = loadRoster();

  function normalize(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function nameKey(value) {
    return normalize(value).replace(/ /g, '-').replace(/^-|-$/g, '');
  }

  function showChip(text, color, ms) {
    if (!chip) {
      chip = document.createElement('div');
      chip.style.cssText = 'position:fixed;bottom:14px;left:50%;transform:translateX(-50%);z-index:99999;padding:.65rem 1.2rem;border-radius:999px;font-family:Inter,system-ui,sans-serif;font-size:14px;font-weight:700;line-height:1.25;color:#fff;box-shadow:0 4px 18px rgba(0,0,0,.3);max-width:92vw;text-align:center;transition:opacity .3s';
      document.body.appendChild(chip);
    }
    chip.textContent = text;
    chip.style.background = color || '#1d4ed8';
    chip.style.opacity = '1';
    clearTimeout(chip._timer);
    if (ms) chip._timer = setTimeout(function () { chip.style.opacity = '0'; }, ms);
  }

  function showStorageWarning() {
    if (banner) return;
    banner = document.createElement('div');
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:100000;background:#b91c1c;color:#fff;font-family:Inter,system-ui,sans-serif;font-size:14px;font-weight:700;text-align:center;padding:.65rem 1rem;box-shadow:0 2px 12px rgba(0,0,0,.3)';
    banner.textContent = '⚠️ Este navegador no pudo guardar la copia de seguridad local. No cierres esta página hasta ver la confirmación del sistema.';
    document.body.appendChild(banner);
  }

  function readStorage(key) {
    try { return localStorage.getItem(key); }
    catch (e) { showStorageWarning(); return null; }
  }

  function writeStorage(key, value) {
    try { localStorage.setItem(key, value); return true; }
    catch (e) { showStorageWarning(); return false; }
  }

  function removeStorage(key) {
    try { localStorage.removeItem(key); }
    catch (e) { showStorageWarning(); }
  }

  function readBox() {
    var raw = readStorage(OUTBOX);
    if (!raw) return volatileQueue.slice();
    try { return JSON.parse(raw).concat(volatileQueue); }
    catch (e) { showStorageWarning(); return volatileQueue.slice(); }
  }

  function writeBox(items) {
    var ok = writeStorage(OUTBOX, JSON.stringify(items));
    if (ok) volatileQueue = [];
    return ok;
  }

  function itemKey(endpoint, payload) {
    try {
      var data = JSON.parse(payload);
      if (endpoint.indexOf('add-bonus') >= 0) return 'bonus|' + (data.nombre || '') + '|' + (data.grado || '') + '|' + (data.fecha || '');
      return endpoint + '|' + (data.alumno_id || data.nombre || '') + '|' + (data.grado || '') + '|' + (data.sesion || '');
    } catch (e) { return endpoint + '|' + String(payload).length; }
  }

  function enqueue(endpoint, payload) {
    var key = itemKey(endpoint, payload);
    var items = readBox().filter(function (item) { return item.k !== key; });
    var item = { k: key, ep: endpoint, p: payload, t: Date.now(), attempts: 0 };
    items.push(item);
    if (!writeBox(items) && !volatileQueue.some(function (queued) { return queued.k === key; })) volatileQueue.push(item);
    return key;
  }

  function dequeue(key) {
    var items = readBox().filter(function (item) { return item.k !== key; });
    volatileQueue = volatileQueue.filter(function (item) { return item.k !== key; });
    writeStorage(OUTBOX, JSON.stringify(items.filter(function (item) { return volatileQueue.indexOf(item) < 0; })));
  }

  function migrateLegacy() {
    var all = [];
    LEGACY.forEach(function (legacyKey) {
      var raw = readStorage(legacyKey);
      if (!raw) return;
      try {
        var old = JSON.parse(raw) || [];
        old.forEach(function (item) {
          var ep = item.ep || (legacyKey === 'evalOutboxV2' ? EP_EVAL : null);
          if (!ep || !item.p) return;
          all.push({ k: item.k || itemKey(ep, item.p), ep: ep, p: item.p, t: item.t || Date.now(), attempts: item.attempts || 0 });
        });
        if (writeStorage(legacyKey, '[]')) { /* migrado */ }
      } catch (e) { showStorageWarning(); }
    });
    if (!all.length) return;
    var current = readBox();
    var byKey = Object.create(null);
    current.concat(all).forEach(function (item) { byKey[item.k] = item; });
    writeBox(Object.keys(byKey).map(function (key) { return byKey[key]; }));
  }

  function loadRoster() {
    var keyEl = document.getElementById('eval-grade-key');
    var grade = (keyEl && keyEl.dataset.grade) || GRADE;
    if (!grade || (!isEval && !isTask)) return Promise.resolve(null);
    return nativeFetch('/.netlify/functions/get-roster?grado=' + encodeURIComponent(grade))
      .then(function (response) {
        if (!response.ok) throw new Error('roster ' + response.status);
        return response.json();
      })
      .then(function (data) {
        (data.alumnos || []).forEach(function (student) {
          rosterByName[normalize(student.nombre)] = student;
        });
        rosterReady = true;
        return rosterByName;
      })
      .catch(function () {
        rosterFailed = true;
        return null;
      });
  }

  function addCanonicalId(endpoint, body) {
    var data;
    try { data = JSON.parse(body); } catch (e) { return body; }
    if (endpoint !== EP_EVAL && endpoint !== EP_TASK) return body;
    var official = rosterByName[normalize(data.nombre)];
    if (official && official.id) {
      data.alumno_id = official.id;
      data.nombre = official.nombre;
    }
    return JSON.stringify(data);
  }

  function draftKey(name) {
    var official = rosterByName[normalize(name)];
    return 'taskDraftV2-' + SESSION + '-' + GRADE + '-' + (official && official.id ? official.id : nameKey(name));
  }

  function currentTaskValues() {
    var name = document.getElementById('inp-nombre');
    var link = document.getElementById('inp-link');
    var comment = document.getElementById('inp-comment');
    return {
      nombre: name ? name.value.trim() : '',
      link: link ? link.value : '',
      comentario: comment ? comment.value : '',
      t: Date.now()
    };
  }

  var lastDraftKey = '';
  function saveTaskDraft() {
    if (!isTask) return;
    var values = currentTaskValues();
    if (!values.nombre) return;
    var key = draftKey(values.nombre);
    lastDraftKey = key;
    writeStorage(key, JSON.stringify(values));
  }

  function restoreTaskDraft() {
    if (!isTask) return;
    var name = document.getElementById('inp-nombre');
    if (!name || !name.value.trim()) return;
    var key = draftKey(name.value.trim());
    if (key === lastDraftKey) return;
    var raw = readStorage(key);
    if (!raw) return;
    try {
      var draft = JSON.parse(raw);
      var link = document.getElementById('inp-link');
      var comment = document.getElementById('inp-comment');
      if (link && !link.value) link.value = draft.link || '';
      if (comment && !comment.value) comment.value = draft.comentario || '';
      lastDraftKey = key;
      showChip('↩️ Recuperamos tu borrador guardado','#1d4ed8',5000);
    } catch (e) { /* borrador corrupto: no interrumpir la entrega */ }
  }

  function clearTaskDraft(payload) {
    if (!isTask) return;
    try {
      var data = JSON.parse(payload);
      if (data.nombre) removeStorage(draftKey(data.nombre));
    } catch (e) {}
  }

  function setupTaskDraft() {
    if (!isTask) return;
    var form = document.getElementById('form-section');
    if (!form) return;
    var timer = null;
    form.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(saveTaskDraft, 250);
    }, true);
    var name = document.getElementById('inp-nombre');
    if (name) {
      name.addEventListener('change', restoreTaskDraft, true);
      name.addEventListener('blur', function () { setTimeout(restoreTaskDraft, 100); }, true);
    }
    window.addEventListener('pagehide', saveTaskDraft);
  }

  function evalIdentity() {
    if (!isEval) return null;
    var nameEl = document.getElementById('eval-student-name') || document.getElementById('exam-who-name');
    var name = nameEl && nameEl.textContent.trim();
    if (!name) return null;
    var official = rosterByName[normalize(name)];
    return { name: name, key: official && official.id ? official.id : nameKey(name) };
  }

  function evalProgressKey(identity) {
    return 'evalProgressV3-' + SESSION + '-' + GRADE + '-' + identity.key;
  }

  function saveEvalProgress() {
    var identity = evalIdentity();
    if (!identity) return;
    var selected = {};
    document.querySelectorAll('.eval-q input[type="radio"]:checked').forEach(function (input) {
      selected[input.name] = input.value;
    });
    writeStorage(evalProgressKey(identity), JSON.stringify({ sel: selected, t: Date.now(), nombre: identity.name }));
  }

  var restoredEvalKey = '';
  function restoreEvalProgress() {
    var identity = evalIdentity();
    if (!identity) return;
    var key = evalProgressKey(identity);
    if (key === restoredEvalKey) return;
    restoredEvalKey = key;
    var raw = readStorage(key);
    if (!raw) return;
    try {
      var state = JSON.parse(raw);
      if (!state || !state.sel || Date.now() - (state.t || 0) > 6 * 3600 * 1000) {
        removeStorage(key);
        return;
      }
      Object.keys(state.sel).forEach(function (inputName) {
        var selector = 'input[name="' + inputName + '"][value="' + state.sel[inputName] + '"]';
        var input = document.querySelector(selector);
        if (input && !input.disabled) input.checked = true;
      });
      if (typeof window.updateAnswered === 'function') window.updateAnswered();
      showChip('↩️ Recuperamos tu progreso de esta evaluación','#1d4ed8',5000);
    } catch (e) { /* no bloquear el examen por un borrador corrupto */ }
  }

  window.__recordEvalResult = function (key, result) {
    if (!writeStorage(key, JSON.stringify(result))) {
      showChip('⚠️ No se pudo guardar la copia local; mantén esta página abierta hasta confirmar el envío','#b91c1c');
    }
  };

  // Compatibilidad con repasos antiguos que escriben directamente en
  // localStorage antes de iniciar el POST. Un fallo de cuota no puede cortar
  // la función de envío antes de que la cola reciba el payload.
  window.__safeSetItem = function (key, value) { return writeStorage(key, value); };
  window.__safeGetItem = function (key) { return readStorage(key); };
  window.__safeRemoveItem = function (key) { removeStorage(key); };

  function isTaskUnassigned(endpoint, data) {
    return endpoint === EP_TASK && data && data.matched === false;
  }

  function isSaved(endpoint, data) {
    if (!data || data.ok === false) return false;
    return true;
  }

  function messageForUnassigned(data) {
    return (data && data.mensaje) || 'Guardamos tu entrega, pero falta vincularla a tu nombre. Avísale a la profesora.';
  }

  function parseResponse(response) {
    return response.clone().json();
  }

  function transformedUnassignedResponse(data) {
    if (typeof Response === 'undefined') return null;
    return new Response(JSON.stringify({
      ok: false,
      saved: true,
      matched: false,
      requiresReview: true,
      error: messageForUnassigned(data)
    }), { status: 409, headers: { 'Content-Type': 'application/json' } });
  }

  function finishSaved(endpoint, key, payload, data) {
    dequeue(key);
    if (endpoint === EP_TASK && data && data.matched === true) clearTaskDraft(payload);
    if (data && data.sinAsignar) {
      showChip('⚠️ Guardado, pero queda pendiente de asignar a un alumno','#b45309',9000);
    } else if (isTaskUnassigned(endpoint, data)) {
      showChip('⚠️ Guardado, pero falta confirmar el alumno','#b45309',9000);
    } else {
      showChip('✅ Guardado y confirmado por el sistema' + (data && data.alumno ? ' · ' + data.alumno : ''),'#15803d',7000);
    }
  }

  function flush() {
    if (sending) return;
    var items = readBox();
    if (!items.length) return;
    sending = true;
    var item = items[0];
    var body = addCanonicalId(item.ep, item.p);
    item.attempts = (item.attempts || 0) + 1;
    nativeFetch(item.ep, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body })
      .then(function (response) {
        if (!response.ok) {
          return parseResponse(response).then(function (data) {
            if (data && data.identidadInvalida) {
              dequeue(item.k);
              showChip('⚠️ La identidad cambió; vuelve a elegir tu nombre antes de enviar','#b91c1c',9000);
              return;
            }
            throw new Error('HTTP ' + response.status);
          });
        }
        return parseResponse(response).then(function (data) {
          if (!isSaved(item.ep, data)) throw new Error('respuesta no confirmada');
          finishSaved(item.ep, item.k, body, data);
        });
      })
      .then(function () {
        sending = false;
        if (readBox().length) setTimeout(flush, 400);
      })
      .catch(function () {
        sending = false;
        showChip('📡 Guardando… no cierres esta página todavía','#b45309');
      });
  }

  function beaconAll() {
    if (!navigator.sendBeacon) return;
    readBox().forEach(function (item) {
      try {
        var body = addCanonicalId(item.ep, item.p);
        navigator.sendBeacon(item.ep, new Blob([body], { type: 'application/json' }));
      } catch (e) { showStorageWarning(); }
    });
  }

  function installFetchGuard() {
    window.fetch = function (url, options) {
      var endpoint = typeof url === 'string' && (url.indexOf(EP_EVAL) >= 0 || url.indexOf(EP_TASK) >= 0 || url.indexOf(EP_BONUS) >= 0)
        ? (url.indexOf(EP_EVAL) >= 0 ? EP_EVAL : url.indexOf(EP_TASK) >= 0 ? EP_TASK : EP_BONUS) : null;
      if (!endpoint || !options || !options.body) return nativeFetch(url, options);
      var originalBody = options.body;
      var prepared = identityReady.then(function () { return addCanonicalId(endpoint, originalBody); });
      return prepared.then(function (body) {
        var key = enqueue(endpoint, body);
        showChip('⏳ Guardando…','#1d4ed8');
        var next = {};
        Object.keys(options).forEach(function (prop) { next[prop] = options[prop]; });
        next.body = body;
        return nativeFetch(url, next).then(function (response) {
          if (!response.ok) {
            return parseResponse(response).then(function (data) {
              if (data && data.identidadInvalida) {
                dequeue(key);
                showChip('⚠️ La identidad cambió; vuelve a elegir tu nombre antes de enviar','#b91c1c',9000);
              } else {
                setTimeout(flush, 1200);
              }
              return response;
            }).catch(function () { setTimeout(flush, 1200); return response; });
          }
          return parseResponse(response).then(function (data) {
            if (isTaskUnassigned(endpoint, data)) {
              finishSaved(endpoint, key, body, data);
              return transformedUnassignedResponse(data) || response;
            }
            if (!isSaved(endpoint, data)) { setTimeout(flush, 1200); return response; }
            finishSaved(endpoint, key, body, data);
            return response;
          }).catch(function () { setTimeout(flush, 1200); return response; });
        }).catch(function (error) {
          setTimeout(flush, 1200);
          throw error;
        });
      });
    };
  }

  migrateLegacy();
  installFetchGuard();
  setupTaskDraft();
  if (isEval) {
    document.addEventListener('change', function (event) {
      if (event.target && event.target.type === 'radio' && /^eq\d+$/.test(event.target.name || '')) saveEvalProgress();
    }, true);
    setInterval(restoreEvalProgress, 400);
  }
  setInterval(flush, 8000);
  window.addEventListener('online', flush);
  setTimeout(flush, 1500);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') beaconAll(); });
  window.addEventListener('pagehide', function () { saveTaskDraft(); saveEvalProgress(); beaconAll(); });
})();
