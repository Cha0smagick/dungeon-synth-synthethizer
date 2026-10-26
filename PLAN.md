# CRYPT FORGE DS-1 — Plan Atómico de Construcción

**Producto:** Sintetizador de dungeon synth (orientación black metal), aplicación web autocontenida, sin instalación, sin dependencias, funciona offline haciendo doble clic en `index.html`.

**Fecha:** 2026-10-26
**Ejecutor:** Adeptus Vinictus II (encarnando `data-researcher`, `javascript-pro`, `qa-expert`)

---

## 1. Visión y alcance

### 1.1 Qué es (y se construye)
Una estación de trabajo de dungeon synth completa en un solo navegador:

- **Motor de síntesis** con arquitectura de 3 osciladores + sub, filtro con envolvente, doble ADSR, LFO, modo mono/poli con portamento.
- **Cadena FX oscura:** drive de cinta, reverb de catedral (convolución generada proceduralmente), delay sincronizado al tempo, suelo de hiso/vinilo.
- **Caja de ritmos sintetizada** (kick, snare, tom, hat, crash) con patrones de black metal.
- **Secuenciador** de 16 pasos con 8 patrones, modo canción (encadenado) y cambio de patrón en vivo.
- **Grabación** de la salida maestra a WAV (16/24 bits) con un clic.
- **Teclado** en pantalla + teclado QWERTY + entrada MIDI (Web MIDI, protegido si no existe).
- **10 presets** de sonido dungeon synth, bloqueo de escala modal (Eolia, Doria, Frigia), persistencia en localStorage.

### 1.2 Qué NO es (límites explícitos, fuera de alcance)
- No es un DAW multipista ni un editor de waveforms.
- No importa samples externos ni formatos de plugins (VST/AU). Todo el sonido se sintetiza en el navegador.
- No tiene edición de automatización por curva; la expresión se maneja con acentos por paso y envolventes.
- No usa frameworks, bundlers, CDN ni recursos externos: cero red en tiempo de ejecución.

---

## 2. Fundamentos del género (fase de investigación)

Fuente canónica verificada: Wikipedia «Dungeon synth» (consultada 2026-10-26).

**Definición:** género de música electrónica derivado del black metal y el dark ambient, originado a principios de los 90 en Noruega (progenitores: Mortiis y Burzum). Evoca temas medievales europeos y fantasía. Instrumental/ambient, usado como intro/interludio/outro en discos de metal.

**Rasgos de producción verificados y asumidos para el diseño del motor:**

| Rasgo del género | Implementación en CRYPT FORGE |
|---|---|
| Atmosfera de dark ambient, builds lentos y repetitivos | Pads con ataque lento (0.1–2 s), notas largas, reverb de catedral dominante |
| Herencia Berlin School (Tangerine Dream, Klaus Schulze) | Secuencias de 16 pasos, tempo 40–140 BPM, patrones hipnóticos |
| Estética medieval/fantasy | Afinación modal resaltada (eolia/doria/frigia), leads tipo flauta/cuerno, campanas |
| Lo-fi de cinta y teclados baratos | Drive waveshaper, hiso de vinculo, detune, sampI rate crudo del WAV |
| Black metal: blast beats, tremolo, voz crispada | Caja de ritmos con patrones BM (kick/snare/hat/crash), modo mono con glide para riffs tersos |
| Polifonía corral | Voces con detune/unison, coro simulado por batimiento de osciladores |
| Influencias citadas: Dead Can Dance, Arcana, Tchaikovsky | Presets de inspiración neoclásica/oscura (cuerdas, corno, coro, campana) |
| Subgénero relevante: crypt hop (lo-fi + beats) | Patrones de batería punchy y BPM medio disponibles |

**Referentes sonoros de los presets (canon del género):** Mortiis (era I), Burzum (ambient), Old Tower, Depressive Silence, Sombre Arcane, Thangorodrim, Jim Kirkwood, Pazuzu.

---

## 3. Arquitectura

Aplicación de scripts clásicos (sin módulos ES, para funcionar desde `file://` sin CORS), cada archivo expone su API en `window`:

```
index.html            Estructura DOM: cabecera (transporte+grabadora), paneles de síntesis,
                      secuenciador, teclado. Carga los scripts en orden de dependencia.
css/style.css         Tema oscuro profesional, rejilla responsive, knob SVG, pasos del secuenciador.
js/wav.js             Codificador WAV PCM 16/24 bits. Función pura → testeable en Node.
js/audio-engine.js    AudioContext, cadena master (drive/limitador/medidor), generador de IR de
                      reverb, curvas waveshaper, buffer de ruido, destino de grabación. Singleton.
js/synth.js           Clase Voice + clase Synth: noteOn/noteOff, parámetros, presets.
js/drums.js           Voces de batería sintetizadas + banco de patrones.
js/sequencer.js       Transporte con lookahead scheduling, 8 patrones × 16 pasos (melodía+batería),
                      modo canción, cola de patrón siguiente.
js/recorder.js        Captura del master vía AudioWorklet (con fallback ScriptProcessor), temporizador,
                      exportación WAV vía wav.js.
js/ui.js              Clase Knob (arrastre/rueda/shift-fino/doble-clic reset), construcción de paneles,
                      teclado en pantalla, mapeo QWERTY, Web MIDI, localStorage, wiring completo.
test/wav.test.js      Test Node del codificador WAV (assert-based).
README.md             Manual de uso en español.
```

### Flujo de audio

```
voices (synth) ─┐
                ├─► dryGain ──────────────────────────────┐
drums ──────────┤                                        │
                ├─► reverbSend ─► predelay ─► convolver ──┤
                ├─► delaySend ─► delay(+fb+lp damp) ──────┤
                └─► hissGain ──────────────────────────────┘
                                                         ▼
                              masterGain ◄─ drive(waveshaper)
                                        ▼
                              limiter (DynamicsCompressor)
                                        ▼
                    analyser (medidor) ─┬─► destination (altavoces)
                                        └─► recDest (grabación WAV)
```

---

## 4. Especificación de audio

### 4.1 Voz de síntesis (`Synth`)
- **OSC A:** forma (sine/triangle/saw/square), octava (−2…+2), desafine en cents (−1200…1200), nivel.
- **OSC B:** igual que A (permite unísono/intervalos).
- **SUB:** sine una octava abajo, nivel.
- **FILTRO:** lowpass 12 dB/oct, corte (40–8000 Hz, curva log), resonancia (0–20), cantidad de envolvente.
- **ENV F (filtro):** A/D/S/R + cantidad sobre corte.
- **ENV A (amp):** A/D/S/R.
- **LFO:** forma (sine/tri), frecuencia (0.05–12 Hz), profundidad (0–1), destino (corte/diapasón/amp).
- **MODO:** poli (8 voces, robo de la más antigua) / mono con portamento (0–500 ms).
- **Paneo:** cada voz se panoramiza por posición de nota (spread −1…+1 → L…R).

### 4.2 Efectos (`audio-engine`)
- **Reverb:** ConvolverNode, IR estéreo generada (ruido con decaimiento exponencial, filtro oscuro, reflexiones tempranas), duración 4 s. Predelay 0–120 ms, nivel wet.
- **Delay:** tiempo = división sincronizada al BPM (1/4, 3/8, 1/8 punteado, 1/8), feedback 0–0.85 con amortiguación LP 3 kHz en el lazo, nivel wet.
- **Drive:** WaveShaper tanh suave, cantidad 0–1, con compensación de nivel post-curva.
- **Hiss:** bucle de ruido rosa muy lento (muestra de 2 s) a −60…−20 dB.
- **Limitador:** DynamicsCompressor (umbral −8 dB, ratio 12, knee 6, ataque 3 ms) sobre el master, más makeup al 0.9.

### 4.3 Batería (`drums`)
Sintetizada pura: kick (seno con barrido de tono 120→45 Hz + click), snare (ruido BP + tono 180 Hz), tom (seno 220→90), hat (ruido HP 8k con decay 40 ms), crash (ruido HP 5k, decay 1.5 s).

### 4.4 Secuenciador (`sequencer`)
- Lookahead scheduler: 25 ms de consulta, 100 ms de antelación (patrón robusto de reloj de Web Audio).
- 16 semicorcheas por patrón, swing 0–60 %, gate por patrón (25/50/75/100 %).
- 8 patrones; modo canción = cadena de 16 entradas (pattern 1–8 o vacío, repetición incluida por posición).
- Acento por paso (shift-clic) = paso al 100 % de velocidad/gate, normal = 70 %.

### 4.5 Grabación (`recorder`)
- AudioWorklet de captura (código embebido vía Blob URL, compatible `file://`), fallback a ScriptProcessorNode.
- Exporta WAV mono, 16 o 24 bits, a la tasa del contexto. Nombre `cryptforge_<fecha>_<hora>.wav`.
- Contador de tiempo y aviso al pasar de 5 minutos.

---

## 5. Especificación de UI

- **Tema:** oscuro (carbón/negro tinta), acentos ámbar/cobre, tipografía del sistema.
- **Rejilla:** cabecera fija (logo, preset, transporte BPM/swing, grabadora); panel izquierdo (OSC/FILTRO/ENV/LFO); panel derecho (FX/MASTER); secuenciador central (melodía + batería + patrones + canción); teclado a ancho completo abajo.
- **Knobs:** dial SVG; arrastre vertical, rueda, Shift = fino, doble clic = valor por defecto. Todos con `title` de ayuda.
- **Teclado:** 2 octavas, resalte de escala modal, etiquetas de notas opcionales, mapeo QWERTY (fila Z/X/C… graves, fila Q/2/W… agudas).
- **Accesibilidad:** foco visible, contraste alto, todo operable por teclado.

---

## 6. Plan atómico (tareas verificables)

Cada tarea es indivisible y tiene criterio de aceptación. Dependencias marcadas.

| # | Tarea | Depende de | Criterio de aceptación |
|---|---|---|---|
| T1 | Scaffold: `index.html`, `css/style.css`, esqueleto de `js/`, orden de scripts | — | Página carga sin errores de consola; paneles vacíos visibles |
| T2 | `js/wav.js` codificador PCM + `test/wav.test.js` | — | `node test/wav.test.js` pasa; cabecera RIFF/WAVE/fmt/data correcta |
| T3 | `js/audio-engine.js` contexto, master, IR reverb, curvas, ruido, medidor | T1 | Contexto se crea; cadena conectada; unidad de ganancia 1.0 |
| T4 | `js/synth.js` voz completa + 10 presets | T3 | noteOn/noteOff suenan; robo de voces; mono+glide funcionan |
| T5 | `js/drums.js` 5 voces + disparo | T3 | Cada voz suena distinta y seculara |
| T6 | `js/sequencer.js` transporte, 8 patrones, modo canción | T4, T5 | Play avanza 16 pasos; BPM real (±1 % swing aplicado); cadena avanza |
| T7 | `js/recorder.js` captura worklet + fallback + export | T2, T3 | REC/STOP descarga WAV válido; cabecera del archivo verificada |
| T8 | `js/ui.js` knobs, paneles, teclado, QWERTY, MIDI, localStorage, wiring | T4–T7 | Todo control visible modifica el motor al moverlo; patch persiste al recargar |
| T9 | Contenido demo: 2 patrones + cadena de canción + patch inicial | T6, T8 | Play con patch por defecto produce un motivo dungeon synth audible |
| T10 | QA: `node --check` de todos los JS, tests, caza de errores de consola en navegador (BrowserOS neo tras reconexión) | T1–T9 | 0 errores de sintaxis; 0 errores de consola; flujo grabar→exportar verificado |
| T11 | `README.md` + limpieza final + revisión de código | T10 | Cualquier persona puede abrir y tocar en < 60 s |

---

## 7. Robustez (requisitos no negociables)

- `AudioContext` se crea **solo** tras gesto del usuario (política de autoplay), con botón de "activar audio".
- Todo acceso a API opcional (Web MIDI, AudioWorklet, localStorage) está envuelto en try/catch con degradación graceful.
- Si el navegador no soporta algo, la app sigue funcionando sin esa función, con aviso discreto.
- Sin fuga de voces: cada `noteOn` crea nodos y cada release los destruye (`stop()` programado tras el release).
- Sin fugas de patrón: parar el transporte detiene todos los schedulers pendientes.

---

## 8. Fuera de alcance (registrado para no construirlo a lo tonto)

Plugins VST, importación de samples, Ableton Link, Ableton-style piano roll de libre dibujo, pistas múltiples de audio, compás de firmas irregulares, exportación MIDI. Si el Maestro de forja las pide después, se planifican como iteración 2.

---

## 9. Estado de BrowserOS neo (verificación web)

Servidor MCP `browseros-neo` vivo en `127.0.0.1:9010` y `connected` por CLI, pero sus herramientas no llegaron a esta sesión de agente. Acción del Maestro de forja: refrescar conexiones MCP o iniciar sesión nueva para que aparezcan las herramientas del navegador. **T10 (verificación en navegador real) queda pendiente de esa reconexión**; el resto del plan no depende de ella.
