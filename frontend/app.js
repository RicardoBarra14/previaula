/* ==========================================================================
   PreviAula · app.js
   Lógica de interacción del panel. Consume la API FastAPI y, si no está
   disponible (por ejemplo al abrir index.html sin servidor), cae de forma
   automática al respaldo local window.PREVIAULA_MOCK con los mismos datos.
   ========================================================================== */

(() => {
  "use strict";

  // ------------------------------------------------------------------ Estado
  const API = "";                     // mismo origen cuando lo sirve FastAPI
  const MOCK = window.PREVIAULA_MOCK || {};
  let USE_MOCK = false;               // se decide al arrancar (probe /api/health)

  if (!window.MOCK_ATTENDANCE_CACHE) window.MOCK_ATTENDANCE_CACHE = {};
  if (!window.MOCK_STUDENT_ACTIVITIES_CACHE) window.MOCK_STUDENT_ACTIVITIES_CACHE = {};
  if (!window.MOCK_STUDENT_GRADES_CACHE) window.MOCK_STUDENT_GRADES_CACHE = {};
  if (!window.MOCK_ESTABLISHMENTS_CACHE) window.MOCK_ESTABLISHMENTS_CACHE = null;

  const state = {
    students: [],
    incidents: [],
    courses: [],
    summary: {},
    showAllAlerts: false,
    currentCourse: null,
    attendanceDraft: {},              // { studentId: "presente"|"atrasado"|"ausente" }
    incidentSeverity: "baja",
    familyChildIds: [],
    currentChild: null,
    sessionIncidents: [],
    user: null,
    studentInfo: null,
    guardianInfo: null,
    wellbeingAgeGroup: "basica",
    activeEstablishmentId: 1,
  };

  let gaugeSeq = 0;

  // --------------------------------------------------------------- Utilidades
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const escapeHTML = (s = "") =>
    String(s).replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));

  const AVATAR_COLORS = [
    "#3B5E66", "#5B7F86", "#6E9199", "#7C9A72", "#B0885A", "#8A7CA0", "#4C757F",
  ];
  const hash = (str = "") => {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return h;
  };
  const initials = (name = "") =>
    name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] || "").join("").toUpperCase();

  const avatar = (seed, name, cls = "") => {
    const color = AVATAR_COLORS[hash(seed || name) % AVATAR_COLORS.length];
    return `<div class="avatar ${cls}" style="background:${color}">${escapeHTML(initials(name))}</div>`;
  };

  const RISK_VAR = { alto: "--risk-alto", medio: "--risk-medio", bajo: "--risk-bajo" };
  const FACTOR_VAR = {
    "Inasistencia": "--f-asistencia",
    "Reuniones omitidas": "--f-reuniones",
    "Incidentes": "--f-incidentes",
    "Vulnerabilidad (IVE)": "--f-ive",
  };

  const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
    "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

  const parseDate = (iso) => new Date(iso + "T00:00:00");
  const longDate = (iso) => {
    const d = parseDate(iso);
    return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} de ${MONTHS[d.getMonth()]} de ${d.getFullYear()}`;
  };
  const shortDate = (iso) => {
    const d = parseDate(iso);
    return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`;
  };

  // ------------------------------------------------------------- Simulación Mock API (Offline)
  function simulateMockApi(path, method, body) {
    if (method === "POST") {
      if (path === "/api/auth/login") {
        const u = body.username.toLowerCase();
        const p = body.password;
        if (!p.endsWith("123") && p !== "123") {
          return { error: "Usuario o contraseña incorrectos" };
        }
        
        let role = "profesor";
        let full_name = "Prof. Andrés Silva";
        let related_id = null;
        
        if (u.includes("orientador")) {
          role = "orientador";
          full_name = "Psic. Lorena Espinoza";
        } else if (u.includes("funcionario")) {
          role = "funcionario";
          full_name = "Don Patricio Alvear (Sostenedor)";
        } else if (u.includes("apoderado")) {
          role = "apoderado";
          related_id = 4; // Martina Fuentes' guardian
          full_name = "Carmen Fuentes (Apoderado)";
        } else if (u.includes("estudiante_martina") || u.includes("martina")) {
          role = "estudiante";
          related_id = 4; // Martina Fuentes
          full_name = "Martina Fuentes";
        } else if (u.includes("estudiante")) {
          role = "estudiante";
          related_id = 1; // Mateo Rojas
          full_name = "Mateo Rojas";
        }
        
        let student_info = null;
        let guardian_info = null;
        
        if (role === "estudiante") {
          const s = (MOCK.students || []).find(x => x.id === related_id) || (MOCK.students || [])[0];
          if (s) {
            student_info = JSON.parse(JSON.stringify(s));
            student_info.establishment_name = "Liceo Gabriela Mistral";
            related_id = s.id;
          }
        } else if (role === "apoderado") {
          const s = (MOCK.students || []).find(x => x.id === 4) || (MOCK.students || [])[0];
          guardian_info = {
            id: related_id,
            full_name: full_name,
            relationship: "Madre",
            phone: "+56 9 8472 1928",
            email: "c.fuentes@correo.cl",
            students: []
          };
          if (s) {
            const s_copy = JSON.parse(JSON.stringify(s));
            s_copy.establishment_name = "Liceo Gabriela Mistral";
            guardian_info.students.push(s_copy);
          }
        }
        
        return {
          status: "success",
          user: { id: 99, username: body.username, role, full_name, related_id },
          student_info,
          guardian_info
        };
      }
      if (path === "/api/auth/register") {
        const username = body.username;
        const role = body.role;
        const fullName = body.full_name;
        let relatedId = body.related_id || (Math.floor(Math.random() * 10) + 1);
        
        const user = {
          id: Date.now(),
          username: username,
          role: role,
          full_name: fullName,
          related_id: relatedId
        };
        
        let studentInfo = null;
        if (role === "estudiante") {
          const st = (MOCK.students || []).find(s => s.id === relatedId) || {
            id: relatedId,
            first_name: fullName.split(" ")[0],
            last_name: fullName.split(" ")[1] || "",
            course: "7° Básico A",
            ive_index: 82,
            comuna: "La Pintana"
          };
          studentInfo = {
            id: st.id,
            first_name: st.first_name || st.full_name.split(" ")[0],
            last_name: st.last_name || st.full_name.split(" ")[1] || "",
            course: st.course || "7° Básico A",
            ive_index: st.ive_index || 82,
            comuna: st.comuna || "La Pintana",
            establishment_name: "Liceo Gabriela Mistral"
          };
        }
        
        return {
          status: "success",
          user: user,
          student_info: studentInfo,
          guardian_info: null
        };
      }
      if (path === "/api/establishments") {
        if (!window.MOCK_ESTABLISHMENTS_CACHE) {
          simulateMockApi("/api/establishments/compare", "GET");
        }
        const newId = window.MOCK_ESTABLISHMENTS_CACHE.length + 1;
        const newEst = {
          id: newId,
          name: body.name,
          comuna: body.comuna,
          ive_average: parseInt(body.ive_average),
          students_count: 0,
          avg_attendance: 100,
          high_risk_count: 0,
          incidents_count: 0,
          avg_gpa: body.avg_gpa || 5.0,
          avg_violence_risk: body.avg_violence_risk || 15,
          avg_home_risk: body.avg_home_risk || 20
        };
        window.MOCK_ESTABLISHMENTS_CACHE.push(newEst);
        return { status: "success", establishment_id: newId, message: "Establecimiento registrado exitosamente con asignaturas." };
      }
      if (path.includes("/grades")) {
        const studentId = parseInt(path.split("/")[3]);
        const payload = body;
        if (!window.MOCK_STUDENT_GRADES_CACHE[studentId]) {
          simulateMockApi(path, "GET");
        }
        const records = window.MOCK_STUDENT_GRADES_CACHE[studentId] || [];
        let record = records.find(r => r.subject_name === payload.subject_name);
        if (!record) {
          record = { subject_name: payload.subject_name, teacher_name: "Docente Asignado", grades: [], average: 0.0 };
          records.push(record);
        }
        record.grades.push(parseFloat(payload.grade));
        record.average = Math.round((record.grades.reduce((a,b)=>a+b, 0) / record.grades.length) * 10) / 10;
        window.MOCK_STUDENT_GRADES_CACHE[studentId] = records;
        
        // Actualizar promedio general del estudiante en state.students para consistencia en dashboards
        const student = state.students.find(s => s.id === studentId);
        if (student) {
          const general_avg = Math.round((records.reduce((a,b)=>a+b.average, 0) / records.length) * 10) / 10;
          // Actualizar nota simulada
          student.academic_risk_score = Math.max(10, Math.min(90, Math.round((7.0 - general_avg) * 15)));
        }
        
        return { status: "success", message: "Calificación registrada exitosamente" };
      }
      if (path === "/api/student/self-report") {
        const studentId = body.student_id;
        if (!window.MOCK_STUDENT_REPORTS) window.MOCK_STUDENT_REPORTS = {};
        window.MOCK_STUDENT_REPORTS[studentId] = body.safe_at_school || "Sí";
        
        const student = state.students.find(s => s.id === studentId);
        if (student) {
          const pSafe = window.MOCK_PARENT_SURVEYS ? window.MOCK_PARENT_SURVEYS[studentId] : "Sí";
          const sSafe = body.safe_at_school || "Sí";
          if ((pSafe === "Sí" && sSafe === "No") || (pSafe === "No" && sSafe === "Sí")) {
            student.risk.mismatch = true;
            student.risk.mismatch_detail = "Inconsistencia de Seguridad: El apoderado percibe plena seguridad del estudiante en el liceo, pero el estudiante reporta sentirse inseguro.";
          } else {
            student.risk.mismatch = false;
            student.risk.mismatch_detail = "";
          }
        }
        return { id: 999, status: "registrado", needs_talk: body.needs_talk };
      }
      if (path === "/api/guardian/survey") {
        const studentId = body.student_id;
        if (!window.MOCK_PARENT_SURVEYS) window.MOCK_PARENT_SURVEYS = {};
        window.MOCK_PARENT_SURVEYS[studentId] = body.safe_at_school;
        
        const student = state.students.find(s => s.id === studentId);
        if (student) {
          const sSafe = window.MOCK_STUDENT_REPORTS ? window.MOCK_STUDENT_REPORTS[studentId] : "No";
          const pSafe = body.safe_at_school;
          if ((pSafe === "Sí" && sSafe === "No") || (pSafe === "No" && sSafe === "Sí")) {
            student.risk.mismatch = true;
            student.risk.mismatch_detail = "Inconsistencia de Seguridad: El apoderado percibe plena seguridad del estudiante en el liceo, pero el estudiante reporta sentirse inseguro.";
          } else {
            student.risk.mismatch = false;
            student.risk.mismatch_detail = "";
          }
        }
        return { status: "success", message: "Encuesta registrada exitosamente." };
      }
      if (path === "/api/guardian/excuse") {
        return { id: 999, status: "pendiente", message: "Justificación registrada (Mock)." };
      }
      if (path.includes("/activities") && !path.includes("/activities/")) {
        // Asignación de taller
        const studentId = parseInt(path.split("/")[3]);
        const catalog = [
          { id: 1, title: "Taller de Comunicación Asertiva y Empatía", description: "Desarrollo de habilidades de escucha y expresión no violenta.", type: "directa", category: "convivencia", target_risk: "violence", delivery: "presencial" },
          { id: 2, title: "Club de Fútbol Mixto y Liderazgo", description: "Deporte social que fomenta el trabajo en equipo y el autocontrol.", type: "indirecta", category: "deportiva", target_risk: "violence", delivery: "presencial" },
          { id: 3, title: "Taller de Mindfulness y Calma Mental", description: "Técnicas de respiración y autorregulación emocional en el aula.", type: "directa", category: "emocional", target_risk: "home", delivery: "online" },
          { id: 4, title: "Círculos de Apoyo Psicoeducativo", description: "Espacio seguro de conversación y contención para estudiantes con problemáticas complejas.", type: "directa", category: "emocional", target_risk: "home", delivery: "presencial" },
          { id: 5, title: "Club de Tareas y Reforzamiento Pedagógico", description: "Apoyo personalizado para mejorar rendimiento académico y hábitos de estudio.", type: "indirecta", category: "academica", target_risk: "academic", delivery: "presencial" },
          { id: 6, title: "Taller de Creación Digital y Robótica", description: "Fomento de la motivación y asistencia a través de la tecnología aplicada.", type: "indirecta", category: "academica", target_risk: "academic", delivery: "online" },
          { id: 7, title: "Taller de Mediadores Escolares Jóvenes", description: "Formación de estudiantes líderes para resolución pacífica de conflictos entre pares.", type: "directa", category: "convivencia", target_risk: "violence", delivery: "presencial" },
          { id: 8, title: "Yoga y Expresión Corporal Infantil", description: "Canalización del estrés infantil mediante posturas y juego guiado.", type: "indirecta", category: "emocional", target_risk: "general", delivery: "presencial" }
        ];
        const act = catalog.find(a => a.id === body.activity_id);
        if (act) {
          const newAssignment = {
            assignment_id: Date.now(),
            status: "asignada",
            assigned_date: "2026-07-10",
            assigned_by: body.assigned_by || "Orientador",
            activity_id: act.id,
            ...act
          };
          if (!window.MOCK_STUDENT_ACTIVITIES_CACHE[studentId]) {
            window.MOCK_STUDENT_ACTIVITIES_CACHE[studentId] = [];
          }
          window.MOCK_STUDENT_ACTIVITIES_CACHE[studentId].unshift(newAssignment);
          return { id: newAssignment.assignment_id, status: "asignada" };
        }
      }
    } else if (method === "PUT") {
      if (path.includes("/activities/")) {
        const parts = path.split("/");
        const studentId = parseInt(parts[3]);
        const activityId = parseInt(parts[5]);
        const assignments = window.MOCK_STUDENT_ACTIVITIES_CACHE[studentId] || [];
        const item = assignments.find(a => a.activity_id === activityId);
        if (item) {
          item.status = body.status;
          item.feedback = body.feedback || null;
          return { status: "actualizado" };
        }
      }
    } else { // GET
      if (path.includes("/attendance")) {
        // e.g. /api/attendance?course=7%C2%B0%20B%C3%A1sico%20A&date=2026-07-10
        const url = new URL("http://localhost" + path);
        const course = url.searchParams.get("course");
        const dateStr = url.searchParams.get("date");
        const key = `${course}_${dateStr}`;
        if (window.MOCK_ATTENDANCE_CACHE[key]) {
          return window.MOCK_ATTENDANCE_CACHE[key];
        }
        if (dateStr === "2026-07-10") {
          const roster = (MOCK.courses.find(c => c.course === course) || {}).students || [];
          const out = {};
          roster.forEach(s => {
            const seedVal = hash(s.full_name + dateStr) % 12;
            out[s.id] = seedVal === 0 ? "ausente" : (seedVal === 1 ? "atrasado" : "presente");
          });
          return out;
        }
        return {};
      }
      if (path.includes("/activities")) {
        const studentId = parseInt(path.split("/")[3]);
        const s = (MOCK.students || []).find(x => x.id === studentId) || { risk: { score: 20 }, violence_risk_score: 15, home_risk_score: 20, academic_risk_score: 25 };
        
        if (!window.MOCK_STUDENT_ACTIVITIES_CACHE[studentId]) {
          const assignments = [];
          if (studentId === 4) {
            assignments.push({
              assignment_id: 104, status: "asignada", assigned_date: "2026-07-10", assigned_by: "Sistema",
              activity_id: 5, title: "Club de Tareas y Reforzamiento Pedagógico", description: "Apoyo personalizado para mejorar rendimiento académico y hábitos de estudio.", type: "indirecta", category: "academica", target_risk: "academic", delivery: "presencial"
            });
            assignments.push({
              assignment_id: 103, status: "en_progreso", assigned_date: "2026-07-10", assigned_by: "Sistema",
              activity_id: 3, title: "Taller de Mindfulness y Calma Mental", description: "Técnicas de respiración y autorregulación emocional en el aula.", type: "directa", category: "emocional", target_risk: "home", delivery: "online"
            });
          }
          // Para pruebas rápidas del alumno de demostración (Mateo Rojas - ID 1)
          if (studentId === 1) {
            assignments.push({
              assignment_id: 103, status: "en_progreso", assigned_date: "2026-07-10", assigned_by: "Sistema",
              activity_id: 3, title: "Taller de Mindfulness y Calma Mental", description: "Técnicas de respiración y autorregulación emocional en el aula.", type: "directa", category: "emocional", target_risk: "home", delivery: "online"
            });
          }
          const vRisk = s.violence_risk_score || 15;
          const hRisk = s.home_risk_score || 20;
          const aRisk = s.academic_risk_score || 25;
          
          if (vRisk >= 60) {
            assignments.push({
              assignment_id: 101, status: "asignada", assigned_date: "2026-07-10", assigned_by: "Sistema",
              activity_id: 1, title: "Taller de Comunicación Asertiva y Empatía", description: "Desarrollo de habilidades de escucha y expresión no violenta.", type: "directa", category: "convivencia", target_risk: "violence", delivery: "presencial"
            });
            assignments.push({
              assignment_id: 102, status: "en_progreso", assigned_date: "2026-07-10", assigned_by: "Orientador",
              activity_id: 7, title: "Taller de Mediadores Escolares Jóvenes", description: "Formación de estudiantes líderes para resolución pacífica de conflictos entre pares.", type: "directa", category: "convivencia", target_risk: "violence", delivery: "presencial"
            });
          }
          if (hRisk >= 60) {
            assignments.push({
              assignment_id: 103, status: "asignada", assigned_date: "2026-07-10", assigned_by: "Sistema",
              activity_id: 3, title: "Taller de Mindfulness y Calma Mental", description: "Técnicas de respiración y autorregulación emocional en el aula.", type: "directa", category: "emocional", target_risk: "home", delivery: "online"
            });
          }
          if (aRisk >= 60) {
            assignments.push({
              assignment_id: 104, status: "asignada", assigned_date: "2026-07-10", assigned_by: "Sistema",
              activity_id: 5, title: "Club de Tareas y Reforzamiento Pedagógico", description: "Apoyo personalizado para mejorar rendimiento académico y hábitos de estudio.", type: "indirecta", category: "academica", target_risk: "academic", delivery: "presencial"
            });
          }
          assignments.push({
            assignment_id: 105, status: "asignada", assigned_date: "2026-07-10", assigned_by: "Sistema",
            activity_id: 2, title: "Club de Fútbol Mixto y Liderazgo", description: "Deporte social que fomenta el trabajo en equipo y el autocontrol.", type: "indirecta", category: "deportiva", target_risk: "violence", delivery: "presencial"
          });
          
          window.MOCK_STUDENT_ACTIVITIES_CACHE[studentId] = assignments;
        }
        
        const assigned = window.MOCK_STUDENT_ACTIVITIES_CACHE[studentId];
        const assignedIds = new Set(assigned.map(a => a.activity_id));
        
        const catalog = [
          { id: 1, title: "Taller de Comunicación Asertiva y Empatía", description: "Desarrollo de habilidades de escucha y expresión no violenta.", type: "directa", category: "convivencia", target_risk: "violence", delivery: "presencial" },
          { id: 2, title: "Club de Fútbol Mixto y Liderazgo", description: "Deporte social que fomenta el trabajo en equipo y el autocontrol.", type: "indirecta", category: "deportiva", target_risk: "violence", delivery: "presencial" },
          { id: 3, title: "Taller de Mindfulness y Calma Mental", description: "Técnicas de respiración y autorregulación emocional en el aula.", type: "directa", category: "emocional", target_risk: "home", delivery: "online" },
          { id: 4, title: "Círculos de Apoyo Psicoeducativo", description: "Espacio seguro de conversación y contención para estudiantes con problemáticas complejas.", type: "directa", category: "emocional", target_risk: "home", delivery: "presencial" },
          { id: 5, title: "Club de Tareas y Reforzamiento Pedagógico", description: "Apoyo personalizado para mejorar rendimiento académico y hábitos de estudio.", type: "indirecta", category: "academica", target_risk: "academic", delivery: "presencial" },
          { id: 6, title: "Taller de Creación Digital y Robótica", description: "Fomento de la motivación y asistencia a través de la tecnología aplicada.", type: "indirecta", category: "academica", target_risk: "academic", delivery: "online" },
          { id: 7, title: "Taller de Mediadores Escolares Jóvenes", description: "Formación de estudiantes líderes para resolución pacífica de conflictos entre pares.", type: "directa", category: "convivencia", target_risk: "violence", delivery: "presencial" },
          { id: 8, title: "Yoga y Expresión Corporal Infantil", description: "Canalización del estrés infantil mediante posturas y juego guiado.", type: "indirecta", category: "emocional", target_risk: "general", delivery: "presencial" }
        ];
        
        const recommended = [];
        const vRisk = s.violence_risk_score || 15;
        const hRisk = s.home_risk_score || 20;
        const aRisk = s.academic_risk_score || 25;
        
        catalog.forEach(act => {
          if (assignedIds.has(act.id)) return;
          const target = act.target_risk;
          if (target === "violence" && vRisk >= 60) recommended.push(act);
          else if (target === "home" && hRisk >= 60) recommended.push(act);
          else if (target === "academic" && aRisk >= 60) recommended.push(act);
          else if (target === "general" && recommended.length < 3) recommended.push(act);
        });
        
        if (recommended.length === 0) {
          catalog.forEach(act => {
            if (!assignedIds.has(act.id) && recommended.length < 3) recommended.push(act);
          });
        }
        
        return {
          student_id: studentId,
          assigned: assigned,
          recommended: recommended.slice(0, 4)
        };
      }
      if (path.includes("/grades")) {
        const studentId = parseInt(path.split("/")[3]);
        if (!window.MOCK_STUDENT_GRADES_CACHE[studentId]) {
          const s = (MOCK.students || []).find(x => x.id === studentId) || { risk: { attendance_rate: 85 } };
          const att_rate = s.risk ? s.risk.attendance_rate : 85;
          const base = 3.8 + (att_rate / 100) * 2.8;
          
          const subjects = ["Lenguaje y Comunicación", "Matemáticas", "Historia, Geografía y Ciencias Sociales", "Ciencias Naturales"];
          const teachers = ["Prof. A. Silva", "Prof. C. Morales", "Prof. R. Gutiérrez", "Prof. S. Ortega"];
          const out = subjects.map((name, i) => {
            const grades = [
              Math.round((base + (Math.sin(studentId + i) * 0.4)) * 10) / 10,
              Math.round((base + (Math.cos(studentId - i) * 0.3)) * 10) / 10,
              Math.round((base + (Math.sin(studentId * i) * 0.5)) * 10) / 10
            ].map(g => Math.min(7.0, Math.max(1.0, g)));
            
            return {
              subject_name: name,
              teacher_name: teachers[i],
              grades: grades,
              average: Math.round((grades.reduce((a,b)=>a+b, 0) / grades.length) * 10) / 10
            };
          });
          window.MOCK_STUDENT_GRADES_CACHE[studentId] = out;
        }
        
        const out = window.MOCK_STUDENT_GRADES_CACHE[studentId];
        const general_avg = out.length ? Math.round((out.reduce((a,b)=>a+b.average, 0) / out.length) * 10) / 10 : 0.0;
        return { student_id: studentId, grades: out, general_average: general_avg };
      }
      if (path === "/api/establishments/compare") {
        if (!window.MOCK_ESTABLISHMENTS_CACHE) {
          window.MOCK_ESTABLISHMENTS_CACHE = [
            { id: 1, name: "Liceo Gabriela Mistral", comuna: "La Pintana", ive_average: 85, students_count: 340, avg_attendance: 82, high_risk_count: 5, incidents_count: 14, avg_gpa: 5.2, avg_violence_risk: 42, avg_home_risk: 48 },
            { id: 2, name: "Escuela Básica República de Chile", comuna: "Cerro Navia", ive_average: 92, students_count: 280, avg_attendance: 78, high_risk_count: 8, incidents_count: 22, avg_gpa: 4.8, avg_violence_risk: 54, avg_home_risk: 62 },
            { id: 3, name: "Colegio Industrial San José", comuna: "Puente Alto", ive_average: 76, students_count: 420, avg_attendance: 86, high_risk_count: 3, incidents_count: 9, avg_gpa: 5.6, avg_violence_risk: 28, avg_home_risk: 32 }
          ];
        }
        return window.MOCK_ESTABLISHMENTS_CACHE;
      }
    }
    return null;
  }

  // --------------------------------------------------------------- Capa API
  async function apiGet(path, mockValue) {
    if (USE_MOCK) {
      const sim = simulateMockApi(path, "GET");
      return sim !== null ? sim : mockValue;
    }
    try {
      const r = await fetch(API + path);
      if (!r.ok) throw new Error(r.status);
      return await r.json();
    } catch (e) {
      const sim = simulateMockApi(path, "GET");
      return sim !== null ? sim : mockValue;
    }
  }

  async function apiPost(path, body, mockValue) {
    if (USE_MOCK) {
      const sim = simulateMockApi(path, "POST", body);
      return sim !== null ? sim : mockValue;
    }
    try {
      const r = await fetch(API + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(r.status);
      return await r.json();
    } catch (e) {
      const sim = simulateMockApi(path, "POST", body);
      return sim !== null ? sim : mockValue;
    }
  }

  async function apiPut(path, body) {
    if (USE_MOCK) {
      const sim = simulateMockApi(path, "PUT", body);
      return sim !== null ? sim : { status: "actualizado" };
    }
    try {
      const r = await fetch(API + path, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(r.status);
      return await r.json();
    } catch (e) {
      const sim = simulateMockApi(path, "PUT", body);
      return sim !== null ? sim : { status: "actualizado" };
    }
  }

  const getStudentDetail = (id) =>
    apiGet(`/api/students/${id}`, (MOCK.details || {})[id]);
  const getAttendance = (id) =>
    apiGet(`/api/students/${id}/attendance`, (MOCK.attendance || {})[id]);

  // -------------------------------------------------------- Medidor de riesgo
  function gauge(score, level, size = 76, showLabel = false) {
    const stroke = size < 90 ? 8 : 12;
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    const frac = Math.max(0, Math.min(1, score / 100));
    const offset = c * (1 - frac);
    const id = `g${++gaugeSeq}`;
    const colorVar = RISK_VAR[level] || "--risk-bajo";
    const scoreFont = size < 90 ? 22 : 40;

    return `
      <div class="gauge" style="width:${size}px;height:${size}px">
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
          <defs>
            <linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stop-color="var(${colorVar})" stop-opacity="0.55"/>
              <stop offset="1" stop-color="var(${colorVar})"/>
            </linearGradient>
          </defs>
          <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none"
            stroke="var(--surface-2)" stroke-width="${stroke}"/>
          <circle class="gauge-arc" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none"
            stroke="url(#${id})" stroke-width="${stroke}" stroke-linecap="round"
            stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${c.toFixed(1)}"
            transform="rotate(-90 ${size / 2} ${size / 2})"
            data-offset="${offset.toFixed(1)}"/>
        </svg>
        <div class="gauge__center">
          <div class="gauge__score" style="font-size:${scoreFont}px;color:var(${colorVar})">
            ${score}<span class="gauge__unit">/100</span>
          </div>
          ${showLabel ? `<div class="gauge__label" style="color:var(${colorVar})">${level}</div>` : ""}
        </div>
      </div>`;
  }

  function factorBars(factors = []) {
    return `<div class="factors">
      ${factors.map((f) => `
        <div class="factor-row">
          <div class="factor-row__head">
            <span class="factor-row__name">${escapeHTML(f.name)}</span>
            <span class="factor-row__val">${f.contribution}%</span>
          </div>
          <div class="bar" style="background:var(${FACTOR_VAR[f.name] || "--ink-mute"})">
            <div class="bar__fill" style="width:0" data-w="${f.contribution}%"></div>
          </div>
        </div>`).join("")}
    </div>`;
  }

  function attendanceRing(rate) {
    const size = 112;
    const stroke = 12;
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    const frac = Math.max(0, Math.min(1, rate / 100));
    const offset = c * (1 - frac);
    const id = `g${++gaugeSeq}`;
    const colorVar = rate < 85 ? "--risk-alto" : (rate < 90 ? "--risk-medio" : "--risk-bajo");

    return `
      <div class="gauge" style="width:${size}px;height:${size}px">
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
          <defs>
            <linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stop-color="var(${colorVar})" stop-opacity="0.55"/>
              <stop offset="1" stop-color="var(${colorVar})"/>
            </linearGradient>
          </defs>
          <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none"
            stroke="var(--surface-2)" stroke-width="${stroke}"/>
          <circle class="gauge-arc" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none"
            stroke="url(#${id})" stroke-width="${stroke}" stroke-linecap="round"
            stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${c.toFixed(1)}"
            transform="rotate(-90 ${size / 2} ${size / 2})"
            data-offset="${offset.toFixed(1)}"/>
        </svg>
        <div class="gauge__center">
          <div class="gauge__score" style="font-size:26px;color:var(${colorVar})">
            ${rate}<span class="gauge__unit">%</span>
          </div>
          <div class="gauge__label" style="color:var(${colorVar})">Asistencia</div>
        </div>
      </div>`;
  }

  function animateGauges(root = document) {
    requestAnimationFrame(() => {
      $$(".gauge-arc", root).forEach((arc) => {
        if (arc.dataset.done) return;
        arc.dataset.done = "1";
        arc.style.strokeDashoffset = arc.dataset.offset;
      });
    });
  }

  function animateBars(root) {
    $$(".bar__fill", root).forEach((fill) => {
      setTimeout(() => {
        fill.style.width = fill.dataset.w;
      }, 50);
    });
  }

  const chip = (level, label) =>
    `<span class="chip chip--${level}"><span class="chip__dot"></span>${escapeHTML(label)}</span>`;

  // =========================================================================
  // RENDER · Vista Orientación
  // =========================================================================
  function renderHero() {
    const s = state.summary;
    $("#hero-date").innerHTML =
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>${longDate(s.date)}`;

    const kpis = [
      { label: "Alertas activas", value: s.active_alerts, note: `+${s.alerts_today} hoy`, up: true },
      { label: "Riesgo alto", value: s.high_risk, note: "requieren seguimiento" },
      { label: "Casos con protocolo", value: s.open_cases, note: "en acompañamiento" },
      { label: "Asistencia promedio", value: s.avg_attendance + "%", note: "curso completo" },
    ];
    $("#hero-kpis").innerHTML = kpis.map((k) => `
      <div class="kpi">
        <div class="kpi__label">${k.label}</div>
        <div class="kpi__value">${k.value}${k.up ? ` <span class="up">▲</span>` : ""}</div>
        <div class="kpi__note">${k.note}</div>
      </div>`).join("");
  }

  function renderAlerts() {
    let list = state.students;

    // Filtrar por establecimiento activo
    if (state.activeEstablishmentId) {
      list = list.filter(s => s.establishment_id === state.activeEstablishmentId);
    }

    // Si somos profesor, filtrar por su curso
    if (state.user && state.user.role === "profesor") {
      list = list.filter(s => s.course === "7° Básico A");
    }

    // Filtrar por riesgo si no queremos ver todos
    if (!state.showAllAlerts) {
      list = list.filter((s) => s.risk.level !== "bajo");
    }

    const grid = $("#alert-grid");
    if (!list.length) {
      grid.innerHTML = `<div class="empty">Sin alertas activas para este establecimiento/curso.</div>`;
      return;
    }
    grid.innerHTML = list.map((s) => {
      const vRisk = s.violence_risk_score || 15;
      const hRisk = s.home_risk_score || 20;
      const aRisk = s.academic_risk_score || 25;
      
      return `
        <article class="card alert-card" data-search="${escapeHTML((s.full_name + " " + s.course).toLowerCase())}">
          <div class="alert-card__top">
            ${avatar(s.avatar_seed, s.full_name)}
            <div class="alert-card__id">
              <div class="alert-card__name">${escapeHTML(s.full_name)}</div>
              <div class="alert-card__meta">${escapeHTML(s.course)} · IVE ${s.ive_index} · ${escapeHTML(s.comuna)}</div>
              <div class="student-card-badges">
                <span class="student-card-badge ${aRisk >= 60 ? "high-risk" : ""}">🎓 Acad: ${aRisk}%</span>
                <span class="student-card-badge ${vRisk >= 60 ? "high-risk" : ""}">🤝 Viol: ${vRisk}%</span>
                <span class="student-card-badge ${hRisk >= 60 ? "high-risk" : ""}">🏠 Hogar: ${hRisk}%</span>
              </div>
            </div>
            ${chip(s.risk.level, s.risk.label)}
          </div>
          ${s.risk.mismatch ? `
            <div class="alert-mismatch-banner" style="background: var(--risk-alto-wash); color: var(--risk-alto); border: 1px solid var(--risk-alto); padding: 8px 12px; border-radius: var(--r-sm); margin: 0 16px 12px; font-size: 11.5px; display: flex; align-items: start; gap: 6px; font-weight:600; line-height: 1.35;">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px; flex-shrink: 0; margin-top: 1px;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/></svg>
              <div>
                ${escapeHTML(s.risk.mismatch_detail)}
              </div>
            </div>
          ` : ""}
          <div class="alert-card__body">
            <div class="alert-card__gauge">${gauge(s.risk.score, s.risk.level, 76)}</div>
            <div class="alert-card__info">
              <div class="alert-card__headline">${escapeHTML(s.risk.headline)}</div>
              ${factorBars(s.risk.top_factors)}
            </div>
          </div>
          <div class="alert-card__foot">
            <button class="btn btn--ghost" data-open="${s.id}" type="button">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>
              Abrir ficha
            </button>
          </div>
        </article>`;
    }).join("");

    animateGauges(grid);
    animateBars(grid);
    grid.querySelectorAll("[data-open]").forEach((b) =>
      b.addEventListener("click", () => openDrawer(+b.dataset.open)));
  }

  function renderIncidents() {
    let list = state.incidents;

    // Filtrar por establecimiento activo
    if (state.activeEstablishmentId) {
      list = list.filter(i => {
        const student = state.students.find(s => s.id === i.student_id);
        return student && student.establishment_id === state.activeEstablishmentId;
      });
    }

    // Si somos profesor, filtrar por curso
    if (state.user && state.user.role === "profesor") {
      list = list.filter(i => {
        const student = state.students.find(s => s.id === i.student_id);
        return student && student.course === "7° Básico A";
      });
    }

    const tbody = $("#incident-tbody");
    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="muted" style="text-align:center">No hay registros de convivencia recientes.</td></tr>`;
      return;
    }

    tbody.innerHTML = list.slice(0, 8).map((i) => `
      <tr data-search="${escapeHTML((i.student_name + " " + i.category + " " + i.course).toLowerCase())}">
        <td class="td-when">${shortDate(i.date)}</td>
        <td class="td-cat">${escapeHTML(i.category)}</td>
        <td>
          <div class="td-student">${avatar(i.avatar_seed, i.student_name, "avatar--sm")}
            <div><div>${escapeHTML(i.student_name)}</div>
            <div style="font-size:11.5px;color:var(--ink-mute)">${escapeHTML(i.course)}</div></div>
          </div>
        </td>
        <td class="td-reporter">${escapeHTML(i.reported_by)}</td>
        <td>${chip(sevLevel(i.severity), capitalize(i.severity))}</td>
        <td><button class="row-arrow" data-open="${i.student_id}" type="button" aria-label="Abrir ficha">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
        </button></td>
      </tr>`).join("");
    tbody.querySelectorAll("[data-open]").forEach((b) =>
      b.addEventListener("click", () => openDrawer(+b.dataset.open)));
  }

  const sevLevel = (sev) => ({ alta: "alto", moderada: "medio", baja: "bajo" }[sev] || "bajo");
  const capitalize = (s = "") => s.charAt(0).toUpperCase() + s.slice(1);

  // =========================================================================
  // Panel de ficha (drawer)
  // =========================================================================
  async function openDrawer(id) {
    const [detail, att] = await Promise.all([getStudentDetail(id), getAttendance(id)]);
    if (!detail) return;
    const r = detail.risk;
    const g = detail.guardian || {};
    const sum = (att && att.summary) || {};

    $("#drawer-head").innerHTML = `
      ${avatar(detail.avatar_seed, detail.full_name, "avatar--lg")}
      <div class="drawer__id">
        <div class="drawer__name">${escapeHTML(detail.full_name)}</div>
        <div class="drawer__meta">${escapeHTML(detail.course)} · IVE ${detail.ive_index} · ${escapeHTML(detail.comuna)}</div>
        <div style="margin-top:8px">${chip(r.level, r.label)}</div>
      </div>
      <button class="drawer__close" id="drawer-close" type="button" aria-label="Cerrar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>`;

    const vRisk = detail.violence_risk_score || 15;
    const hRisk = detail.home_risk_score || 20;
    const aRisk = detail.academic_risk_score || 25;

    const mismatchBanner = r.mismatch ? `
      <div class="alert-mismatch-banner" style="background: var(--risk-alto-wash); color: var(--risk-alto); border: 1px solid var(--risk-alto); padding: 12px; border-radius: var(--r-sm); margin-bottom: 20px; font-size: 12.5px; display: flex; align-items: start; gap: 8px; font-weight:600; line-height: 1.4;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 18px; height: 18px; flex-shrink: 0; margin-top: 1px;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/></svg>
        <div>
          ${escapeHTML(r.mismatch_detail)}
          <div style="font-weight: normal; margin-top: 4px; font-size: 11.5px; color: var(--ink-soft);">
            Se sugiere agendar entrevista presencial de aclaración de convivencia escolar.
          </div>
        </div>
      </div>
    ` : "";

    $("#drawer-body").innerHTML = `
      ${mismatchBanner}
      <div class="drawer-gauge">
        ${gauge(r.score, r.level, 132, true)}
        <div class="drawer-gauge__txt">
          <div class="drawer-gauge__lead">${escapeHTML(r.headline)}</div>
          <div style="font-size:12px;color:var(--ink-mute);margin-top:8px">Ventana de análisis: últimos ${r.window_days} días</div>
        </div>
      </div>

      <div>
        <div class="mini-title">Factores del riesgo (explicabilidad)</div>
        ${factorBars(r.factors)}
      </div>

      <div class="mini-title" style="margin-top:20px">Alertas de Riesgo Multidimensional</div>
      <div class="drawer-risks">
        <div class="drawer-risk-card">
          <span class="drawer-risk-card__title">Académico</span>
          <span class="drawer-risk-card__val">${aRisk}%</span>
          <span class="drawer-risk-card__label ${aRisk >= 60 ? "risk-level-alto" : (aRisk >= 35 ? "risk-level-medio" : "risk-level-bajo")}">
            ${aRisk >= 60 ? "Crítico" : (aRisk >= 35 ? "Medio" : "Bajo")}
          </span>
        </div>
        <div class="drawer-risk-card">
          <span class="drawer-risk-card__title">Violencia</span>
          <span class="drawer-risk-card__val">${vRisk}%</span>
          <span class="drawer-risk-card__label ${vRisk >= 60 ? "risk-level-alto" : (vRisk >= 35 ? "risk-level-medio" : "risk-level-bajo")}">
            ${vRisk >= 60 ? "Crítico" : (vRisk >= 35 ? "Medio" : "Bajo")}
          </span>
        </div>
        <div class="drawer-risk-card">
          <span class="drawer-risk-card__title">Familiar</span>
          <span class="drawer-risk-card__val">${hRisk}%</span>
          <span class="drawer-risk-card__label ${hRisk >= 60 ? "risk-level-alto" : (hRisk >= 35 ? "risk-level-medio" : "risk-level-bajo")}">
            ${hRisk >= 60 ? "Crítico" : (hRisk >= 35 ? "Medio" : "Bajo")}
          </span>
        </div>
      </div>

      <div class="mini-title" style="margin-top:20px">Plan de Prevención y Convivencia</div>
      <div id="drawer-activities-panel" style="margin-bottom:20px;"></div>

      <div>
        <div class="mini-title">Asistencia · último mes</div>
        <div class="att-bars">
          <div class="att-bar att-bar--p"><div class="att-bar__n">${sum.present ?? 0}</div><div class="att-bar__l">Presente</div></div>
          <div class="att-bar att-bar--t"><div class="att-bar__n">${sum.late ?? 0}</div><div class="att-bar__l">Atrasos</div></div>
          <div class="att-bar att-bar--a"><div class="att-bar__n">${sum.absent ?? 0}</div><div class="att-bar__l">Ausencias</div></div>
        </div>
      </div>

      <div>
        <div class="mini-title">Apoderado</div>
        <div class="guardian-box">
          <div class="guardian-row"><span>Nombre</span><span>${escapeHTML(g.full_name || "—")} · ${escapeHTML(g.relationship || "")}</span></div>
          <div class="guardian-row"><span>Teléfono</span><span class="${g.contact_ok ? "" : "guardian-warn"}">${escapeHTML(g.phone || "—")}${g.contact_ok ? "" : " ⚠"}</span></div>
          <div class="guardian-row"><span>Correo</span><span>${escapeHTML(g.email || "—")}</span></div>
          <div class="guardian-row"><span>Reuniones omitidas</span><span>${r.missed_meetings} de ${r.meetings_total}</span></div>
        </div>
        ${g.contact_ok ? "" : `<div style="font-size:11.5px;color:var(--risk-alto);margin-top:8px">⚠ Datos de contacto sin verificar — actualizar en próxima entrevista.</div>`}
      </div>

      <div>
        <div class="mini-title">Bitácora de incidentes</div>
        <div class="incident-log">
          ${(detail.incidents || []).length ? detail.incidents.map((i) => `
            <div class="incident-item" data-sev="${i.severity}">
              <div class="incident-item__top">
                <span class="incident-item__cat">${escapeHTML(i.category)}</span>
                <span class="incident-item__date">${shortDate(i.log_date)}</span>
              </div>
              <div class="incident-item__desc">${escapeHTML(i.description)}</div>
            </div>`).join("") : `<div class="section-sub">Sin incidentes registrados.</div>`}
        </div>
      </div>
      
      <div style="margin-top: 16px;">
        <div class="mini-title">Alertas e Inconsistencias Manuales</div>
        <div style="padding: 12px; background: var(--bg); border: 1px solid var(--line); border-radius: var(--r-sm);">
          <label class="field__label" for="drawer-manual-mismatch" style="font-size:11.5px; font-weight:600; color:var(--ink-soft); display:block; margin-bottom:6px;">Reportar Inconsistencia Manual (No detectada automáticamente)</label>
          <textarea id="drawer-manual-mismatch" class="textarea" placeholder="Ej: En entrevista, el estudiante revela acoso escolar que omite en encuestas..." style="width: 100%; min-height: 55px; font-size:12px; padding: 6px; margin-bottom: 8px;">${escapeHTML(detail.manual_mismatch || "")}</textarea>
          <button type="button" class="btn btn--accent btn--sm" id="save-manual-mismatch-btn" data-student-id="${detail.id}" style="padding: 4px 12px; font-size: 11.5px; width: auto;">Guardar Inconsistencia</button>
        </div>
      </div>`;

    $("#drawer").classList.add("is-open");
    $("#drawer").setAttribute("aria-hidden", "false");
    $("#drawer-scrim").classList.add("is-open");
    $("#drawer-close").addEventListener("click", closeDrawer);
    animateGauges($("#drawer"));
    animateBars($("#drawer"));

    // Guardar Inconsistencia Manual
    const saveManualMismatchBtn = $("#save-manual-mismatch-btn");
    if (saveManualMismatchBtn) {
      saveManualMismatchBtn.addEventListener("click", async () => {
        const studentId = saveManualMismatchBtn.dataset.studentId;
        const mismatchText = $("#drawer-manual-mismatch").value.trim();
        const ok = await apiPut(`/api/students/${studentId}/manual-mismatch`, { manual_mismatch: mismatchText || null });
        if (ok) {
          toast("Inconsistencia manual actualizada exitosamente.");
          // Recargar datos y alertas
          state.students = await apiGet("/api/students", state.students);
          renderAlerts();
        } else {
          toast("Error al guardar la inconsistencia manual.");
        }
      });
    }

    // Guardar Notas Apoderado
    const saveGNotesBtn = $("#save-guardian-notes-btn");
    if (saveGNotesBtn) {
      saveGNotesBtn.addEventListener("click", async () => {
        const guardianId = saveGNotesBtn.dataset.guardianId;
        const notesText = $("#drawer-guardian-notes").value;
        if (!guardianId) {
          toast("No hay un apoderado asociado para ingresar notas.");
          return;
        }
        const ok = await apiPut(`/api/guardian/${guardianId}/teacher_notes`, { teacher_notes: notesText });
        if (ok) {
          toast("Notas del apoderado guardadas exitosamente.");
        } else {
          toast("Error al guardar notas del apoderado.");
        }
      });
    }

    // Render actividades preventivas dinámicas en el panel
    renderDrawerActivities(id);
  }

  async function renderDrawerActivities(studentId) {
    const actBox = $("#drawer-activities-panel");
    if (!actBox) return;
    
    actBox.innerHTML = `<div class="muted" style="font-size:11.5px">Cargando talleres y recomendaciones...</div>`;
    const data = await apiGet(`/api/students/${studentId}/activities`, null);
    if (!data) return;
    
    const assigned = data.assigned || [];
    const recommended = data.recommended || [];
    
    let html = `
      <div style="margin-top:8px">
        <span style="font-size:11.5px; font-weight:600; color:var(--ink-soft); display:block; margin-bottom:6px;">Talleres Asignados</span>
        <div style="display:flex; flex-direction:column; gap:6px;">
          ${assigned.length === 0 ? `<div style="font-size:11.5px; color:var(--ink-mute);">Ninguno asignado aún.</div>` : assigned.map(a => {
            const badgeStatus = `status-${a.status}`;
            const statusLabel = a.status === "asignada" ? "Asignada" : (a.status === "en_progreso" ? "En Progreso" : "Completada");
            return `
              <div style="padding:8px; background:var(--bg); border:var(--card-border); border-radius:var(--r-sm); display:flex; flex-direction:column; gap:2px;">
                <div style="display:flex; align-items:center; justify-content:between; gap:6px;">
                  <span style="font-size:12px; font-weight:600; color:var(--ink);">${escapeHTML(a.title)}</span>
                  <span class="activity-badge ${badgeStatus}" style="font-size:9.5px; margin-left:auto; padding:1px 6px;">${statusLabel}</span>
                </div>
                <div style="font-size:10.5px; color:var(--ink-soft);">${escapeHTML(a.description)}</div>
                ${a.feedback ? `<div style="font-size:10px; background:var(--surface-3); padding:4px 8px; border-radius:4px; margin-top:4px; font-style:italic;">"${escapeHTML(a.feedback)}"</div>` : ""}
              </div>
            `;
          }).join("")}
        </div>
      </div>
      
      <div style="margin-top:12px">
        <span style="font-size:11.5px; font-weight:600; color:var(--ink-soft); display:block; margin-bottom:6px;">Sugerencias Preventivas Automatizadas</span>
        <div style="display:flex; flex-direction:column; gap:6px;">
          ${recommended.length === 0 ? `<div style="font-size:11.5px; color:var(--ink-mute);">No hay recomendaciones adicionales.</div>` : recommended.map(a => {
            const badgeType = a.type === "directa" ? "directa" : "indirecta";
            const typeLabel = a.type === "directa" ? "Directa" : "Indirecta";
            return `
              <div style="padding:8px; background:var(--surface-2); border:1px solid var(--line-strong); border-radius:var(--r-sm); display:flex; flex-direction:column; gap:2px;">
                <div style="display:flex; align-items:center; justify-content:between; gap:6px;">
                  <span style="font-size:12px; font-weight:600; color:var(--ink);">${escapeHTML(a.title)}</span>
                  <span class="activity-badge ${badgeType}" style="font-size:9.5px; margin-left:auto; padding:1px 6px;">${typeLabel}</span>
                </div>
                <div style="font-size:10.5px; color:var(--ink-soft);">${escapeHTML(a.description)}</div>
                <button class="activity-assign-btn" data-assign-student="${studentId}" data-activity="${a.id}" type="button" style="margin-top:4px; padding:4px 8px; font-size:11px;">Asignar Taller</button>
              </div>
            `;
          }).join("")}
        </div>
      </div>
    `;
    
    actBox.innerHTML = html;
    
    // Wire Assign Clicks
    actBox.querySelectorAll("[data-activity]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const actId = +btn.dataset.activity;
        const res = await apiPost(`/api/students/${studentId}/activities`, {
          activity_id: actId,
          assigned_by: (state.user && state.user.full_name) || "Orientador"
        }, { id: Date.now(), status: "asignada" });
        if (res) {
          toast("Taller preventivo asignado correctamente.");
          renderDrawerActivities(studentId);
        }
      });
    });
  }

  function closeDrawer() {
    $("#drawer").classList.remove("is-open");
    $("#drawer").setAttribute("aria-hidden", "true");
    $("#drawer-scrim").classList.remove("is-open");
  }

  // =========================================================================
  // RENDER · Vista Docencia
  // =========================================================================
  function getCoursesForEstablishment(estId) {
    if (state.user && state.user.role === "profesor") {
      return state.courses.filter(c => c.course === "7° Básico A");
    }
    const estStudents = state.students.filter(s => s.establishment_id === estId);
    const courseNames = [...new Set(estStudents.map(s => s.course))];
    return state.courses.filter(c => courseNames.includes(c.course));
  }

  function renderCourseTabs() {
    const tabs = $("#course-tabs");
    const activeCourses = getCoursesForEstablishment(state.activeEstablishmentId);
    
    if (activeCourses.length === 0) {
      tabs.innerHTML = `<div class="muted">No hay cursos disponibles para este establecimiento.</div>`;
      $("#roster").innerHTML = "";
      $("#roster-course-label").textContent = "—";
      return;
    }
    
    if (!activeCourses.some(c => c.course === state.currentCourse)) {
      state.currentCourse = activeCourses[0].course;
      state.attendanceDraft = {};
    }

    tabs.innerHTML = activeCourses.map((c) => `
      <button class="course-tab ${c.course === state.currentCourse ? "is-active" : ""}"
              data-course="${escapeHTML(c.course)}" type="button">${escapeHTML(c.course)}</button>`).join("");
    tabs.querySelectorAll("[data-course]").forEach((b) =>
      b.addEventListener("click", async () => {
        state.currentCourse = b.dataset.course;
        state.attendanceDraft = {};
        
        // Recargar asistencia para la fecha seleccionada
        const dateInput = $("#attendance-date");
        const dateStr = dateInput ? dateInput.value : "2026-07-10";
        const res = await apiGet(`/api/attendance?course=${state.currentCourse}&date=${dateStr}`, null);
        if (res && Object.keys(res).length > 0) {
          state.attendanceDraft = res;
        }
        
        renderRoster();
        renderCourseTabs();
      }));
  }

  function currentRoster() {
    return state.students.filter(s => s.course === state.currentCourse && s.establishment_id === state.activeEstablishmentId);
  }

  function renderRoster() {
    const roster = currentRoster();
    $("#roster-course-label").textContent = `${state.currentCourse || "—"} · ${roster.length} estudiantes`;

    // Por defecto todos "presente" (registro rápido: marcar solo excepciones).
    roster.forEach((s) => {
      if (!state.attendanceDraft[s.id]) state.attendanceDraft[s.id] = "presente";
    });

    $("#roster").innerHTML = roster.map((s) => {
      const cur = state.attendanceDraft[s.id];
      const seg = (val, txt) =>
        `<button class="seg__btn ${cur === val ? "is-on" : ""}" data-status="${val}" data-id="${s.id}" type="button">${txt}</button>`;
      return `<div class="roster__row">
        ${avatar(s.avatar_seed, s.full_name, "avatar--sm")}
        <div class="roster__name">${escapeHTML(s.full_name)}</div>
        <div class="seg">${seg("presente", "Presente")}${seg("atrasado", "Atrasado")}${seg("ausente", "Ausente")}</div>
      </div>`;
    }).join("");

    $$("#roster .seg__btn").forEach((b) =>
      b.addEventListener("click", () => {
        state.attendanceDraft[+b.dataset.id] = b.dataset.status;
        renderRoster();
      }));
    updateRosterSummary();
    populateIncidentStudents();
    populateGradesStudentSelect();
  }

  function updateRosterSummary() {
    const roster = currentRoster();
    const relevant = roster.map((s) => state.attendanceDraft[s.id]);
    const count = (v) => relevant.filter((x) => x === v).length;
    $("#roster-summary").innerHTML =
      `<b>${count("presente")}</b> presentes · <b>${count("atrasado")}</b> atrasos · <b>${count("ausente")}</b> ausentes`;
  }

  async function saveAttendance() {
    const roster = currentRoster();
    const dateInput = $("#attendance-date");
    const dateStr = dateInput ? dateInput.value : "2026-07-10";

    const records = roster.map((s) => ({
      student_id: s.id, status: state.attendanceDraft[s.id],
      log_date: dateStr, recorded_by: (state.user && state.user.full_name) || "Docente",
    }));
    await apiPost("/api/attendance", { records }, { saved: records.length });

    // Guardar en la caché de simulación offline
    const key = `${state.currentCourse}_${dateStr}`;
    if (!window.MOCK_ATTENDANCE_CACHE) window.MOCK_ATTENDANCE_CACHE = {};
    window.MOCK_ATTENDANCE_CACHE[key] = {};
    records.forEach(r => {
      window.MOCK_ATTENDANCE_CACHE[key][r.student_id] = r.status;
    });

    toast(`Asistencia de ${state.currentCourse} guardada para el ${shortDate(dateStr)} (${records.length} registros)`);
  }

  function populateIncidentStudents() {
    const roster = currentRoster();
    const sel = $("#inc-student");
    sel.innerHTML = roster.map((s) =>
      `<option value="${s.id}">${escapeHTML(s.full_name)}</option>`).join("");
  }

  async function saveIncident() {
    const sid = +$("#inc-student").value;
    const roster = currentRoster();
    const student = roster.find((s) => s.id === sid);
    const category = $("#inc-category").value;
    const severity = state.incidentSeverity;
    const description = $("#inc-desc").value.trim() || "Sin descripción adicional.";
    const protocol = $("#inc-protocol").checked;

    await apiPost("/api/incidents", {
      student_id: sid, category, severity, description,
      reported_by: "Docente", protocol_activated: protocol,
    }, { id: Date.now() });

    state.sessionIncidents.unshift({
      student_name: student ? student.full_name : "Estudiante",
      category, severity, description,
    });
    renderSessionIncidents();
    $("#inc-desc").value = "";
    $("#inc-protocol").checked = false;
    toast("Incidente registrado en la bitácora");
  }

  function renderSessionIncidents() {
    const box = $("#recent-incidents");
    if (!state.sessionIncidents.length) {
      box.innerHTML = `<div class="section-sub">Aún no registras incidentes en esta sesión.</div>`;
      return;
    }
    const dotColor = (sev) =>
      `var(${{ alta: "--risk-alto", moderada: "--accent", baja: "--risk-bajo" }[sev]})`;
    box.innerHTML = state.sessionIncidents.map((i) => `
      <div class="recent-item">
        <span class="recent-item__dot" style="background:${dotColor(i.severity)}"></span>
        <div class="recent-item__body">
          <div class="recent-item__title">${escapeHTML(i.category)} · ${escapeHTML(i.student_name)}</div>
          <div class="recent-item__meta">${escapeHTML(i.description)}</div>
        </div>
      </div>`).join("");
  }

  // =========================================================================
  // RENDER · Vista Familia
  // =========================================================================
  function pickFamilyChildren() {
    if (state.guardianInfo && state.guardianInfo.students && state.guardianInfo.students.length > 0) {
      state.familyChildIds = [...new Set(state.guardianInfo.students.map((s) => s.id))];
    } else {
      const withRate = state.students.map((s) => s).sort(
        (a, b) => b.risk.attendance_rate - a.risk.attendance_rate);
      const picks = [withRate[0], withRate[Math.floor(withRate.length / 2)], withRate[withRate.length - 1]]
        .filter(Boolean);
      state.familyChildIds = [...new Set(picks.map((s) => s.id))];
    }
    state.currentChild = state.familyChildIds[0];
  }

  function renderChildPills() {
    const wrap = $("#child-select");
    if (!wrap) return;
    wrap.innerHTML = state.familyChildIds.map((id) => {
      const s = state.students.find((x) => x.id === id);
      if (!s) return "";
      return `<button class="child-pill ${id === state.currentChild ? "is-active" : ""}" data-child="${id}" type="button">
        ${avatar(s.avatar_seed, s.full_name, "avatar--sm")} ${escapeHTML(s.first_name)}
      </button>`;
    }).join("");
    wrap.querySelectorAll("[data-child]").forEach((b) =>
      b.addEventListener("click", () => {
        state.currentChild = +b.dataset.child;
        renderFamily();
        const activeTab = $(".family-tab-btn.is-active");
        if (activeTab) {
          const tab = activeTab.dataset.familyTab;
          if (tab === "rendimiento") {
            renderFamilyGrades();
          } else if (tab === "perfil") {
            renderFamilyProfile();
          }
        }
      }));
  }

  async function renderFamily() {
    renderChildPills();
    const s = state.students.find((x) => x.id === state.currentChild);
    if (!s) return;
    $("#family-name").textContent = s.full_name;
    $("#family-course").textContent = `${s.course} · ${s.comuna}`;

    const att = await getAttendance(s.id);
    const sum = (att && att.summary) || { rate: 0 };
    $("#family-ring").innerHTML = attendanceRing(sum.rate);
    animateGauges($("#family-ring"));

    const series = (att && att.series) || [];
    const colOf = (iso) => ((parseDate(iso).getDay() + 6) % 7);
    const cal = $("#family-cal");
    cal.style.gridTemplateColumns = "repeat(5, 1fr)";
    let cells = ["L", "M", "M", "J", "V"].map((d) =>
      `<div style="font-size:10.5px;color:var(--ink-mute);text-align:center;font-weight:600">${d}</div>`);
    if (series.length) {
      const first = Math.min(colOf(series[0].date), 4);
      for (let i = 0; i < first; i++) cells.push(`<div class="cal-cell cal-cell--empty"></div>`);
      series.forEach((day) => {
        const dnum = parseDate(day.date).getDate();
        cells.push(`<div class="cal-cell cal-cell--${day.status}" title="${escapeHTML(longDate(day.date))} · ${day.status}">${dnum}</div>`);
      });
    }
    cal.innerHTML = cells.join("");
  }

  async function renderFamilyGrades() {
    if (!state.currentChild) return;
    const container = $("#family-grades-container");
    container.innerHTML = `<div class="muted">Cargando calificaciones...</div>`;
    
    const res = await apiGet(`/api/students/${state.currentChild}/grades`, null);
    if (!res || !res.grades || res.grades.length === 0) {
      container.innerHTML = `<div class="muted">No hay calificaciones registradas.</div>`;
      $("#family-gpa").textContent = "0.0";
    } else {
      $("#family-gpa").textContent = res.general_average.toFixed(1);
      container.innerHTML = res.grades.map(g => {
        const isGood = g.average >= 4.0;
        const avgCls = isGood ? "grade-buena" : "grade-alerta";
        return `
          <div class="grade-row">
            <div class="grade-row__info">
              <div class="grade-row__subject">${escapeHTML(g.subject_name)}</div>
              <div class="grade-row__teacher">${escapeHTML(g.teacher_name)}</div>
              <div class="grade-row__grades-pills">
                ${g.grades.map(n => `<span class="grade-pill">${n.toFixed(1)}</span>`).join("")}
              </div>
            </div>
            <div class="grade-row__avg">
              <span class="grade-val ${avgCls}">${g.average.toFixed(1)}</span>
            </div>
          </div>
        `;
      }).join("");
    }
  }

  async function renderFamilyProfile() {
    const guardianId = state.guardianInfo ? state.guardianInfo.id : (state.user ? state.user.related_id : null);
    if (!guardianId) {
      toast("No se encontró información del apoderado.");
      return;
    }
    
    const g = await apiGet(`/api/guardian/${guardianId}`, null);
    if (!g) return;
    
    state.guardianInfo = g;
    
    // Rellenar formulario de perfil familiar
    if ($("#profile-phone")) $("#profile-phone").value = g.phone || "";
    if ($("#profile-email")) $("#profile-email").value = g.email || "";
    if ($("#profile-employment")) $("#profile-employment").value = g.employment_status || "";
    if ($("#profile-education")) $("#profile-education").value = g.education_level || "";
    if ($("#profile-availability")) $("#profile-availability").value = g.availability_hours || "";
    if ($("#profile-internet")) $("#profile-internet").value = g.internet_access || "";
    if ($("#profile-computer")) $("#profile-computer").value = g.has_computer || "";
    if ($("#profile-comments")) $("#profile-comments").value = g.parent_comments || "";
    
    // Notas del docente
    const notesDisplay = $("#guardian-teacher-notes-display");
    if (notesDisplay) {
      notesDisplay.textContent = g.teacher_notes || "Sin observaciones de vinculación registradas actualmente por los docentes.";
      if (g.teacher_notes) {
        notesDisplay.style.fontStyle = "normal";
        notesDisplay.style.color = "var(--ink)";
      } else {
        notesDisplay.style.fontStyle = "italic";
        notesDisplay.style.color = "var(--ink-soft)";
      }
    }
    
    // Renderizar estudiantes asignados
    const listContainer = $("#assigned-children-list");
    if (listContainer) {
      if (!g.students || g.students.length === 0) {
        listContainer.innerHTML = `<div class="muted" style="font-size:12.5px;">No tienes estudiantes vinculados a tu cargo.</div>`;
      } else {
        listContainer.innerHTML = g.students.map(s => `
          <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 12px; background:var(--surface-2); border:1px solid var(--line); border-radius:var(--r-sm); margin-bottom: 6px;">
            <div style="display:flex; align-items:center; gap:8px;">
              ${avatar(s.avatar_seed, s.full_name, "avatar--sm")}
              <div>
                <div style="font-size:13px; font-weight:600; color:var(--ink);">${escapeHTML(s.full_name)}</div>
                <div style="font-size:11px; color:var(--ink-mute);">${escapeHTML(s.course)} · RUN: ${escapeHTML(s.run)}</div>
              </div>
            </div>
            <button class="btn btn--sm btn--block remove-child-btn" data-student-id="${s.id}" type="button" style="width: auto; padding:4px 10px; font-size:11.5px; background:var(--risk-alto-wash); color:var(--risk-alto); border:1px solid var(--risk-alto);">Desvincular</button>
          </div>
        `).join("");
        
        listContainer.querySelectorAll(".remove-child-btn").forEach(btn => {
          btn.addEventListener("click", async () => {
            const studentId = parseInt(btn.dataset.studentId);
            if (confirm("¿Seguro que deseas desvincular a este estudiante de tu perfil de apoderado?")) {
              const res = await apiDelete(`/api/guardian/${guardianId}/students/${studentId}`);
              if (res && res.status === "success") {
                toast("Estudiante desvinculado con éxito.");
                await renderFamilyProfile();
                
                // Actualizar sesión local
                const userSession = JSON.parse(localStorage.getItem("previaula_session") || "{}");
                if (userSession.guardian_info) {
                  userSession.guardian_info.students = userSession.guardian_info.students.filter(x => x.id !== studentId);
                  localStorage.setItem("previaula_session", JSON.stringify(userSession));
                  state.guardianInfo = userSession.guardian_info;
                }
                
                pickFamilyChildren();
                renderChildPills();
                renderFamily();
              }
            }
          });
        });
      }
    }
    
    // Alerta de inconsistencia
    const alertBox = $("#guardian-mismatch-alert");
    const alertText = $("#guardian-mismatch-text");
    if (alertBox && alertText) {
      if (state.currentChild) {
        const riskData = await apiGet(`/api/students/${state.currentChild}/risk`, null);
        if (riskData && riskData.mismatch) {
          alertText.textContent = riskData.mismatch_detail;
          alertBox.style.display = "block";
        } else {
          alertBox.style.display = "none";
        }
      } else {
        alertBox.style.display = "none";
      }
    }
  }

  // =========================================================================
  // RENDER · Vista Estudiante
  // =========================================================================
  async function renderStudent() {
    const student = state.studentInfo || (state.students && state.students[0]) || {};
    if (!student.id) return;
    
    $("#student-hero-title").textContent = `Hola, ${student.first_name || "Estudiante"}`;
    $("#student-hero-date").textContent = `${student.establishment_name || "Establecimiento"} · ${student.course || "Curso"}`;
    
    const res = await apiGet(`/api/students/${student.id}/grades`, null);
    const grades = res ? res.grades : [];
    const gpa = res ? res.general_average : 0.0;
    
    $("#student-kpi-gpa").textContent = gpa.toFixed(1);
    
    const att = await getAttendance(student.id);
    const rate = att && att.summary ? att.summary.rate : 100;
    $("#student-kpi-att").textContent = `${rate}%`;
    
    const container = $("#student-grades-container");
    if (grades.length === 0) {
      container.innerHTML = `<div class="muted">No hay calificaciones registradas.</div>`;
    } else {
      container.innerHTML = grades.map(g => {
        const isGood = g.average >= 4.0;
        const avgCls = isGood ? "grade-buena" : "grade-alerta";
        return `
          <div class="grade-row">
            <div class="grade-row__info">
              <div class="grade-row__subject">${escapeHTML(g.subject_name)}</div>
              <div class="grade-row__teacher">${escapeHTML(g.teacher_name)}</div>
              <div class="grade-row__grades-pills">
                ${g.grades.map(n => `<span class="grade-pill">${n.toFixed(1)}</span>`).join("")}
              </div>
            </div>
            <div class="grade-row__avg">
              <span class="grade-val ${avgCls}">${g.average.toFixed(1)}</span>
            </div>
          </div>
        `;
      }).join("");
    }
    
    const course = student.course || "7° Básico";
    const isBasica = course.includes("Básico") && parseInt(course) <= 5;
    
    if (isBasica) {
      $("#survey-basica").style.display = "block";
      $("#survey-media").style.display = "none";
      state.wellbeingAgeGroup = "basica";
    } else {
      $("#survey-basica").style.display = "none";
      $("#survey-media").style.display = "block";
      state.wellbeingAgeGroup = "media";
    }

    // Render actividades y talleres preventivos recomendados / asignados
    renderStudentActivities();
  }

  async function renderStudentActivities() {
    const student = state.studentInfo || (state.students && state.students[0]) || {};
    if (!student.id) return;
    const container = $("#student-activities-container");
    if (!container) return;
    
    container.innerHTML = `<div class="muted" style="grid-column: span 2;">Cargando talleres y recomendaciones...</div>`;
    const data = await apiGet(`/api/students/${student.id}/activities`, null);
    if (!data) return;
    
    const assigned = data.assigned || [];
    const recommended = data.recommended || [];
    
    let html = "";
    
    // Actividades asignadas primero
    assigned.forEach(a => {
      const badgeType = a.type === "directa" ? "directa" : "indirecta";
      const typeLabel = a.type === "directa" ? "Prevención Directa" : "Prevención Indirecta";
      const statusLabel = a.status === "asignada" ? "Asignada" : (a.status === "en_progreso" ? "En Progreso" : "Completada");
      
      html += `
        <article class="activity-card" style="border: 1px solid var(--line-strong);">
          <div class="activity-card__header">
            <span class="activity-card__title">${escapeHTML(a.title)}</span>
            <span class="activity-badge status-${a.status}">${statusLabel}</span>
          </div>
          <p class="activity-card__desc">${escapeHTML(a.description)}</p>
          <div class="activity-card__meta">
            <span class="activity-badge ${badgeType}">${typeLabel}</span>
            <span class="activity-badge" style="background:var(--bg-secondary)">De: ${escapeHTML(a.assigned_by)}</span>
          </div>
          ${a.status !== "completada" ? `
            <div style="margin-top:8px; display:flex; gap:6px;">
              ${a.status === "asignada" ? `
                <button class="btn btn--ghost btn--xs act-status-btn" data-act="${a.activity_id}" data-status="en_progreso" style="flex:1; font-size:11px; padding:6px;">Iniciar Taller</button>
              ` : `
                ${a.delivery === "online" ? `
                  <button class="btn btn--primary btn--xs act-play-btn" data-act="${a.activity_id}" style="flex:1; font-size:11px; padding:6px;">Realizar Actividad Online</button>
                ` : `
                  <button class="btn btn--ghost btn--xs act-status-btn" data-act="${a.activity_id}" data-status="completada" style="flex:1; font-size:11px; padding:6px; background:var(--risk-bajo-wash); color:var(--risk-bajo);">Completar Taller</button>
                `}
              `}
            </div>
          ` : `
            <div style="font-size:10.5px; background:var(--surface-3); padding:6px 10px; border-radius:4px; margin-top:4px; font-style:italic; border-left:2px solid var(--risk-bajo);">
              ${a.feedback ? `Tu reseña: "${escapeHTML(a.feedback)}"` : "¡Actividad completada exitosamente!"}
            </div>
          `}
        </article>
      `;
    });
    
    // Actividades recomendadas
    recommended.forEach(a => {
      const badgeType = a.type === "directa" ? "directa" : "indirecta";
      const typeLabel = a.type === "directa" ? "Recomendado" : "Recomendado General";
      
      html += `
        <article class="activity-card" style="opacity: 0.9; border: 1px dashed var(--line-strong); background: var(--bg-secondary);">
          <div class="activity-card__header">
            <span class="activity-card__title" style="color:var(--ink-soft);">${escapeHTML(a.title)}</span>
            <span class="activity-badge" style="background:var(--accent-wash); color:var(--accent)">Sugerido</span>
          </div>
          <p class="activity-card__desc">${escapeHTML(a.description)}</p>
          <div class="activity-card__meta">
            <span class="activity-badge ${badgeType}">${typeLabel}</span>
            <span class="activity-badge">${escapeHTML(a.delivery)}</span>
          </div>
          <button class="btn btn--ghost btn--xs act-optin-btn" data-optin="${a.id}" style="margin-top:8px; font-size:11px; padding:6px;">Inscribirse</button>
        </article>
      `;
    });
    
    if (assigned.length === 0 && recommended.length === 0) {
      container.innerHTML = `<div class="muted" style="grid-column:span 2;">No hay talleres disponibles para tu perfil.</div>`;
    } else {
      container.innerHTML = html;
      
      // Conectar botones de cambio de estado
      container.querySelectorAll(".act-status-btn").forEach(btn => {
        btn.addEventListener("click", async () => {
          const actId = +btn.dataset.act;
          const status = btn.dataset.status;
          
          let feedback = null;
          if (status === "completada") {
            feedback = prompt("¿Qué te pareció este taller preventivo? Comparte un breve comentario de tu experiencia (opcional):");
          }
          
          const res = await apiPut(`/api/students/${student.id}/activities/${actId}`, {
            status: status,
            feedback: feedback
          });
          if (res) {
            toast(status === "completada" ? "¡Taller completado con éxito!" : "Taller iniciado.");
            renderStudentActivities();
          }
        });
      });
      
      // Conectar botón de autoinscripción
      container.querySelectorAll(".act-optin-btn").forEach(btn => {
        btn.addEventListener("click", async () => {
          const actId = +btn.dataset.optin;
          const res = await apiPost(`/api/students/${student.id}/activities`, {
            activity_id: actId,
            assigned_by: "Estudiante (Autoinscripción)"
          }, { id: Date.now(), status: "asignada" });
          if (res) {
            toast("Inscripción realizada. Taller preventivo iniciado.");
            renderStudentActivities();
          }
        });
      });

      // Conectar botones de realizar actividad online
      container.querySelectorAll(".act-play-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          const actId = +btn.dataset.act;
          const act = assigned.find(x => x.activity_id === actId);
          if (act) {
            openOnlineActivityModal(student.id, act);
          }
        });
      });
    }
  }

  function openOnlineActivityModal(studentId, act) {
    const modal = $("#activity-overlay");
    const content = $("#activity-modal-content");
    const closeBtn = $("#activity-modal-close");
    
    if (!modal || !content || !closeBtn) return;
    
    closeBtn.onclick = () => {
      modal.style.display = "none";
    };
    
    let innerHTML = "";
    if (act.title.includes("Mindfulness") || act.title.includes("Calma")) {
      // Taller de Mindfulness: Ejercicio interactivo de respiración neurodivergente
      innerHTML = `
        <h3 class="section-title" style="font-size: 16px; margin-bottom: 8px;">${escapeHTML(act.title)}</h3>
        <p class="section-sub" style="margin-bottom: 20px;">Ejercicio Guiado: Respira y regula tus emociones. Sigue el ritmo del círculo.</p>
        
        <div style="display: flex; flex-direction: column; align-items: center; gap: 24px; margin: 20px 0;">
          <div id="breathing-circle" style="width: 100px; height: 100px; border-radius: 50%; background: var(--primary-wash); border: 4px solid var(--primary); display: flex; align-items: center; justify-content: center; transition: all 4s ease-in-out; font-weight:600; color: var(--primary); font-size:13px; text-align:center; padding: 10px;">Inhala</div>
          <div id="breathing-timer" style="font-size: 12px; color: var(--ink-soft); font-weight:600;">Paso 1 de 3</div>
        </div>
        
        <div id="breathing-survey" style="display: none; border-top: 1px solid var(--line); padding-top: 16px;">
          <label class="field__label" for="mindfulness-mood">¿Cómo te sientes después de este ejercicio?</label>
          <select id="mindfulness-mood" class="select" style="width:100%; padding:8px; margin-bottom: 12px; border-radius: var(--r-sm);">
            <option value="Muy tranquilo y enfocado">Muy tranquilo y enfocado</option>
            <option value="Más calmado">Más calmado</option>
            <option value="Igual que antes">Igual que antes</option>
          </select>
          <button id="submit-online-act" class="btn btn--accent btn--block">Finalizar y Guardar</button>
        </div>
      `;
      content.innerHTML = innerHTML;
      modal.style.display = "flex";
      
      // Lógica de respiración
      let step = 0;
      const circle = document.getElementById("breathing-circle");
      const timer = document.getElementById("breathing-timer");
      
      function breatheCycle() {
        if (!circle || !timer) return;
        step++;
        if (step === 1) {
          circle.style.transform = "scale(1.6)";
          circle.textContent = "Inhala...";
          timer.textContent = "Inhala profundamente por la nariz";
          setTimeout(breatheCycle, 4000);
        } else if (step === 2) {
          circle.textContent = "Mantén...";
          timer.textContent = "Sostén el aire con calma";
          setTimeout(breatheCycle, 4000);
        } else if (step === 3) {
          circle.style.transform = "scale(1.0)";
          circle.textContent = "Exhala...";
          timer.textContent = "Suelta el aire despacio por la boca";
          setTimeout(breatheCycle, 4000);
        } else {
          // Completar ciclo
          circle.style.display = "none";
          timer.style.display = "none";
          document.getElementById("breathing-survey").style.display = "block";
        }
      }
      breatheCycle();
      
      document.getElementById("submit-online-act").onclick = async () => {
        const moodVal = document.getElementById("mindfulness-mood").value;
        const res = await apiPut(`/api/students/${studentId}/activities/${act.activity_id}`, {
          status: "completada",
          feedback: `Completado online: Me siento "${moodVal}"`
        });
        if (res) {
          toast("¡Taller completado con éxito!");
          modal.style.display = "none";
          renderStudentActivities();
        }
      };
      
    } else {
      // Cualquier otro taller (por ejemplo Creación Digital y Robótica)
      innerHTML = `
        <h3 class="section-title" style="font-size: 16px; margin-bottom: 8px;">${escapeHTML(act.title)}</h3>
        <p class="section-sub" style="margin-bottom: 16px;">Microdesafío interactivo sobre lógica de programación.</p>
        
        <div style="background: var(--bg-secondary); border-radius: var(--r-sm); padding: 12px; font-family: monospace; font-size:12px; margin-bottom:16px; border:1px solid var(--line-strong);">
          <span style="color:var(--primary)">// Conecta las instrucciones para encender el robot:</span><br/>
          1. Conectar batería (Energía)<br/>
          2. Cargar firmware (Software)<br/>
          3. Presionar botón de encendido<br/>
        </div>
        
        <div class="field" style="margin-bottom:16px;">
          <label class="field__label">¿Cuál es el orden lógico correcto para encenderlo?</label>
          <div style="display:flex; flex-direction:column; gap:8px; margin-top:8px;">
            <label style="font-size:12.5px; display:flex; align-items:center; gap:8px;">
              <input type="radio" name="robot-order" value="incorrect" /> 3 -> 2 -> 1 (Encender, programar, alimentar)
            </label>
            <label style="font-size:12.5px; display:flex; align-items:center; gap:8px;">
              <input type="radio" name="robot-order" value="correct" /> 1 -> 2 -> 3 (Alimentar, programar, encender)
            </label>
            <label style="font-size:12.5px; display:flex; align-items:center; gap:8px;">
              <input type="radio" name="robot-order" value="incorrect2" /> 2 -> 3 -> 1 (Programar, encender, alimentar)
            </label>
          </div>
        </div>
        
        <button id="submit-online-quiz" class="btn btn--accent btn--block">Verificar y Completar</button>
      `;
      content.innerHTML = innerHTML;
      modal.style.display = "flex";
      
      document.getElementById("submit-online-quiz").onclick = async () => {
        const selected = document.querySelector('input[name="robot-order"]:checked');
        if (!selected) {
          toast("Por favor selecciona una opción");
          return;
        }
        if (selected.value !== "correct") {
          toast("Respuesta incorrecta. ¡Inténtalo de nuevo!");
          return;
        }
        
        const res = await apiPut(`/api/students/${studentId}/activities/${act.activity_id}`, {
          status: "completada",
          feedback: "Completado online: Desafío de lógica de robótica superado"
        });
        if (res) {
          toast("¡Taller completado con éxito!");
          modal.style.display = "none";
          renderStudentActivities();
        }
      };
    }
  }

  // =========================================================================
  // RENDER · Vista Funcionario (Dirección)
  // =========================================================================
  async function renderOfficial() {
    const tbody = $("#official-establishments-tbody");
    tbody.innerHTML = `<tr><td colspan="10" class="muted" style="text-align:center">Cargando establecimientos...</td></tr>`;
    
    const data = await apiGet("/api/establishments/compare", []);
    if (data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10" class="muted" style="text-align:center">No hay establecimientos registrados.</td></tr>`;
      return;
    }
    
    let totalMatricula = 0;
    let totalCriticos = 0;
    let sumGpa = 0;
    let sumViolence = 0;
    let sumHome = 0;
    
    tbody.innerHTML = data.map(est => {
      totalMatricula += est.students_count;
      totalCriticos += est.high_risk_count;
      sumGpa += est.avg_gpa || 0;
      sumViolence += est.avg_violence_risk || 0;
      sumHome += est.avg_home_risk || 0;
      
      const attColor = est.avg_attendance >= 85 ? "var(--risk-bajo)" : (est.avg_attendance >= 75 ? "var(--risk-medio)" : "var(--risk-alto)");
      const criticalColor = est.high_risk_count > 4 ? "var(--risk-alto)" : (est.high_risk_count > 1 ? "var(--risk-medio)" : "var(--risk-bajo)");
      
      const gpaColor = est.avg_gpa >= 5.5 ? "var(--risk-bajo)" : (est.avg_gpa >= 4.0 ? "var(--risk-medio)" : "var(--risk-alto)");
      const violenceColor = est.avg_violence_risk >= 50 ? "var(--risk-alto)" : (est.avg_violence_risk >= 25 ? "var(--risk-medio)" : "var(--risk-bajo)");
      const homeColor = est.avg_home_risk >= 50 ? "var(--risk-alto)" : (est.avg_home_risk >= 25 ? "var(--risk-medio)" : "var(--risk-bajo)");
      
      return `
        <tr>
          <td><strong>${escapeHTML(est.name)}</strong></td>
          <td>${escapeHTML(est.comuna)}</td>
          <td style="text-align: center;">${est.students_count}</td>
          <td style="text-align: center;">
            <div style="display: flex; align-items: center; justify-content: center; gap: 8px;">
              <div style="background: var(--bg-secondary); border-radius: var(--r-pill); width: 60px; height: 8px; overflow: hidden; display: flex;">
                <div style="background: ${attColor}; width: ${est.avg_attendance}%; height: 100%;"></div>
              </div>
              <span style="font-weight: 600; min-width: 32px; font-size:11.5px;">${est.avg_attendance}%</span>
            </div>
          </td>
          <td style="text-align: center; font-weight: 700; color: ${gpaColor};">${(est.avg_gpa || 0.0).toFixed(1)}</td>
          <td style="text-align: center;">
            <span class="grade-pill" style="background: var(--surface-2); color: ${violenceColor}; font-weight: 700;">${est.avg_violence_risk || 0}%</span>
          </td>
          <td style="text-align: center;">
            <span class="grade-pill" style="background: var(--surface-2); color: ${homeColor}; font-weight: 700;">${est.avg_home_risk || 0}%</span>
          </td>
          <td style="text-align: center;">
            <span style="color: ${criticalColor}; font-weight: 700;">${est.high_risk_count}</span>
          </td>
          <td style="text-align: center;">${est.incidents_count}</td>
          <td style="text-align: center;">
            <span class="grade-pill" style="background: var(--surface-2); font-weight: 500;">${est.ive_average}%</span>
          </td>
        </tr>
      `;
    }).join("");
    
    $("#off-kpi-schools").textContent = data.length;
    $("#off-kpi-students").textContent = totalMatricula;
    $("#off-kpi-alerts").textContent = totalCriticos;
    $("#off-kpi-gpa").textContent = (sumGpa / data.length).toFixed(1);
    $("#off-kpi-violence").textContent = `${Math.round(sumViolence / data.length)}%`;
    $("#off-kpi-home").textContent = `${Math.round(sumHome / data.length)}%`;
  }

  // =========================================================================
  // Cambio de vista y perfil
  // =========================================================================
  const VIEW_META = {
    orientacion: { title: "Panel de orientación", sub: "Escuela Los Aromos · Alta vulnerabilidad (IVE)", search: true },
    docencia: { title: "Registro docente", sub: "Toma de asistencia e incidentes de convivencia", search: false },
    familia: { title: "Portal de familia", sub: "Asistencia de tu estudiante", search: false },
    estudiante: { title: "Mi Portal de Estudiante", sub: "Mis calificaciones y estado de bienestar", search: false },
    funcionario: { title: "Dirección General", sub: "Monitoreo multiestablecimiento", search: false },
  };

  function setView(view) {
    $$(".role-btn").forEach((b) => b.classList.toggle("is-active", b.dataset.view === view));
    $$(".view").forEach((v) => v.classList.toggle("is-active", v.id === "view-" + view));
    const meta = VIEW_META[view];
    $("#view-title").textContent = meta.title;
    $("#view-sub").textContent = meta.sub;
    $("#search-box").classList.toggle("hide", !meta.search);
    
    if (view === "orientacion") {
      renderHero();
      renderAlerts();
      renderIncidents();
    } else if (view === "docencia") {
      renderCourseTabs();
      renderRoster();
      renderSessionIncidents();
    } else if (view === "familia") {
      renderFamily();
    } else if (view === "estudiante") {
      renderStudent();
    } else if (view === "funcionario") {
      renderOfficial();
    }
  }

  // ---------------------------------------------------------------- Calificaciones Docente
  function populateGradesStudentSelect() {
    const roster = currentRoster();
    const select = $("#grades-student-select");
    if (!select) return;
    select.innerHTML = roster.map(s => `<option value="${s.id}">${escapeHTML(s.full_name)}</option>`).join("");
    
    // Al cambiar de estudiante o asignatura, refrescar las notas registradas
    select.addEventListener("change", renderGradesList);
    const subSelect = $("#grades-subject-select");
    if (subSelect) {
      subSelect.addEventListener("change", renderGradesList);
    }
    renderGradesList();
  }

  async function renderGradesList() {
    const studentId = parseInt($("#grades-student-select")?.value);
    const subjectName = $("#grades-subject-select")?.value;
    const container = $("#grades-list-container");
    if (!container) return;
    if (!studentId || !subjectName) {
      container.innerHTML = `<span style="font-size:12px;color:var(--ink-mute);">Selecciona un estudiante.</span>`;
      return;
    }
    
    const data = await apiGet(`/api/students/${studentId}/grades`, null);
    if (!data || !data.grades) {
      container.innerHTML = `<span style="font-size:12px;color:var(--ink-mute);">No hay calificaciones registradas.</span>`;
      return;
    }
    
    const subjData = data.grades.find(g => g.subject_name === subjectName);
    if (!subjData || !subjData.grades || subjData.grades.length === 0) {
      container.innerHTML = `<span style="font-size:12px;color:var(--ink-mute);">No hay notas registradas para esta asignatura.</span>`;
      return;
    }
    
    container.innerHTML = subjData.grades.map(n => 
      `<span class="grade-pill" style="padding: 4px 8px; background: var(--bg); border: 1px solid var(--line-strong); border-radius: var(--r-sm); font-size:12px; font-weight:600; color: ${n >= 4.0 ? "var(--risk-bajo)" : "var(--risk-alto)"};">${n.toFixed(1)}</span>`
    ).join("");
  }

  async function saveNewGrade() {
    const studentId = parseInt($("#grades-student-select")?.value);
    const subjectName = $("#grades-subject-select")?.value;
    const inputVal = parseFloat($("#grades-new-value")?.value);
    
    if (!studentId || !subjectName || isNaN(inputVal) || inputVal < 1.0 || inputVal > 7.0) {
      toast("Por favor ingrese una nota válida entre 1.0 y 7.0");
      return;
    }
    
    const res = await apiPost(`/api/students/${studentId}/grades`, {
      subject_name: subjectName,
      grade: inputVal
    }, null);
    
    if (res) {
      toast("Calificación registrada exitosamente");
      $("#grades-new-value").value = "";
      renderGradesList();
    }
  }

  const PROFILE_HINT = {
    hypersensitive: "Transiciones lentas y sin acentos intensos, pensado para hipersensibilidad sensorial.",
    hyposensitive: "Acentos pastel (durazno y azul cielo) y respuesta ágil para estimular la atención.",
  };
  function setProfile(profile) {
    document.body.classList.remove("profile-hypersensitive", "profile-hyposensitive");
    document.body.classList.add("profile-" + profile);
    $$("#sensory-opts .sensory__opt").forEach((b) =>
      b.classList.toggle("is-active", b.dataset.profile === profile));
    $("#sensory-hint").textContent = PROFILE_HINT[profile];
  }

  // ------------------------------------------------------------------- Toast
  let toastTimer;
  function toast(msg) {
    const wrap = $("#toast-wrap");
    wrap.innerHTML = `<div class="toast">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>
      ${escapeHTML(msg)}</div>`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (wrap.innerHTML = ""), 3200);
  }

  // ------------------------------------------------------------------ Buscar
  function wireSearch() {
    $("#search-input").addEventListener("input", (e) => {
      const q = e.target.value.trim().toLowerCase();
      $$("#alert-grid .alert-card, #incident-tbody tr").forEach((el) => {
        const hit = !q || (el.dataset.search || "").includes(q);
        el.style.display = hit ? "" : "none";
      });
    });
  }

  async function populateEstablishmentSelect() {
    const select = $("#active-establishment-select");
    if (!select) return;
    
    const data = await apiGet("/api/establishments/compare", []);
    if (data.length > 0) {
      select.innerHTML = data.map(est => 
        `<option value="${est.id}">${escapeHTML(est.name)}</option>`
      ).join("");
      
      select.addEventListener("change", () => {
        state.activeEstablishmentId = parseInt(select.value);
        // Refrescar la vista actual
        const activeBtn = $(".role-btn.is-active");
        const activeView = activeBtn ? activeBtn.dataset.view : "orientacion";
        setView(activeView);
        toast(`Mostrando datos de: ${select.options[select.selectedIndex].text}`);
      });
    }
  }

  // ------------------------------------------------------------------ Sidebar por rol
  function setupSidebarForRole(role) {
    $("#btn-nav-orientacion").style.display = "none";
    $("#btn-nav-docencia").style.display = "none";
    $("#btn-nav-familia").style.display = "none";
    $("#btn-nav-estudiante").style.display = "none";
    $("#btn-nav-funcionario").style.display = "none";
    
    let defaultView = "orientacion";
    
    if (role === "orientador") {
      $("#btn-nav-orientacion").style.display = "";
      $("#btn-nav-docencia").style.display = "";
      $("#btn-nav-funcionario").style.display = "";
      defaultView = "orientacion";
    } else if (role === "profesor") {
      $("#btn-nav-docencia").style.display = "";
      $("#btn-nav-orientacion").style.display = "";
      defaultView = "docencia";
    } else if (role === "apoderado") {
      $("#btn-nav-familia").style.display = "";
      defaultView = "familia";
      if (state.guardianInfo && state.guardianInfo.students && state.guardianInfo.students.length) {
        state.familyChildIds = state.guardianInfo.students.map(s => s.id);
        state.currentChild = state.familyChildIds[0];
      }
    } else if (role === "estudiante") {
      $("#btn-nav-estudiante").style.display = "";
      defaultView = "estudiante";
    } else if (role === "funcionario") {
      $("#btn-nav-funcionario").style.display = "";
      $("#btn-nav-orientacion").style.display = "";
      $("#btn-nav-docencia").style.display = "";
      defaultView = "funcionario";
    }
    
    // Configurar visibilidad del selector de colegio
    const selector = $("#establishment-selector-container");
    if (selector) {
      selector.style.display = (role === "funcionario" || role === "orientador") ? "flex" : "none";
      const selectEl = $("#active-establishment-select");
      if (selectEl) {
        selectEl.disabled = (role !== "funcionario");
        selectEl.value = String(state.activeEstablishmentId || 1);
      }
    }
    
    setView(defaultView);
  }

  // ------------------------------------------------------------------ Chatbot Lógica
  let breathingInterval;

  function initChatbot() {
    const toggle = $("#chatbot-toggle");
    const box = $("#chatbot-box");
    const close = $("#chatbot-close");
    const body = $("#chatbot-body");
    const optsContainer = $("#chatbot-options");

    toggle.addEventListener("click", () => {
      const isHidden = box.style.display === "none";
      box.style.display = isHidden ? "flex" : "none";
      box.setAttribute("aria-hidden", !isHidden);
      if (isHidden) {
        body.scrollTop = body.scrollHeight;
      }
    });

    close.addEventListener("click", () => {
      box.style.display = "none";
      box.setAttribute("aria-hidden", "true");
      stopBreathing();
    });

    optsContainer.addEventListener("click", (e) => {
      const btn = e.target.closest(".chat-opt");
      if (!btn) return;

      const flow = btn.dataset.flow;
      const text = btn.textContent;

      appendChatMessage(text, "user");
      optsContainer.innerHTML = "";

      setTimeout(() => {
        handleBotFlow(flow);
      }, 600);
    });
  }

  function appendChatMessage(text, sender) {
    const body = $("#chatbot-body");
    const msg = document.createElement("div");
    msg.className = `chat-msg ${sender}`;
    msg.innerHTML = `<div class="chat-msg__bubble">${text}</div>`;
    body.appendChild(msg);
    body.scrollTop = body.scrollHeight;
  }

  function handleBotFlow(flow) {
    const optsContainer = $("#chatbot-options");

    if (flow === "info") {
      appendChatMessage("¿Qué información del colegio necesitas saber?", "bot");
      optsContainer.innerHTML = `
        <button class="chat-opt" data-flow="info-reuniones" type="button">Próxima Reunión</button>
        <button class="chat-opt" data-flow="info-contacto" type="button">Contacto Orientación</button>
        <button class="chat-opt" data-flow="info-justificar" type="button">¿Cómo justificar?</button>
        <button class="chat-opt" data-flow="start" type="button">← Volver al inicio</button>
      `;
    } else if (flow === "info-reuniones") {
      appendChatMessage("Las reuniones de apoderados son programadas mensualmente. La próxima reunión general está fijada para el <b>Jueves 24 de julio a las 18:30 h</b> en la sala de clases correspondiente.", "bot");
      showReturnOption();
    } else if (flow === "info-contacto") {
      appendChatMessage("El equipo de Convivencia Escolar y orientación atiende de Lunes a Viernes de 08:30 a 14:00 h. Puedes coordinar una cita escribiendo a <b>contacto.orientacion@liceogabriela.cl</b> o solicitándolo en secretaría.", "bot");
      showReturnOption();
    } else if (flow === "info-justificar") {
      appendChatMessage("Para justificar una inasistencia, inicia sesión como <b>Apoderado</b>, ve al menú 'Justificaciones y Encuestas', selecciona la fecha y detalla el motivo. Será revisado por secretaría.", "bot");
      showReturnOption();
    } else if (flow === "emotion") {
      appendChatMessage("Es normal sentirse estresado o cansado. ¿Cómo te sientes en este momento?", "bot");
      optsContainer.innerHTML = `
        <button class="chat-opt" data-flow="emotion-stress" type="button">Estresado por las tareas/colegio</button>
        <button class="chat-opt" data-flow="emotion-conflict" type="button">Tuve un conflicto con alguien</button>
        <button class="chat-opt" data-flow="emotion-crisis" type="button">Tengo mucha ansiedad ahora</button>
        <button class="chat-opt" data-flow="start" type="button">← Volver al inicio</button>
      `;
    } else if (flow === "emotion-stress") {
      appendChatMessage("Comprendo. Cuando hay mucho agobio, te recomendamos aplicar la regla del 45-5: estudia 45 minutos y descansa 5 minutos haciendo algo lejos de las pantallas. Recuerda que ir paso a paso es la mejor manera de avanzar.", "bot");
      showReturnOption();
    } else if (flow === "emotion-conflict") {
      appendChatMessage("Los desacuerdos ocurren, pero hablar bajo frustración puede empeorarlos. Respira profundo, tómate unos minutos y cuando estés listo, conversa con tu orientador de confianza. Ellos pueden guiar una mediación pacífica.", "bot");
      showReturnOption();
    } else if (flow === "emotion-crisis") {
      appendChatMessage("Hagamos un ejercicio de respiración guiado de 12 segundos (Inhalar - Retener - Exhalar). Te ayudará a calmar las pulsaciones.", "bot");

      const body = $("#chatbot-body");
      const container = document.createElement("div");
      container.className = "breathing-container";
      container.innerHTML = `
        <div class="breathing-circle" id="breathe-circle">4s</div>
        <div class="breathing-text" id="breathe-text">Inhala profundo...</div>
      `;
      body.appendChild(container);
      body.scrollTop = body.scrollHeight;

      startBreathingCycle();

      optsContainer.innerHTML = `
        <button class="chat-opt" data-flow="stop-breathe" type="button">Detener ejercicio / Volver</button>
      `;
    } else if (flow === "stop-breathe") {
      stopBreathing();
      handleBotFlow("start");
    } else if (flow === "start") {
      appendChatMessage("¿En qué te puedo ayudar hoy? Selecciona una de las opciones para comenzar.", "bot");
      optsContainer.innerHTML = `
        <button class="chat-opt" data-flow="info" type="button">Información del Colegio</button>
        <button class="chat-opt" data-flow="emotion" type="button">Apoyo Emocional / Contención</button>
      `;
    }
  }

  function showReturnOption() {
    const optsContainer = $("#chatbot-options");
    optsContainer.innerHTML = `
      <button class="chat-opt" data-flow="start" type="button">Volver al inicio</button>
    `;
  }

  function startBreathingCycle() {
    stopBreathing();
    const circle = $("#breathe-circle");
    const label = $("#breathe-text");
    
    let step = 0; // 0: inhale, 1: hold, 2: exhale
    let timer = 4;

    const run = () => {
      timer--;
      if (timer < 0) {
        step = (step + 1) % 3;
        timer = 3;
      }

      const cEl = $("#breathe-circle");
      const lEl = $("#breathe-text");
      if (cEl) cEl.textContent = `${timer + 1}s`;

      if (step === 0) {
        if (lEl) lEl.textContent = "Inhala profundo...";
      } else if (step === 1) {
        if (lEl) lEl.textContent = "Mantén el aire...";
      } else {
        if (lEl) lEl.textContent = "Exhala suavemente...";
      }
    };

    breathingInterval = setInterval(run, 1000);
  }

  function stopBreathing() {
    clearInterval(breathingInterval);
    const container = $(".breathing-container");
    if (container) container.remove();
  }

  // ------------------------------------------------------------------- Init
  async function probeBackend() {
    if (window.PREVIAULA_FORCE_MOCK) {
      USE_MOCK = true;
      document.body.classList.add("is-offline");
      return;
    }
    try {
      const r = await fetch(API + "/api/health", { method: "GET" });
      USE_MOCK = !r.ok;
    } catch (e) {
      USE_MOCK = true;
    }
    if (USE_MOCK) document.body.classList.add("is-offline");
  }

  async function init() {
    await probeBackend();

    state.summary = await apiGet("/api/dashboard/summary", MOCK.summary || {});
    state.students = await apiGet("/api/students", MOCK.students || []);
    state.incidents = await apiGet("/api/incidents?limit=20", MOCK.incidents || []);
    state.courses = await apiGet("/api/courses", MOCK.courses || []);
    state.currentCourse = (state.courses[0] || {}).course || null;

    await populateEstablishmentSelect();

    // Orientación
    renderHero();
    renderAlerts();
    renderIncidents();

    // Docencia
    renderCourseTabs();
    renderRoster();
    renderSessionIncidents();

    // Familia
    pickFamilyChildren();

    // Eventos
    $$(".role-btn").forEach((b) =>
      b.addEventListener("click", () => setView(b.dataset.view)));
    $$("#sensory-opts .sensory__opt").forEach((b) =>
      b.addEventListener("click", () => setProfile(b.dataset.profile)));
    $("#toggle-all-alerts").addEventListener("click", (e) => {
      state.showAllAlerts = !state.showAllAlerts;
      e.target.textContent = state.showAllAlerts ? "Ver solo alertas →" : "Ver todos →";
      renderAlerts();
    });
    $("#save-attendance").addEventListener("click", saveAttendance);
    $("#save-incident").addEventListener("click", saveIncident);
    $$("#inc-severity button").forEach((b) =>
      b.addEventListener("click", () => {
        state.incidentSeverity = b.dataset.sev;
        $$("#inc-severity button").forEach((x) =>
          x.classList.toggle("is-on", x === b));
      }));
    $("#drawer-scrim").addEventListener("click", closeDrawer);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });

    wireSearch();

    // Conectar el selector de fecha del docente
    const dateInput = $("#attendance-date");
    if (dateInput) {
      dateInput.addEventListener("change", async () => {
        const dateStr = dateInput.value;
        const res = await apiGet(`/api/attendance?course=${state.currentCourse}&date=${dateStr}`, null);
        if (res && Object.keys(res).length > 0) {
          state.attendanceDraft = res;
        } else {
          state.attendanceDraft = {};
          const roster = currentRoster();
          roster.forEach((s) => {
            state.attendanceDraft[s.id] = "presente";
          });
        }
        renderRoster();
      });
    }

    // ---------------------------------------------------------- Conexión de Login y Registro
    const toggleRegisterLink = $("#toggle-register-link");
    const loginForm = $("#login-form");
    const registerForm = $("#register-user-form");
    
    toggleRegisterLink.addEventListener("click", (e) => {
      e.preventDefault();
      const isLoginVisible = loginForm.style.display !== "none";
      if (isLoginVisible) {
        loginForm.style.display = "none";
        registerForm.style.display = "block";
        toggleRegisterLink.textContent = "¿Ya tienes cuenta? Ingresar";
      } else {
        loginForm.style.display = "block";
        registerForm.style.display = "none";
        toggleRegisterLink.textContent = "¿No tienes cuenta? Regístrate aquí";
      }
    });

    registerForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fullName = $("#reg-fullname").value.trim();
      const username = $("#reg-username").value.trim();
      const password = $("#reg-password").value.trim();
      const role = $("#reg-role").value;
      $("#reg-error").style.display = "none";
      
      const res = await apiPost("/api/auth/register", {
        username, password, role, full_name: fullName
      }, null);
      
      if (res && res.status === "success") {
        state.user = res.user;
        state.studentInfo = res.student_info;
        state.guardianInfo = res.guardian_info;
        localStorage.setItem("previaula_session", JSON.stringify(res));
        
        document.body.classList.remove("is-logged-out");
        
        // Reset forms
        loginForm.style.display = "block";
        registerForm.style.display = "none";
        toggleRegisterLink.textContent = "¿No tienes cuenta? Regístrate aquí";
        $("#reg-fullname").value = "";
        $("#reg-username").value = "";
        $("#reg-password").value = "";
        
        setupSidebarForRole(res.user.role);
        toast("Cuenta creada con éxito");
      } else {
        $("#reg-error").textContent = (res && res.error) || "Error al crear la cuenta.";
        $("#reg-error").style.display = "block";
      }
    });

    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const username = $("#login-username").value.trim();
      const password = $("#login-password").value.trim();
      $("#login-error").style.display = "none";
      
      const res = await apiPost("/api/auth/login", { username, password }, null);
      if (res && res.status === "success") {
        state.user = res.user;
        state.studentInfo = res.student_info;
        state.guardianInfo = res.guardian_info;
        localStorage.setItem("previaula_session", JSON.stringify(res));
        
        document.body.classList.remove("is-logged-out");
        setupSidebarForRole(res.user.role);
      } else {
        $("#login-error").textContent = (res && res.error) || "Usuario o contraseña incorrectos.";
        $("#login-error").style.display = "block";
      }
    });

    // Conectar botón para agregar calificación
    const addGradeBtn = $("#add-grade-btn");
    if (addGradeBtn) {
      addGradeBtn.addEventListener("click", saveNewGrade);
    }

    // Conectar el formulario de registro de establecimientos
    const registerEstForm = $("#register-establishment-form");
    if (registerEstForm) {
      registerEstForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const name = $("#est-name").value.trim();
        const comuna = $("#est-comuna").value.trim();
        const ive_average = parseInt($("#est-ive").value);
        
        const res = await apiPost("/api/establishments", {
          name, comuna, ive_average
        }, null);
        
        if (res) {
          toast("Establecimiento registrado con éxito");
          $("#est-name").value = "";
          $("#est-comuna").value = "";
          $("#est-ive").value = "";
          
          // Refrescar
          await populateEstablishmentSelect();
          renderOfficial();
        }
      });
    }

    $("#logout-btn").addEventListener("click", (e) => {
      e.preventDefault();
      localStorage.removeItem("previaula_session");
      state.user = null;
      state.studentInfo = null;
      state.guardianInfo = null;
      document.body.classList.add("is-logged-out");
      $("#login-username").value = "";
      $("#login-password").value = "";
      $("#login-error").style.display = "none";
    });

    // Restauración de sesión
    const savedSession = localStorage.getItem("previaula_session");
    if (savedSession) {
      const data = JSON.parse(savedSession);
      state.user = data.user;
      state.studentInfo = data.student_info;
      state.guardianInfo = data.guardian_info;
      document.body.classList.remove("is-logged-out");
      setupSidebarForRole(data.user.role);
    } else {
      document.body.classList.add("is-logged-out");
    }

    // Pestañas Familia
    $$(".family-tab-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const tab = btn.dataset.familyTab;
        $$(".family-tab-btn").forEach(b => b.classList.toggle("is-active", b === btn));
        $$(".family-tab-content").forEach(c => {
          c.style.display = c.id === `family-tab-content-${tab}` ? "block" : "none";
        });
        
        if (tab === "rendimiento") {
          renderFamilyGrades();
        }
      });
    });

    // Formulario de Justificación
    const excuseForm = $("#excuse-form");
    excuseForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!state.currentChild) return;
      const date = $("#excuse-date").value;
      const reason = $("#excuse-reason").value.trim();
      
      const res = await apiPost("/api/guardian/excuse", {
        student_id: state.currentChild,
        log_date: date,
        reason: reason
      }, { status: "pendiente" });
      
      if (res && res.status === "pendiente") {
        toast("Justificación enviada correctamente y en revisión.");
        excuseForm.reset();
      }
    });

    // Formulario de Cohesión
    const cohesionForm = $("#cohesion-form");
    cohesionForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const guardianId = state.guardianInfo ? state.guardianInfo.id : 4;
      const studentId = state.currentChild || 4;
      const rate = parseInt($("#cohesion-rate").value);
      const help = parseInt($("#cohesion-help").value);
      const safe = $("#cohesion-safe") ? $("#cohesion-safe").value : "Sí";
      
      const res = await apiPost("/api/guardian/survey", {
        guardian_id: guardianId,
        student_id: studentId,
        cohesion_rate: rate,
        cohesion_help: help,
        safe_at_school: safe
      }, { status: "success" });
      
      if (res) {
        toast("Respuestas enviadas. ¡Gracias por colaborar con el entorno escolar!");
        cohesionForm.reset();
        
        // Recargar alertas para ver reflejada la inconsistencia de inmediato
        state.students = await apiGet("/api/students", state.students);
        renderAlerts();
      }
    });

    // Formulario socioemocional del estudiante
    const wellbeingForm = $("#wellbeing-form");
    let selectedMood = "";
    $$(".mood-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        selectedMood = btn.dataset.val;
        $$(".mood-btn").forEach(b => b.classList.toggle("is-active", b === btn));
      });
    });
    
    let surveyBasicaSafe = "";
    $$("#survey-basica-safe button").forEach(btn => {
      btn.addEventListener("click", () => {
        surveyBasicaSafe = btn.dataset.val;
        $$("#survey-basica-safe button").forEach(b => b.style.background = b === btn ? "var(--surface-2)" : "var(--bg)");
      });
    });
    let surveyBasicaSocial = "";
    $$("#survey-basica-social button").forEach(btn => {
      btn.addEventListener("click", () => {
        surveyBasicaSocial = btn.dataset.val;
        $$("#survey-basica-social button").forEach(b => b.style.background = b === btn ? "var(--surface-2)" : "var(--bg)");
      });
    });

    wellbeingForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const student = state.studentInfo || (state.students && state.students[0]) || {};
      if (!student.id) return;
      
      let payload = {
        student_id: student.id,
        age_group: state.wellbeingAgeGroup,
        needs_talk: $("#survey-needs-talk").checked
      };
      
      if (state.wellbeingAgeGroup === "basica") {
        payload.energy_mood = selectedMood || "☀️";
        payload.safe_at_school = surveyBasicaSafe || "Sí";
        payload.social_ok = surveyBasicaSocial || "Sí";
      } else {
        payload.stress_level = parseInt($("#survey-media-stress").value);
        payload.safe_at_school = $("#survey-media-safe").value;
        payload.social_ok = $("#survey-media-social").value;
      }
      
      const res = await apiPost("/api/student/self-report", payload, { status: "registrado", needs_talk: payload.needs_talk });
      if (res && res.status === "registrado") {
        toast(res.needs_talk ? "Reporte enviado. Un psicólogo te contactará pronto." : "Reporte de bienestar enviado correctamente.");
        wellbeingForm.reset();
        selectedMood = "";
        $$(".mood-btn").forEach(b => b.classList.remove("is-active"));
        $$("#survey-basica-safe button, #survey-basica-social button").forEach(b => b.style.background = "var(--bg)");
        
        // Recargar datos y refrescar alertas reactivamente
        state.students = await apiGet("/api/students", state.students);
        renderAlerts();
      }
    });

    // Chatbot flotante
    initChatbot();

    // Modal Glosario Ayuda e Interpretación de Datos
    const btnGlosario = $("#btn-glosario-ayuda");
    const modalGlosario = $("#modal-glosario");
    const btnCloseGlosario = $("#close-glosario-btn");
    
    if (btnGlosario && modalGlosario && btnCloseGlosario) {
      btnGlosario.addEventListener("click", () => {
        modalGlosario.style.display = "flex";
      });
      btnCloseGlosario.addEventListener("click", () => {
        modalGlosario.style.display = "none";
      });
      modalGlosario.addEventListener("click", (e) => {
        if (e.target === modalGlosario) {
          modalGlosario.style.display = "none";
        }
      });
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
