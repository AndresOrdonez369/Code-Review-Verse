# URC + Git: cómo conviven (o cómo evitar Git completamente)

Este documento responde la pregunta que probablemente te está dando vueltas: **"¿Si URC es nuestro VCS de verdad, para qué Git?"**

## Recomendación corta

**Usa Git solo si te comprometes a la disciplina.** Si no, desactívalo y usa el flujo clipboard desde la vista de diff de URC. Ambos caminos son de primera clase.

---

## Las dos rutas

### Ruta A — Sin Git (recomendada para empezar)

Más simple, menos cosas que mantener. URC sigue siendo el único VCS.

**Setup:**
1. En tu `settings.json`:
   ```json
   "uefnCodeReview.useGitForOldCode": false
   ```
2. Listo. La extensión ni siquiera intenta consultar Git.

**Workflow:**
1. Modificas `audio_manager.verse`.
2. Abres el panel **Source Control** (icono de ramitas en la sidebar).
3. URC ya muestra `audio_manager.verse (Modified)`.
4. Click en el archivo → se abre la vista de diff de VS Code (dos columnas).
5. Click en el panel IZQUIERDO (la versión URC HEAD).
6. Selecciona la función vieja → `Ctrl+C`.
7. Vuelves al editor con tu archivo modificado.
8. Selecciona la función nueva.
9. `Ctrl+Shift+R`.
10. QuickPick: el preview te muestra los primeros 70 caracteres de tu clipboard. Verifica que es la versión vieja correcta.
11. Selecciona "Use clipboard". Continúa con nota → metadata → IA → Slack.

**Trade-offs:**
- ✓ Cero overhead de Git
- ✓ URC es la fuente de verdad única
- ✓ El diff vs el panel URC es siempre correcto
- ✗ Un paso manual (copiar la versión vieja) por cada snippet

**Esta es la ruta que recomiendo si:**
- Tu equipo nunca ha usado Git en este repo
- No quieres mantener dos VCSes en sync
- Prefieres confiabilidad sobre velocidad

---

### Ruta B — Con Git (auto-detección)

Más rápida pero requiere disciplina. Git vive **paralelo** a URC, no lo reemplaza.

**Setup:**
1. En la raíz del proyecto:
   ```powershell
   cd "C:\Users\<tu>\OneDrive\Documents\Fortnite Projects\<tu_proyecto>"
   git init
   git add .
   git commit -m "Baseline inicial"
   ```
2. En `settings.json` (o usa el default):
   ```json
   "uefnCodeReview.useGitForOldCode": true
   ```

**Workflow normal:**
1. Modificas `audio_manager.verse`.
2. Selecciona la función nueva en el editor.
3. `Ctrl+Shift+R`.
4. QuickPick: "Use Git diff (recommended) +5 -2" — Enter.
5. Nota → metadata → IA → Slack.

**Workflow después de un review aprobado:**
1. Reviewer reaccionó ✅ en Slack.
2. Tú: `git add . && git commit -m "DD-2645: damage value capped fix"`.
3. HEAD avanza. Próxima review diffea contra ESTE commit.

**Workflow después de URC sync (CRÍTICO):**
1. URC bajó cambios del servidor. Tu working tree tiene cambios que tú no hiciste.
2. **Inmediatamente**: `git add . && git commit -m "URC sync 2026-05-05"`.
3. Esto le dice a Git "este es el nuevo punto de partida después del sync".
4. Si NO haces este commit, tu próxima review va a incluir como "tus cambios" lo que en realidad bajó del equipo.

**Trade-offs:**
- ✓ Auto-detección del código viejo, sin clipboard
- ✓ Diff con stats automáticos (`+5 -2`)
- ✓ Historia local respaldada
- ✗ Disciplina obligatoria: commit después de URC sync, commit después de approval
- ✗ Si te olvidas un commit, el siguiente diff sale raro

**Esta es la ruta correcta si:**
- Cada dev del equipo se compromete a los dos rituales (sync + approval commits)
- Estás cómodo con `git add` / `git commit` en PowerShell
- Quieres maximizar velocidad por encima de simplicidad

---

## Casos borde y cómo manejarlos

### Caso 1: Hago Ctrl+Shift+R y el QuickPick solo muestra "Use clipboard" / "No old code"

**Causa:** el archivo no está trackeado en Git (nunca lo agregaste con `git add`), o no hay `.git/` en el repo.

**Fix con Ruta B:** `git add archivo.verse && git commit -m "track this file"`. La próxima vez ya aparece la opción Git.
**Fix con Ruta A:** ignóralo, usa clipboard.

### Caso 2: El diff sale enorme (200+ líneas)

**Causa:** acumulaste muchos cambios sin committear (o sin hacer review previo).

**Diagnóstico:** mira el `+X -Y` en el header del snippet. Si es `+150 -20`, hay demasiados cambios juntos.

**Fix:**
- Mejor estrategia: divide en snippets más pequeños (selecciones más cortas, multi-snippet session).
- Si todos los cambios son genuinamente del mismo ticket: tag size como `XL` y manda.
- Si NO deberían estar juntos: descarta la sesión (`Discard All`), commitea lo que ya estaba aprobado, y empieza de cero con solo los cambios actuales.

### Caso 3: URC me bajó cambios del equipo y ahora mi diff incluye cosas que no hice

**Esto es el problema #1 de Git+URC.**

**Si usas Ruta A (sin Git):** no aplica, no te pasa.

**Si usas Ruta B (con Git):**
- Inmediatamente después de un URC sync, ANTES de seguir trabajando:
  ```powershell
  git add .
  git commit -m "URC sync"
  ```
- Si te olvidaste y ya hiciste cambios encima: detecta lo que es tuyo manualmente. La forma más simple:
  ```powershell
  git stash             # guarda tus cambios
  git add .             # stage lo que vino de URC
  git commit -m "URC sync"
  git stash pop         # recupera tus cambios encima del nuevo baseline
  ```

### Caso 4: Hice Ctrl+Shift+R pero ya había hecho `git commit` antes

**Síntoma:** la extensión dice "File matches HEAD exactly — no changes to diff".

**Causa:** committeaste antes de mandar a review. Tu working tree = HEAD, no hay nada que diffear.

**Fix:**
- Ruta B: deshaz el commit con `git reset --soft HEAD~1`. Esto deja tus cambios en working tree, retrocede HEAD un commit. Ahora `Ctrl+Shift+R` muestra el diff. Después del review, vuelves a committear.
- **Mejor regla:** committea SOLO después del review aprobado, nunca antes.

### Caso 5: Modifiqué algo, hice review, lo aprobaron, committeé. Ahora estoy haciendo otro cambio en el mismo archivo

**Esto funciona perfecto.**

1. HEAD apunta al commit del review aprobado.
2. Haces nuevo cambio.
3. `Ctrl+Shift+R` muestra solo el diff vs el último commit, no vs el original.
4. La función entera ya no sale como `+` porque YA fue committeada.
5. Solo lo nuevo sale como `+`.

Es exactamente el flujo que esperarías. Esto es por qué committear después de approval es importante.

### Caso 6: El archivo es completamente nuevo (no existía antes)

**Causa esperada:** archivo nuevo, nada que comparar.

**Comportamiento:** todo el archivo aparece como `+`. No es un bug — el archivo entero ES nuevo. La selección que hagas se va a mostrar entera como añadida.

**Mejor práctica:** la primera review de un archivo nuevo va a ser grande. Acéptalo. Una vez aprobada y committeada, las siguientes reviews del mismo archivo serán pequeñas.

### Caso 7: Quiero deshacer una sesión de snippets pendientes

`Ctrl+Shift+P` → "Code Review: Discard Pending Review". Limpia todo, no manda nada a Slack.

### Caso 8: Mi clipboard tenía algo viejo y no me di cuenta

**Protección:** v0.2.1+ muestra preview del clipboard en el QuickPick:
```
Use clipboard          "Cancelable:=TimerDevice1.SuccessEvent.Subscribe..."
```

Si lo que muestra NO es la versión vieja del código que estás reviewando, picks "No old code" o vuelves a copiar.

### Caso 9: El AI no me corre

**Diagnóstico** (siempre el mismo): `Ctrl+Shift+U` → dropdown "UEFN Code Review". Busca líneas `[ERROR]`.

**Fixes comunes:**
- "API key not valid" → reconfigura
- "limit: 0" → modelo de pago, cambia a `gemini-2.5-flash`
- "Empty response" → snippet muy largo, divide

### Caso 10: Cambié de máquina / clean install de VS Code

**Lo que necesitas re-hacer:**
1. Instalar el `.vsix`
2. `Configure Credentials` (las credenciales son local-only)

**Lo que NO necesitas re-hacer:**
- El repo Git ya está si lo tenías (los commits viven en `.git/`)
- La guía `.verse-style.md` está en URC con todo el equipo

---

## Decisión: Ruta A o Ruta B

Para tu equipo de 5 (Camilo, Juanse, Jose, Nico, tú), mi recomendación honesta:

**Empiecen con Ruta A durante 2 semanas.** Es robusta, simple, y la curva de aprendizaje es nula. Cada review toma 10 segundos extra (copiar viejo del panel URC) pero nunca se rompe.

**Después de 2 semanas, evalúen:**
- Si todos están cómodos y la fricción del clipboard les molesta → migran a Ruta B con disciplina.
- Si no → se quedan en Ruta A. Está perfectamente bien.

**No tienes que decidir hoy.** El setting `useGitForOldCode` lo cambias cuando quieras y el flujo de la otra ruta sigue funcionando.

---

## Configuración por dev

Cada uno puede elegir individualmente. En tu `settings.json` personal:

```json
{
  // Yo prefiero clipboard manual
  "uefnCodeReview.useGitForOldCode": false
}
```

vs.

```json
{
  // Yo me comprometo con Git
  "uefnCodeReview.useGitForOldCode": true
}
```

Esto NO afecta a los demás. Cada quien usa el modo que prefiere.

---

## ¿Y si en el futuro queremos algo mejor que ambas?

Una opción real (no implementada) sería integrar directamente con la SCM API que usa la extensión de URC. Si Epic expone una API pública o semi-pública para leer el original de un archivo URC-trackeado, podríamos eliminar la necesidad de Git Y de clipboard. Pero eso requiere reverse-engineering o documentación que no tenemos hoy.

Por ahora: **Ruta A o Ruta B, ambas funcionan, el equipo decide.**
