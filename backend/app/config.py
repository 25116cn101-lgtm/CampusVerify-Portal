from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    database_url: str = "sqlite:///./campusverify.db"
    jwt_secret: str = "development-only-change-this-secret"
    access_token_minutes: int = 30
    cors_origins: str = "http://localhost:5173"
    max_upload_mb: int = 10
    upload_dir: str = "./private_uploads"
    seed_demo: bool = False
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

settings = Settings()
