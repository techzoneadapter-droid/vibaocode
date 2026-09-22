# Vibaocode

Vibaocode is a lightweight, review-first AI coding workspace that keeps GitHub as the source of truth while running heavy code, previews, and tests in cloud sandboxes.

## Main workflow

```
GitHub
  -> Load project
  -> Run in Vercel Sandbox
  -> Prompt AI agent
  -> Live mobile preview
  -> Auto Test / AI Play Test
  -> Review diff
  -> Review branch
  -> Push
  -> Pull Request
```

## Current features

- GitHub repository browser and code editor.
- Public repository reads without a token.
- Fine-grained GitHub token support for private reads and writes.
- Safe review branches and pull requests.
- Project Mode for multi-file AI edits.
- OpenAI API coding mode.
- Official ChatGPT/Codex device authentication and subscription-backed coding agent.
- Claude API Project Mode using Anthropic Messages API.
- Gemini API Project Mode using Gemini structured output.
- Persistent Vercel Sandbox runtime for public repositories.
- Run and Review automatically start the target project.
- Live Sync sends draft edits into the running sandbox.
- Mobile preview from the sandbox dev-server URL.
- Auto Test for lint, test, build, and HTTP smoke checks.
- AI Play Test with safe browser interactions, canvas/game clicks, error collection, live screenshot frames, and replay.
- Credentials entered in Settings stay in browser session storage and are never committed to Git.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Environment

```env
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.3-codex
```

The app can also accept provider keys in Settings for the current browser session.

## Cloud runtime

Vibaocode uses `@vercel/sandbox`. On Vercel deployments, Sandbox authentication uses the deployment's Vercel identity/OIDC automatically.

The cloud runtime currently clones public GitHub repositories. Private repositories can still be read/edited using the GitHub API, but private Sandbox clone/run is a roadmap item.

## AI authentication

### ChatGPT / Codex

Vibaocode uses Codex's official device login flow inside a persistent cloud workspace. It does not read ChatGPT browser cookies.

### OpenAI API

Enter an OpenAI API key in Settings or configure `OPENAI_API_KEY` on the server.

### Claude

Project Mode supports Anthropic API keys and uses Claude Sonnet 4.6.

### Gemini

Project Mode supports Gemini API keys and uses Gemini structured JSON output. For remote/headless environments, API-key or Vertex authentication is preferred over browser Google-account sign-in.

## GitHub access

Public repository reads work without authentication. For writes/private repositories, create a fine-grained GitHub token restricted to the repositories Vibaocode should manage.

Do not commit access tokens or AI provider keys.

## Safety

- AI edits are review-first and are not pushed automatically.
- Coding agents run inside isolated cloud sandboxes.
- Account connections use official provider-supported authentication, not cookie/session scraping.
- Browser play testing skips controls with destructive labels such as delete, purchase, logout, or reset.

See `PROJECT.md` for current limitations and roadmap.


## Cloud runtime
- Run automatically installs project dependencies and starts the development server in a persistent Vercel Sandbox.
- ChatGPT/Codex login automatically installs and caches the official Codex CLI, then shows the device authorization code in Settings.
- Auto Test runs typecheck/lint/test/build when available plus an HTTP smoke test.
- AI Play uses a cached Chromium/Playwright runner, captures live frames, clicks safe UI controls and performs drag gestures on canvas games.
