#!/usr/bin/env python3
"""Apply the teacher-auth hardening migration.

This script is intentionally idempotent and exists as a handoff artifact: Codex
can re-run it on a checkout to reproduce/inspect the migration instead of
reverse-engineering a giant index.html diff.
"""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
FUNCTIONS = ROOT / "netlify" / "functions"
INDEX = ROOT / "index.html"


def save(path: Path, old: str, new: str) -> None:
    if old != new:
        path.write_text(new, encoding="utf-8")
        print("updated", path.relative_to(ROOT))


def add_teacher_auth_import(text: str, quote="'") -> str:
    if "requireTeacher" in text:
        return text
    # Put it after the last top-level require near the beginning.
    matches = list(re.finditer(r"^const .*?= require\([^\n]+\);\s*$", text, re.M))
    if not matches:
        raise RuntimeError("No require() anchor found")
    m = matches[-1]
    line = f"\nconst {{ requireTeacher }} = require({quote}./_teacherAuth{quote});"
    return text[:m.end()] + line + text[m.end():]


def auth_response(headers="CORS") -> str:
    return (
        "  const auth = requireTeacher(event);\n"
        f"  if (!auth.ok) return {{ statusCode: auth.statusCode, headers: {headers}, body: JSON.stringify({{ error: auth.error }}) }};\n"
    )


def patch_get_results() -> None:
    p = FUNCTIONS / "get-results.js"
    s = p.read_text(encoding="utf-8")
    old = s
    s = s.replace("GET /.netlify/functions/get-results?pw=...&session=02&grado=sec2",
                  "GET /.netlify/functions/get-results?session=02&grado=sec2 (Authorization: Bearer …)")
    s = re.sub(r'^const TEACHER_PW\s*=.*?;\s*\n', '', s, flags=re.M)
    s = add_teacher_auth_import(s, '"')
    s = s.replace('"Access-Control-Allow-Headers": "Content-Type",',
                  '"Access-Control-Allow-Headers": "Content-Type, Authorization",')
    legacy = "  const params = event.queryStringParameters || {};\n  if (params.pw !== TEACHER_PW) return { statusCode: 401, headers: CORS, body: '{\"error\":\"Unauthorized\"}' };\n"
    if legacy in s:
        s = s.replace(legacy, auth_response() + "\n  const params = event.queryStringParameters || {};\n")
    save(p, old, s)


def patch_get_tasks() -> None:
    p = FUNCTIONS / "get-tasks.js"
    s = p.read_text(encoding="utf-8")
    old = s
    s = s.replace("GET /.netlify/functions/get-tasks?pw=...&session=05&grado=prim6",
                  "GET /.netlify/functions/get-tasks?session=05&grado=prim6 (Authorization: Bearer …)")
    s = re.sub(r'^const TEACHER_PW\s*=.*?;\s*\n', '', s, flags=re.M)
    s = add_teacher_auth_import(s)
    s = s.replace('"Access-Control-Allow-Headers": "Content-Type",',
                  '"Access-Control-Allow-Headers": "Content-Type, Authorization",')
    s = s.replace("  const { pw, session, grado } = event.queryStringParameters || {};\n  if (pw !== TEACHER_PW) return { statusCode: 401, headers: CORS, body: '{\"error\":\"Unauthorized\"}' };\n",
                  auth_response() + "\n  const { session, grado } = event.queryStringParameters || {};\n")
    save(p, old, s)


def patch_get_libreta() -> None:
    p = FUNCTIONS / "get-libreta.js"
    s = p.read_text(encoding="utf-8")
    old = s
    s = s.replace("GET /.netlify/functions/get-libreta?pw=...",
                  "GET /.netlify/functions/get-libreta (Authorization: Bearer …)")
    s = re.sub(r'^const TEACHER_PW\s*=.*?;\s*\n', '', s, flags=re.M)
    s = add_teacher_auth_import(s, '"')
    s = s.replace('"Access-Control-Allow-Headers": "Content-Type",',
                  '"Access-Control-Allow-Headers": "Content-Type, Authorization",')
    legacy = "  const params = event.queryStringParameters || {};\n  if (params.pw !== TEACHER_PW) return { statusCode: 401, headers: CORS, body: '{\"error\":\"Unauthorized\"}' };\n"
    if legacy in s:
        s = s.replace(legacy, auth_response())
    save(p, old, s)


def patch_health() -> None:
    p = FUNCTIONS / "health.js"
    s = p.read_text(encoding="utf-8")
    old = s
    s = re.sub(r'^const TEACHER_PW\s*=.*?;\s*\n', '', s, flags=re.M)
    s = add_teacher_auth_import(s)
    s = s.replace("'Access-Control-Allow-Headers': 'Content-Type',",
                  "'Access-Control-Allow-Headers': 'Content-Type, Authorization',")
    legacy = "  const params = event.queryStringParameters || {};\n  if (params.pw !== TEACHER_PW) return { statusCode: 401, headers: CORS, body: '{\"error\":\"Unauthorized\"}' };\n"
    if legacy in s:
        s = s.replace(legacy, auth_response())
    save(p, old, s)


def patch_trash() -> None:
    p = FUNCTIONS / "trash.js"
    s = p.read_text(encoding="utf-8")
    old = s
    s = re.sub(r'^const TEACHER_PW\s*=.*?;\s*\n', '', s, flags=re.M)
    s = add_teacher_auth_import(s)
    s = s.replace("'Access-Control-Allow-Headers': 'Content-Type',",
                  "'Access-Control-Allow-Headers': 'Content-Type, Authorization',")
    # Authenticate once. POST body-password remains accepted only as temporary
    # compatibility for already-generated teacher pages; query passwords are not.
    anchor = "  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };\n  const db = supabase();"
    replacement = (
        "  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };\n"
        "  const auth = requireTeacher(event, { allowBodyPassword: event.httpMethod === 'POST' });\n"
        "  if (!auth.ok) return response(auth.statusCode, { error: auth.error });\n"
        "  const db = supabase();"
    )
    if anchor in s:
        s = s.replace(anchor, replacement)
    s = s.replace("      const params = event.queryStringParameters || {};\n      if (params.pw !== TEACHER_PW) return response(401, { error: 'Unauthorized' });\n", "")
    s = s.replace("      if (body.pw !== TEACHER_PW) return response(401, { error: 'Unauthorized' });\n", "")
    save(p, old, s)


def fail_closed_legacy_functions() -> None:
    """Remove the leaked fallback from legacy POST endpoints.

    Those endpoints still accept the password in the POST body for generated
    notes pages. Crucially, missing Netlify configuration can never authenticate.
    """
    fallback_patterns = [
        r"process\.env\.TEACHER_PASSWORD\s*\|\|\s*'yoshipotosucio'",
        r'process\.env\.TEACHER_PASSWORD\s*\|\|\s*"yoshipotosucio"',
    ]
    for p in FUNCTIONS.glob("*.js"):
        if p.name in {"_teacherAuth.js", "teacher-login.js"}:
            continue
        s = p.read_text(encoding="utf-8")
        old = s
        for pat in fallback_patterns:
            s = re.sub(pat, "process.env.TEACHER_PASSWORD", s)
        if "TEACHER_PW" in s:
            # Every direct comparison must fail closed when the env var is absent.
            s = re.sub(
                r"if\s*\(\s*([^()\n]+?)\s*!==\s*TEACHER_PW\s*\)",
                r"if (!TEACHER_PW || \1 !== TEACHER_PW)",
                s,
            )
        save(p, old, s)


def patch_index() -> None:
    p = INDEX
    s = p.read_text(encoding="utf-8")
    old = s

    access_re = re.compile(
        r"const PASS_KEY\s*=\s*'cc2026_unlocked';\n"
        r"const CORRECT_PW\s*=\s*'[^']+';\n\n"
        r"function isUnlocked\(\)\{.*?\n\}\n\n"
        r"function tryUnlock\(\)\{.*?\n\}\n",
        re.S,
    )
    access_new = r"""const PASS_KEY = 'cc2026_teacher_token';
const PW_KEY   = 'cc2026_teacher_pw';

function teacherToken(){ return sessionStorage.getItem(PASS_KEY) || ''; }
function teacherPassword(){ return sessionStorage.getItem(PW_KEY) || ''; }
function isUnlocked(){ return !!teacherToken(); }
function teacherHeaders(extra){
  return Object.assign({}, extra || {}, teacherToken() ? {Authorization:'Bearer ' + teacherToken()} : {});
}
async function teacherFetch(url, options){
  const opts = Object.assign({}, options || {});
  opts.headers = teacherHeaders(opts.headers);
  const res = await fetch(url, opts);
  if(res.status === 401){
    sessionStorage.removeItem(PASS_KEY);
    if(ES_CONSOLA) pedirClave();
  }
  return res;
}
async function authenticateTeacher(password){
  const res = await fetch('/.netlify/functions/teacher-login', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({password})
  });
  const data = await res.json().catch(()=>({}));
  if(!res.ok || !data.token) throw new Error(data.error || 'Contraseña incorrecta');
  sessionStorage.setItem(PASS_KEY, data.token);
  // Compatibilidad temporal con páginas de notas ya generadas. Se borra al salir
  // y nunca vuelve a formar parte del código ni de una URL.
  sessionStorage.setItem(PW_KEY, password);
  sessionStorage.setItem('nota_pw', password);
}

async function tryUnlock(){
  const input = document.getElementById('pass-input');
  if(!input) return;
  const password = input.value;
  try{
    await authenticateTeacher(password);
    input.value = '';
    updateLogoutBtn();
    repintar();
  }catch(_){
    input.value = '';
    input.classList.add('shake');
    const err = document.getElementById('lock-err');
    if(err) err.classList.add('visible');
    setTimeout(()=> input.classList.remove('shake'), 450);
    input.focus();
  }
}
"""
    s, n = access_re.subn(access_new, s, count=1)
    if n != 1 and "cc2026_teacher_token" not in s:
        raise RuntimeError("No pude migrar el bloque ACCESS CONTROL de index.html")

    # Session storage, not persistent localStorage, for teacher auth state.
    s = s.replace("  localStorage.removeItem(PASS_KEY);", "  sessionStorage.removeItem(PASS_KEY);\n  sessionStorage.removeItem(PW_KEY);\n  sessionStorage.removeItem('nota_pw');")

    # Privileged GETs: password disappears from the URL, token goes in Authorization.
    s = s.replace("fetch(`/.netlify/functions/get-results?pw=${encodeURIComponent(CORRECT_PW)}&session=${session}`)",
                  "teacherFetch(`/.netlify/functions/get-results?session=${session}`)")
    s = s.replace("fetch('/.netlify/functions/get-libreta?pw=' + encodeURIComponent(CORRECT_PW))",
                  "teacherFetch('/.netlify/functions/get-libreta')")
    s = s.replace("let url = `/.netlify/functions/get-tasks?pw=${encodeURIComponent(CORRECT_PW)}&session=${_currentTasksSession}`;",
                  "let url = `/.netlify/functions/get-tasks?session=${_currentTasksSession}`;")
    s = s.replace("const res = await fetch(url);", "const res = await teacherFetch(url);", 1)
    s = s.replace("fetch('/.netlify/functions/trash?pw=' + encodeURIComponent(CORRECT_PW),{cache:'no-store'})",
                  "teacherFetch('/.netlify/functions/trash',{cache:'no-store'})")
    s = s.replace("fetch('/.netlify/functions/health?pw=' + encodeURIComponent(CORRECT_PW), {cache:'no-store'})",
                  "teacherFetch('/.netlify/functions/health', {cache:'no-store'})")

    # "Después" cards load both protected resources in parallel.
    s = s.replace("const pw = CORRECT_PW, nn = String(sesion).padStart(2,'0');",
                  "const nn = String(sesion).padStart(2,'0');")
    s = s.replace("fetch(`/.netlify/functions/get-results?pw=${encodeURIComponent(pw)}&session=${nn}`).then(r=>r.json()).catch(()=>null)",
                  "teacherFetch(`/.netlify/functions/get-results?session=${nn}`).then(r=>r.json()).catch(()=>null)")
    s = s.replace("fetch(`/.netlify/functions/get-tasks?pw=${encodeURIComponent(pw)}&session=${nn}&grado=${gradeId}`).then(r=>r.json()).catch(()=>null)",
                  "teacherFetch(`/.netlify/functions/get-tasks?session=${nn}&grado=${gradeId}`).then(r=>r.json()).catch(()=>null)")

    # Legacy POST endpoints keep body auth for now, but the value comes only from
    # the password entered in this browser session, never from source code.
    s = s.replace("CORRECT_PW", "teacherPassword()")
    # The global replacement above can create invalid setter expressions in the
    # old notes-bridge line; normalize it explicitly.
    s = s.replace("sessionStorage.setItem('nota_pw', teacherPassword());", "sessionStorage.setItem('nota_pw', teacherPassword());")

    # saveShifts used a localStorage boolean plus the old constant.
    s = s.replace("const pw = localStorage.getItem(PASS_KEY)==='1' ? teacherPassword() : '';",
                  "const pw = isUnlocked() ? teacherPassword() : '';")

    # Console login is now server-validated and token-based.
    old_login = re.compile(
        r"function entrarConsola\(\)\{\n"
        r"  var inp = document\.getElementById\('pass-input'\);\n"
        r"  var err = document\.getElementById\('lock-err'\);\n"
        r"  if\(inp\.value\.trim\(\) === teacherPassword\(\)\)\{.*?\n"
        r"  \}\n\}", re.S)
    new_login = r"""async function entrarConsola(){
  var inp = document.getElementById('pass-input');
  var err = document.getElementById('lock-err');
  var password = inp.value;
  try{
    await authenticateTeacher(password);
    inp.value = '';
    if(err) err.style.display = 'none';
    updateLogoutBtn();
    render();
  }catch(_){
    if(err) err.style.display = 'block';
    inp.value = '';
    inp.focus();
  }
}"""
    s, nlogin = old_login.subn(new_login, s, count=1)
    if nlogin != 1 and "await authenticateTeacher(password)" not in s:
        raise RuntimeError("No pude migrar entrarConsola()")

    # Protected GETs must use teacherFetch after URL cleanup.
    # Replace any remaining exact get-tasks `fetch(url)` in loadTasks if needed.
    load_tasks_start = s.find("async function loadTasks()")
    load_tasks_end = s.find("function renderTasks", load_tasks_start)
    if load_tasks_start >= 0 and load_tasks_end > load_tasks_start:
        chunk = s[load_tasks_start:load_tasks_end].replace("const res = await fetch(url);", "const res = await teacherFetch(url);")
        s = s[:load_tasks_start] + chunk + s[load_tasks_end:]

    if "yoshipotosucio" in s:
        raise RuntimeError("La contraseña histórica sigue presente en index.html")
    if "CORRECT_PW" in s:
        raise RuntimeError("Quedó una referencia a CORRECT_PW en index.html")
    if re.search(r"[?&]pw=", s):
        raise RuntimeError("Quedó una contraseña en query string dentro de index.html")

    save(p, old, s)


def verify_tree() -> None:
    leaked = []
    query_pw = []
    for p in ROOT.rglob("*"):
        if not p.is_file() or ".git" in p.parts:
            continue
        if p.suffix not in {".js", ".html", ".md", ".py", ".toml"}:
            continue
        text = p.read_text(encoding="utf-8", errors="ignore")
        if "yoshipotosucio" in text and p.name != Path(__file__).name:
            leaked.append(str(p.relative_to(ROOT)))
        if p.name == "index.html" and re.search(r"[?&]pw=", text):
            query_pw.append(str(p.relative_to(ROOT)))
    if leaked:
        raise RuntimeError("Secret literal aún presente en: " + ", ".join(leaked))
    if query_pw:
        raise RuntimeError("Password en URL aún presente en: " + ", ".join(query_pw))


if __name__ == "__main__":
    patch_get_results()
    patch_get_tasks()
    patch_get_libreta()
    patch_health()
    patch_trash()
    fail_closed_legacy_functions()
    patch_index()
    verify_tree()
    print("teacher-auth hardening OK")
