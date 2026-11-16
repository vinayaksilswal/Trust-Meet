from conviya.config import settings
from conviya.main import app


app.state.dedicated_worker = settings.environment == "production"
