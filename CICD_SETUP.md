# CI/CD Setup for Healthcare App

## Hugging Face Spaces Deployment (Docker SDK)

This app uses **Docker SDK** for Hugging Face Spaces deployment.

### Required GitHub Secrets
1. `HF_TOKEN` - Your Hugging Face access token (write permission)
2. `HF_SPACE_NAME` - Your space name (e.g., `username/healthcare-app`)

### How to Get HF Token
1. Go to https://huggingface.co/settings/tokens
2. Create a new token with **write** permissions
3. Add to GitHub repo: Settings → Secrets → Actions

### Docker SDK Configuration
The `Dockerfile` is configured for HF Spaces:
- Uses Python 3.10 slim base image
- Exposes port **7860** (required by HF Spaces)
- Runs Streamlit with CORS/XSRF disabled for HF compatibility

### README.md Frontmatter
The `README.md` contains required YAML frontmatter:
```yaml
---
title: HospAI
emoji: 🏥
colorFrom: blue
colorTo: red
sdk: docker
pinned: false
license: mit
---
```

### Deployment
Push to `main` branch triggers automatic deployment to HF Spaces.
