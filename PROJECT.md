# Vibaocode Project Context

## Product
Vibaocode is a lightweight personal AI coding workspace for users who prefer to direct software changes through prompts instead of writing code manually.

## Core workflow
1. Read source code from GitHub.
2. Start the project in an isolated cloud sandbox.
3. Keep a mobile preview beside the code.
4. Ask an AI coding agent to find and modify the relevant files.
5. Watch compatible cloud-agent changes appear in the running preview.
6. Run automated lint/test/build/smoke checks and browser play tests.
7. Review diffs before pushing.
8. Push to a safe review branch and open a pull request.

## Product principles
- Review-first: AI changes must never be pushed automatically.
- Mobile-first: preview and UI should make mobile review easy.
- Lightweight client: heavy execution happens in cloud sandboxes, not on the user's PC.
- Source ownership: GitHub remains the source of truth.
- Secrets: never commit API keys, cookies, access tokens, or passwords.
- Official authentication only: use provider-supported device login, OAuth, API keys, or supported CLI authentication. Never scrape consumer browser cookies.
- Preserve unrelated behavior when editing files.
- Prefer small, reversible edits.
- Accessibility and responsive layout are required.

## Current
- Public GitHub repository reading without a token.
- Fine-grained GitHub token for private repository reads/writes.
- File tree and plain text/code editor.
- Safe review branches and pull requests from the UI.
- Project Mode that finds and proposes edits across multiple files.
- OpenAI API project/file editing.
- Official ChatGPT/Codex device login in a persistent Vercel Sandbox.
- Codex account agent can edit the cloud working tree, run checks, and return changed files for review.
- Claude API and Gemini API Project Mode adapters.
- Persistent Vercel Sandbox cloud runtime for public repositories.
- Run button starts the project automatically in the sandbox.
- Review starts the project automatically if it is not already running.
- Live Sync mirrors draft file changes into the running sandbox after a short debounce.
- Auto Test runs available lint/test/build scripts plus an HTTP smoke test.
- AI Play Test launches a browser, performs safe UI/canvas interactions, records console/page errors, and captures screenshots.
- Live AI Play Test streams the current test frame into the phone preview while the browser tester is working, then exposes a replay.
- Session-only credential storage in the browser when credentials are entered through Settings.

## Current limitations
- Cloud Run currently clones public GitHub repositories. Private repositories can still be edited through the GitHub API, but private-repo Sandbox clone/run is not enabled yet.
- ChatGPT/Codex is the first direct subscription/account login.
- Claude and Gemini are currently available through official API keys. Gemini's official headless guidance favors API keys or Vertex AI instead of interactive Google-account login.
- Browser play testing is heuristic. It safely clicks visible controls and game canvas points; project-specific scripted test missions will be added later.
- AI Play Test live view is a screenshot stream, not a full remote desktop/VNC session.

## Planned next
- GitHub App/OAuth instead of manually entering a token.
- Private GitHub repo clone/run in Sandbox using short-lived GitHub App installation tokens.
- Project-specific test missions and reusable QA scripts.
- Coder -> Tester -> Reviewer repair loop with bounded automatic retries.
- Visual click-to-component review and screenshot annotations.
- More official coding-agent account connections where their provider supports remote/headless authentication.
- Multi-agent session history and per-project memory.
