FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends gcc libc6-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
RUN pip install --no-cache-dir .
CMD ["uvicorn", "copick_web.app.main:app", "--host", "0.0.0.0", "--port", "8000"]
