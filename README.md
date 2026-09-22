# Vibaocode

A lightweight AI-assisted coding workspace that keeps GitHub as the source of truth and puts a mobile preview beside code review.

## V1 features

- Read a public GitHub repository without a token.
- Read private repositories with a fine-grained GitHub token.
- Browse repository files and edit text/code.
- Ask OpenAI to propose a full-file replacement using a selectable model.
- Review changes before applying them.
- Create a safe review branch before editing.
- Push approved changes to the review branch and open a pull request.
- Review a deployed app in a mobile device frame.
- Preview a selected standalone HTML file immediately.
- Load project guidance from `PROJECT.md`.
- Keep GitHub/OpenAI credentials in browser session storage only when entered through the UI.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Environment

Copy `.env.example` to `.env.local` if you want the server to provide the OpenAI key instead of entering it per browser session.

```env
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.3-codex
```

The UI can also accept an OpenAI API key for the current browser session.

## GitHub access

Public repository reads work without authentication. To write changes or access a private repository, create a fine-grained GitHub personal access token with access only to the repositories you want Vibaocode to manage.

Do not commit access tokens or API keys.

## Deploy

The project is designed for Vercel/Next.js deployment.

After deploying, set `OPENAI_API_KEY` and optionally `OPENAI_MODEL` in the deployment environment if you do not want to paste a key into the UI.

## Current limitation

The current version edits the currently selected file. It does not yet run the target repository inside a cloud sandbox. For application preview, paste an existing Vercel/GitHub Pages preview URL, or open a standalone HTML file.

See `PROJECT.md` for the roadmap.
