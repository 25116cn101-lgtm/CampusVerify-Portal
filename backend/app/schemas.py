from pydantic import BaseModel, Field, ConfigDict

class LoginInput(BaseModel):
    identifier: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=1, max_length=200)

class UserOut(BaseModel):
    id: int
    email: str
    admission_number: str | None
    full_name: str
    role: str
    college_id: str
    model_config = ConfigDict(from_attributes=True)

class QueueCreate(BaseModel):
    slot_date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    counter: str = Field(default="Main Counter", max_length=60)

class StatusUpdate(BaseModel):
    status: str
    note: str = ""

class RuleInput(BaseModel):
    key: str
    label: str
    description: str = ""
    applies_to: str = "All"
    required: bool = True
    active: bool = True
