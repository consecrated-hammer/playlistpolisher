# Playlist Polisher

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/Docker-Ready-blue.svg)](docker-compose.yml)

**A modern, self-hosted Spotify playlist management tool**

Sort, clean, and organize your Spotify playlists with a beautiful Spotify-themed UI.

[Features](#features) • [Quick Start](#quick-start) • [Spotify Setup](#spotify-developer-app-setup) • [Configuration](#configuration) • [Contributing](#contributing)

</div>

---

## Features

- **Smart Playlist Sorting** - Sort by artist, album, title, date added, or custom order
- **Duplicate Detection & Removal** - Find and remove duplicates with intelligent matching
- **Track Caching** - Fast playlist loading with local track cache
- **Scheduled Operations** - Automate sorting and cleaning tasks
- **In-App Playback** - Play music directly in the app (Spotify Premium)
- **Background Jobs** - Long operations run asynchronously with progress tracking
- **Spotify-Themed UI** - Beautiful, familiar interface matching Spotify's design

## Quick Start

### Prerequisites

- Docker (20.10+) and Docker Compose (v2.0+)
- Spotify account (free or premium)
- Spotify Developer App credentials ([setup below](#spotify-developer-app-setup))

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/consecrated-hammer/playlistpolisher.git
cd playlistpolisher

# 2. Configure environment
cp .env.example .env
nano .env  # Add your Spotify credentials (see setup below)

# 3. Generate a secure secret key
openssl rand -hex 32  # Copy output to SECRET_KEY in .env

# 4. Start the application
docker compose up -d

# 5. Access at http://localhost:8001
```

### Using Pre-built Images

```bash
# Pull and run pre-built images from GitHub Container Registry
docker pull ghcr.io/consecrated-hammer/playlistpolisher:latest
docker compose up -d
```

---

## Spotify Developer App Setup

Playlist Polisher requires Spotify API credentials. Here's how to get them:

### 1. Create Spotify Developer App

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Log in with your Spotify account
3. Click **"Create app"**

### 2. Fill in App Details

- **App name**: `Playlist Polisher` (or any name)
- **App description**: `Personal playlist management tool`
- **Website**: `https://github.com/consecrated-hammer/playlistpolisher` (optional)
- **Redirect URIs**: 
  - For local: `http://localhost:8000/auth/callback`
  - For custom domain: `https://yourdomain.com/auth/callback`
  - ⚠️ **Must match exactly** what you put in `.env`
- **API/SDKs**: Select **Web API**
- Accept terms and click **Save**

### 3. Get Your Credentials

- **Client ID**: Copy from the app dashboard
- **Client Secret**: Click "View client secret" and copy

### 4. Add to Your .env File

```bash
SPOTIFY_CLIENT_ID=your_client_id_here
SPOTIFY_CLIENT_SECRET=your_client_secret_here
SPOTIFY_REDIRECT_URI=http://localhost:8000/auth/callback
SECRET_KEY=your_generated_secret_key_here
```

### Important Notes

- **Development Mode**: Your app runs in Spotify's Development Mode (up to 25 users) - perfect for personal use
- **Keep secrets private**: Never commit `.env` to version control
- **HTTPS required**: For public hosting, use HTTPS and update redirect URI accordingly

---

## Configuration

### Required Environment Variables

```bash
# Spotify API Credentials
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
SPOTIFY_REDIRECT_URI=http://localhost:8000/auth/callback

# Security (generate with: openssl rand -hex 32)
SECRET_KEY=your_random_64_character_hex_string

# Application URLs
FRONTEND_URL=http://localhost
BACKEND_API_URL=http://localhost:8001
```

### Optional Variables

```bash
# Database
PLAYLISTPOLISHER_DB_PATH=/data/playlist_polisher.db

# Cache settings
TRACK_CACHE_TTL_DAYS=30

# CORS (for custom domains)
FRONTEND_ALLOWED_ORIGINS=http://localhost,https://yourdomain.com

# Primary domain (for multi-domain setups)
DOMAIN_PRIMARY=yourdomain.com
```

See [.env.example](.env.example) for all options with descriptions.

---

## Usage

1. **Login** - Click "Login with Spotify" and authorize the app
2. **View Playlists** - See all your playlists in the library
3. **Sort Playlists** - Select sorting criteria and options
4. **Remove Duplicates** - Analyze and remove duplicate tracks
5. **Schedule Operations** - Automate regular playlist maintenance

---

## Updating

```bash
# Pull latest changes
git pull origin main

# Rebuild and restart
docker compose up --build -d

# Or with pre-built images
docker compose pull
docker compose up -d
```

**Always backup first:**
```bash
docker compose down
cp .data/playlist_polisher.db .data/playlist_polisher.db.backup
```

---

## Development

### Local Development Setup

```bash
# Clone the repo
git clone https://github.com/consecrated-hammer/playlistpolisher.git
cd playlistpolisher

# Backend setup
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8001

# Frontend setup (new terminal)
cd frontend
npm install
npm run dev  # Runs on http://localhost:5173
```

### Tech Stack

**Backend:** FastAPI, Python 3.12, SQLite, Spotipy  
**Frontend:** React 18, Vite 5, Tailwind CSS 3  
**Infrastructure:** Docker, Nginx

### Project Structure

```
playlistpolisher/
├── backend/app/          # FastAPI application
│   ├── routes/           # API endpoints
│   ├── services/         # Business logic
│   ├── db/               # Database models & operations
│   └── utils/            # Session & token management
├── frontend/src/         # React application
│   ├── components/       # UI components
│   ├── pages/            # Route pages
│   ├── services/         # API client
│   └── context/          # Global state
└── docker-compose.yml    # Container orchestration
```

---

## Security

- **OAuth 2.0** authentication with Spotify
- **HTTP-only** secure session cookies
- **No token exposure** to frontend
- Session and job data encrypted in SQLite

### Reporting Vulnerabilities

Report security issues to: **playlistpolisher@gmail.com**

See [SECURITY.md](SECURITY.md) for details.

---

## Troubleshooting

### Authentication Issues

- Verify `SPOTIFY_REDIRECT_URI` matches your Spotify app settings exactly
- Check Client ID and Secret are correct
- Clear browser cookies and retry

### View Logs

```bash
docker compose logs -f backend
docker compose logs -f frontend
```

### Reset Database

```bash
docker compose down
docker volume rm playlistpolisher_data
docker compose up -d
```

---

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Quick Contribution Steps

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes
4. Test thoroughly
5. Submit a pull request

Report bugs and request features via [GitHub Issues](https://github.com/consecrated-hammer/playlistpolisher/issues).

---

## License

This project is licensed under the MIT License - see [LICENSE](LICENSE) for details.

---

## Disclaimer

Playlist Polisher is an independent tool and is not affiliated with, endorsed by, or sponsored by Spotify AB.

**Development Status:** This app runs on Spotify's Development Mode API (limited to 25 users). Perfect for personal use and small groups.

---

<div align="center">

**Built for the self-hosting community**

⭐ Star this project if you find it useful!

</div>