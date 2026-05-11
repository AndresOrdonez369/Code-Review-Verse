# 🚀 UEFN Code Review — VS Code Extension

A VS Code extension designed specifically for Unreal Editor for Fortnite (UEFN) development teams. It replaces the manual workflow of "copying code, pasting into Slack, and manually typing context" with a fast, standardized keyboard shortcut.

**The Goal:** A code review should take 30 seconds to send and 30 seconds to review.

## ✨ Key Features

- **Frictionless Workflow:** `Cmd/Ctrl + Shift + R` shortcut on your active selection.
- **Git Auto-Detection:** Automatically computes the diff against the Git HEAD (perfect for coexisting with Unreal Revision Control - URC).
- **Multi-Snippet Sessions:** Groups changes from multiple files into a single structured review message.
- **AI Pre-review (Google Gemini):** Analyzes code for anti-patterns and bugs before a human reviewer sees it.
- **Living Style Guide:** Reads the `.verse-style.md` file from the workspace and uses it as the strict authority for the AI.
- **Slack Integration (Two Modes):**
  - *Bot Token (Recommended):* Keeps the channel clean by posting the main metadata and grouping all AI feedback into a **thread**.
  - *Incoming Webhook:* Simple mode with AI feedback inline in the main message.
- **Quick Approvals:** Via native Slack reactions (✅ approve, 🔁 request changes, 👀 reviewing).
- **Native Security:** Credentials are saved in VS Code's `SecretStorage` (native encryption, nothing in plain text).

---

## 📚 Team Documentation Hub

If you are part of the studio and looking for how to use this tool in your daily workflow, check out our internal guides (included in this repository):

1. 📖 [GUIA_EQUIPO.md](./GUIA_EQUIPO.md) — Mandatory reading. How to make effective reviews, golden rules, and how to read diffs.
2. 🔀 [URC_Y_GIT.md](./URC_Y_GIT.md) — How Git and URC coexist (Clipboard Route vs. Git Route).
3. 🔄 [UPDATE.md](./UPDATE.md) — Release notes and changelog (v0.2.9+).

---

## 🛠️ Installation and Setup (Users)

### 1. Install the Extension
You can compile it locally or install the `.vsix` package distributed by the team:

```bash
code --install-extension uefn-code-review-0.2.8.vsix --force
```

### 2. Configure Credentials

- In VS Code, open the Command Palette (Cmd/Ctrl + Shift + P) and run:

Code Review: Configure Credentials

- It will ask you to choose between Bot Token mode (Threads) or Webhook mode. You will need:

- The Slack Token or Webhook URL (provided by the Lead).

- Your Google Gemini API Key (free via AI Studio).

- Your author name.

### 3. Configure Workspace (settings.json)
Open your user settings in VS Code and add this block to standardize the options across the studio:

```bash
JSON
{
  "uefnCodeReview.geminiModel": "gemini-2.5-flash",
  "uefnCodeReview.useGitForOldCode": true,
  "uefnCodeReview.diffContextLines": 3,
  "uefnCodeReview.projects": [
    "RH", "HH2", "HH3", "DnD", "R&D", "Otro"
  ],
  "uefnCodeReview.reviewTypes": [
    "Bug Fixed", "Bug", "New Feature", "Refactor", "Hotfix", "Code Review", "Question"
  ],GIT AD
  "uefnCodeReview.author": "Your Name Here"
}
```

## 💻 Local Development (Maintainers)

If you want to modify the extension or compile a new version:

### 1. Environment Setup
Clone this repository and install dependencies:

```bash
npm install
npm run compile
```

### 2. Code Structure


```bash
Code-Review-Verse/
├── package.json           # VS Code Manifest (commands, keybindings, settings)
├── tsconfig.json
├── .verse-style.md        # Canonical style guide for the studio
├── GUIA_EQUIPO.md         # Usage documentation
├── URC_Y_GIT.md           # Version control flows documentation
└── src/
    ├── extension.ts       # Activation + command registration
    ├── diff.ts            # Diff logic, LCS, and hunk extension (v0.2.8+)
    ├── gemini.ts          # Google Gemini API integration
    ├── originalContent.ts # Fetches HEAD from Git or Clipboard
    ├── prompts.ts         # System prompts injected into the AI
    ├── session.ts         # Multi-snippet session management in memory
    ├── slack.ts           # Block Kit UI and POST to Slack (Bot Token & Webhook)
    ├── statusBar.ts       # UI for the pending reviews bottom widget
    ├── styleGuide.ts      # Reads the .verse-style.md from the workspace
    └── types.ts           # TypeScript interfaces and types
```

### 3. Package a New Version

To generate the .vsix file for distribution:

```bash
npm run package
```

This will generate a uefn-code-review-x.x.x.vsix file in the root directory, ready to be shared.

## 🐛 Troubleshooting & Support
- The shortcut Ctrl+Shift+R does nothing? Ensure you have an active text selection in your .verse or .py file before triggering the command.

- AI Pre-review failed? Open the VS Code Output Panel (Ctrl+Shift+U) and select UEFN Code Review from the dropdown menu to see detailed logs. This is usually caused by an invalid/expired API key or hitting the rate limit.

- Diff shows the entire file as green (+)? You likely haven't committed your base file to Git. Run git add . && git commit -m "baseline" to establish your HEAD.

## 🗺️ Roadmap
[ ] Full support for Python (.python-style.md).

[ ] Local developer metrics (average severity, reviews sent per sprint).

[ ] Direct integration with URC API (if Epic Games exposes it in the future).

## 🤝 Contributing & Feedback

This tool is actively maintained to improve our studio's workflow. If you encounter bugs, have feature requests, or want to suggest a new rule for the .verse-style.md, please reach out to Andres O. via DM on Slack or open a discussion in the repository.