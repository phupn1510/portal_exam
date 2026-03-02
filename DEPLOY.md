# IOE Quiz Portal - Deployment Guide

## Architecture

```
┌─────────────────┐         ┌─────────────────┐
│   Vercel       │         │   Railway/      │
│   (Frontend)   │────────▶│   Render        │
│   Next.js      │         │   (Backend)     │
└─────────────────┘         └─────────────────┘
```

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Git](https://git-scm.com/)
- [Vercel Account](https://vercel.com/)
- [Railway Account](https://railway.app/)

---

## Option 1: Railway + Vercel (Recommended)

### Step 1: Deploy Backend to Railway

1. **Push code to GitHub**
   ```bash
   cd /Users/dn-plg-a0683/Documents/mock_exam/portal
   git init
   git add .
   git commit -m "Initial commit"
   # Create repo on GitHub and push
   ```

2. **Deploy on Railway**
   - Go to [Railway](https://railway.app/)
   - Click "New Project" → "Deploy from GitHub"
   - Select your repository
   - Select the `backend` folder
   - Add Environment Variables:
     - `PORT`: 3001
     - `OPENAI_API_KEY`: your-openai-key
     - `GEMINI_API_KEY`: your-gemini-key
     - `FRONTEND_URL`: your-vercel-url (e.g., https://your-app.vercel.app)
   - Click "Deploy"

3. **Get Backend URL**
   - After deployment, Railway provides a URL like: `https://your-backend.railway.app`

### Step 2: Deploy Frontend to Vercel

1. **Go to [Vercel](https://vercel.com/)**
2. Click "New Project" → "Import Git Repository"
3. Select your repository
4. Configure:
   - Framework Preset: Next.js
   - Root Directory: `frontend`
5. Add Environment Variables:
   - `NEXT_PUBLIC_API_URL`: https://your-backend.railway.app/api
6. Click "Deploy"

---

## Option 2: All on Vercel (Serverless)

For simpler setup, convert the backend to API routes:

### Create API routes in frontend

```bash
cd frontend/src/app/api
```

Create route files for each endpoint:
- `api/pdf/route.ts`
- `api/quiz/route.ts`
- `api/ai/route.ts`

Note: OCR functionality requires serverless function with higher timeout.

---

## Environment Variables

### Backend (.env)
```
PORT=3001
NODE_ENV=production
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=...
FRONTEND_URL=https://your-frontend.vercel.app
```

### Frontend (.env)
```
NEXT_PUBLIC_API_URL=https://your-backend.railway.app/api
```

---

## Post-Deployment

1. **Test the API**
   ```bash
   curl https://your-backend.railway.app/api/health
   ```

2. **Upload a PDF**
   - Visit your frontend
   - Upload a test PDF
   - Verify questions are parsed

3. **Test AI**
   - Take a quiz
   - Click "🤖 Giải thích AI"
   - Verify explanation appears

---

## Troubleshooting

### Backend Issues
- Check Railway logs: Railway Dashboard → Deploy → Logs
- Verify environment variables are set
- For OCR issues, consider using a separate worker

### Frontend Issues
- Check Vercel logs: Vercel Dashboard → Functions → Logs
- Verify NEXT_PUBLIC_API_URL is correct
- Ensure CORS is configured on backend

### Common Errors
- "Connection refused" → Backend URL incorrect
- "CORS error" → Add frontend URL to FRONTEND_URL env var
- "PDF parsing failed" → Check PDF is valid, < 50MB
