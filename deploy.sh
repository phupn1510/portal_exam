#!/bin/bash

# IOE Quiz Portal - Quick Deploy Script
# Usage: ./deploy.sh

echo "🚀 IOE Quiz Portal Deployment"
echo "================================"

# Check if git is initialized
if [ ! -d ".git" ]; then
    echo "❌ Git not initialized. Run: git init"
    exit 1
fi

# Check for GitHub remote
if ! git remote get-url origin &> /dev/null; then
    echo "❌ No GitHub remote. Create a repo and add remote:"
    echo "   git remote add origin https://github.com/username/repo.git"
    exit 1
fi

echo ""
echo "📋 Deployment Steps:"
echo ""
echo "1. BACKEND (Railway)"
echo "   - Go to https://railway.app"
echo "   - New Project → Deploy from GitHub"
echo "   - Select 'backend' folder"
echo "   - Add env vars: PORT=3001, OPENAI_API_KEY=..., FRONTEND_URL=..."
echo "   - Deploy and copy URL"
echo ""
echo "2. FRONTEND (Vercel)"
echo "   - Go to https://vercel.com"
echo "   - New Project → Import from GitHub"
echo "   - Select 'frontend' as root directory"
echo "   - Add env var: NEXT_PUBLIC_API_URL=<backend-url>/api"
echo "   - Deploy"
echo ""
echo "3. TEST"
echo "   - Visit your Vercel URL"
echo "   - Upload a PDF"
echo "   - Take a quiz and test AI explanations"
echo ""

read -p "Press Enter to open Railway..."
open https://railway.app
