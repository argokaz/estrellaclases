(function () {
  'use strict';

  var VALID = { sec2a: '2.° Secundaria A', sec2b: '2.° Secundaria B' };
  var params = new URLSearchParams(window.location.search);
  var selected = VALID[params.get('aula')] ? params.get('aula') : '';

  var ROSTERS = {
    sec2a: [
      'Breixo Daichi Berrios Santos',
      'Jordan Rodrigo Bujaico Garcia',
      'Almudena Milagros Caycho Mendoza',
      'Maria Angela Quilla Curi Mayhuire',
      'Jesus Adrian Flores Mamani',
      'Zoe Akari Jorge Jorge',
      'Alejandra Katalella Loza Rojas',
      'Miley Aileen Ñahui Saavedra',
      'Joshua Emanuel Panta de las Casas',
      'Tatiana Gabriela Rivas Comitivo',
      'Sofia Alexandra Rojas Chuco',
      'Maximo Lionel Isaac Saavedra Napan',
      'Joe Valentino Salcedo Palomino',
      'Naomi Ysamar Siesquen Castañeda',
      'Julio Angelo Torres Sanchez',
      'Leysi Montaño Ramos',
    ],
    sec2b: [
      'Fabianna Zoe Aliaga Llamccaya',
      'Gonzalo Antonio Anco Malca',
      'Amy Anahi Alexia Barreto Rojas',
      'Sayuri Dariana Bastidas Salinas',
      'Dana Marycielo Chafloque Chuco',
      'Rodrigo Andree Cieza Zanabria',
      'Valentino Aldair Lopez Pajuelo',
      'Astridth Minelly Montaño Ramos',
      'Verioska Valery Perez Calle',
      'Gael Adriano Ramos Ore',
      'Victoria Guadalupe Rojas Ocanto',
      'James Johann Santa Cruz Holguin',
      'Camila Antuanet Soto Huamani',
      'Luciana Mayte Soto Huamani',
      'Jasmin Fatima Torrejon Sanchez',
    ],
  };

  function norm(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  var sectionByName = {};
  Object.keys(ROSTERS).forEach(function (grade) {
    ROSTERS[grade].forEach(function (name) { sectionByName[norm(name)] = grade; });
  });
  // Nombre histórico de Leysi: permite rescatar envíos que sigan pendientes
  // en una laptop del colegio después de publicar la separación.
  sectionByName[norm('Leisy Mabel Montano Ramos')] = 'sec2a';
  sectionByName[norm('Leysi Montaño')] = 'sec2a';

  window.SEC2_SECTION = selected || 'sec2';
  window.SEC2_SECTION_LABEL = selected ? VALID[selected] : '2.° Secundaria';
  window.SEC2_ROSTERS = ROSTERS;

  var originalFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var rawUrl = typeof input === 'string' ? input : (input && input.url) || '';

    // Sin aula elegida no se permite que una página antigua consulte ni escriba
    // como el salón combinado. El selector recarga con ?aula=sec2a|sec2b.
    if (!selected && rawUrl.indexOf('/.netlify/functions/') >= 0) {
      return new Promise(function () {});
    }

    var nextInput = input;
    if (selected && typeof input === 'string' && input.indexOf('grado=sec2') >= 0) {
      nextInput = input.replace(/([?&]grado=)sec2(?=(&|$))/g, '$1' + selected);
    }

    var nextInit = init;
    if (selected && init && typeof init.body === 'string') {
      try {
        var body = JSON.parse(init.body);
        var changed = false;
        if (body.grado === 'sec2') {
          body.grado = sectionByName[norm(body.nombre)] || selected;
          changed = true;
        }
        if (body.grade === 'sec2') {
          body.grade = selected;
          changed = true;
        }
        if (changed) nextInit = Object.assign({}, init, { body: JSON.stringify(body) });
      } catch (_) {}
    }

    return originalFetch(nextInput, nextInit);
  };

  function choose(grade) {
    var next = new URL(window.location.href);
    next.searchParams.set('aula', grade);
    window.location.replace(next.pathname + next.search + next.hash);
  }

  function renderSelector() {
    var overlay = document.createElement('div');
    overlay.id = 'sec2-section-selector';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'sec2-selector-title');
    overlay.innerHTML =
      '<div class="sec2-selector-card">' +
        '<span class="sec2-selector-kicker">MISMO MATERIAL · DATOS SEPARADOS</span>' +
        '<h1 id="sec2-selector-title">¿En qué salón estás?</h1>' +
        '<p>Elige antes de continuar para cargar la lista, ruleta, notas y tareas correctas.</p>' +
        '<div class="sec2-selector-actions">' +
          '<button type="button" data-aula="sec2a"><b>2.° A</b><span>16 alumnos</span></button>' +
          '<button type="button" data-aula="sec2b"><b>2.° B</b><span>15 alumnos</span></button>' +
        '</div>' +
      '</div>';
    overlay.querySelectorAll('[data-aula]').forEach(function (button) {
      button.addEventListener('click', function () { choose(button.dataset.aula); });
    });
    document.body.appendChild(overlay);
    setTimeout(function () { overlay.querySelector('button').focus(); }, 0);
  }

  function renderBadge() {
    var badge = document.createElement('button');
    badge.id = 'sec2-section-badge';
    badge.type = 'button';
    badge.title = 'Cambiar de salón';
    badge.innerHTML = '<strong>' + VALID[selected] + '</strong><span>Cambiar</span>';
    badge.addEventListener('click', function () {
      var next = new URL(window.location.href);
      next.searchParams.delete('aula');
      window.location.assign(next.pathname + next.search + next.hash);
    });
    document.body.appendChild(badge);
  }

  document.addEventListener('DOMContentLoaded', function () {
    var style = document.createElement('style');
    style.textContent =
      '#sec2-section-selector{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(5,12,28,.94);backdrop-filter:blur(12px);font-family:Inter,system-ui,sans-serif;color:#eaf2ff}' +
      '.sec2-selector-card{width:min(560px,100%);padding:clamp(28px,6vw,48px);border:1px solid rgba(96,165,250,.35);border-radius:24px;background:#0c1930;box-shadow:0 24px 80px rgba(0,0,0,.45);text-align:center}' +
      '.sec2-selector-kicker{display:block;margin-bottom:12px;color:#60a5fa;font-size:12px;font-weight:900;letter-spacing:.12em}' +
      '.sec2-selector-card h1{margin:0;color:#fff;font-size:clamp(30px,7vw,48px);line-height:1.05}' +
      '.sec2-selector-card p{margin:16px auto 28px;max-width:440px;color:#b8c7dd;font-size:16px;line-height:1.55}' +
      '.sec2-selector-actions{display:grid;grid-template-columns:1fr 1fr;gap:14px}' +
      '.sec2-selector-actions button{min-height:116px;border:1px solid rgba(96,165,250,.45);border-radius:18px;background:#132849;color:#fff;cursor:pointer;font:inherit;transition:transform .16s,background .16s}' +
      '.sec2-selector-actions button:hover,.sec2-selector-actions button:focus{outline:3px solid rgba(96,165,250,.32);background:#1d4f91;transform:translateY(-2px)}' +
      '.sec2-selector-actions b{display:block;font-size:30px}.sec2-selector-actions span{display:block;margin-top:6px;color:#b8c7dd;font-size:14px}' +
      '#sec2-section-badge{position:fixed;top:12px;right:12px;z-index:2147483000;display:flex;align-items:center;gap:8px;padding:8px 11px;border:1px solid rgba(96,165,250,.5);border-radius:999px;background:rgba(8,23,48,.92);box-shadow:0 6px 24px rgba(0,0,0,.28);color:#fff;cursor:pointer;font:700 12px/1.1 Inter,system-ui,sans-serif}' +
      '#sec2-section-badge span{color:#93c5fd;font-size:10px;text-transform:uppercase;letter-spacing:.06em}' +
      '@media(max-width:520px){.sec2-selector-actions{grid-template-columns:1fr}.sec2-selector-actions button{min-height:92px}#sec2-section-badge{top:8px;right:8px}}';
    document.head.appendChild(style);

    document.querySelectorAll('[data-grade="sec2"]').forEach(function (el) {
      if (selected) el.dataset.grade = selected;
    });

    if (selected) renderBadge();
    else renderSelector();
  });
})();
