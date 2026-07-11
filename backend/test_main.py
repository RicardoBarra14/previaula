import pytest
from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)

def test_health():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.json()["app"] == "PreviAula"

def test_login_teacher():
    response = client.post("/api/auth/login", json={
        "username": "profesor",
        "password": "profesor123"
    })
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert data["user"]["role"] == "profesor"
    assert data["user"]["full_name"] == "Prof. Andrés Silva"

def test_login_student():
    response = client.post("/api/auth/login", json={
        "username": "estudiante",
        "password": "estudiante123"
    })
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert data["user"]["role"] == "estudiante"
    assert data["student_info"] is not None
    assert data["student_info"]["first_name"] == "Mateo"

def test_login_guardian():
    response = client.post("/api/auth/login", json={
        "username": "apoderado",
        "password": "apoderado123"
    })
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert data["user"]["role"] == "apoderado"
    assert data["guardian_info"] is not None
    assert len(data["guardian_info"]["students"]) > 0

def test_login_fail():
    response = client.post("/api/auth/login", json={
        "username": "profesor",
        "password": "wrongpassword"
    })
    assert response.status_code == 401
    data = response.json()
    assert "detail" in data

def test_get_student_grades():
    response = client.get("/api/students/1/grades")
    assert response.status_code == 200
    data = response.json()
    assert data["student_id"] == 1
    assert "grades" in data
    assert "general_average" in data
    assert len(data["grades"]) > 0

def test_student_self_report():
    response = client.post("/api/student/self-report", json={
        "student_id": 1,
        "age_group": "basica",
        "energy_mood": "☀️",
        "safe_at_school": "Sí",
        "social_ok": "Sí",
        "needs_talk": False
    })
    assert response.status_code == 201
    data = response.json()
    assert data["status"] == "registrado"
    assert data["needs_talk"] is False

def test_guardian_excuse():
    response = client.post("/api/guardian/excuse", json={
        "student_id": 1,
        "log_date": "2026-07-10",
        "reason": "Control médico anual."
    })
    assert response.status_code == 201
    data = response.json()
    assert data["status"] == "pendiente"

def test_establishments_compare():
    response = client.get("/api/establishments/compare")
    assert response.status_code == 200
    data = response.json()
    assert len(data) > 0
    assert "name" in data[0]
    assert "students_count" in data[0]
    assert "avg_gpa" in data[0]
    assert "avg_violence_risk" in data[0]
    assert "avg_home_risk" in data[0]


def test_attendance_by_date():
    response = client.get("/api/attendance?course=7%C2%B0%20B%C3%A1sico%20A&date=2026-07-10")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, dict)


def test_activities_flow():
    # 1. Listar catálogo de actividades
    response = client.get("/api/activities")
    assert response.status_code == 200
    acts = response.json()
    assert len(acts) > 0

    # 2. Ver actividades asignadas y recomendadas del estudiante 1
    response = client.get("/api/students/1/activities")
    assert response.status_code == 200
    data = response.json()
    assert "assigned" in data
    assert "recommended" in data

    # 3. Asignar actividad 4 al estudiante 1
    response = client.post("/api/students/1/activities", json={
        "activity_id": 4,
        "assigned_by": "Orientador de Test"
    })
    assert response.status_code in (200, 201)

    # 4. Actualizar estado de la actividad asignada a 'en_progreso'
    response = client.put("/api/students/1/activities/4", json={
        "status": "en_progreso",
        "feedback": "Iniciado correctamente en test."
    })
    assert response.status_code == 200
    assert response.json()["status"] == "actualizado"


def test_register_user():
    # Registrar nuevo usuario
    response = client.post("/api/auth/register", json={
        "username": "test.profesor",
        "password": "testpassword123",
        "role": "profesor",
        "full_name": "Profesor de Test"
    })
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert data["user"]["username"] == "test.profesor"
    assert data["user"]["role"] == "profesor"


def test_create_establishment():
    # Registrar nuevo establecimiento
    response = client.post("/api/establishments", json={
        "name": "Colegio de Test San Francisco",
        "comuna": "La Pintana",
        "ive_average": 88
    })
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert "establishment_id" in data


def test_add_grade():
    # Registrar nueva nota para estudiante 1
    response = client.post("/api/students/1/grades", json={
        "subject_name": "Matemáticas",
        "grade": 6.5,
        "term": 1
    })
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"


def test_guardian_survey_and_mismatch():
    # 1. Enviar encuesta de apoderado para estudiante 4 (Martina Fuentes)
    # Martina ya tiene un autorreporte con safe_at_school = "No"
    # Si su apoderado envía safe_at_school = "Sí" -> Mismatch!
    response = client.post("/api/guardian/survey", json={
        "guardian_id": 4,
        "student_id": 4,
        "cohesion_rate": 4,
        "cohesion_help": 3,
        "safe_at_school": "Sí"
    })
    assert response.status_code == 201
    assert response.json()["status"] == "success"
    
    # 2. Consultar el riesgo de Martina y verificar que el mismatch esté activo
    response = client.get("/api/students/4")
    assert response.status_code == 200
    data = response.json()
    assert data["risk"]["mismatch"] is True
    assert "Inconsistencia" in data["risk"]["mismatch_detail"]
