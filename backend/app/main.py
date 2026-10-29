import os, uuid, mimetypes
from datetime import date, datetime, timezone
from pathlib import Path
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import select, func
from .config import settings
from .db import Base, engine, get_db, SessionLocal
from .models import User, StudentProfile, ChecklistRule, StudentDocument, QueueToken, AuditEvent
from .schemas import LoginInput, QueueCreate, StatusUpdate, RuleInput
from .security import verify_password, create_access_token, decode_access_token
from .dependencies import current_user, require_roles
from .seed import seed_demo

app = FastAPI(title="CampusVerify API", version="0.1.0", description="College scholarship preparation and hardcopy queue management.")
origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=True, allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"], allow_headers=["Authorization", "Content-Type"])


@app.on_event("startup")
def startup():
    Base.metadata.create_all(bind=engine)
    if settings.seed_demo:
        db = SessionLocal()
        try:
            seed_demo(db)
        finally:
            db.close()
    Path(settings.upload_dir).mkdir(parents=True, exist_ok=True)


@app.get("/health")
def health():
    return {"status": "ok"}


def audit(db, user, target_type, target_id, action, details=""):
    db.add(AuditEvent(
        college_id=user.college_id,
        actor_user_id=user.id,
        target_type=target_type,
        target_id=str(target_id),
        action=action,
        details=details,
    ))


@app.post("/api/auth/login")
def login(data: LoginInput, db: Session = Depends(get_db)):
    ident = data.identifier.strip()
    user = db.query(User).filter(
        (User.email == ident.lower()) | (User.admission_number == ident)
    ).first()
    if not user or not user.is_active or not verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_access_token(user.id, user.role, user.college_id)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "email": user.email,
            "admission_number": user.admission_number,
            "full_name": user.full_name,
            "role": user.role,
            "college_id": user.college_id,
        },
    }


@app.get("/api/auth/me")
def me(user: User = Depends(current_user)):
    return {
        "id": user.id,
        "email": user.email,
        "admission_number": user.admission_number,
        "full_name": user.full_name,
        "role": user.role,
        "college_id": user.college_id,
    }


@app.get("/api/student/dashboard")
def student_dashboard(user: User = Depends(require_roles("student")), db: Session = Depends(get_db)):
    profile = db.query(StudentProfile).filter_by(user_id=user.id).first()
    docs = db.query(StudentDocument).filter_by(user_id=user.id, college_id=user.college_id).all()
    rules = db.query(ChecklistRule).filter_by(college_id=user.college_id, active=True).all()
    uploaded = {d.rule_key for d in docs if d.status != "Rejected"}
    applicable = [
        r for r in rules
        if r.applies_to in ("All", "Conditional")
        or (r.applies_to == "Renewal" and profile and profile.application_type == "Renewal")
        or (r.applies_to == "Hosteller" and profile and profile.hostel_status)
    ]
    required = [r for r in applicable if r.required]
    missing = [r.key for r in required if r.key not in uploaded]
    return {
        "student": {"id": user.id, "name": user.full_name, "admission_number": user.admission_number},
        "profile": None if not profile else {
            "course": profile.course,
            "branch": profile.branch,
            "academic_year": profile.academic_year,
            "application_type": profile.application_type,
            "category": profile.category,
            "hostel_status": profile.hostel_status,
        },
        "required_count": len(required),
        "uploaded_count": len([k for k in uploaded if k in {r.key for r in required}]),
        "missing_keys": missing,
        "readiness_percent": 100 if not required else round(100 * (len(required) - len(missing)) / len(required)),
    }


@app.get("/api/checklist")
def checklist(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rules = db.query(ChecklistRule).filter_by(
        college_id=user.college_id, active=True
    ).order_by(ChecklistRule.id).all()
    return [
        {
            "id": r.id,
            "key": r.key,
            "label": r.label,
            "description": r.description,
            "applies_to": r.applies_to,
            "required": r.required,
        }
        for r in rules
    ]


@app.post("/api/documents")
async def upload_document(
    rule_key: str = Form(...),
    file: UploadFile = File(...),
    user: User = Depends(require_roles("student")),
    db: Session = Depends(get_db),
):
    rule = db.query(ChecklistRule).filter_by(
        college_id=user.college_id, key=rule_key, active=True
    ).first()
    if not rule:
        raise HTTPException(status_code=400, detail="Unknown checklist item")

    allowed = {
        ".pdf": {"application/pdf"},
        ".png": {"image/png"},
        ".jpg": {"image/jpeg"},
        ".jpeg": {"image/jpeg"},
    }
    ext = Path(file.filename or "").suffix.lower()
    if ext not in allowed or file.content_type not in allowed[ext]:
        raise HTTPException(status_code=400, detail="Only PDF, PNG, and JPEG uploads are allowed")

    max_bytes = settings.max_upload_mb * 1024 * 1024
    content = await file.read(max_bytes + 1)
    if len(content) > max_bytes:
        raise HTTPException(status_code=413, detail=f"File exceeds {settings.max_upload_mb} MB limit")

    # Lightweight signature validation; production should also scan for malware and use object storage.
    valid = (
        (ext == ".pdf" and content.startswith(b"%PDF"))
        or (ext == ".png" and content.startswith(b"\x89PNG\r\n\x1a\n"))
        or (ext in {".jpg", ".jpeg"} and content.startswith(b"\xff\xd8\xff"))
    )
    if not valid:
        raise HTTPException(status_code=400, detail="File signature does not match the selected file type")

    stored = f"{uuid.uuid4().hex}{ext}"
    target = Path(settings.upload_dir) / stored
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(content)

    record = StudentDocument(
        user_id=user.id,
        college_id=user.college_id,
        rule_key=rule_key,
        original_filename=(file.filename or "upload")[:255],
        stored_filename=stored,
        content_type=file.content_type,
        size_bytes=len(content),
        status="Uploaded",
    )
    db.add(record)
    audit(db, user, "document", stored, "uploaded", f"rule={rule_key}")
    db.commit()
    db.refresh(record)
    return {
        "id": record.id,
        "rule_key": record.rule_key,
        "filename": record.original_filename,
        "status": record.status,
        "size_bytes": record.size_bytes,
    }


@app.get("/api/documents")
def list_documents(user: User = Depends(current_user), db: Session = Depends(get_db)):
    query = db.query(StudentDocument).filter_by(college_id=user.college_id)
    if user.role == "student":
        query = query.filter_by(user_id=user.id)
    rows = query.order_by(StudentDocument.created_at.desc()).all()
    return [
        {
            "id": r.id,
            "user_id": r.user_id,
            "rule_key": r.rule_key,
            "filename": r.original_filename,
            "status": r.status,
            "staff_note": r.staff_note,
            "size_bytes": r.size_bytes,
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]


@app.get("/api/documents/{document_id}/file")
def view_document(
    document_id: int,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    query = db.query(StudentDocument).filter_by(
        id=document_id,
        college_id=user.college_id,
    )
    if user.role == "student":
        query = query.filter_by(user_id=user.id)

    doc = query.first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    file_path = Path(settings.upload_dir) / doc.stored_filename
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="Stored file not found")

    return FileResponse(
        path=str(file_path),
        media_type=doc.content_type,
        filename=doc.original_filename,
        content_disposition_type="inline",
    )


@app.delete("/api/documents/{document_id}", status_code=204)
def delete_document(
    document_id: int,
    user: User = Depends(require_roles("student")),
    db: Session = Depends(get_db),
):
    doc = db.query(StudentDocument).filter_by(
        id=document_id,
        user_id=user.id,
        college_id=user.college_id,
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    file_path = Path(settings.upload_dir) / doc.stored_filename
    audit(db, user, "document", doc.id, "deleted", f"rule={doc.rule_key}")
    db.delete(doc)
    db.commit()

    try:
        file_path.unlink(missing_ok=True)
    except OSError:
        pass
    return None


@app.get("/api/queue")
def get_queue(slot_date: str | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    day = slot_date or date.today().isoformat()
    rows = db.query(QueueToken).filter_by(
        college_id=user.college_id, slot_date=day
    ).order_by(QueueToken.token_number).all()
    return [
        {
            "id": r.id,
            "token_number": r.token_number,
            "student_name": db.get(User, r.user_id).full_name if db.get(User, r.user_id) else "Student",
            "user_id": r.user_id,
            "slot_date": r.slot_date,
            "status": r.status,
            "counter": r.counter,
            "mine": r.user_id == user.id,
        }
        for r in rows
    ]


@app.post("/api/queue/tokens")
def create_token(data: QueueCreate, user: User = Depends(require_roles("student")), db: Session = Depends(get_db)):
    if data.slot_date < date.today().isoformat():
        raise HTTPException(status_code=400, detail="Cannot book a past date")
    existing = db.query(QueueToken).filter(
        QueueToken.college_id == user.college_id,
        QueueToken.user_id == user.id,
        QueueToken.slot_date == data.slot_date,
        QueueToken.status.in_(["Waiting", "Called", "In Progress"]),
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="You already have an active token for this date")
    max_token = db.query(func.max(QueueToken.token_number)).filter_by(
        college_id=user.college_id, slot_date=data.slot_date
    ).scalar() or 0
    token = QueueToken(
        college_id=user.college_id,
        user_id=user.id,
        token_number=max_token + 1,
        slot_date=data.slot_date,
        counter=data.counter,
        status="Waiting",
    )
    db.add(token)
    audit(db, user, "queue_token", "new", "created", f"date={data.slot_date}")
    db.commit()
    db.refresh(token)
    return {
        "id": token.id,
        "token_number": token.token_number,
        "slot_date": token.slot_date,
        "status": token.status,
        "counter": token.counter,
    }


def get_token_for_college(token_id, user, db):
    token = db.query(QueueToken).filter_by(
        id=token_id, college_id=user.college_id
    ).first()
    if not token:
        raise HTTPException(status_code=404, detail="Token not found")
    return token


@app.post("/api/queue/tokens/{token_id}/call")
def call_token(token_id: int, user: User = Depends(require_roles("staff", "admin")), db: Session = Depends(get_db)):
    token = get_token_for_college(token_id, user, db)
    if token.status != "Waiting":
        raise HTTPException(status_code=409, detail="Only Waiting tokens can be called")
    token.status = "Called"
    token.updated_at = datetime.now(timezone.utc)
    audit(db, user, "queue_token", token.id, "called")
    db.commit()
    return {"id": token.id, "status": token.status}


@app.post("/api/queue/tokens/{token_id}/start")
def start_token(token_id: int, user: User = Depends(require_roles("staff", "admin")), db: Session = Depends(get_db)):
    token = get_token_for_college(token_id, user, db)
    if token.status != "Called":
        raise HTTPException(status_code=409, detail="Only Called tokens can start")
    token.status = "In Progress"
    token.updated_at = datetime.now(timezone.utc)
    audit(db, user, "queue_token", token.id, "started")
    db.commit()
    return {"id": token.id, "status": token.status}


@app.post("/api/queue/tokens/{token_id}/complete")
def complete_token(token_id: int, user: User = Depends(require_roles("staff", "admin")), db: Session = Depends(get_db)):
    token = get_token_for_college(token_id, user, db)
    if token.status != "In Progress":
        raise HTTPException(status_code=409, detail="Only In Progress tokens can complete")
    token.status = "Completed"
    token.updated_at = datetime.now(timezone.utc)
    audit(db, user, "queue_token", token.id, "hardcopy_received")
    db.commit()
    return {"id": token.id, "status": token.status, "message": "Hardcopy receipt recorded"}


@app.post("/api/queue/tokens/{token_id}/skip")
def skip_token(token_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    token = get_token_for_college(token_id, user, db)
    if user.role == "student" and token.user_id != user.id:
        raise HTTPException(status_code=403, detail="You can only skip your own token")
    if user.role not in ("student", "staff", "admin"):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    if token.status not in ("Waiting", "Called"):
        raise HTTPException(status_code=409, detail="Only Waiting or Called tokens can be skipped")
    token.status = "Skipped"
    token.updated_at = datetime.now(timezone.utc)
    audit(db, user, "queue_token", token.id, "skipped")
    db.commit()
    return {"id": token.id, "status": token.status, "message": "Skipped token history preserved"}


@app.post("/api/queue/tokens/{token_id}/reschedule")
def reschedule_token(token_id: int, data: QueueCreate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    old = get_token_for_college(token_id, user, db)
    if user.role == "student" and old.user_id != user.id:
        raise HTTPException(status_code=403, detail="You can only reschedule your own token")
    if user.role not in ("student", "staff", "admin"):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    if old.status not in ("Skipped", "No-show"):
        raise HTTPException(status_code=409, detail="Only skipped/no-show tokens can be rescheduled")
    if data.slot_date < date.today().isoformat():
        raise HTTPException(status_code=400, detail="Cannot reschedule to a past date")
    new_token_number = (
        db.query(func.max(QueueToken.token_number))
        .filter_by(college_id=user.college_id, slot_date=data.slot_date)
        .scalar() or 0
    ) + 1
    new = QueueToken(
        college_id=user.college_id,
        user_id=old.user_id,
        token_number=new_token_number,
        slot_date=data.slot_date,
        counter=data.counter,
        status="Waiting",
    )
    db.add(new)
    audit(db, user, "queue_token", old.id, "rescheduled", f"new_token={new_token_number};date={data.slot_date}")
    db.commit()
    db.refresh(new)
    return {
        "old_token_id": old.id,
        "new_token_id": new.id,
        "token_number": new.token_number,
        "slot_date": new.slot_date,
        "status": new.status,
    }


@app.get("/api/staff/students")
def staff_students(user: User = Depends(require_roles("staff", "admin")), db: Session = Depends(get_db)):
    students = db.query(User).filter_by(
        college_id=user.college_id, role="student"
    ).order_by(User.full_name).all()
    output = []
    for s in students:
        docs = db.query(StudentDocument).filter_by(
            user_id=s.id, college_id=user.college_id
        ).all()
        output.append({
            "id": s.id,
            "name": s.full_name,
            "admission_number": s.admission_number,
            "email": s.email,
            "document_count": len(docs),
            "documents": [
                {"id": d.id, "rule_key": d.rule_key, "filename": d.original_filename, "status": d.status}
                for d in docs
            ],
        })
    return output


@app.post("/api/staff/students/{student_id}/status")
def update_student_document_status(student_id: int, data: StatusUpdate, user: User = Depends(require_roles("staff", "admin")), db: Session = Depends(get_db)):
    allowed = {"Verified", "Correction Required", "Rejected", "Uploaded"}
    if data.status not in allowed:
        raise HTTPException(status_code=400, detail="Invalid document status")
    doc = db.query(StudentDocument).filter_by(
        id=student_id, college_id=user.college_id
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    doc.status = data.status
    doc.staff_note = data.note[:2000]
    audit(db, user, "document", doc.id, "status_updated", data.status)
    db.commit()
    return {"id": doc.id, "status": doc.status, "staff_note": doc.staff_note}


@app.get("/api/admin/rules")
def admin_rules(user: User = Depends(require_roles("admin")), db: Session = Depends(get_db)):
    rows = db.query(ChecklistRule).filter_by(
        college_id=user.college_id
    ).order_by(ChecklistRule.id).all()
    return [
        {
            "id": r.id,
            "key": r.key,
            "label": r.label,
            "description": r.description,
            "applies_to": r.applies_to,
            "required": r.required,
            "active": r.active,
        }
        for r in rows
    ]


@app.put("/api/admin/rules")
def save_rule(data: RuleInput, user: User = Depends(require_roles("admin")), db: Session = Depends(get_db)):
    if data.applies_to not in {"All", "Fresh", "Renewal", "Hosteller", "Conditional"}:
        raise HTTPException(status_code=400, detail="Invalid applies_to")
    rule = db.query(ChecklistRule).filter_by(
        college_id=user.college_id, key=data.key
    ).first()
    if rule is None:
        rule = ChecklistRule(college_id=user.college_id, key=data.key)
        db.add(rule)
    rule.label = data.label[:240]
    rule.description = data.description[:2000]
    rule.applies_to = data.applies_to
    rule.required = data.required
    rule.active = data.active
    audit(db, user, "checklist_rule", data.key, "saved")
    db.commit()
    return {"key": rule.key, "label": rule.label, "required": rule.required, "active": rule.active}


@app.get("/api/admin/audit")
def admin_audit(user: User = Depends(require_roles("admin")), db: Session = Depends(get_db)):
    rows = db.query(AuditEvent).filter_by(
        college_id=user.college_id
    ).order_by(AuditEvent.created_at.desc()).limit(200).all()
    return [
        {
            "id": r.id,
            "actor_user_id": r.actor_user_id,
            "target_type": r.target_type,
            "target_id": r.target_id,
            "action": r.action,
            "details": r.details,
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]


@app.websocket("/ws/queue")
async def queue_ws(websocket: WebSocket, token: str):
    await websocket.accept()
    try:
        payload = decode_access_token(token)
        with SessionLocal() as db:
            user = db.get(User, int(payload.get("sub", "0")))
            if not user or not user.is_active or user.college_id != payload.get("college_id"):
                await websocket.close(code=1008)
                return
        await websocket.send_json({
            "type": "connected",
            "message": "Queue socket connected; refresh REST data for authoritative state",
        })
        while True:
            await websocket.receive_text()
            await websocket.send_json({
                "type": "heartbeat",
                "at": datetime.now(timezone.utc).isoformat(),
            })
    except (WebSocketDisconnect, Exception):
        return
