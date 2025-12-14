Deploying on Render

Quick steps:

1. Create a new Web Service on Render and link your repository (GitHub/GitLab).
2. Set the build command: `pip install -r requirements.txt`
3. Set the start command: `gunicorn app:app --bind 0.0.0.0:$PORT --workers 3`
4. Ensure the `requirements.txt`, `Procfile`, and `render.yaml` are present in the repo root.
5. Add any environment variables if needed (none required by default).

Notes:
- Render will provide `PORT` environment variable. The app reads `$PORT` when starting.
- FFmpeg must be available on the instance; Render does not provide FFmpeg by default. You have two options:
  1. Use a custom build step to download a static ffmpeg binary into the project during the build phase (advanced).
  2. Use a Render private service with a Dockerfile that includes FFmpeg installation (recommended for reliable FFmpeg availability).

Docker option (recommended): create a `Dockerfile` that installs FFmpeg and runs `gunicorn app:app`.

Example quick Dockerfile snippet:

```
FROM python:3.11-slim
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . /app
RUN pip install -r requirements.txt
CMD ["gunicorn", "app:app", "-b", "0.0.0.0:$PORT", "--workers", "3"]
```

If you want, I can add a `Dockerfile` to this repo and wire `render.yaml` to use Docker instead — tell me if you prefer that route.
