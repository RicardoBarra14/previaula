"""
Genera frontend/mock-data.js a partir de la base sembrada.

Replica la forma exacta de las respuestas de la API para que el frontend
funcione en modo offline (fallback) mostrando los mismos datos que el backend
real. Se ejecuta una sola vez al construir el prototipo:

    python export_mock.py
"""
import json
import sqlite3
from datetime import date, timedelta
from pathlib import Path

BASE = Path(__file__).resolve().parent
DB = BASE / "previaula.db"
OUT = BASE.parent / "frontend" / "mock-data.js"

TODAY = date(2026, 7, 10)
WINDOW = 30
WEIGHTS = {"Inasistencia": 0.48, "Reuniones omitidas": 0.24,
           "Incidentes": 0.16, "Vulnerabilidad (IVE)": 0.12}
SEV = {"baja": 1, "moderada": 2, "alta": 3}
HIGH, MED = 58, 32

conn = sqlite3.connect(DB)
conn.row_factory = sqlite3.Row


def clamp(x, lo=0.0, hi=1.0):
    return max(lo, min(hi, x))


def start():
    return (TODAY - timedelta(days=WINDOW)).isoformat()


def att_rate(sid):
    rows = conn.execute(
        "SELECT status FROM AttendanceLogs WHERE student_id=? AND log_date>=?",
        (sid, start())).fetchall()
    total = len(rows) or 1
    p = sum(1 for r in rows if r["status"] == "presente")
    l = sum(1 for r in rows if r["status"] == "atrasado")
    a = sum(1 for r in rows if r["status"] == "ausente")
    return (p + 0.5 * l) / total, {"presente": p, "atrasado": l,
                                    "ausente": a, "total": total}


def risk(row):
    sid = row["id"]
    rate, counts = att_rate(sid)
    absence = clamp((0.96 - rate) / 0.28)
    mt = conn.execute("SELECT attended FROM GuardianMeetings WHERE student_id=?",
                      (sid,)).fetchall()
    mtot = len(mt) or 1
    mmiss = sum(1 for m in mt if not m["attended"])
    missed = mmiss / mtot
    inc = conn.execute(
        "SELECT severity FROM Incidents WHERE student_id=? AND log_date>=?",
        (sid, start())).fetchall()
    incw = clamp(sum(SEV[i["severity"]] for i in inc) / 6.0)
    ivec = row["ive_index"] / 100.0
    comps = {"Inasistencia": absence, "Reuniones omitidas": missed,
             "Incidentes": incw, "Vulnerabilidad (IVE)": ivec}
    contrib = {k: WEIGHTS[k] * v for k, v in comps.items()}
    raw = sum(contrib.values())
    score = round(raw * 100)
    tot = raw or 1e-9
    factors = [{"name": n, "contribution": round(v / tot * 100),
                "raw_value": round(comps[n] * 100)}
               for n, v in sorted(contrib.items(), key=lambda kv: kv[1],
                                  reverse=True)]
    if score >= HIGH:
        level, label = "alto", "Riesgo alto"
    elif score >= MED:
        level, label = "medio", "Riesgo moderado"
    else:
        level, label = "bajo", "Riesgo bajo"
    if score < 15:
        headline = "Perfil estable, sin factores de riesgo relevantes."
    else:
        t = factors[0]
        headline = f"Factor principal: {t['name']} ({t['contribution']}% del riesgo detectado)."
        
    mismatch = False
    mismatch_detail = ""
    parent_survey = conn.execute(
        "SELECT * FROM GuardianSurveys WHERE student_id=? ORDER BY survey_date DESC LIMIT 1",
        (sid,)).fetchone()
    student_report = conn.execute(
        "SELECT * FROM StudentSelfReports WHERE student_id=? ORDER BY report_date DESC LIMIT 1",
        (sid,)).fetchone()
    if parent_survey and student_report:
        p_safe = parent_survey["safe_at_school"]
        s_safe = student_report["safe_at_school"]
        if (p_safe == "Sí" and s_safe == "No") or (p_safe == "No" and s_safe == "Sí"):
            mismatch = True
            mismatch_detail = "Inconsistencia de Seguridad: El apoderado percibe plena seguridad del estudiante en el liceo, pero el estudiante reporta sentirse inseguro."

    return {"score": score, "level": level, "label": label, "headline": headline,
            "attendance_rate": round(rate * 100), "attendance_counts": counts,
            "missed_meetings": mmiss, "meetings_total": mtot,
            "incidents_window": len(inc), "factors": factors,
            "window_days": WINDOW, "mismatch": mismatch, "mismatch_detail": mismatch_detail}


def sdict(r):
    return {"id": r["id"], "run": r["run"], "first_name": r["first_name"],
            "last_name": r["last_name"],
            "full_name": f"{r['first_name']} {r['last_name']}",
            "course": r["course"], "ive_index": r["ive_index"],
            "comuna": r["comuna"], "guardian_id": r["guardian_id"],
            "avatar_seed": r["avatar_seed"],
            "establishment_id": r["establishment_id"],
            "violence_risk_score": r["violence_risk_score"],
            "home_risk_score": r["home_risk_score"],
            "academic_risk_score": r["academic_risk_score"]}


# --- summary ------------------------------------------------------------------
students_rows = conn.execute("SELECT * FROM Students").fetchall()
levels = {"alto": 0, "medio": 0, "bajo": 0}
rates = []
for r in students_rows:
    rk = risk(r)
    levels[rk["level"]] += 1
    rates.append(rk["attendance_rate"])
open_cases = conn.execute(
    "SELECT COUNT(*) AS n FROM Incidents WHERE protocol_activated=1").fetchone()["n"]
alerts_today = conn.execute(
    "SELECT COUNT(*) AS n FROM Incidents WHERE log_date=?",
    (TODAY.isoformat(),)).fetchone()["n"]
summary = {"students_total": len(students_rows),
           "active_alerts": levels["alto"] + levels["medio"],
           "high_risk": levels["alto"], "medium_risk": levels["medio"],
           "low_risk": levels["bajo"], "open_cases": open_cases,
           "alerts_today": alerts_today,
           "avg_attendance": round(sum(rates) / len(rates)) if rates else 0,
           "date": TODAY.isoformat()}

# --- students list ------------------------------------------------------------
students = []
for r in students_rows:
    s = sdict(r)
    rk = risk(r)
    s["risk"] = {"score": rk["score"], "level": rk["level"],
                 "label": rk["label"], "headline": rk["headline"],
                 "attendance_rate": rk["attendance_rate"],
                 "top_factors": rk["factors"][:2],
                 "mismatch": rk["mismatch"],
                 "mismatch_detail": rk["mismatch_detail"]}
    students.append(s)
students.sort(key=lambda x: x["risk"]["score"], reverse=True)

# --- student details + attendance --------------------------------------------
details, attendance = {}, {}
for r in students_rows:
    s = sdict(r)
    g = conn.execute("SELECT * FROM Guardians WHERE id=?",
                     (s["guardian_id"],)).fetchone()
    s["guardian"] = dict(g) if g else None
    s["risk"] = risk(r)
    inc = conn.execute(
        "SELECT * FROM Incidents WHERE student_id=? ORDER BY log_date DESC LIMIT 10",
        (r["id"],)).fetchall()
    s["incidents"] = [dict(i) for i in inc]
    details[r["id"]] = s

    st = (TODAY - timedelta(days=30)).isoformat()
    ar = conn.execute(
        "SELECT log_date, status FROM AttendanceLogs "
        "WHERE student_id=? AND log_date>=? ORDER BY log_date",
        (r["id"], st)).fetchall()
    series = [{"date": x["log_date"], "status": x["status"]} for x in ar]
    total = len(series) or 1
    p = sum(1 for x in series if x["status"] == "presente")
    l = sum(1 for x in series if x["status"] == "atrasado")
    a = sum(1 for x in series if x["status"] == "ausente")
    attendance[r["id"]] = {"series": series,
                           "summary": {"present": p, "late": l, "absent": a,
                                       "total": total,
                                       "rate": round((p + 0.5 * l) / total * 100)}}

# --- courses ------------------------------------------------------------------
courses = []
for c in [x["course"] for x in conn.execute(
        "SELECT DISTINCT course FROM Students ORDER BY course").fetchall()]:
    roster = conn.execute(
        "SELECT id, first_name, last_name, avatar_seed FROM Students "
        "WHERE course=? ORDER BY last_name", (c,)).fetchall()
    courses.append({"course": c, "students": [
        {"id": x["id"], "full_name": f"{x['first_name']} {x['last_name']}",
         "avatar_seed": x["avatar_seed"]} for x in roster]})

# --- incidents ----------------------------------------------------------------
inc_rows = conn.execute(
    "SELECT i.*, s.first_name, s.last_name, s.course, s.avatar_seed "
    "FROM Incidents i JOIN Students s ON s.id=i.student_id "
    "ORDER BY i.log_date DESC, i.id DESC LIMIT 20").fetchall()
incidents = [{"id": r["id"], "student_id": r["student_id"],
              "student_name": f"{r['first_name']} {r['last_name']}",
              "course": r["course"], "avatar_seed": r["avatar_seed"],
              "date": r["log_date"], "category": r["category"],
              "severity": r["severity"], "description": r["description"],
              "reported_by": r["reported_by"],
              "protocol_activated": bool(r["protocol_activated"])}
             for r in inc_rows]

payload = {"summary": summary, "students": students, "details": details,
           "attendance": attendance, "courses": courses, "incidents": incidents}

OUT.write_text(
    "// Snapshot de datos generado desde el backend sembrado (backend/export_mock.py).\n"
    "// Se usa solo como respaldo cuando la API FastAPI no está disponible\n"
    "// (por ejemplo, al abrir index.html directamente sin servidor).\n"
    "window.PREVIAULA_MOCK = " + json.dumps(payload, ensure_ascii=False, indent=1) + ";\n",
    encoding="utf-8")

print(f"[OK] mock-data.js generado: {OUT}  ({OUT.stat().st_size/1024:.1f} KB)")
print(f"  estudiantes: {len(students)} | incidentes: {len(incidents)} | cursos: {len(courses)}")
