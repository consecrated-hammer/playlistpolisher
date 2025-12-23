# Contributing to Playlist Polisher

Thank you for your interest in contributing! This guide will help you get started.

## Code of Conduct

- Be respectful and considerate
- Accept constructive criticism gracefully
- Focus on what's best for the project
- Show empathy towards other contributors

## How to Contribute

### Reporting Bugs

Check existing issues first, then create a new issue including:

- Clear title and description
- Steps to reproduce
- Expected vs actual behavior
- Environment details (browser, OS, Docker version)
- Relevant logs

### Suggesting Features

- Search existing issues/discussions first
- Describe the feature and its use case
- Explain why it would be valuable
- Consider implementation challenges

### Submitting Code

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make your changes (see [Coding Standards](#coding-standards))
4. Test thoroughly
5. Commit with clear messages (see [Commit Guidelines](#commit-messages))
6. Push to your fork: `git push origin feature/your-feature`
7. Open a Pull Request

## Development Setup

### Prerequisites

- Docker and Docker Compose
- Git
- Spotify Developer account with API credentials

### Quick Start

```bash
# Clone and setup
git clone https://github.com/yourusername/playlistpolisher.git
cd playlistpolisher
cp .env.example .env
# Edit .env with your Spotify credentials

# Start with Docker
docker compose up --build

# Access application
# Frontend: http://localhost
# Backend API: http://localhost:8001
# API Docs: http://localhost:8001/docs
```

### Backend Development (without Docker)

```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8001
```

### Frontend Development (without Docker)

```bash
cd frontend
npm install
npm run dev  # Runs on http://localhost:5173
```

## Coding Standards

### Python (Backend)

- Follow PEP 8
- Use type hints
- Write docstrings for functions/classes
- Keep functions focused and single-purpose

```python
from typing import Optional

async def get_playlist(playlist_id: str) -> Optional[dict]:
    """Retrieve playlist details from Spotify API."""
    # Implementation
```

### JavaScript/React (Frontend)

- Use functional components with hooks
- Follow existing component patterns
- Use Tailwind CSS for styling (match existing patterns)
- Keep components small and focused

```jsx
const PlaylistCard = ({ playlist, onClick }) => {
  return (
    <div className="bg-spotify-gray-dark rounded-lg p-4">
      <h3 className="text-white">{playlist.name}</h3>
    </div>
  );
};
```

### Commit Messages

Use conventional commits format:

```
<type>: <description>

[optional body]
```

**Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

**Examples:**
```
feat: add duplicate detection
fix: resolve session expiry issue
docs: update installation steps
```

## Testing

```bash
# Backend tests
cd backend && pytest

# Frontend tests
cd frontend && npm test
```

## Pull Request Guidelines

- Keep PRs focused on a single feature/fix
- Update documentation for new features
- Add tests for new functionality
- Ensure all tests pass
- Follow the existing code style

## Questions?

- Open an issue for questions
- Check existing discussions
- Reach out to maintainers

Thank you for contributing! 🎵