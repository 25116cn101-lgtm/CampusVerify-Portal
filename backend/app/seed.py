from sqlalchemy.orm import Session
from .models import User, StudentProfile, ChecklistRule
from .security import hash_password

DEFAULT_RULES = [
    ("cover-letter", "Cover letter", "College-approved cover letter", "All", True),
    ("checklist-print", "Checklist printout", "Print the applicable checklist", "All", True),
    ("scholarship-form", "Scholarship form printout", "Signed/printed form where required", "All", True),
    ("previous-scholarship", "Previous-year scholarship status", "Where applicable for renewal", "Renewal", False),
    ("counselling-letter", "Counselling letter", "Where applicable", "Conditional", False),
    ("income-certificate", "Income certificate", "Confirm current validity and verification rules", "All", True),
    ("caste-certificate", "Caste certificate", "Where applicable", "Conditional", False),
    ("domicile", "Domicile certificate", "Confirm current requirement", "All", True),
    ("bank-passbook", "Bank passbook copy", "Follow college instructions; avoid unnecessary data exposure", "All", True),
    ("marksheets", "Marksheets from Class 10 onward", "Include all applicable marksheets", "All", True),
    ("tuition-receipt", "Current-session tuition fee receipt", "Current academic session", "All", True),
    ("hostel-receipt", "Hostel fee receipt and bonafide", "For hostellers", "Hosteller", False),
    ("student-id", "Student Aadhaar and college ID", "Collect only if institution confirms it is necessary", "All", True),
    ("parent-docs", "Parent identity documents", "Only where current official rules require", "Conditional", False),
    ("affidavits", "Student/parent scholarship affidavits", "Use college-approved templates", "All", True),
]
def seed_demo(db: Session):
    if db.query(User).count() > 0:
        return
    college = "demo-college"
    users = [
        User(email="admin@campusverify.local", admission_number=None, full_name="Demo College Admin", password_hash=hash_password("ChangeMe-Admin-123!"), role="admin", college_id=college),
        User(email="staff@campusverify.local", admission_number=None, full_name="Demo Counter Staff", password_hash=hash_password("ChangeMe-Staff-123!"), role="staff", college_id=college),
        User(email="student@campusverify.local", admission_number="CV2026001", full_name="Demo Student", password_hash=hash_password("ChangeMe-Student-123!"), role="student", college_id=college),
    ]
    db.add_all(users)
    db.flush()
    db.add(StudentProfile(user_id=users[2].id, course="B.A.", branch="General", academic_year="2026-27", application_type="Fresh", category="General", hostel_status=False, phone=""))
    for key, label, desc, applies, required in DEFAULT_RULES:
        db.add(ChecklistRule(college_id=college, key=key, label=label, description=desc, applies_to=applies, required=required))
    db.commit()
