FROM python:3.11-slim

WORKDIR /app/symptom_backend

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY symptom_backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY symptom_backend/ ./

RUN adduser --disabled-password --gecos "" appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 5002
CMD ["gunicorn", "-w", "2", "-b", "0.0.0.0:5002", "app:app"]
