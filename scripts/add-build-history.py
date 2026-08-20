#!/usr/bin/env python3
"""Inject a compact build badge + version history popover into index.html.

Idempotent by marker. This keeps the first formal build number visible in the
UI and leaves a human-readable history for future Codex/Claude work.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "index.html"
MARKER = "BUILD_HISTORY_WIDGET"
BUILD = "20260819.1"

CSS = r'''
/* BUILD_HISTORY_WIDGET */
.build-version-trigger{
  position:fixed;left:10px;bottom:10px;z-index:1800;
  border:1px solid rgba(0,0,0,.14);background:rgba(255,255,255,.92);
  color:#555;border-radius:999px;padding:5px 9px;
  font:600 10px/1.2 'Inter',system-ui,sans-serif;letter-spacing:.02em;
  box-shadow:0 4px 14px rgba(0,0,0,.08);backdrop-filter:blur(10px);
  cursor:pointer;opacity:.78;transition:opacity .15s,border-color .15s,background .15s;
}
.build-version-trigger:hover,.build-version-trigger:focus-visible{opacity:1;background:#fff;border-color:#999;}
.build-version-popover{
  display:none;position:fixed;left:10px;bottom:43px;z-index:1810;
  width:min(380px,calc(100vw - 20px));max-height:min(62vh,560px);overflow:auto;
  background:#fff;color:#111;border:1px solid #ddd;border-radius:14px;
  box-shadow:0 18px 50px rgba(0,0,0,.16);padding:14px 14px 12px;
  font-family:'Inter',system-ui,sans-serif;
}
.build-version-popover.open{display:block;}
.build-version-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:10px;}
.build-version-head strong{font:800 15px/1.2 'Space Grotesk','Inter',sans-serif;}
.build-version-current{font-size:11px;color:#666;margin-top:3px;}
.build-version-close{border:0;background:#f3f3f1;color:#555;border-radius:7px;padding:4px 7px;font-size:12px;cursor:pointer;}
.build-version-list{display:flex;flex-direction:column;gap:9px;}
.build-version-item{border-top:1px solid #ecece8;padding-top:9px;}
.build-version-item:first-child{border-top:0;padding-top:0;}
.build-version-meta{display:flex;gap:7px;flex-wrap:wrap;align-items:center;margin-bottom:4px;}
.build-version-tag{font:800 11px/1 'Space Grotesk','Inter',sans-serif;color:#111;}
.build-version-date{font-size:10px;color:#777;}
.build-version-title{font-size:12px;font-weight:700;color:#222;margin-bottom:3px;}
.build-version-changes{margin:0;padding-left:17px;color:#555;font-size:11px;line-height:1.45;}
.build-version-foot{border-top:1px solid #ecece8;margin-top:10px;padding-top:8px;font-size:10px;color:#888;line-height:1.4;}
@media(max-width:520px){
  .build-version-trigger{left:8px;bottom:8px;}
  .build-version-popover{left:8px;bottom:39px;width:calc(100vw - 16px);max-height:68vh;}
}
'''

WIDGET = r'''
<!-- BUILD_HISTORY_WIDGET -->
<button id="build-version-trigger" class="build-version-trigger" type="button"
  aria-haspopup="dialog" aria-expanded="false" aria-controls="build-version-popover"
  onclick="toggleBuildHistory()">Build 20260819.1</button>

<section id="build-version-popover" class="build-version-popover" role="dialog"
  aria-modal="false" aria-labelledby="build-version-title">
  <div class="build-version-head">
    <div>
      <strong id="build-version-title">Historial de versiones</strong>
      <div class="build-version-current">Build actual: 20260819.1 · 19 ago 2026</div>
    </div>
    <button class="build-version-close" type="button" onclick="closeBuildHistory()" aria-label="Cerrar historial">✕</button>
  </div>

  <div class="build-version-list">
    <article class="build-version-item">
      <div class="build-version-meta"><span class="build-version-tag">Build 20260819.1</span><span class="build-version-date">19 ago 2026</span></div>
      <div class="build-version-title">Seguridad docente + versionado visible</div>
      <ul class="build-version-changes">
        <li>La contraseña docente deja de estar incrustada en el frontend y en fallbacks del backend.</li>
        <li>El acceso de profesora pasa a una sesión temporal firmada; lecturas protegidas usan Authorization.</li>
        <li>La contraseña deja de viajar en URLs/query strings.</li>
        <li>Se agrega este build number y el historial de cambios dentro de la interfaz.</li>
      </ul>
    </article>

    <article class="build-version-item">
      <div class="build-version-meta"><span class="build-version-tag">9f30d2b</span><span class="build-version-date">19 ago 2026</span></div>
      <div class="build-version-title">Protección de datos y papelera</div>
      <ul class="build-version-changes">
        <li>Papelera recuperable para alumnos, evaluaciones, tareas y puntos.</li>
        <li>Deshacer/restaurar eliminaciones y panel de salud de datos.</li>
        <li>Selector oficial de alumno para entregar tareas y protección contra doble envío.</li>
        <li>Mejoras de accesibilidad y comportamiento móvil.</li>
      </ul>
    </article>

    <article class="build-version-item">
      <div class="build-version-meta"><span class="build-version-tag">0cc7f24</span><span class="build-version-date">18 ago 2026</span></div>
      <div class="build-version-title">Guardado más seguro</div>
      <ul class="build-version-changes">
        <li>Blindaje de evaluaciones y tareas para evitar pérdidas silenciosas o asignaciones incorrectas.</li>
      </ul>
    </article>

    <article class="build-version-item">
      <div class="build-version-meta"><span class="build-version-tag">c2444b6</span><span class="build-version-date">18 ago 2026</span></div>
      <div class="build-version-title">Calendario de 4.° secundaria corregido</div>
      <ul class="build-version-changes">
        <li>Fusión de S26 + S27 y soporte para aplazamientos con rango definido.</li>
      </ul>
    </article>

    <article class="build-version-item">
      <div class="build-version-meta"><span class="build-version-tag">a8bd240</span><span class="build-version-date">17 ago 2026</span></div>
      <div class="build-version-title">Cierre anual en 30 sesiones</div>
      <ul class="build-version-changes">
        <li>El año se consolida en 30 sesiones y termina el 18 de diciembre.</li>
        <li>S29/S30 absorben el cierre del plan original y se eliminan S31/S32.</li>
      </ul>
    </article>
  </div>

  <div class="build-version-foot">Desde este build, cada cambio relevante debería incrementar el build y añadir una entrada aquí. El historial anterior se conserva por commit porque aún no existía numeración formal.</div>
</section>

<script>
(function(){
  const trigger = document.getElementById('build-version-trigger');
  const popover = document.getElementById('build-version-popover');
  if(!trigger || !popover) return;

  window.toggleBuildHistory = function(){
    const open = !popover.classList.contains('open');
    popover.classList.toggle('open', open);
    trigger.setAttribute('aria-expanded', String(open));
  };
  window.closeBuildHistory = function(){
    popover.classList.remove('open');
    trigger.setAttribute('aria-expanded','false');
  };

  document.addEventListener('click', function(event){
    if(!popover.classList.contains('open')) return;
    if(popover.contains(event.target) || trigger.contains(event.target)) return;
    window.closeBuildHistory();
  });
  document.addEventListener('keydown', function(event){
    if(event.key === 'Escape' && popover.classList.contains('open')) window.closeBuildHistory();
  });
})();
</script>
'''


def main() -> None:
    text = INDEX.read_text(encoding="utf-8")
    if MARKER in text:
        print("build history already present")
        return
    if "</style>" not in text or "</body>" not in text:
        raise RuntimeError("index.html no tiene los anchors esperados")
    text = text.replace("</style>", CSS + "\n</style>", 1)
    text = text.replace("</body>", WIDGET + "\n</body>", 1)
    INDEX.write_text(text, encoding="utf-8")
    print(f"build history injected: Build {BUILD}")


if __name__ == "__main__":
    main()
