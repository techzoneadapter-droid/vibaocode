# Vibaocode Project Context

## Product
Vibaocode is a lightweight personal AI coding workspace for users who prefer to direct software changes through prompts instead of writing code manually.

## Core workflow
1. Read source code from GitHub.
2. Open and review one file at a time.
3. Show a mobile preview beside the code.
4. Ask an AI coding agent to modify the selected file.
5. Review the proposed change before applying it.
6. Push the approved change back to GitHub.

## Product principles
- Review-first: AI changes must never be pushed automatically.
- Mobile-first: preview and UI should make mobile review easy.
- Lightweight: avoid heavy browser IDE dependencies when a simpler UI works.
- Source ownership: GitHub remains the source of truth.
- Secrets: never commit API keys, cookies, access tokens, or passwords.
- Official integrations only: use provider APIs/OAuth rather than automating consumer account sessions.
- Preserve unrelated behavior when editing files.
- Prefer small, reversible edits.
- Accessibility and responsive layout are required.

## Current
- Public GitHub repository reading without a token.
- Fine-grained GitHub token for private repositories and writes.
- File tree and plain text/code editor.
- Review view comparing current GitHub file and draft/AI proposal.
- Safe review branches created from the UI.
- Pull requests opened from the UI after reviewed changes are pushed.
- Mobile preview using an external URL or the currently opened HTML file.
- OpenAI-powered single-file editing with selectable coding/general models.
- Session-only credential storage in the browser.

## Planned next
- GitHub OAuth/App connection.
- Multi-file AI agent.
- Vercel preview deployments and automatic preview URLs.
- Visual click-to-component review.
- Screenshot annotations.
- Multi-agent coder/reviewer/tester workflow.
- Additional official AI providers.
- Cloud sandbox for npm install, tests and build logs.
