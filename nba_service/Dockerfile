FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py ./

ENV PYTHONUNBUFFERED=1
EXPOSE 8080

CMD ["sh", "-c", "gunicorn -b 0.0.0.0:${PORT:-8080} app:app --workers 1 --threads 2 --timeout 120 --graceful-timeout 120"]
