FROM python:3.11-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
COPY services/api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && useradd --system --uid 10001 conviya
COPY services/api/alembic.ini .
COPY services/api/migrations migrations
COPY services/api/conviya conviya
USER conviya
EXPOSE 8000
CMD ["uvicorn", "conviya.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
