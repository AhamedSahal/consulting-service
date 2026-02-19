# Push Backend to GitHub

This repo is ready to push to its own GitHub repository.

1. **Create a new repo on GitHub** (e.g. `hr-consulting-ai-service`). Do **not** initialize with README.

2. **Add remote and push** (replace `YOUR_USERNAME` and repo name):

```bash
cd "d:\DATA\tuscan\consulting\cunsulting-agent-service"
git remote add origin https://github.com/YOUR_USERNAME/hr-consulting-ai-service.git
git branch -M main
git push -u origin main
```

Deploy the backend to Railway, Render, or Fly.io (not Vercel). Set `FRONTEND_URL` to your Vercel frontend URL.
