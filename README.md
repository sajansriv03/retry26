# Wacky West Online (2–4 players)

This repo is set up so you can deploy **one service** and get a permanent host domain where players can join by link.

## Fastest deploy (minimal work): Render Blueprint

### 1) Push this repo to GitHub

### 2) Create Render account and deploy
- Go to: https://render.com/
- Click **New +** → **Blueprint**
- Select your GitHub repo
- Render will detect `render.yaml` and create the service automatically

### 3) Wait for deploy to finish
Render will run:
- `npm install && npm run build`
- `npm run server`

### 4) Use your host URL
Render gives you a URL like:
- `https://wacky-west-online.onrender.com`

That URL is your host domain. Share it with players.

---

## How players join
1. Each player opens the domain URL.
2. Register/login.
3. Host creates room.
4. Host shares room link shown in lobby (`?room=<code>`).
5. Others open that room link and join.
6. Host starts game.

---

## Local dev
```bash
npm install
npm run server      # backend at :8787
npm run dev         # frontend at :5173 (proxy /api -> :8787)
```

Or:
```bash
npm run dev:all
```

---

## Important note on “always-on free hosting”
Most free hosts (including Render free) may sleep after inactivity.
If you need strict always-on uptime, use a paid instance/VPS.
