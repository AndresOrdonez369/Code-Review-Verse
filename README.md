# UEFN Code Review — VS Code Extension

Selecciona código en VS Code, presiona un atajo y se postea a Slack con un pre-review de IA opcional.

## Características

- Atajo `Cmd/Ctrl + Shift + R` sobre selección activa.
- Post a Slack vía Incoming Webhook (sin backend, sin servidor).
- Pre-review IA opcional con Google Gemini (free tier: 1500 req/día).
- Lee `.verse-style.md` del workspace y lo usa como autoridad para el pre-review.
- Aprobación vía reacciones de Slack: ✅ aprobar, 🔁 cambios, 👀 revisando.
- Credenciales en SecretStorage de VS Code (cifrado nativo, no en `settings.json`).

## Instalación (modo dev)

```bash
cd extension
npm install
npm run compile
```

Para empaquetar:

```bash
npm run package    # genera uefn-code-review-0.1.0.vsix
```

Instalar el `.vsix`:

```bash
code --install-extension uefn-code-review-0.1.0.vsix
```

O en VS Code: `Extensions → ⋯ → Install from VSIX...`

## Configuración inicial

Una vez instalada, abre la paleta (`Cmd+Shift+P`) y corre:

```
Code Review: Configure Credentials
```

Te pedirá:
1. **Slack Incoming Webhook URL** — ver `../SETUP.md` para crearla.
2. **Gemini API Key** — opcional, ver `../SETUP.md`. Deja vacío para deshabilitar IA.
3. **Tu nombre** — se mostrará como autor en Slack.

## Uso

1. Selecciona código en cualquier archivo `.verse` o `.py`.
2. Presiona `Cmd+Shift+R` (o `Ctrl+Shift+R` en Windows/Linux).
3. Opcionalmente describe el contexto (Enter sin texto si no aplica).
4. La extensión corre el pre-review IA (si está habilitado) y postea a Slack.

Para enviar saltándote la IA: paleta → `Code Review: Send for Code Review (skip AI pre-review)`.

## Estructura

```
extension/
├── package.json           # Manifest VS Code (commands, keybindings, settings)
├── tsconfig.json
└── src/
    ├── extension.ts       # Activación + comandos
    ├── slack.ts           # Block Kit + POST a webhook
    ├── gemini.ts          # Llamada a Gemini con responseSchema
    ├── styleGuide.ts      # Lee .verse-style.md del workspace
    ├── prompts.ts         # System prompts por lenguaje
    └── types.ts
```

## Settings disponibles

| Key                                  | Default                  | Descripción                                |
|--------------------------------------|--------------------------|--------------------------------------------|
| `uefnCodeReview.author`              | `""`                     | Nombre mostrado en Slack                   |
| `uefnCodeReview.enableAiPreReview`   | `true`                   | Toggle global del pre-review IA            |
| `uefnCodeReview.styleGuidePath`      | `.verse-style.md`        | Path relativo al workspace para Verse      |
| `uefnCodeReview.geminiModel`         | `gemini-2.0-flash-exp`   | Modelo Gemini a usar                       |

## Roadmap

- [ ] Soporte para `.python-style.md`
- [ ] Comando "diff against last commit" (cuando se integre con URC)
- [ ] Selector de canal de Slack (múltiples webhooks)
- [ ] Métricas locales: cuántos reviews por dev, severidad promedio
