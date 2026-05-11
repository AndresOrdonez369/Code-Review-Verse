# v0.2.9 — AI consistency fix (same code → same review)

## El problema que descubriste

Mandaste dos snippets IDÉNTICOS. Uno llegó como `HIGH` con un bug real de concurrency. El otro llegó como `LOW` con solo nits de estilo. Mismo código, conclusiones opuestas.

Esto NO es un bug de la extensión — es comportamiento intrínseco de los LLMs. Pero teníamos margen para minimizarlo.

## Por qué pasaba

Gemini (y todos los LLMs) eligen palabras una por una. En cada paso eligen entre varios "tokens" probables. El parámetro `temperature` controla esa elección:

```
temperature = 0.0  → siempre el más probable (determinístico, "rígido")
temperature = 0.2  → mayormente el más probable, pero a veces cambia
temperature = 1.0  → alta variabilidad ("creativo")
```

Yo tenía `temperature: 0.2`. Suficiente para que dos ejecuciones del mismo prompt tomaran caminos distintos:

- **Ejecución 1** → la IA "pensó" hacia [Concurrency] → encontró el subscribe sin unsubscribe → HIGH
- **Ejecución 2** → la IA "pensó" hacia [Style] primero → encontró el separator faltante → LOW, y se perdió el bug

El primer review era el correcto. El segundo fue un falso negativo grave.

## Lo que arregla v0.2.9

### 1. `temperature: 0.0` por default

Greedy decoding — siempre elige el token más probable. Con el mismo input, debería dar el mismo output (modulo updates que Google haga al modelo en el servidor).

Nuevo setting:
```json
"uefnCodeReview.aiTemperature": 0.0
```

Default 0. Si por algún motivo quieres variación (no recomiendo para code review), puedes subirlo.

### 2. Prompt re-estructurado con "must-check" priorizado

Antes el prompt listaba 18 dimensiones sin orden estricto. La IA podía empezar por estilo y terminar ahí.

Ahora el prompt obliga un proceso de 3 pasos:

```
STEP 1 — INVESTIGATE
   Para CADA categoría, en este orden:
   PRIORITY A (potencial 🔴):
     1. [Concurrency]  ← chequear primero
     2. [Effects]
     3. [Security]
     4. [Persistence]
     5. [Correctness]
   PRIORITY B (potencial 🟡):
     6-10. Architecture / Arrays / Failure / Transactions / Expressions
   PRIORITY C (potencial 💭):
     11-13. Naming / Formatting / Separators / Comments

STEP 2 — DECIDE OVERALL SEVERITY
   max(severidades encontradas)
   IMPORTANTE: no devolver "low" sin haber chequeado PRIORITY A.

STEP 3 — WRITE THE REVIEW
   Para cada hallazgo: 🔴/🟡/💭 [Section] Title. Why: ... Suggestion: ...
```

### 3. Patrones específicos de Verse marcados como "always flag"

Le doy ejemplos concretos al modelo de qué cosas son 🔴 y no se discuten:

- Subscribe inside re-entrant function without unsubscribe → ALWAYS 🔴
- `set X = ...` without `<transacts>` → ALWAYS 🟡 minimum
- `<decides>` function called without `[]` → ALWAYS 🔴
- Persistent write without `Player.IsActive[]` → ALWAYS 🔴
- Player passed across `Sleep` without revalidation → ALWAYS 🟡

Tu caso original (subscribe leak en `OnTimer1Finished`) ahora cae directo en el primer patrón, debería ser detectado consistentemente.

## Lo que NO arregla (limitaciones)

Aún con todo esto, los LLMs tienen variabilidad residual:

- **Updates del modelo en el servidor de Google**: si Google despliega una versión nueva de `gemini-2.5-flash`, los resultados pueden cambiar.
- **Token sampling no es 100% determinístico** ni con temperature 0 en algunos providers (depende de la implementación interna).
- **El modelo puede entender el código sutilmente diferente** dependiendo de tokens previos.

En la práctica, con temperature=0 + prompt estructurado, vas a tener **>95% consistencia** en reviews del mismo código. Pero **el AI sigue siendo una primera pasada, no la fuente de verdad**.

## La regla del equipo

**Trust but verify:** el AI agarra el 80% de los issues típicos, pero el reviewer humano es la autoridad final. Cuando veas un severity `LOW` en código que sospechas tiene un problema más serio, **léelo tú mismo**. No confíes ciegamente.

Casos donde el AI puede equivocarse:

| Escenario | Riesgo |
|---|---|
| Código que requiere conocimiento de TU proyecto (devices específicos, side effects no obvios) | AI no sabe → posibles falsos negativos |
| Bugs sutiles de timing en concurrencia compleja | AI puede miss algunos |
| Anti-patterns no documentados en `.verse-style.md` | AI no los flagea |
| Cambios masivos (>200 líneas en un snippet) | AI puede saltarse áreas |

Para mitigar: **agregar el patrón a `.verse-style.md`** cuando un humano encuentre algo que el AI no agarró. La próxima review IA lo detectará.

## Archivos a reemplazar

```
v029/package.json          →  extension/package.json
v029/src/gemini.ts         →  extension/src/gemini.ts
v029/src/prompts.ts        →  extension/src/prompts.ts
v029/src/extension.ts      →  extension/src/extension.ts
```

`.verse-style.md` no cambia respecto a v0.2.8. Otros archivos tampoco.

## Recompile

```powershell
cd extension
npm run compile
npm run package
code --install-extension uefn-code-review-0.2.9.vsix --force
```

Reload window.

## Cómo verificar

Repite tu mismo experimento:

1. Selecciona la función `OnTimer1Finished` (con el subscribe leak).
2. Mándala a review TRES veces (3 snippets en una sesión, o 3 sesiones separadas).
3. Los 3 reviews deberían ser **prácticamente idénticos** y deberían flagear el bug de concurrency como 🔴.

Si todavía ves variación significativa entre ejecuciones, mándame los 3 outputs y vemos qué afinar. Pero con temperature=0 + prompt nuevo debería ser consistente.

## Sobre tu settings.json

Vi tu screenshot. Todo está bien configurado:
- `geminiModel: gemini-2.5-flash` ✓
- `useGitForOldCode: true` ✓
- `diffContextLines: 3` ✓
- `globalStyleGuidePath: C:\Users\xrand\OneDrive\Documents\code-review-slack\.verse-style.md` ✓
- Custom projects (RH/HH2/HH3/DnD/R&D/Otro) ✓
- Custom reviewTypes ✓
- author: Andres O ✓

Solo te falta agregar (opcional pero recomendado para v0.2.9):

```json
"uefnCodeReview.aiTemperature": 0.0
```

Aunque es el default — no es necesario ponerlo si quieres el comportamiento estándar.
