"""
PreviAula · database.py
------------------------------------------------------------------------------
Capa de datos del prototipo. Usa solo la librería estándar de Python (sqlite3),
así que no requiere dependencias extra para funcionar.

Responsabilidades:
  1. Abrir/crear la base SQLite (previaula.db) en la carpeta backend/.
  2. Crear el esquema: Students, Guardians, AttendanceLogs, Incidents,
     GuardianMeetings, Establishments, Users, Subjects, Grades,
     StudentSelfReports, AttendanceExcuses.
  3. Sembrar datos de prueba chilenos realistas (nombres locales, RUNs
     ficticios, índices IVE variados de JUNAEB, patrones de inasistencia,
     incidentes de desregulación emocional, citaciones a apoderados, notas y usuarios).

La siembra es idempotente: solo inserta si la base está vacía. Para regenerar
los datos del prototipo, basta con borrar el archivo previaula.db y reiniciar.
"""

from __future__ import annotations

import random
import sqlite3
from datetime import date, timedelta
from pathlib import Path

# --- Ubicación de la base junto a este archivo -------------------------------
BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "previaula.db"

# Semilla fija: los datos del prototipo se ven consistentes en cada arranque.
random.seed(2026)

# Ventana de historial (días hacia atrás) para asistencia e incidentes.
HISTORY_DAYS = 60
TODAY = date(2026, 7, 10)  # fecha "actual" del prototipo


# ==============================================================================
# Conexión
# ==============================================================================
def get_connection() -> sqlite3.Connection:
    """Devuelve una conexión con row_factory tipo dict y claves foráneas ON."""
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


# ==============================================================================
# Esquema
# ==============================================================================
SCHEMA = """
CREATE TABLE IF NOT EXISTS Establishments (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    comuna        TEXT    NOT NULL,
    ive_average   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS Guardians (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    run           TEXT    NOT NULL,
    full_name     TEXT    NOT NULL,
    relationship  TEXT    NOT NULL,   -- Madre / Padre / Abuela / Tutor legal
    phone         TEXT    NOT NULL,
    email         TEXT    NOT NULL,
    contact_ok    INTEGER NOT NULL DEFAULT 1,  -- ¿datos de contacto verificados?
    employment_status  TEXT DEFAULT NULL,
    education_level    TEXT DEFAULT NULL,
    availability_hours TEXT DEFAULT NULL,
    internet_access    TEXT DEFAULT NULL,
    has_computer       TEXT DEFAULT NULL,
    parent_comments    TEXT DEFAULT NULL,
    teacher_notes      TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS Students (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    run                 TEXT    NOT NULL,
    first_name          TEXT    NOT NULL,
    last_name           TEXT    NOT NULL,
    course              TEXT    NOT NULL,   -- 7° Básico A, 2° Medio C, ...
    ive_index           INTEGER NOT NULL,   -- Índice de Vulnerabilidad Escolar (0-100)
    comuna              TEXT    NOT NULL,
    guardian_id         INTEGER,
    avatar_seed         TEXT    NOT NULL,   -- semilla para avatar generado
    establishment_id    INTEGER,
    violence_risk_score INTEGER NOT NULL DEFAULT 15,
    home_risk_score     INTEGER NOT NULL DEFAULT 20,
    academic_risk_score INTEGER NOT NULL DEFAULT 25,
    manual_mismatch     TEXT DEFAULT NULL,
    FOREIGN KEY (guardian_id) REFERENCES Guardians(id),
    FOREIGN KEY (establishment_id) REFERENCES Establishments(id)
);

CREATE TABLE IF NOT EXISTS Users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE,
    password      TEXT    NOT NULL,   -- contraseña en texto plano (para prototipo)
    role          TEXT    NOT NULL,   -- apoderado | estudiante | profesor | orientador | funcionario
    related_id    INTEGER,            -- Student.id o Guardian.id según rol
    full_name     TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS Subjects (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    name             TEXT    NOT NULL,
    teacher_name     TEXT    NOT NULL,
    establishment_id INTEGER NOT NULL,
    FOREIGN KEY (establishment_id) REFERENCES Establishments(id)
);

CREATE TABLE IF NOT EXISTS Grades (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL,
    subject_id INTEGER NOT NULL,
    grade      REAL    NOT NULL,   -- nota formato 1.0 a 7.0
    term       INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (student_id) REFERENCES Students(id),
    FOREIGN KEY (subject_id) REFERENCES Subjects(id)
);

CREATE TABLE IF NOT EXISTS StudentSelfReports (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id     INTEGER NOT NULL,
    age_group      TEXT    NOT NULL,   -- basica | media
    energy_mood    TEXT,               -- emoji o nivel
    safe_at_school TEXT,               -- Sí/No o Likert
    social_ok      TEXT,               -- Sí/No o Likert
    stress_level   INTEGER,            -- 1 al 5 (solo enseñanza media)
    needs_talk     INTEGER NOT NULL DEFAULT 0,
    report_date    TEXT    NOT NULL,
    FOREIGN KEY (student_id) REFERENCES Students(id)
);

CREATE TABLE IF NOT EXISTS AttendanceExcuses (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id     INTEGER NOT NULL,
    log_date       TEXT    NOT NULL,   -- fecha a justificar YYYY-MM-DD
    reason         TEXT    NOT NULL,
    date_submitted TEXT    NOT NULL,   -- fecha YYYY-MM-DD
    status         TEXT    NOT NULL DEFAULT 'pendiente', -- pendiente | aprobada | rechazada
    FOREIGN KEY (student_id) REFERENCES Students(id)
);

CREATE TABLE IF NOT EXISTS AttendanceLogs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id    INTEGER NOT NULL,
    log_date      TEXT    NOT NULL,   -- ISO YYYY-MM-DD
    status        TEXT    NOT NULL,   -- presente | atrasado | ausente
    recorded_by   TEXT    NOT NULL,
    FOREIGN KEY (student_id) REFERENCES Students(id)
);

CREATE TABLE IF NOT EXISTS Incidents (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id         INTEGER NOT NULL,
    log_date           TEXT    NOT NULL,
    category           TEXT    NOT NULL,  -- Desregulación emocional, Conflicto...
    severity           TEXT    NOT NULL,  -- baja | moderada | alta
    description        TEXT    NOT NULL,
    reported_by        TEXT    NOT NULL,
    protocol_activated INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (student_id) REFERENCES Students(id)
);

CREATE TABLE IF NOT EXISTS GuardianMeetings (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id    INTEGER NOT NULL,
    meeting_date  TEXT    NOT NULL,
    purpose       TEXT    NOT NULL,   -- Entrevista, Citación, Reunión apoderados
    attended      INTEGER NOT NULL,   -- 1 asistió, 0 omitida
    FOREIGN KEY (student_id) REFERENCES Students(id)
);

CREATE TABLE IF NOT EXISTS Activities (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    title         TEXT    NOT NULL,
    description   TEXT    NOT NULL,
    type          TEXT    NOT NULL,   -- directa | indirecta
    category      TEXT    NOT NULL,   -- convivencia | emocional | academica | deportiva
    target_risk   TEXT    NOT NULL,   -- violence | home | academic | general
    delivery      TEXT    NOT NULL    -- presencial | online
);

CREATE TABLE IF NOT EXISTS StudentActivities (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id    INTEGER NOT NULL,
    activity_id   INTEGER NOT NULL,
    assigned_date TEXT    NOT NULL,   -- YYYY-MM-DD
    status        TEXT    NOT NULL DEFAULT 'asignada', -- asignada | en_progreso | completada
    assigned_by   TEXT    NOT NULL,   -- Docente | Orientador | Sistema
    feedback      TEXT,               -- Comentario al completar
    FOREIGN KEY (student_id) REFERENCES Students(id),
    FOREIGN KEY (activity_id) REFERENCES Activities(id)
);

CREATE TABLE IF NOT EXISTS GuardianSurveys (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    guardian_id    INTEGER NOT NULL,
    student_id     INTEGER NOT NULL,
    cohesion_rate  INTEGER NOT NULL,
    cohesion_help  INTEGER NOT NULL,
    safe_at_school TEXT NOT NULL,
    survey_date    TEXT NOT NULL,
    FOREIGN KEY (guardian_id) REFERENCES Guardians(id),
    FOREIGN KEY (student_id) REFERENCES Students(id)
);

CREATE TABLE IF NOT EXISTS GuardianReports (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    guardian_id    INTEGER NOT NULL,
    student_id     INTEGER NOT NULL,
    category       TEXT NOT NULL,
    description    TEXT NOT NULL,
    report_date    TEXT NOT NULL,
    FOREIGN KEY (guardian_id) REFERENCES Guardians(id),
    FOREIGN KEY (student_id) REFERENCES Students(id)
);
"""


# ==============================================================================
# Datos base para la siembra
# ==============================================================================
ESTABLISHMENTS_BLUEPRINT = [
    ("Liceo Gabriela Mistral", "La Pintana", 85),
    ("Escuela Básica República de Chile", "Cerro Navia", 92),
    ("Colegio Industrial San José", "Puente Alto", 76),
]

STUDENT_BLUEPRINT = [
    # (nombre, apellido, curso, ive, comuna, perfil)
    ("Mateo",     "Rojas",       "7° Básico A", 92, "La Pintana",
     {"asist": 0.78, "omite": 0.55, "inc": "alta", "violence": 75, "home": 80, "academic": 72}),
    ("Sofía",     "Valdés",      "2° Medio C",  74, "Puente Alto",
     {"asist": 0.89, "omite": 0.30, "inc": "moderada", "violence": 42, "home": 45, "academic": 38}),
    ("Lucas",     "San Martín",  "4° Medio A",  81, "Puente Alto",
     {"asist": 0.83, "omite": 0.60, "inc": "moderada", "violence": 58, "home": 68, "academic": 62}),
    ("Martina",   "Fuentes",     "1° Medio B",  88, "Cerro Navia",
     {"asist": 0.72, "omite": 0.65, "inc": "alta", "violence": 82, "home": 88, "academic": 78}),
    ("Benjamín",  "Cortés",      "8° Básico A", 69, "Puente Alto",
     {"asist": 0.95, "omite": 0.10, "inc": "baja", "violence": 12, "home": 18, "academic": 15}),
    ("Florencia", "Muñoz",       "2° Medio C",  95, "La Pintana",
     {"asist": 0.68, "omite": 0.70, "inc": "alta", "violence": 88, "home": 92, "academic": 85}),
    ("Agustín",   "Reyes",       "6° Básico B", 63, "Cerro Navia",
     {"asist": 0.97, "omite": 0.05, "inc": "baja", "violence": 8, "home": 12, "academic": 10}),
    ("Antonia",   "Cáceres",     "1° Medio B",  85, "Cerro Navia",
     {"asist": 0.86, "omite": 0.40, "inc": "moderada", "violence": 35, "home": 55, "academic": 42}),
    ("Vicente",   "Sepúlveda",   "4° Medio A",  77, "La Pintana",
     {"asist": 0.91, "omite": 0.20, "inc": "baja", "violence": 18, "home": 25, "academic": 28}),
    ("Catalina",  "Herrera",     "7° Básico A", 90, "La Pintana",
     {"asist": 0.75, "omite": 0.50, "inc": "moderada", "violence": 65, "home": 70, "academic": 60}),
    ("Joaquín",   "Navarro",     "8° Básico A", 58, "Puente Alto",
     {"asist": 0.98, "omite": 0.05, "inc": "baja", "violence": 10, "home": 15, "academic": 12}),
    ("Isidora",   "Pizarro",     "6° Básico B", 82, "Cerro Navia",
     {"asist": 0.88, "omite": 0.35, "inc": "moderada", "violence": 40, "home": 48, "academic": 35}),
    ("Tomás",     "Aravena",     "2° Medio C",  93, "Puente Alto",
     {"asist": 0.70, "omite": 0.62, "inc": "alta", "violence": 78, "home": 85, "academic": 80}),
    ("Emilia",    "Bravo",       "1° Medio B",  66, "Puente Alto",
     {"asist": 0.96, "omite": 0.10, "inc": "baja", "violence": 15, "home": 22, "academic": 18}),
    ("Maximiliano","Contreras",  "4° Medio A",  79, "Cerro Navia",
     {"asist": 0.84, "omite": 0.45, "inc": "moderada", "violence": 48, "home": 58, "academic": 50}),
    ("Josefa",    "Vega",        "7° Básico A", 87, "La Pintana",
     {"asist": 0.90, "omite": 0.25, "inc": "baja", "violence": 20, "home": 30, "academic": 22}),
]

ACTIVITIES_BLUEPRINT = [
    ("Taller de Comunicación Asertiva y Empatía", "Desarrollo de habilidades de escucha y expresión no violenta.", "directa", "convivencia", "violence", "presencial"),
    ("Club de Fútbol Mixto y Liderazgo", "Deporte social que fomenta el trabajo en equipo y el autocontrol.", "indirecta", "deportiva", "violence", "presencial"),
    ("Taller de Mindfulness y Calma Mental", "Técnicas de respiración y autorregulación emocional en el aula.", "directa", "emocional", "home", "online"),
    ("Círculos de Apoyo Psicoeducativo", "Espacio seguro de conversación y contención para estudiantes con problemáticas complejas.", "directa", "emocional", "home", "presencial"),
    ("Club de Tareas y Reforzamiento Pedagógico", "Apoyo personalizado para mejorar rendimiento académico y hábitos de estudio.", "indirecta", "academica", "academic", "presencial"),
    ("Taller de Creación Digital y Robótica", "Fomento de la motivación y asistencia a través de la tecnología aplicada.", "indirecta", "academica", "academic", "online"),
    ("Taller de Mediadores Escolares Jóvenes", "Formación de estudiantes líderes para resolución pacífica de conflictos entre pares.", "directa", "convivencia", "violence", "presencial"),
    ("Yoga y Expresión Corporal Infantil", "Canalización del estrés infantil mediante posturas y juego guiado.", "indirecta", "emocional", "general", "presencial")
]

GUARDIAN_FIRST = ["Carmen", "Rosa", "Patricia", "Jacqueline", "Mónica",
                  "Héctor", "Luis", "Marcelo", "Jorge", "Nibaldo",
                  "Verónica", "Sandra", "Claudia", "Gladys", "Juan"]
GUARDIAN_LAST = ["Soto", "Araya", "Poblete", "Tapia", "Godoy", "Riquelme",
                 "Fuentealba", "Salinas", "Cárdenas", "Ñanco", "Millán"]
RELATIONSHIPS = ["Madre", "Padre", "Abuela", "Tía", "Tutor legal"]

INCIDENT_LIBRARY = {
    "alta": [
        ("Desregulación emocional", "Crisis de angustia en aula; requirió apoyo de dupla psicosocial y contención."),
        ("Activación de protocolo", "Se activa protocolo de retención escolar por ausentismo reiterado no justificado."),
        ("Conflicto interpersonal", "Altercado físico en patio; ambas partes derivadas a mediación."),
    ],
    "moderada": [
        ("Desregulación emocional", "Episodio de frustración durante evaluación; se aplicó pausa sensorial."),
        ("Conflicto interpersonal", "Discusión verbal con compañero; resuelto con conversación guiada."),
        ("Observación general", "Se retira antes del horario sin autorización del apoderado."),
    ],
    "baja": [
        ("Observación general", "Muestra desmotivación en asignaturas del bloque de la tarde."),
        ("Observación general", "Olvido reiterado de materiales; se coordina apoyo con familia."),
        ("Desregulación emocional", "Se muestra retraído en actividades grupales; se ofrece acompañamiento."),
    ],
}

RECORDERS = ["Prof. A. Silva", "Prof. C. Morales", "Orientador T. Ruiz",
             "Dir. M. Fuentes", "Psic. L. Espinoza", "Prof. R. Gutiérrez"]

MEETING_PURPOSES = ["Entrevista de apoderado", "Citación por asistencia",
                    "Reunión de apoderados", "Devolución psicosocial"]

SUBJECT_NAMES = ["Lenguaje y Comunicación", "Matemáticas", "Historia, Geografía y Ciencias Sociales", "Ciencias Naturales"]
TEACHERS = ["Prof. A. Silva", "Prof. C. Morales", "Prof. R. Gutiérrez", "Prof. S. Ortega"]


# ==============================================================================
# Utilidades de generación
# ==============================================================================
def _fake_run() -> str:
    """Genera un RUN chileno ficticio con formato NN.NNN.NNN-DV (no válido real)."""
    body = random.randint(9_000_000, 24_999_999)
    dv = random.choice(list("0123456789K"))
    s = f"{body:,}".replace(",", ".")
    return f"{s}-{dv}"


def _phone() -> str:
    return f"+56 9 {random.randint(3000, 9999)} {random.randint(1000, 9999)}"


def _weekdays(days_back: int):
    """Itera las fechas hábiles (lun-vie) dentro de la ventana de historial."""
    for delta in range(days_back, -1, -1):
        d = TODAY - timedelta(days=delta)
        if d.weekday() < 5:  # 0-4 = lunes a viernes
            yield d


# ==============================================================================
# Siembra
# ==============================================================================
def _seed(conn: sqlite3.Connection) -> None:
    cur = conn.cursor()

    # --- Establecimientos ---------------------------------------------------
    est_ids = []
    for name, comuna, ive in ESTABLISHMENTS_BLUEPRINT:
        cur.execute(
            "INSERT INTO Establishments (name, comuna, ive_average) VALUES (?,?,?)",
            (name, comuna, ive)
        )
        est_ids.append(cur.lastrowid)

    # --- Asignaturas --------------------------------------------------------
    sub_map = {} # (est_id, sub_name) -> sub_id
    for est_id in est_ids:
        for sname, tname in zip(SUBJECT_NAMES, TEACHERS):
            cur.execute(
                "INSERT INTO Subjects (name, teacher_name, establishment_id) VALUES (?,?,?)",
                (sname, tname, est_id)
            )
            sub_map[(est_id, sname)] = cur.lastrowid

    # --- Apoderados ---------------------------------------------------------
    guardian_ids = []
    for bp in STUDENT_BLUEPRINT:
        name = f"{random.choice(GUARDIAN_FIRST)} {random.choice(GUARDIAN_LAST)}"
        rel = random.choice(RELATIONSHIPS)
        email = (name.lower().replace(" ", ".")
                 .replace("é", "e").replace("í", "i").replace("ó", "o")
                 .replace("á", "a").replace("ñ", "n") + "@correo.cl")
        # Algunos apoderados con datos de contacto desactualizados (desajuste).
        contact_ok = 0 if bp[5]["omite"] > 0.55 and random.random() < 0.6 else 1
        cur.execute(
            "INSERT INTO Guardians (run, full_name, relationship, phone, email, contact_ok)"
            " VALUES (?,?,?,?,?,?)",
            (_fake_run(), name, rel, _phone(), email, contact_ok),
        )
        guardian_ids.append(cur.lastrowid)

    # --- Estudiantes --------------------------------------------------------
    student_records = []
    for (first, last, course, ive, comuna, profile), gid in zip(
        STUDENT_BLUEPRINT, guardian_ids
    ):
        # Determinar establecimiento según comuna
        if comuna == "La Pintana":
            est_id = est_ids[0]
        elif comuna == "Cerro Navia":
            est_id = est_ids[1]
        else: # Puente Alto / otros
            est_id = est_ids[2]

        cur.execute(
            "INSERT INTO Students (run, first_name, last_name, course, ive_index,"
            " comuna, guardian_id, avatar_seed, establishment_id, violence_risk_score,"
            " home_risk_score, academic_risk_score) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (_fake_run(), first, last, course, ive, comuna, gid,
             f"{first}{last}", est_id, profile.get("violence", 15),
             profile.get("home", 20), profile.get("academic", 25)),
        )
        sid = cur.lastrowid
        student_records.append((sid, profile, est_id, first, last, gid))

    # --- Asistencia diaria (lun-vie) ---------------------------------------
    school_days = list(_weekdays(HISTORY_DAYS))
    n_days = len(school_days)
    for sid, profile, _, _, _, _ in student_records:
        target = profile["asist"]
        absent_n = round((1 - target) * n_days)
        late_n = max(1, round(0.05 * n_days))

        idx = list(range(n_days))
        random.shuffle(idx)
        absent_idx = set(idx[:absent_n])
        late_idx = set(idx[absent_n:absent_n + late_n])

        for i, d in enumerate(school_days):
            if i in absent_idx:
                status = "ausente"
            elif i in late_idx:
                status = "atrasado"
            else:
                status = "presente"
            cur.execute(
                "INSERT INTO AttendanceLogs (student_id, log_date, status, recorded_by)"
                " VALUES (?,?,?,?)",
                (sid, d.isoformat(), status, random.choice(RECORDERS)),
            )

    # --- Incidentes ---------------------------------------------------------
    load_map = {"alta": (3, 6), "moderada": (1, 3), "baja": (0, 2)}
    for sid, profile, _, _, _, _ in student_records:
        lo, hi = load_map[profile["inc"]]
        n = random.randint(lo, hi)
        for _ in range(n):
            sev = profile["inc"]
            if random.random() < 0.3:
                sev = random.choice(["baja", "moderada", "alta"])
            cat, desc = random.choice(INCIDENT_LIBRARY[sev])
            days_ago = random.randint(0, HISTORY_DAYS)
            d = TODAY - timedelta(days=days_ago)
            protocol = 1 if sev == "alta" and random.random() < 0.7 else 0
            cur.execute(
                "INSERT INTO Incidents (student_id, log_date, category, severity,"
                " description, reported_by, protocol_activated) VALUES (?,?,?,?,?,?,?)",
                (sid, d.isoformat(), cat, sev, desc,
                 random.choice(RECORDERS), protocol),
            )

    # --- Citaciones / reuniones de apoderado -------------------------------
    for sid, profile, _, _, _, _ in student_records:
        n_meetings = random.randint(2, 5)
        for _ in range(n_meetings):
            days_ago = random.randint(0, HISTORY_DAYS)
            d = TODAY - timedelta(days=days_ago)
            attended = 0 if random.random() < profile["omite"] else 1
            cur.execute(
                "INSERT INTO GuardianMeetings (student_id, meeting_date, purpose, attended)"
                " VALUES (?,?,?,?)",
                (sid, d.isoformat(), random.choice(MEETING_PURPOSES), attended),
            )

    # --- Calificaciones (Notas) --------------------------------------------
    for sid, profile, est_id, _, _, _ in student_records:
        # Ponderar notas según perfil de riesgo (asistencia)
        base_factor = profile["asist"] # 0.68 a 0.98
        for sname in SUBJECT_NAMES:
            sub_id = sub_map[(est_id, sname)]
            # Generar 3 o 4 notas por asignatura
            n_grades = random.randint(3, 4)
            for _ in range(n_grades):
                # Desviación realista
                raw_grade = 3.5 + base_factor * 3.0 + random.uniform(-0.6, 0.6)
                grade = round(min(7.0, max(1.0, raw_grade)), 1)
                cur.execute(
                    "INSERT INTO Grades (student_id, subject_id, grade, term) VALUES (?,?,?,?)",
                    (sid, sub_id, grade, 1)
                )

    # --- Catálogo de Actividades Preventivas --------------------------------
    act_ids = {} # title -> id
    for title, desc, type_act, cat, target, deliv in ACTIVITIES_BLUEPRINT:
        cur.execute(
            "INSERT INTO Activities (title, description, type, category, target_risk, delivery) "
            "VALUES (?,?,?,?,?,?)",
            (title, desc, type_act, cat, target, deliv)
        )
        act_ids[title] = cur.lastrowid

    # --- Asignaciones de Actividades a Estudiantes --------------------------
    for sid, profile, est_id, first, last, gid in student_records:
        v_risk = profile.get("violence", 15)
        h_risk = profile.get("home", 20)
        a_risk = profile.get("academic", 25)
        
        if v_risk >= 60:
            cur.execute(
                "INSERT INTO StudentActivities (student_id, activity_id, assigned_date, status, assigned_by) "
                "VALUES (?,?,'2026-07-10','asignada','Sistema')",
                (sid, act_ids["Taller de Comunicación Asertiva y Empatía"])
            )
            cur.execute(
                "INSERT INTO StudentActivities (student_id, activity_id, assigned_date, status, assigned_by) "
                "VALUES (?,?,'2026-07-10','en_progreso','Orientador')",
                (sid, act_ids["Taller de Mediadores Escolares Jóvenes"])
            )
        if h_risk >= 60:
            cur.execute(
                "INSERT INTO StudentActivities (student_id, activity_id, assigned_date, status, assigned_by) "
                "VALUES (?,?,'2026-07-10','asignada','Sistema')",
                (sid, act_ids["Taller de Mindfulness y Calma Mental"])
            )
        if a_risk >= 60:
            cur.execute(
                "INSERT INTO StudentActivities (student_id, activity_id, assigned_date, status, assigned_by) "
                "VALUES (?,?,'2026-07-10','asignada','Sistema')",
                (sid, act_ids["Club de Tareas y Reforzamiento Pedagógico"])
            )
            
        cur.execute(
            "INSERT INTO StudentActivities (student_id, activity_id, assigned_date, status, assigned_by) "
            "VALUES (?,?,'2026-07-10','asignada','Sistema')",
            (sid, act_ids["Club de Fútbol Mixto y Liderazgo"])
        )
        
        # Asignar taller online en progreso a Mateo Rojas para pruebas inmediatas
        if first == "Mateo" and last == "Rojas":
            cur.execute(
                "INSERT INTO StudentActivities (student_id, activity_id, assigned_date, status, assigned_by) "
                "VALUES (?,?,'2026-07-10','en_progreso','Sistema')",
                (sid, act_ids["Taller de Mindfulness y Calma Mental"])
            )

    # --- Usuarios del Sistema -----------------------------------------------
    # 1. Usuarios genéricos/fáciles de prueba
    # Profesor
    cur.execute(
        "INSERT INTO Users (username, password, role, related_id, full_name)"
        " VALUES (?,?,?,?,?)",
        ("profesor", "profesor123", "profesor", None, "Prof. Andrés Silva")
    )
    # Orientador (Psicólogo)
    cur.execute(
        "INSERT INTO Users (username, password, role, related_id, full_name)"
        " VALUES (?,?,?,?,?)",
        ("orientador", "orientador123", "orientador", None, "Psic. Lorena Espinoza")
    )
    # Funcionario Alto Rango
    cur.execute(
        "INSERT INTO Users (username, password, role, related_id, full_name)"
        " VALUES (?,?,?,?,?)",
        ("funcionario", "funcionario123", "funcionario", None, "Don Patricio Alvear (Administrador Municipal)")
    )
    # Apoderado por defecto (apunta al apoderado de Mateo Rojas, estudiante id 1)
    cur.execute(
        "INSERT INTO Users (username, password, role, related_id, full_name)"
        " VALUES (?,?,?,?,?)",
        ("apoderado", "apoderado123", "apoderado", 1, "Carmen Rojas (Apoderado de Mateo)")
    )
    # Estudiante por defecto (Mateo Rojas, estudiante id 1)
    cur.execute(
        "INSERT INTO Users (username, password, role, related_id, full_name)"
        " VALUES (?,?,?,?,?)",
        ("estudiante", "estudiante123", "estudiante", 1, "Mateo Rojas")
    )

    # 2. Cuentas individuales para todos los estudiantes y apoderados para escalar
    for sid, profile, est_id, first, last, gid in student_records:
        username_st = f"estudiante_{first.lower()}"
        cur.execute(
            "INSERT OR IGNORE INTO Users (username, password, role, related_id, full_name)"
            " VALUES (?,?,?,?,?)",
            (username_st, "123", "estudiante", sid, f"{first} {last}")
        )
        
        # Buscar nombre apoderado
        ap_row = cur.execute("SELECT full_name FROM Guardians WHERE id = ?", (gid,)).fetchone()
        ap_name = ap_row["full_name"] if ap_row else "Apoderado"
        ap_first = ap_name.split()[0].lower()
        username_ap = f"apoderado_{ap_first}"
        cur.execute(
            "INSERT OR IGNORE INTO Users (username, password, role, related_id, full_name)"
            " VALUES (?,?,?,?,?)",
            (username_ap, "123", "apoderado", gid, ap_name)
        )

    # --- Autorreportes de Estudiantes y Encuestas de Apoderados (Seeding) -----
    for sid, profile, est_id, first, last, gid in student_records:
        if first == "Martina" and last == "Fuentes":
            # Martina (ID 4): insegura, solicita hablar con psicólogo
            cur.execute(
                "INSERT INTO StudentSelfReports (student_id, age_group, energy_mood, safe_at_school, social_ok, stress_level, needs_talk, report_date) "
                "VALUES (?,'media','☁️','No','Regular',4,1,'2026-07-10')",
                (sid,)
            )
            # Apoderada Carmen: cree que todo está bien
            cur.execute(
                "INSERT INTO GuardianSurveys (guardian_id, student_id, cohesion_rate, cohesion_help, safe_at_school, survey_date) "
                "VALUES (?,?,4,3,'Sí','2026-07-10')",
                (gid, sid)
            )
        elif first == "Mateo" and last == "Rojas":
            # Mateo (ID 1): todo bien, consistente
            cur.execute(
                "INSERT INTO StudentSelfReports (student_id, age_group, energy_mood, safe_at_school, social_ok, stress_level, needs_talk, report_date) "
                "VALUES (?,'basica','☀️','Sí','Sí',1,0,'2026-07-10')",
                (sid,)
            )
            cur.execute(
                "INSERT INTO GuardianSurveys (guardian_id, student_id, cohesion_rate, cohesion_help, safe_at_school, survey_date) "
                "VALUES (?,?,4,3,'Sí','2026-07-10')",
                (gid, sid)
            )
        else:
            # Consistentes por defecto
            safe_val = "Sí" if profile.get("violence", 15) < 60 else "No"
            cur.execute(
                "INSERT INTO StudentSelfReports (student_id, age_group, energy_mood, safe_at_school, social_ok, stress_level, needs_talk, report_date) "
                "VALUES (?,'media','☀️',?,'Sí',2,0,'2026-07-10')",
                (sid, safe_val)
            )
            cur.execute(
                "INSERT INTO GuardianSurveys (guardian_id, student_id, cohesion_rate, cohesion_help, safe_at_school, survey_date) "
                "VALUES (?,?,3,2,?,'2026-07-10')",
                (gid, sid, safe_val)
            )

    conn.commit()


# ==============================================================================
# Public Initialization
# ==============================================================================
def init_db() -> None:
    """Crea el esquema y siembra datos si la base está vacía (idempotente)."""
    conn = get_connection()
    try:
        conn.executescript(SCHEMA)
        conn.commit()
        count = conn.execute("SELECT COUNT(*) AS n FROM Students").fetchone()["n"]
        if count == 0:
            _seed(conn)
            print(f"[PreviAula] Base sembrada en {DB_PATH}")
        else:
            print(f"[PreviAula] Base existente con {count} estudiantes ({DB_PATH})")
    finally:
        conn.close()


# Permite ejecutar `python database.py` para (re)generar la base directamente.
if __name__ == "__main__":
    if DB_PATH.exists():
        print(f"[PreviAula] Eliminando base previa {DB_PATH}")
        DB_PATH.unlink()
    init_db()
    # Pequeño resumen de verificación
    conn = get_connection()
    for table in ("Establishments", "Guardians", "Students", "Users", "Subjects",
                  "Grades", "AttendanceLogs", "Incidents", "GuardianMeetings"):
        n = conn.execute(f"SELECT COUNT(*) AS n FROM {table}").fetchone()["n"]
        print(f"  · {table:<18} {n:>5} filas")
    conn.close()
