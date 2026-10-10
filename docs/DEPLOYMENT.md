# Deployment Guide

[Repository README](../README.md) · [Frontend guide](FRONTEND_GUIDE.md) · [Interface contract](INTERFACE_CONTRACT.md)

## Purpose and architecture

The SRTF Simulator is one **Flask web service**. Flask serves `static/index.html`, CSS, and JavaScript, and exposes `POST /simulate` on the same origin. The scheduling engine runs in Python (`engine.py`); browser controls only replay its results. There is **no database, session storage, authentication system, or separate frontend host** to configure.

## Local development

Requires Python 3.10+ and a modern browser:

```sh
python -m venv .venv
python -m pip install -r requirements.txt
python app.py
```

Activate `.venv` before installing dependencies if you use a virtual environment. `python app.py` listens on `127.0.0.1:5000` and is appropriate for local Windows development. Open http://127.0.0.1:5000. Do not open `static/index.html` using a `file://` URL, as `/simulate` will not be available.

## Render deployment

**Project-listed demo address:** https://srtf-simulator.onrender.com (check live availability separately; the link itself does not certify uptime).

1. In the Render dashboard, create a **Web Service**, connect the GitHub repository `Furina-star/srtf-simulator`, and select `main`.
2. Set **Language/Runtime** to Python; leave **Root Directory** empty (repository root).
3. Select the free instance if suitable for the project.
4. Use the following commands:

| Setting | Value |
|---|---|
| Build command | `pip install -r requirements.txt` |
| Start command | `gunicorn app:app --bind 0.0.0.0:$PORT` |
| Branch | `main` |
| Runtime dependencies | `Flask`, `gunicorn` from `requirements.txt` |

5. Deploy the service. Look for a successful build **and** a running service. A successful build alone does not mean deployment is complete.
6. Open the resulting HTTPS URL. Use **Load Sample → Run SRTF → Jump to End** and check the reference averages (WT 6.50, TAT 13.00, RT 4.25).

The command `gunicorn app:app` identifies `app.py` and its Flask variable `app`. `--bind 0.0.0.0:$PORT` lets Render route incoming requests to its assigned port. No edit to `app.py` is necessary for this deployment.

### Why Gunicorn is necessary

The Flask development server started by `python app.py` is meant for local use. Gunicorn is the production WSGI server for the Render/Linux deployment. Gunicorn is not a supported native Windows command; use `python app.py` on Windows for local demonstrations.

### Free-tier behavior

An inactive free instance may sleep, causing a delay when the next user visits. Availability, quotas, and sleep behavior are controlled by the hosting provider and may change. Load the website shortly before the presentation; a closed Render dashboard or powered-off personal computer does not by itself stop a successfully deployed cloud service.

## Redeployment

With auto-deploy enabled on Render, commits reaching the configured `main` branch trigger redeployment. Prefer feature branches and pull requests; ensure the GitHub Actions checks pass before merging. Do not store tokens, passwords, or private configuration in the repository. There are **no app-specific environment variables** required by the current source code. Render provides `$PORT` for the server bind.

## Troubleshooting

| Symptom | Likely cause | Action |
|---|---|---|
| `gunicorn: command not found` / exit 127 | Gunicorn missing from installed dependencies | Ensure `requirements.txt` contains `gunicorn`, rebuild, and redeploy |
| Build succeeds but service doesn't become live | Startup command/port issue | Check service logs and use the exact Gunicorn start command above |
| Browser shows a page but Run fails | `/simulate` is unreachable | Confirm the Flask Web Service is running and frontend is served from that same service |
| Initial visit is slow | Free instance waking after inactivity | Allow time for startup and retry |
| HTTP 400 from `/simulate` | Invalid input or workload past the 10,000-unit limit | Read the JSON error and verify [input rules](INTERFACE_CONTRACT.md#input-rules) |
| HTTP 413 | Request body exceeds 16 KiB | Reduce request size |
| Local Windows `gunicorn` fails | Unsupported native Windows setup | Run `python app.py` locally instead |
| Site shows old source | Deploy pending, cache, or wrong branch | Check deployment commit and refresh browser |

## Automated checks versus actual hosting

The repository's GitHub Actions workflow runs Python tests, an engine self-check, JS syntax validation, and Node frontend tests. The default Node run **skips seven optional live-HTTP cases** unless `SRTF_TEST_URL` is set. CI passing does not verify Render uptime or actual browser appearance. See [the frontend guide](FRONTEND_GUIDE.md) for a manual browser review checklist.
