"""
PreviAula · main.py
------------------------------------------------------------------------------
API FastAPI del sistema de alerta temprana y convivencia escolar.

Ejecutar (desde la carpeta backend/):
    pip install -r ../requirements.txt
    uvicorn main:app --reload

Luego abrir  http://localhost:8000  → sirve el frontend y consume esta API.

Endpoints principales (todos bajo /api):
    GET  /api/health
    GET  /api/dashboard/summary
    GET  /api/students
    GET  /api/students/{id}
    GET  /api/students/{id}/risk
    GET  /api/students/{id}/attendance
    GET  /api/courses
    GET  /api/incidents
    POST /api/incidents
    POST /api/attendance

El score de riesgo de deserción se calcula con un modelo ponderado y
transparente. La justificación se entrega como contribuciones porcentuales por
factor (estilo SHAP: "Inasistencia 58%, Reuniones omitidas 17%, ...").
"""

from __future__ import annotations

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from datetime import date, timedelta
from pathlib import Path
from typing import List, Optional, Union

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import database

# ------------------------------------------------------------------------------
# Constantes del modelo de riesgo
# ------------------------------------------------------------------------------
TODAY = database.TODAY          # fecha "actual" del prototipo (2026-07-10)
RISK_WINDOW_DAYS = 30           # ventana de análisis ("el último mes")

# Pesos del modelo (suman 1.0). Ajustables sin tocar el resto del código.
WEIGHTS = {
    "Inasistencia": 0.48,
    "Reuniones omitidas": 0.24,
    "Incidentes": 0.16,
    "Vulnerabilidad (IVE)": 0.12,
}
# Umbrales de nivel de riesgo (score 0-100).
LEVEL_HIGH = 58
LEVEL_MEDIUM = 32

SEVERITY_WEIGHT = {"baja": 1, "moderada": 2, "alta": 3}

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"

app = FastAPI(title="PreviAula API", version="1.0.0")

# CORS permisivo: útil si el frontend se sirve desde otro puerto en desarrollo.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup() -> None:
    database.init_db()


# ------------------------------------------------------------------------------
# Modelos de entrada (POST)
# ------------------------------------------------------------------------------
class IncidentIn(BaseModel):
    student_id: int
    category: str
    severity: str            # baja | moderada | alta
    description: str
    reported_by: str = "Docente"
    protocol_activated: bool = False


class AttendanceItem(BaseModel):
    student_id: int
    status: str              # presente | atrasado | ausente
    log_date: Optional[str] = None   # ISO; por defecto hoy
    recorded_by: str = "Docente"


class AttendanceIn(BaseModel):
    # Acepta un registro o un lote (para pasar lista del curso de una vez).
    records: Union[AttendanceItem, List[AttendanceItem]]


class LoginIn(BaseModel):
    username: str
    password: str


class UserRegister(BaseModel):
    username: str
    password: str
    role: str
    full_name: str
    related_id: Optional[int] = None
    guardian_run: Optional[str] = None
    guardian_relationship: Optional[str] = "Tutor legal"
    guardian_phone: Optional[str] = ""
    guardian_email: Optional[str] = ""
    student_runs: Optional[List[str]] = None


class EstablishmentCreate(BaseModel):
    name: str
    comuna: str
    ive_average: int


class GradeCreate(BaseModel):
    subject_name: str
    grade: float
    term: int = 1


class StudentSelfReportIn(BaseModel):
    student_id: int
    age_group: str          # basica | media
    energy_mood: Optional[str] = None
    safe_at_school: Optional[str] = None
    social_ok: Optional[str] = None
    stress_level: Optional[int] = None
    needs_talk: bool = False


class ExcuseIn(BaseModel):
    student_id: int
    log_date: str          # YYYY-MM-DD
    reason: str


class GuardianSurveyIn(BaseModel):
    guardian_id: int
    student_id: int
    cohesion_rate: int
    cohesion_help: int
    safe_at_school: str


class GuardianProfileUpdate(BaseModel):
    phone: str
    email: str
    employment_status: Optional[str] = None
    education_level: Optional[str] = None
    availability_hours: Optional[str] = None
    internet_access: Optional[str] = None
    has_computer: Optional[str] = None
    parent_comments: Optional[str] = None


class GuardianStudentAssign(BaseModel):
    student_run: str


class GuardianTeacherNotesUpdate(BaseModel):
    teacher_notes: Optional[str] = None


class ManualMismatchUpdate(BaseModel):
    manual_mismatch: Optional[str] = None


class StudentActivityAssignIn(BaseModel):
    activity_id: int
    assigned_by: str = "Orientador"


class StudentActivityUpdateIn(BaseModel):
    status: str            # asignada | en_progreso | completada
    feedback: Optional[str] = None



# ------------------------------------------------------------------------------
# Utilidades
# ------------------------------------------------------------------------------
def _clamp(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))


def _window_start() -> str:
    return (TODAY - timedelta(days=RISK_WINDOW_DAYS)).isoformat()


def _attendance_rate(conn, student_id: int) -> tuple[float, dict]:
    """Devuelve (tasa ponderada, conteos) en la ventana de análisis."""
    rows = conn.execute(
        "SELECT status FROM AttendanceLogs WHERE student_id=? AND log_date>=?",
        (student_id, _window_start()),
    ).fetchall()
    total = len(rows) or 1
    present = sum(1 for r in rows if r["status"] == "presente")
    late = sum(1 for r in rows if r["status"] == "atrasado")
    absent = sum(1 for r in rows if r["status"] == "ausente")
    # Un atraso cuenta como media asistencia efectiva.
    rate = (present + 0.5 * late) / total
    return rate, {"presente": present, "atrasado": late,
                  "ausente": absent, "total": total}


def compute_risk(conn, student: dict) -> dict:
    """
    Modelo de riesgo de deserción ponderado y explicable.

    Cada factor aporta un componente en [0,1] que se pondera y suma para el
    score global (0-100). Las contribuciones se re-normalizan a 100% para la
    justificación estilo SHAP.
    """
    sid = student["id"]

    # 1) Inasistencia — motor principal, con sensibilidad alta bajo el 96%.
    att_rate, counts = _attendance_rate(conn, sid)
    absence_component = _clamp((0.96 - att_rate) / 0.28)

    # 2) Reuniones/citaciones de apoderado omitidas.
    meetings = conn.execute(
        "SELECT attended FROM GuardianMeetings WHERE student_id=?", (sid,)
    ).fetchall()
    m_total = len(meetings) or 1
    m_missed = sum(1 for m in meetings if not m["attended"])
    missed_component = m_missed / m_total

    # 3) Incidentes de convivencia/desregulación (ponderados por severidad).
    incidents = conn.execute(
        "SELECT severity FROM Incidents WHERE student_id=? AND log_date>=?",
        (sid, _window_start()),
    ).fetchall()
    inc_weighted = sum(SEVERITY_WEIGHT[i["severity"]] for i in incidents)
    incident_component = _clamp(inc_weighted / 6.0)

    # 4) Vulnerabilidad estructural (IVE JUNAEB) como contexto de riesgo.
    ive_component = student["ive_index"] / 100.0

    components = {
        "Inasistencia": absence_component,
        "Reuniones omitidas": missed_component,
        "Incidentes": incident_component,
        "Vulnerabilidad (IVE)": ive_component,
    }
    contributions = {k: WEIGHTS[k] * v for k, v in components.items()}
    raw = sum(contributions.values())
    score = round(raw * 100)

    total_contrib = raw or 1e-9
    factors = [
        {
            "name": name,
            "contribution": round(value / total_contrib * 100),
            "raw_value": round(components[name] * 100),
        }
        for name, value in sorted(
            contributions.items(), key=lambda kv: kv[1], reverse=True
        )
    ]

    if score >= LEVEL_HIGH:
        level, label = "alto", "Riesgo alto"
    elif score >= LEVEL_MEDIUM:
        level, label = "medio", "Riesgo moderado"
    else:
        level, label = "bajo", "Riesgo bajo"

    # Titular explicativo. Para perfiles estables se comunica en positivo.
    if score < 15:
        headline = "Perfil estable, sin factores de riesgo relevantes."
    else:
        top = factors[0]
        headline = (
            f"Factor principal: {top['name']} "
            f"({top['contribution']}% del riesgo detectado)."
        )

    # Mismatch check (inconsistencia de seguridad apoderado-estudiante)
    mismatch = False
    mismatch_detail = ""
    
    # Inconsistencia manual del docente
    manual_mis = student.get("manual_mismatch")
    if manual_mis:
        mismatch = True
        mismatch_detail = f"Inconsistencia Manual (Docente): {manual_mis}"
    else:
        parent_survey = conn.execute(
            "SELECT * FROM GuardianSurveys WHERE student_id=? ORDER BY survey_date DESC LIMIT 1",
            (sid,)
        ).fetchone()
        
        student_report = conn.execute(
            "SELECT * FROM StudentSelfReports WHERE student_id=? ORDER BY report_date DESC LIMIT 1",
            (sid,)
        ).fetchone()
        
        if parent_survey and student_report:
            p_safe = parent_survey["safe_at_school"]
            s_safe = student_report["safe_at_school"]
            if (p_safe == "Sí" and s_safe == "No") or (p_safe == "No" and s_safe == "Sí"):
                mismatch = True
                mismatch_detail = "Inconsistencia de Seguridad: El apoderado percibe plena seguridad del estudiante en el liceo, pero el estudiante reporta sentirse inseguro."

    return {
        "score": score,
        "level": level,
        "label": label,
        "headline": headline,
        "attendance_rate": round(att_rate * 100),
        "attendance_counts": counts,
        "missed_meetings": m_missed,
        "meetings_total": m_total,
        "incidents_window": len(incidents),
        "factors": factors,
        "window_days": RISK_WINDOW_DAYS,
        "mismatch": mismatch,
        "mismatch_detail": mismatch_detail
    }


def _student_row_to_dict(row) -> dict:
    return {
        "id": row["id"],
        "run": row["run"],
        "first_name": row["first_name"],
        "last_name": row["last_name"],
        "full_name": f"{row['first_name']} {row['last_name']}",
        "course": row["course"],
        "ive_index": row["ive_index"],
        "comuna": row["comuna"],
        "guardian_id": row["guardian_id"],
        "avatar_seed": row["avatar_seed"],
        "establishment_id": row["establishment_id"],
        "violence_risk_score": row["violence_risk_score"],
        "home_risk_score": row["home_risk_score"],
        "academic_risk_score": row["academic_risk_score"],
        "manual_mismatch": row["manual_mismatch"] if "manual_mismatch" in row.keys() else None
    }


# ------------------------------------------------------------------------------
# Endpoints · sistema
# ------------------------------------------------------------------------------
@app.get("/api/health")
def health():
    return {"status": "ok", "app": "PreviAula", "date": TODAY.isoformat()}


@app.get("/api/dashboard/summary")
def dashboard_summary():
    """KPIs y contadores para el encabezado del panel."""
    conn = database.get_connection()
    try:
        students = [
            _student_row_to_dict(r)
            for r in conn.execute("SELECT * FROM Students").fetchall()
        ]
        levels = {"alto": 0, "medio": 0, "bajo": 0}
        att_rates = []
        for s in students:
            risk = compute_risk(conn, s)
            levels[risk["level"]] += 1
            att_rates.append(risk["attendance_rate"])

        open_cases = conn.execute(
            "SELECT COUNT(*) AS n FROM Incidents WHERE protocol_activated=1"
        ).fetchone()["n"]

        alerts_today = conn.execute(
            "SELECT COUNT(*) AS n FROM Incidents WHERE log_date=?",
            (TODAY.isoformat(),),
        ).fetchone()["n"]

        avg_att = round(sum(att_rates) / len(att_rates)) if att_rates else 0

        return {
            "students_total": len(students),
            "active_alerts": levels["alto"] + levels["medio"],
            "high_risk": levels["alto"],
            "medium_risk": levels["medio"],
            "low_risk": levels["bajo"],
            "open_cases": open_cases,
            "alerts_today": alerts_today,
            "avg_attendance": avg_att,
            "date": TODAY.isoformat(),
        }
    finally:
        conn.close()


# ------------------------------------------------------------------------------
# Endpoints · estudiantes
# ------------------------------------------------------------------------------
@app.get("/api/students")
def list_students(course: Optional[str] = None):
    """Lista de estudiantes con su resumen de riesgo. Filtrable por curso."""
    conn = database.get_connection()
    try:
        if course:
            rows = conn.execute(
                "SELECT * FROM Students WHERE course=? ORDER BY last_name",
                (course,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM Students ORDER BY last_name"
            ).fetchall()

        out = []
        for r in rows:
            s = _student_row_to_dict(r)
            risk = compute_risk(conn, s)
            s["risk"] = {
                "score": risk["score"],
                "level": risk["level"],
                "label": risk["label"],
                "headline": risk["headline"],
                "attendance_rate": risk["attendance_rate"],
                "top_factors": risk["factors"][:2],
                "mismatch": risk["mismatch"],
                "mismatch_detail": risk["mismatch_detail"]
            }
            out.append(s)
        # Orden por riesgo descendente para priorización.
        out.sort(key=lambda x: x["risk"]["score"], reverse=True)
        return out
    finally:
        conn.close()


@app.get("/api/students/{student_id}")
def get_student(student_id: int):
    conn = database.get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM Students WHERE id=?", (student_id,)
        ).fetchone()
        if not row:
            raise HTTPException(404, "Estudiante no encontrado")
        student = _student_row_to_dict(row)

        guardian = conn.execute(
            "SELECT * FROM Guardians WHERE id=?", (student["guardian_id"],)
        ).fetchone()
        student["guardian"] = dict(guardian) if guardian else None

        student["risk"] = compute_risk(conn, student)

        incidents = conn.execute(
            "SELECT * FROM Incidents WHERE student_id=? ORDER BY log_date DESC LIMIT 10",
            (student_id,),
        ).fetchall()
        student["incidents"] = [dict(i) for i in incidents]

        return student
    finally:
        conn.close()


@app.get("/api/students/{student_id}/risk")
def get_student_risk(student_id: int):
    conn = database.get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM Students WHERE id=?", (student_id,)
        ).fetchone()
        if not row:
            raise HTTPException(404, "Estudiante no encontrado")
        return compute_risk(conn, _student_row_to_dict(row))
    finally:
        conn.close()


@app.get("/api/students/{student_id}/attendance")
def get_student_attendance(student_id: int, days: int = 30):
    """
    Serie de asistencia para la vista de apoderado (amigable, sin datos
    psicológicos). Devuelve el detalle diario y un resumen agregado.
    """
    conn = database.get_connection()
    try:
        start = (TODAY - timedelta(days=days)).isoformat()
        rows = conn.execute(
            "SELECT log_date, status FROM AttendanceLogs "
            "WHERE student_id=? AND log_date>=? ORDER BY log_date",
            (student_id, start),
        ).fetchall()
        series = [{"date": r["log_date"], "status": r["status"]} for r in rows]
        total = len(series) or 1
        present = sum(1 for s in series if s["status"] == "presente")
        late = sum(1 for s in series if s["status"] == "atrasado")
        absent = sum(1 for s in series if s["status"] == "ausente")
        return {
            "series": series,
            "summary": {
                "present": present,
                "late": late,
                "absent": absent,
                "total": total,
                "rate": round((present + 0.5 * late) / total * 100),
            },
        }
    finally:
        conn.close()


# ------------------------------------------------------------------------------
# Endpoints · cursos (vista docente)
# ------------------------------------------------------------------------------
@app.get("/api/courses")
def list_courses():
    """Cursos disponibles con su lista de estudiantes para toma de asistencia."""
    conn = database.get_connection()
    try:
        courses = [
            r["course"]
            for r in conn.execute(
                "SELECT DISTINCT course FROM Students ORDER BY course"
            ).fetchall()
        ]
        result = []
        for c in courses:
            roster = conn.execute(
                "SELECT id, first_name, last_name, avatar_seed FROM Students "
                "WHERE course=? ORDER BY last_name",
                (c,),
            ).fetchall()
            result.append({
                "course": c,
                "students": [
                    {
                        "id": s["id"],
                        "full_name": f"{s['first_name']} {s['last_name']}",
                        "avatar_seed": s["avatar_seed"],
                    }
                    for s in roster
                ],
            })
        return result
    finally:
        conn.close()


# ------------------------------------------------------------------------------
# Endpoints · incidentes (bitácora)
# ------------------------------------------------------------------------------
@app.get("/api/incidents")
def list_incidents(limit: int = 20):
    conn = database.get_connection()
    try:
        rows = conn.execute(
            "SELECT i.*, s.first_name, s.last_name, s.course, s.avatar_seed "
            "FROM Incidents i JOIN Students s ON s.id = i.student_id "
            "ORDER BY i.log_date DESC, i.id DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [
            {
                "id": r["id"],
                "student_id": r["student_id"],
                "student_name": f"{r['first_name']} {r['last_name']}",
                "course": r["course"],
                "avatar_seed": r["avatar_seed"],
                "date": r["log_date"],
                "category": r["category"],
                "severity": r["severity"],
                "description": r["description"],
                "reported_by": r["reported_by"],
                "protocol_activated": bool(r["protocol_activated"]),
            }
            for r in rows
        ]
    finally:
        conn.close()


@app.post("/api/incidents", status_code=201)
def create_incident(payload: IncidentIn):
    if payload.severity not in SEVERITY_WEIGHT:
        raise HTTPException(400, "severity debe ser baja | moderada | alta")
    conn = database.get_connection()
    try:
        exists = conn.execute(
            "SELECT 1 FROM Students WHERE id=?", (payload.student_id,)
        ).fetchone()
        if not exists:
            raise HTTPException(404, "Estudiante no encontrado")
        cur = conn.execute(
            "INSERT INTO Incidents (student_id, log_date, category, severity,"
            " description, reported_by, protocol_activated) VALUES (?,?,?,?,?,?,?)",
            (
                payload.student_id,
                TODAY.isoformat(),
                payload.category,
                payload.severity,
                payload.description,
                payload.reported_by,
                int(payload.protocol_activated),
            ),
        )
        conn.commit()
        return {"id": cur.lastrowid, "status": "registrado"}
    finally:
        conn.close()


# ------------------------------------------------------------------------------
# Endpoints · asistencia (vista docente)
# ------------------------------------------------------------------------------
@app.post("/api/attendance", status_code=201)
def register_attendance(payload: AttendanceIn):
    valid = {"presente", "atrasado", "ausente"}
    items = payload.records
    if isinstance(items, AttendanceItem):
        items = [items]

    conn = database.get_connection()
    try:
        saved = 0
        for item in items:
            if item.status not in valid:
                raise HTTPException(
                    400, f"status inválido: {item.status}"
                )
            log_date = item.log_date or TODAY.isoformat()
            # Upsert manual: reemplaza el registro del día si ya existe.
            conn.execute(
                "DELETE FROM AttendanceLogs WHERE student_id=? AND log_date=?",
                (item.student_id, log_date),
            )
            conn.execute(
                "INSERT INTO AttendanceLogs (student_id, log_date, status, recorded_by)"
                " VALUES (?,?,?,?)",
                (item.student_id, log_date, item.status, item.recorded_by),
            )
            saved += 1
        conn.commit()
        return {"saved": saved, "status": "registrado", "date": TODAY.isoformat()}
    finally:
        conn.close()


# ------------------------------------------------------------------------------
# Endpoints · login, notas, autodeclarado, justificaciones y comparación
# ------------------------------------------------------------------------------
@app.post("/api/auth/login")
def login(payload: LoginIn):
    conn = database.get_connection()
    try:
        user = conn.execute(
            "SELECT * FROM Users WHERE username=? AND password=?",
            (payload.username, payload.password)
        ).fetchone()
        if not user:
            raise HTTPException(401, "Usuario o contraseña incorrectos")
        
        user_dict = dict(user)
        student_info = None
        guardian_info = None
        
        if user_dict["role"] == "estudiante":
            student = conn.execute(
                "SELECT * FROM Students WHERE id=?", (user_dict["related_id"],)
            ).fetchone()
            if student:
                student_info = _student_row_to_dict(student)
                
                # Obtener info del establecimiento
                est = conn.execute(
                    "SELECT name FROM Establishments WHERE id=?", (student["establishment_id"],)
                ).fetchone()
                student_info["establishment_name"] = est["name"] if est else "Establecimiento no asignado"
        elif user_dict["role"] == "apoderado":
            guardian = conn.execute(
                "SELECT * FROM Guardians WHERE id=?", (user_dict["related_id"],)
            ).fetchone()
            if guardian:
                guardian_info = dict(guardian)
                students = conn.execute(
                    "SELECT * FROM Students WHERE guardian_id=?", (guardian["id"],)
                ).fetchall()
                guardian_info["students"] = []
                for s in students:
                    s_dict = _student_row_to_dict(s)
                    est = conn.execute(
                        "SELECT name FROM Establishments WHERE id=?", (s["establishment_id"],)
                    ).fetchone()
                    s_dict["establishment_name"] = est["name"] if est else "Establecimiento no asignado"
                    guardian_info["students"].append(s_dict)
                
        return {
            "status": "success",
            "user": {
                "id": user_dict["id"],
                "username": user_dict["username"],
                "role": user_dict["role"],
                "full_name": user_dict["full_name"],
                "related_id": user_dict["related_id"]
            },
            "student_info": student_info,
            "guardian_info": guardian_info
        }
    finally:
        conn.close()


@app.post("/api/auth/register")
def register_user(payload: UserRegister):
    conn = database.get_connection()
    try:
        existing = conn.execute("SELECT id FROM Users WHERE username=?", (payload.username,)).fetchone()
        if existing:
            raise HTTPException(400, "El nombre de usuario ya está registrado")
            
        related_id = payload.related_id
        guardian_info = None
        student_info = None
        
        # Si el rol es apoderado, creamos el Guardian
        if payload.role == "apoderado":
            run_val = payload.guardian_run or f"TEMP-{payload.username}"
            cur_g = conn.execute(
                """INSERT INTO Guardians 
                   (run, full_name, relationship, phone, email, contact_ok) 
                   VALUES (?,?,?,?,?,1)""",
                (run_val, payload.full_name, payload.guardian_relationship, payload.guardian_phone, payload.guardian_email)
            )
            related_id = cur_g.lastrowid
            
            # Asociar estudiantes por su RUN
            if payload.student_runs:
                for run_str in payload.student_runs:
                    run_clean = run_str.strip()
                    if run_clean:
                        conn.execute(
                            "UPDATE Students SET guardian_id=? WHERE run=?",
                            (related_id, run_clean)
                        )
            
            # Obtener datos de guardian y estudiantes asignados
            g_row = conn.execute("SELECT * FROM Guardians WHERE id=?", (related_id,)).fetchone()
            if g_row:
                guardian_info = dict(g_row)
                students = conn.execute("SELECT * FROM Students WHERE guardian_id=?", (related_id,)).fetchall()
                guardian_info["students"] = []
                for s in students:
                    s_dict = _student_row_to_dict(s)
                    est = conn.execute(
                        "SELECT name FROM Establishments WHERE id=?", (s["establishment_id"],)
                    ).fetchone()
                    s_dict["establishment_name"] = est["name"] if est else "Establecimiento no asignado"
                    guardian_info["students"].append(s_dict)
                    
        # Crear usuario
        cur = conn.execute(
            "INSERT INTO Users (username, password, role, related_id, full_name) VALUES (?,?,?,?,?)",
            (payload.username, payload.password, payload.role, related_id, payload.full_name)
        )
        user_id = cur.lastrowid
        conn.commit()
        
        user = {
            "id": user_id,
            "username": payload.username,
            "role": payload.role,
            "full_name": payload.full_name,
            "related_id": related_id
        }
        
        if payload.role == "estudiante" and related_id:
            st = conn.execute("SELECT * FROM Students WHERE id=?", (related_id,)).fetchone()
            if st:
                student_info = _student_row_to_dict(st)
                est = conn.execute(
                    "SELECT name FROM Establishments WHERE id=?", (st["establishment_id"],)
                ).fetchone()
                student_info["establishment_name"] = est["name"] if est else "Establecimiento no asignado"
                
        return {
            "status": "success",
            "user": user,
            "student_info": student_info,
            "guardian_info": guardian_info
        }
    finally:
        conn.close()


@app.post("/api/establishments")
def create_establishment(payload: EstablishmentCreate):
    conn = database.get_connection()
    try:
        cur = conn.execute(
            "INSERT INTO Establishments (name, comuna, ive_average) VALUES (?,?,?)",
            (payload.name, payload.comuna, payload.ive_average)
        )
        est_id = cur.lastrowid
        
        # Insertar asignaturas básicas para este establecimiento
        for sname, tname in zip(database.SUBJECT_NAMES, database.TEACHERS):
            conn.execute(
                "INSERT INTO Subjects (name, teacher_name, establishment_id) VALUES (?,?,?)",
                (sname, tname, est_id)
            )
            
        conn.commit()
        return {"status": "success", "establishment_id": est_id, "message": "Establecimiento registrado exitosamente con asignaturas."}
    finally:
        conn.close()


@app.post("/api/students/{student_id}/grades")
def add_student_grade(student_id: int, payload: GradeCreate):
    conn = database.get_connection()
    try:
        student = conn.execute("SELECT establishment_id FROM Students WHERE id=?", (student_id,)).fetchone()
        if not student:
            raise HTTPException(404, "Estudiante no encontrado")
        est_id = student["establishment_id"]
        
        subject = conn.execute(
            "SELECT id FROM Subjects WHERE name=? AND establishment_id=?", 
            (payload.subject_name, est_id)
        ).fetchone()
        if not subject:
            # Si no existe por algún motivo, crearla sobre la marcha
            cur = conn.execute(
                "INSERT INTO Subjects (name, teacher_name, establishment_id) VALUES (?,?,?)",
                (payload.subject_name, "Docente Asignado", est_id)
            )
            sub_id = cur.lastrowid
        else:
            sub_id = subject["id"]
            
        conn.execute(
            "INSERT INTO Grades (student_id, subject_id, grade, term) VALUES (?,?,?,?)",
            (student_id, sub_id, payload.grade, payload.term)
        )
        conn.commit()
        return {"status": "success", "message": "Calificación registrada exitosamente"}
    finally:
        conn.close()


@app.get("/api/students/{student_id}/grades")
def get_student_grades(student_id: int):
    conn = database.get_connection()
    try:
        student = conn.execute(
            "SELECT * FROM Students WHERE id=?", (student_id,)
        ).fetchone()
        if not student:
            raise HTTPException(404, "Estudiante no encontrado")
            
        rows = conn.execute(
            "SELECT g.grade, g.term, s.name as subject_name, s.teacher_name "
            "FROM Grades g JOIN Subjects s ON g.subject_id = s.id "
            "WHERE g.student_id=? ORDER BY s.name, g.id",
            (student_id,)
        ).fetchall()
        
        subjects = {}
        for r in rows:
            sname = r["subject_name"]
            if sname not in subjects:
                subjects[sname] = {
                    "subject_name": sname,
                    "teacher_name": r["teacher_name"],
                    "grades": []
                }
            subjects[sname]["grades"].append(r["grade"])
            
        out = []
        for sname, data in subjects.items():
            grades = data["grades"]
            avg = round(sum(grades) / len(grades), 1) if grades else 0.0
            out.append({
                "subject_name": sname,
                "teacher_name": data["teacher_name"],
                "grades": grades,
                "average": avg
            })
            
        general_avg = round(sum(s["average"] for s in out) / len(out), 1) if out else 0.0
        
        return {
            "student_id": student_id,
            "grades": out,
            "general_average": general_avg
        }
    finally:
        conn.close()


@app.post("/api/student/self-report", status_code=201)
def create_self_report(payload: StudentSelfReportIn):
    conn = database.get_connection()
    try:
        student = conn.execute(
            "SELECT 1 FROM Students WHERE id=?", (payload.student_id,)
        ).fetchone()
        if not student:
            raise HTTPException(404, "Estudiante no encontrado")
            
        cur = conn.execute(
            "INSERT INTO StudentSelfReports (student_id, age_group, energy_mood, safe_at_school, "
            "social_ok, stress_level, needs_talk, report_date) VALUES (?,?,?,?,?,?,?,?)",
            (
                payload.student_id,
                payload.age_group,
                payload.energy_mood,
                payload.safe_at_school,
                payload.social_ok,
                payload.stress_level,
                int(payload.needs_talk),
                TODAY.isoformat()
            )
        )
        conn.commit()
        
        if payload.needs_talk:
            conn.execute(
                "INSERT INTO Incidents (student_id, log_date, category, severity, description, "
                "reported_by, protocol_activated) VALUES (?,?,?,?,?,?,?)",
                (
                    payload.student_id,
                    TODAY.isoformat(),
                    "Desregulación emocional",
                    "baja",
                    "Estudiante autodeclara necesidad urgente de conversar con el equipo de orientación (formulario de bienestar).",
                    "Autodeclarado Alumno",
                    0
                )
            )
            conn.commit()
            
        return {"id": cur.lastrowid, "status": "registrado", "needs_talk": payload.needs_talk}
    finally:
        conn.close()


@app.post("/api/guardian/excuse", status_code=201)
def create_excuse(payload: ExcuseIn):
    conn = database.get_connection()
    try:
        student = conn.execute(
            "SELECT 1 FROM Students WHERE id=?", (payload.student_id,)
        ).fetchone()
        if not student:
            raise HTTPException(404, "Estudiante no encontrado")
            
        cur = conn.execute(
            "INSERT INTO AttendanceExcuses (student_id, log_date, reason, date_submitted, status) "
            "VALUES (?,?,?,?,?)",
            (
                payload.student_id,
                payload.log_date,
                payload.reason,
                TODAY.isoformat(),
                "pendiente"
            )
        )
        conn.commit()
        return {"id": cur.lastrowid, "status": "pendiente", "message": "Justificación registrada y en revisión."}
    finally:
        conn.close()


@app.post("/api/guardian/survey", status_code=201)
def create_guardian_survey(payload: GuardianSurveyIn):
    conn = database.get_connection()
    try:
        cur = conn.execute(
            "INSERT INTO GuardianSurveys (guardian_id, student_id, cohesion_rate, cohesion_help, safe_at_school, survey_date) "
            "VALUES (?,?,?,?,?,?)",
            (
                payload.guardian_id,
                payload.student_id,
                payload.cohesion_rate,
                payload.cohesion_help,
                payload.safe_at_school,
                TODAY.isoformat()
            )
        )
        conn.commit()
        return {"id": cur.lastrowid, "status": "success", "message": "Encuesta registrada exitosamente."}
    finally:
        conn.close()


@app.get("/api/establishments/compare")
def compare_establishments():
    conn = database.get_connection()
    try:
        rows = conn.execute("SELECT * FROM Establishments").fetchall()
        out = []
        for r in rows:
            est_id = r["id"]
            students = conn.execute(
                "SELECT id, ive_index, violence_risk_score, home_risk_score, academic_risk_score FROM Students WHERE establishment_id=?", (est_id,)
            ).fetchall()
            
            total_students = len(students)
            if total_students == 0:
                out.append({
                    "id": est_id,
                    "name": r["name"],
                    "comuna": r["comuna"],
                    "ive_average": r["ive_average"],
                    "students_count": 0,
                    "avg_attendance": 0,
                    "high_risk_count": 0,
                    "incidents_count": 0,
                    "avg_gpa": 0.0,
                    "avg_violence_risk": 0,
                    "avg_home_risk": 0
                })
                continue
                
            att_rates = []
            high_risk_count = 0
            for s in students:
                rate, _ = _attendance_rate(conn, s["id"])
                att_rates.append(rate)
                risk = compute_risk(conn, {"id": s["id"], "ive_index": s["ive_index"]})
                if risk["level"] == "alto":
                    high_risk_count += 1
                    
            avg_att = round(sum(att_rates) / len(att_rates) * 100) if att_rates else 0
            
            incidents_count = conn.execute(
                "SELECT COUNT(*) as n FROM Incidents i "
                "JOIN Students s ON i.student_id = s.id "
                "WHERE s.establishment_id=? AND i.log_date>=?",
                (est_id, _window_start())
            ).fetchone()["n"]
            
            # Promedio de Notas (GPA)
            grades_row = conn.execute(
                "SELECT g.grade FROM Grades g "
                "JOIN Students s ON g.student_id = s.id "
                "WHERE s.establishment_id=?", (est_id,)
            ).fetchall()
            grades = [g["grade"] for g in grades_row]
            avg_gpa = round(sum(grades) / len(grades), 2) if grades else 0.0
            
            # Promedios de riesgos
            total_violence = sum(s["violence_risk_score"] for s in students)
            total_home = sum(s["home_risk_score"] for s in students)
            avg_violence = round(total_violence / total_students)
            avg_home = round(total_home / total_students)
            
            out.append({
                "id": est_id,
                "name": r["name"],
                "comuna": r["comuna"],
                "ive_average": r["ive_average"],
                "students_count": total_students,
                "avg_attendance": avg_att,
                "high_risk_count": high_risk_count,
                "incidents_count": incidents_count,
                "avg_gpa": avg_gpa,
                "avg_violence_risk": avg_violence,
                "avg_home_risk": avg_home
            })
        return out
    finally:
        conn.close()


# ------------------------------------------------------------------------------
# Endpoints · asistencia por fecha (para cargador histórico)
# ------------------------------------------------------------------------------
@app.get("/api/attendance")
def get_attendance_by_date(course: str, date: str):
    conn = database.get_connection()
    try:
        rows = conn.execute(
            "SELECT al.student_id, al.status FROM AttendanceLogs al "
            "JOIN Students s ON s.id = al.student_id "
            "WHERE s.course=? AND al.log_date=?",
            (course, date),
        ).fetchall()
        return {r["student_id"]: r["status"] for r in rows}
    finally:
        conn.close()


# ------------------------------------------------------------------------------
# Endpoints · actividades preventivas de violencia
# ------------------------------------------------------------------------------
@app.get("/api/activities")
def list_activities():
    conn = database.get_connection()
    try:
        rows = conn.execute("SELECT * FROM Activities").fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@app.get("/api/students/{student_id}/activities")
def get_student_activities(student_id: int):
    conn = database.get_connection()
    try:
        row = conn.execute("SELECT * FROM Students WHERE id=?", (student_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Estudiante no encontrado")
        student = dict(row)
        
        assigned_rows = conn.execute(
            "SELECT sa.id as assignment_id, sa.status, sa.assigned_date, sa.assigned_by, sa.feedback, "
            "a.id as activity_id, a.title, a.description, a.type, a.category, a.target_risk, a.delivery "
            "FROM StudentActivities sa JOIN Activities a ON sa.activity_id = a.id "
            "WHERE sa.student_id=? ORDER BY sa.id DESC",
            (student_id,)
        ).fetchall()
        assigned = [dict(r) for r in assigned_rows]
        assigned_ids = {a["activity_id"] for a in assigned}
        
        all_activities = conn.execute("SELECT * FROM Activities").fetchall()
        
        recommended = []
        v_risk = student["violence_risk_score"]
        h_risk = student["home_risk_score"]
        a_risk = student["academic_risk_score"]
        
        for act in all_activities:
            act_id = act["id"]
            if act_id in assigned_ids:
                continue
                
            target = act["target_risk"]
            if target == "violence" and v_risk >= 60:
                recommended.append(dict(act))
            elif target == "home" and h_risk >= 60:
                recommended.append(dict(act))
            elif target == "academic" and a_risk >= 60:
                recommended.append(dict(act))
            elif target == "general" and len(recommended) < 3:
                recommended.append(dict(act))
                
        if not recommended:
            for act in all_activities:
                if act["id"] not in assigned_ids and act["target_risk"] in ("general", "violence", "academic"):
                    recommended.append(dict(act))
                    if len(recommended) >= 3:
                        break
                        
        return {
            "student_id": student_id,
            "assigned": assigned,
            "recommended": recommended[:4]
        }
    finally:
        conn.close()


@app.post("/api/students/{student_id}/activities", status_code=201)
def assign_student_activity(student_id: int, payload: StudentActivityAssignIn):
    conn = database.get_connection()
    try:
        st = conn.execute("SELECT 1 FROM Students WHERE id=?", (student_id,)).fetchone()
        if not st:
            raise HTTPException(404, "Estudiante no encontrado")
        act = conn.execute("SELECT 1 FROM Activities WHERE id=?", (payload.activity_id,)).fetchone()
        if not act:
            raise HTTPException(404, "Actividad no encontrada")
            
        exists = conn.execute(
            "SELECT 1 FROM StudentActivities WHERE student_id=? AND activity_id=? AND status IN ('asignada', 'en_progreso')",
            (student_id, payload.activity_id)
        ).fetchone()
        if exists:
            return {"status": "ya_asignada", "message": "Esta actividad ya está activa para el estudiante."}
            
        cur = conn.execute(
            "INSERT INTO StudentActivities (student_id, activity_id, assigned_date, status, assigned_by) "
            "VALUES (?,?,?,'asignada',?)",
            (student_id, payload.activity_id, TODAY.isoformat(), payload.assigned_by)
        )
        conn.commit()
        return {"id": cur.lastrowid, "status": "asignada"}
    finally:
        conn.close()


@app.put("/api/students/{student_id}/activities/{activity_id}")
def update_student_activity(student_id: int, activity_id: int, payload: StudentActivityUpdateIn):
    conn = database.get_connection()
    try:
        row = conn.execute(
            "SELECT 1 FROM StudentActivities WHERE student_id=? AND activity_id=?",
            (student_id, activity_id)
        ).fetchone()
        if not row:
            raise HTTPException(404, "Asignación no encontrada")
            
        conn.execute(
            "UPDATE StudentActivities SET status=?, feedback=? WHERE student_id=? AND activity_id=?",
            (payload.status, payload.feedback, student_id, activity_id)
        )
        conn.commit()
        return {"status": "actualizado"}
    finally:
        conn.close()


@app.put("/api/students/{student_id}/manual-mismatch")
def update_student_manual_mismatch(student_id: int, payload: ManualMismatchUpdate):
    conn = database.get_connection()
    try:
        st = conn.execute("SELECT 1 FROM Students WHERE id=?", (student_id,)).fetchone()
        if not st:
            raise HTTPException(404, "Estudiante no encontrado")
            
        conn.execute("UPDATE Students SET manual_mismatch=? WHERE id=?", (payload.manual_mismatch, student_id))
        conn.commit()
        return {"status": "success", "message": "Inconsistencia manual actualizada."}
    finally:
        conn.close()


# ------------------------------------------------------------------------------
# Frontend estático — se monta AL FINAL para no interceptar /api/*
# ------------------------------------------------------------------------------
if FRONTEND_DIR.exists():
    app.mount(
        "/",
        StaticFiles(directory=str(FRONTEND_DIR), html=True),
        name="frontend",
    )
