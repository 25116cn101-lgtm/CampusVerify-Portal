import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
os.environ["DATABASE_URL"] = "sqlite://"
os.environ["JWT_SECRET"] = "test-secret-for-tests"
os.environ["SEED_DEMO"] = "false"

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app.main import app
from app.db import Base, get_db
from app.models import User, StudentProfile, ChecklistRule
from app.security import hash_password

engine = create_engine("sqlite://", connect_args={"check_same_thread":False}, poolclass=StaticPool)
TestingSession = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base.metadata.create_all(bind=engine)

def override_db():
    db = TestingSession()
    try: yield db
    finally: db.close()
app.dependency_overrides[get_db] = override_db

with TestingSession() as db:
    if db.query(User).count() == 0:
        admin = User(email="admin@test.local",full_name="Admin",password_hash=hash_password("Admin-pass-123!"),role="admin",college_id="college-a")
        staff = User(email="staff@test.local",full_name="Staff",password_hash=hash_password("Staff-pass-123!"),role="staff",college_id="college-a")
        student = User(email="student@test.local",admission_number="A001",full_name="Student",password_hash=hash_password("Student-pass-123!"),role="student",college_id="college-a")
        other = User(email="other@test.local",admission_number="B001",full_name="Other",password_hash=hash_password("Other-pass-123!"),role="student",college_id="college-b")
        db.add_all([admin,staff,student,other]); db.flush()
        db.add(StudentProfile(user_id=student.id,course="BSc",branch="CS",academic_year="2026-27",application_type="Fresh",category="General",hostel_status=False))
        db.add(ChecklistRule(college_id="college-a",key="income",label="Income certificate",required=True))
        db.commit()

client = TestClient(app)

def login(identifier, password):
    return client.post("/api/auth/login",json={"identifier":identifier,"password":password})

def test_health():
    assert client.get("/health").json()["status"] == "ok"

def test_login_and_me():
    response = login("A001","Student-pass-123!")
    assert response.status_code == 200
    token = response.json()["access_token"]
    assert client.get("/api/auth/me",headers={"Authorization":f"Bearer {token}"}).json()["role"] == "student"

def test_bad_password_rejected():
    assert login("A001","wrong-password").status_code == 401

def test_student_cannot_access_admin_rules():
    token = login("A001","Student-pass-123!").json()["access_token"]
    response = client.get("/api/admin/rules",headers={"Authorization":f"Bearer {token}"})
    assert response.status_code == 403

def test_college_isolation_on_queue():
    token = login("A001","Student-pass-123!").json()["access_token"]
    response = client.get("/api/queue",headers={"Authorization":f"Bearer {token}"})
    assert response.status_code == 200
    assert response.json() == []

def test_checklist_scoped_to_college():
    token = login("A001","Student-pass-123!").json()["access_token"]
    response = client.get("/api/checklist",headers={"Authorization":f"Bearer {token}"})
    assert response.status_code == 200
    assert all(row["key"] == "income" for row in response.json())
