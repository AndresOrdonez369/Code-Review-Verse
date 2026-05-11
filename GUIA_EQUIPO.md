# UEFN Code Review — Guía para el Equipo

**Mantenedor:** Andres O.

---

## ¿Qué es esto y por qué lo usamos?

Es una extensión de VS Code que reemplaza el flujo manual de "copiar código, pegar en Slack, escribir contexto a mano" por un atajo de teclado. Cuando termines un cambio que quieres revisar:

1. Seleccionas el código.
2. Presionas `Ctrl+Shift+R`.
3. La extensión lee la versión vieja desde Git automáticamente, computa el diff, llama a la IA para una pre-revisión, y postea todo a `#code-review` con un formato consistente.

**El objetivo es que un code review tarde 30 segundos en mandarlo y 30 segundos en revisarlo**, no 10 minutos en cada lado.

---

## Setup inicial (una vez por persona)

### 1. Tener Git en tu repo de UEFN

Abre PowerShell en la carpeta raíz de tu proyecto UEFN (la que contiene `Plugins/`, `Content/`, etc.):

```powershell
cd "C:\Users\<tu_usuario>\OneDrive\Documents\Fortnite Projects\TG_HavocHotel2_Velociraptor"
```

Verifica si ya hay un `.git`:

```powershell
git status
```

- Si dice algo como `On branch main` o lista archivos: ya está. Salta al paso 2.
- Si dice `not a git repository`: inicializalo:

```powershell
git init
git add .
git commit -m "Baseline antes de empezar a usar code review"
```

Ese commit es tu **baseline**: el "estado revisado y aprobado" inicial. La extensión va a comparar tu trabajo contra esto.

### 2. Instalar la extensión

Andres te entrega un archivo `.vsix` (o lo encuentras en el repo del equipo, donde lo dejemos). Para instalarlo:

```powershell
code --install-extension uefn-code-review-0.2.3.vsix --force
```

Después en VS Code: `Ctrl+Shift+P` → escribir "Reload Window" → Enter.

### 3. Configurar credenciales

`Ctrl+Shift+P` → escribir "Configure Credentials" → Enter.

Te va a pedir tres cosas:

1. **Slack Webhook URL** — Andres te la pasa por DM. Empieza con `https://hooks.slack.com/services/...`
2. **Gemini API Key** — cada uno crea la suya:
   - Ve a https://aistudio.google.com/apikey
   - Login con tu cuenta de Google
   - "Create API key in new project"
   - Copia la key (empieza con `AIza...`)
   - Pégala en VS Code
3. **Tu nombre** — el que va a salir en Slack como autor (ej. "Camilo R", "Juanse", etc.)

Las credenciales se guardan **encriptadas** en VS Code (no quedan en `settings.json` ni se comparten).

### 4. Ajustar settings (recomendado)

`Ctrl+Shift+P` → "Preferences: Open User Settings (JSON)" → agregar:

```json
{
  "uefnCodeReview.geminiModel": "gemini-2.5-flash",
  "uefnCodeReview.diffContextLines": 3,
  "uefnCodeReview.projects": [
    "RH",
    "HH2",
    "HH3",
    "DnD",
    "R&D",
    "RH",
    "Otro",
    
  ],
  "uefnCodeReview.reviewTypes": [
    "Bug Fixed",
    "Bug",
    "New Feature",
    "Refactor",
    "Hotfix",
    "Code Review",
    "Question"
  ]
}
```

Ajusta `projects` y `reviewTypes` según el equipo. El líder técnico (Andres) puede definir la lista canónica y todos copian.

### 5. La guía de estilo Verse

Hay un archivo `.verse-style.md` en la raíz del repo. **NO lo borres.** La IA lo lee como autoridad para revisar tu código. Si encuentras un anti-patrón nuevo en review, lo agregas ahí y la próxima revisión lo aplica automáticamente.

---

## Conceptos que tienes que entender 

### Conceptos 1 — ¿Qué es Git HEAD?

Git guarda *snapshots* del estado de tu código. Cada `git commit` crea un snapshot nuevo. **HEAD** es el snapshot más reciente.

```
[Commit A] ← HEAD apunta aquí
    ↓
[Commit B]
    ↓
[Commit C]
    ↓
... más viejos
```

Cuando trabajas en tu archivo y lo modificas (sin committear), Git ve dos cosas:

- **Versión nueva** (working tree): lo que tienes en el editor
- **Versión vieja** (HEAD): el último snapshot

El "diff" es la diferencia entre las dos. Eso es lo que va a Slack.

### Concepto 2 — Sesión de review

Una **sesión** es un grupo de snippets que se mandan juntos en un mismo mensaje de Slack. Un snippet es un bloque de código que seleccionaste. Cuando trabajas en una feature que toca varios archivos, cada cambio relevante es un snippet, y todos van juntos en una sesión.

El status bar abajo a la derecha te muestra `👁 Review (3)` cuando tienes 3 snippets pendientes en la sesión.

### Concepto 3 — ¿Cuándo committear?

**No después de cada cambio.** El patrón correcto es:

```
1. Trabajas (sin committear).
2. Mandas code review con la extensión.
3. Reviewer aprueba (✅ en Slack).
4. AHORA SÍ committeas:
       git add .
       git commit -m "DD-2645: damage value capped at 4.00 fix"
5. Vuelves a trabajar — el siguiente review diffea contra ESTE nuevo commit.
6. Es importante que tengas en cuenta que si subes el snapshot en UEFN, con los nuevos cambios, ese sera tu nuevo head.
```

Cada commit marca **"estado revisado por humano y aprobado"**. Entre commits, todo lo que hagas se acumula como cambios pendientes.

**Variantes válidas:**
- Si no quieres esperar a la aprobación, commiteas al final del día. Pierdes algo de granularidad pero está bien.
- Si trabajas en una feature grande, commiteas al cerrar el ticket de Jira.

**Lo importante:** committea en momentos donde el código ESTÉ ESTABLE. Si pasaste un día tocando 5 cosas a la vez sin committear, tu próximo diff vs HEAD va a ser enorme y confuso.

### Concepto 4 — ¿Qué seleccionar al hacer Ctrl+Shift+R?

**La función completa o el bloque lógico que cambiaste.** No solo la línea exacta que tocaste.

**Por qué función completa:**
1. El reviewer necesita ver el contexto. Una línea sola no le dice nada.
2. La IA necesita la firma de la función para detectar problemas (race conditions, leaks, parámetros mal usados).
3. El diff Slack-style va a marcar SOLO las líneas que cambiaron con `+` y `-`. Las demás salen sin marca (contexto). Así que aunque selecciones 30 líneas y solo hayas cambiado 2, el diff visible muestra claramente cuáles son las 2.

**Ejemplo correcto:**

```verse
OnTimer1Finished(MaybeAgent:?agent):void=     ← desde aquí
    if(Cancelable:=TimerCancelable?):
        Cancelable.Cancel()
        TimerDevice2.Start()
        Cancelable2:=TimerDevice2.SuccessEvent.Subscribe(OnTimer2Finished)
        set TimerCancelable = option{Cancelable2}    ← hasta aquí
```

Selecciona desde la firma `OnTimer1Finished(...)` hasta la última línea del cuerpo. Eso es 1 snippet bien hecho.

**Ejemplo incorrecto:**

```verse
        Cancelable.Cancel()    ← solo seleccionas esto
```

El reviewer no sabe ni en qué función está. La IA tampoco.

---

## Workflow básico — un solo cambio

Caso típico: cambiaste una función. Quieres mandarla a review.

### Paso 1 — Seleccionar

Abre el archivo. Selecciona la función completa (`Shift+↓` para extender, o click + drag).

### Paso 2 — `Ctrl+Shift+R`

Sale un QuickPick:

```
✓ Use Git diff (recommended)        +5 -2
                                    Auto-detected from your working tree vs HEAD.
📋 Use clipboard                    "<lo que tengas copiado>"
⊘ No old code                       Send only the new selection (no diff)
```

**Presiona Enter** para usar Git (la opción recomendada). Verás los stats: `+5 -2` significa "se agregaron 5 líneas, se quitaron 2 en tu selección".

### Paso 3 — Nota

Aparece un input box: "Optional note for this snippet (what / why)". Escribe algo corto y útil:

```
Migrated to option{} to avoid silent fail when GetTeam returns false
```

**Buena nota:** explica el **por qué** del cambio.
**Mala nota:** *"updates"*, *"fix"*, *""*.

Si presionas Enter sin escribir nada, el snippet va sin nota (no es ideal — escribe la nota).

### Paso 4 — Decidir

```
[Send Review]  [Add Another]  [Discard All]
```

- **Send Review:** abre los prompts de metadata (paso 5).
- **Add Another:** lo deja en cola y vuelves al editor para agregar otro snippet.
- **Discard All:** descarta todo (cuidado).

Si es un solo snippet, click "Send Review".

### Paso 5 — Metadata

Te van a pedir 8 campos:

1. **Type** → `Bug Fixed` / `New Feature` / `Refactor` / etc. — pick por flecha + Enter.
2. **Project** → `Programming` / `DnD` / etc.
3. **Title** → 1 línea descriptiva. Ejemplo: `"Damage value capped at 4.00 in UI"`.
4. **Ticket** → ID de Jira (`DD-2645`) o URL completo. Ambos funcionan.
5. **Size** → `XS` / `S` / `M` / `L` / `XL`.
6. **Summary bullets** → uno por uno. Enter vacío para terminar.
7. **Tested in** → `UEFN Session` / `UEFN Editor` / `Local` / `Manual`.
8. **Testers** → tu nombre. Si probó alguien más, agrega su nombre separado por coma.

### Paso 6 — Espera

Notificación: *"AI pre-review 1/1: audio_manager.verse"* — la IA está revisando. Tarda 1-3 segundos.

Cuando termine: *"Code review posted to Slack"*. Listo.

### Paso 7 — Verifica en Slack

Abre `#code-review`. Tu mensaje debe verse así:

```
[DnD] [Bug Fixed] Damage value capped at 4.00 in UI

Author: Camilo  ·  Size: S  ·  Tested in: UEFN Session  ·  Testers: Camilo

Ticket: DD-2645    ← link clickeable

Summary
• Migrated damage calc to 2-decimal format

📦 1 snippet  ·  ℹ️ AI overall: LOW
─────────────────────────────────────
Snippet 1/1  ·  …/Content/audio_manager.verse  ·  Lines 100-120  ·  verse  ·  +5 -2

Note: Migrated to option{} to avoid silent fail when GetTeam returns false

```diff
   GetPlayerDamage(Player:player)<decides>:float =
       Data := PlayerData[Player]
-      Damage := Data.BaseDamage * Data.Multiplier
+      RawDamage := Data.BaseDamage * Data.Multiplier
+      Damage := FormatTwoDecimals(RawDamage)
       return Damage
```

ℹ️ AI Pre-review — LOW — Refactor preserves logic, naming improved.
   • [low] Consider extracting "%.2f" format into a constant
   _Suggestions:_
   • Move FormatTwoDecimals to math_utils.verse for reuse

React  ✅ approve · 🔁 request changes · 👀 reviewing · 💬 comment in thread
─────────────────────────────────────
```

---

## Workflow avanzado — multi-snippet

Caso: hiciste cambios en varios archivos relacionados. Por ejemplo, agregaste una nueva feature que toca `audio_manager.verse`, `ui_widget.verse`, y `config.verse`. Quieres que se revisen juntos.

### Flujo

1. **Snippet 1** — abre `audio_manager.verse`, selecciona la función nueva, `Ctrl+Shift+R`, "Use Git diff", nota, **"Add Another"**.
2. **Snippet 2** — abre `ui_widget.verse`, selecciona la función nueva, `Ctrl+Shift+R`, "Use Git diff", nota, **"Add Another"**.
3. **Snippet 3** — abre `config.verse`, selecciona los cambios, `Ctrl+Shift+R`, "Use Git diff", nota, **"Send Review"**.
4. Llena los metadata UNA SOLA VEZ (project, title, ticket, etc.) — aplica a los 3 snippets.
5. La IA revisa cada snippet por separado.
6. Slack recibe **un solo mensaje** con los 3 snippets formateados como secciones, separados por divisores, y con su veredicto IA propio cada uno.

El reviewer ve toda la feature de un vistazo en un solo hilo, no en 3 mensajes diferentes.

### Cuándo NO usar multi-snippet

- Si los cambios son **independientes** (ej. arreglaste un bug en audio Y otro bug en UI sin relación). Mejor manda 2 reviews separados.
- Si el cambio es **gigante** (>5 snippets). Eso indica que estás mezclando demasiadas cosas. Divide en feature más pequeñas.

**Regla de oro:** un review = un PR/ticket conceptual. Si reviewer aprueba, todos los snippets se mergen juntos. Si reviewer pide cambios, todo el review queda bloqueado.

---

## Cómo leer un Code Review (para reviewers)

Cuando llega un mensaje a `#code-review`, escanea en este orden — toma 30 segundos:

### 1. Header (5s)

```
[DnD] [Bug Fixed] Damage value capped at 4.00 in UI
Author: Camilo · Size: S · Tested in: UEFN Session
```

¿Es algo que me toca revisar (mi área)? ¿Cuánto va a tomar (size)? ¿Está testeado?

### 2. Veredicto IA agregado (5s)

```
📦 1 snippet  ·  ℹ️ AI overall: LOW
```

- `LOW` o `none`: probablemente es seguro, scan rápido.
- `MEDIUM`: hay algo notable, lee con atención.
- `HIGH`: hay un bug o riesgo importante. Lee TODO con cuidado.
- `🚨 HIGH`: parar y leer, urgente.

### 3. Summary y Notes (5s)

¿Tiene sentido el "qué" y el "por qué"? Si la nota dice *"updates"* o no hay nota, pídela en thread antes de revisar.

### 4. Diff (10s)

Lee las líneas verdes (`+`) y rojas (`-`). Las grises (` `) son contexto, scan rápido. Pregúntate:

- ¿El cambio hace lo que dice la nota?
- ¿Hay edge cases que no se cubrieron?
- ¿Sigue la guía de estilo?

### 5. AI Pre-review por snippet (5s)

```
ℹ️ AI Pre-review — LOW — Refactor preserves logic.
   • [low] Consider extracting %.2f format
```

Si el AI flagea algo y tú estás de acuerdo, comenta en thread o reacciona 🔁. Si no, lo ignoras.

### 6. Reaccionar

- **✅** = aprobado, puede mergear (el autor procede a `git commit`).
- **🔁** = pide cambios. Comenta en thread qué cambiar.
- **👀** = "yo me lo llevo" — reservas el review para que otros sepan.
- **💬** = "tengo dudas" — pregunta en thread sin bloquear.

**Sin "lgtm" ni "looks good" en thread.** La reacción ✅ ES la aprobación. Mantenemos el canal limpio.

---

## Reglas para reviews efectivos

### Como autor

1. **Una idea por review.** Si tu cambio no se puede explicar en 1 oración, está mal scope. Divide.
2. **Siempre escribe la nota del snippet.** "Updates" no cuenta.
3. **No mandes con AI severity ≥ MEDIUM sin abordarlo.** Arregla primero, o explica explícitamente por qué la IA está equivocada en la nota.
4. **Selecciona la función completa, no solo la línea.** El reviewer necesita contexto.
5. **Size honestamente.** XL = "esto debí dividirlo".
6. **Después de aprobado, committea.** Que tu HEAD siempre refleje "código revisado".

### Como reviewer

1. **Apunta a 30 segundos por snippet.** El sistema está hecho para eso. Si te toma más, falló algo.
2. **Reacciona ✅ o 🔁 — nada en medio.** Sin "lgtm but..." — eso es 🔁.
3. **Comentarios concretos en thread.** "Esto está mal" no sirve. "Cambia X por Y porque Z" sí.
4. **Si el AI flagea HIGH, lee con atención.** No asumas que es ruido.
5. **Si encuentras un anti-patrón nuevo, sugiere agregarlo a `.verse-style.md`** (o hazlo tú con un PR).

### Como equipo

1. **`#code-review` es solo para mensajes de la extensión.** No conversaciones generales.
2. **Threads para discusión, reacciones para decisiones.** El estado de un review se ve a primera vista en las reacciones.
3. **`.verse-style.md` evoluciona.** Cada anti-patrón nuevo encontrado se agrega. La IA mejora con el equipo.

---

## FAQ

### ¿Por qué mi diff muestra todo el código como `+`?

**Causa más común:** la versión vieja (HEAD) no tiene esa función / archivo, porque nunca lo committeaste. Cuando seleccionas y mandas, Git correctamente dice "esta función entera es nueva vs HEAD".

**Fix:** committea más seguido. Si trabajaste en `function_X` por 2 semanas sin committear, el diff vs HEAD va a mostrar 200 líneas de `+`. Si committeas al final de cada review aprobado, el siguiente diff solo muestra los cambios desde entonces.

### ¿Puedo mandar a review código sin haber committeado nada?

Sí. La extensión funciona aunque no hayas committeado. Pero sin baseline, **todo** se ve como nuevo. Recomendación: haz un commit baseline al empezar a usar la herramienta (`git init && git add . && git commit -m "baseline"`).

### Si mi archivo no está trackeado por Git, ¿qué pasa?

El QuickPick solo te muestra opciones de "Clipboard" o "No old code". No puedes usar Git diff. Para fixearlo: `git add archivo.verse && git commit -m "track this file"`.

### ¿Tengo que committear cada vez que termine un review?

No es obligatorio, pero es la mejor práctica. Beneficios:

- Diffs limpios y pequeños en el siguiente review.
- Historia clara de "qué se aprobó y cuándo".
- Si rompes algo, tienes el `git log` para hacer rollback.

Si no committeas, el siguiente review va a incluir cambios viejos junto con los nuevos.

### ¿Qué pasa si el código ya está committeado?

Si hiciste un cambio, `git commit`, y luego `Ctrl+Shift+R`, la extensión NO va a encontrar diff (porque tu working tree = HEAD ya). Te va a decir "Git found but no changes". Solución: lo desreviewas (`git reset --soft HEAD~1`), mandas a review, y al aprobarse vuelves a committear.

**O mejor:** committea SOLO después de aprobado, no antes. Así el flujo natural funciona sin malabares.

### Si el diff sale enorme, ¿qué hago?

Probablemente tu selección incluye demasiados cambios acumulados. Opciones:

1. **Divide en snippets más pequeños.** Selecciona solo una función a la vez.
2. **Reduce el contexto:** en settings, baja `uefnCodeReview.diffContextLines` de 3 a 1 o 0.
3. **Si tienes 200 líneas de cambios genuinos:** size es L o XL. Manda igual, pero el reviewer va a tomar más tiempo.

### ¿Cómo cambio el modelo de IA?

Settings → `uefnCodeReview.geminiModel`. Default es `gemini-2.5-flash` (gratis, rápido, calidad decente). Si quieres mejor calidad: `gemini-2.5-flash-lite`. **NO uses modelos con `pro` en el nombre — requieren billing.**

### ¿Por qué la IA no corrió en mi review?

Tres posibilidades:

1. **No configuraste tu API key.** Corre `Configure Credentials`.
2. **Pusiste un modelo que no funciona** (ej. Pro sin billing). Cambia a `gemini-2.5-flash`.
3. **Hit el rate limit** (15 req/min, 1500 req/día). Espera.

Para diagnosticar: `Ctrl+Shift+U` → dropdown "UEFN Code Review" → busca líneas `[ERROR]`.

### El status bar dice "Review (3)" pero no me acuerdo qué tengo encolado

`Ctrl+Shift+P` → "Show Pending Review" — te abre un QuickPick listando los snippets con su archivo, líneas y nota. Desde ahí puedes Send Review o Discard All.

### Quiero borrar un snippet específico de la sesión

Por ahora no se puede borrar uno solo — solo "Discard All" y empezar de cero. Es una mejora futura.

### ¿Puedo personalizar la lista de proyectos / tipos / tested in?

Sí. Settings → `uefnCodeReview.projects` / `reviewTypes` / `testedInOptions` — son arrays de strings. Edítalos en `settings.json`.

### ¿Funciona en Mac también?

Sí. Los atajos son `Cmd+Shift+R` (en vez de `Ctrl+Shift+R`). Todo lo demás idéntico.

---

## Troubleshooting

### "Slack responded 404"

El webhook fue revocado. El lead debe regenerarlo en Slack y compartir la nueva URL. Cada dev corre `Configure Credentials` y pega la nueva.

### "Pre-review failed: API key not valid"

Tu Gemini key está mal copiada o expiró. Crea otra en https://aistudio.google.com/apikey y reconfigura.

### "Pre-review failed: limit: 0"

Seleccionaste un modelo de pago. Cambia `uefnCodeReview.geminiModel` a `gemini-2.5-flash`.

### Slack pinta el diff sin colores

Slack solo aplica rojo/verde a líneas que empiezan con `+ ` o `- `. Si tu diff sale sin colores, probablemente el bloque no es de tipo `diff`. Verifica el OutputChannel para ver el texto crudo y reporta a Andres.

### Mi `Ctrl+Shift+R` no hace nada

Tres causas:

1. **No tienes selección activa.** Selecciona texto primero.
2. **La extensión no está activa.** `Ctrl+Shift+P` → "Code Review: Show Pending Review" — si el comando no aparece, la extensión no está cargada. Reinstala el `.vsix`.
3. **Otro atajo está conflictuando.** Settings → Keybindings → busca "Ctrl+Shift+R" — si hay otro binding, deshabilítalo.

### El status bar nunca muestra "Review (n)"

Solo aparece cuando hay snippets pendientes. Si presionaste `Ctrl+Shift+R` y el snippet se agregó pero el badge no sale, reinstala la extensión.

### "Cancelled during metadata collection"

Le diste Esc en uno de los prompts. Vuelve a hacer `Ctrl+Shift+Alt+R` para enviar la sesión que quedó pendiente.

---

## Checklist diaria del autor

Antes de mandar un review:

- [ ] Hice commit baseline alguna vez en este repo.
- [ ] Mi cambio se puede explicar en una oración.
- [ ] Seleccioné la función o bloque completo, no solo la línea.
- [ ] Voy a escribir una nota concreta explicando el porqué.
- [ ] Si hay AI severity ≥ MEDIUM, voy a abordarlo o explicarlo.
- [ ] Size honesta (XS / S / M / L / XL).
- [ ] Después de aprobado, voy a `git commit` para marcar el nuevo baseline.

## Checklist diaria del reviewer

Cuando ves un review en `#code-review`:

- [ ] Lo escaneé en menos de 1 minuto.
- [ ] Reaccioné con ✅ o 🔁 (no dejé en visto).
- [ ] Si reaccioné 🔁, comenté en thread qué cambiar.
- [ ] Si encontré un anti-patrón nuevo, sugerí agregarlo a `.verse-style.md`.

---

## Para el lead  — administración

### Distribuir una nueva versión

1. Editar el código en `extension/src/`.
2. `npm run compile && npm run package`.
3. El `.vsix` queda en la carpeta. Subirlo al repo del equipo o compartir por DM.
4. Cada dev corre `code --install-extension <archivo>.vsix --force`.

### Actualizar la guía de estilo

Editar `.verse-style.md` en el repo. Commit. Cada dev hace `git pull`. La próxima review automáticamente usa la versión nueva como autoridad para la IA.

### Rotar webhook de Slack

Si el webhook se compromete:

1. Slack admin → app "UEFN Code Review" → revoca webhook.
2. Crea uno nuevo.
3. Comparte la URL nueva al equipo (DM cifrado / 1Password).
4. Cada dev corre `Configure Credentials` para actualizar.

### Métricas / observabilidad

No tenemos backend, así que no hay métricas centralizadas. Cada dev ve su propio Output Channel. Si quieres agregar métricas, sería un proyecto aparte (out of scope por ahora).

---

## Versiones

- **v0.2.3** (current) — fix de scoping de diff, contexto configurable, esta guía
- **v0.2.2** — auto-detección desde Git
- **v0.2.1** — clipboard preview, manejo de URLs en ticket, surface AI failures
- **v0.2.0** — multi-snippet sessions, diff real, status bar widget
- **v0.1.x** — versiones iniciales single-snippet

---

*Última actualización: 2026-05-05. Si encuentras un problema o tienes una sugerencia / DM a Andres.*
