# CRYPT FORGE DS-1 — Sintetizador de Dungeon Synth

Estación de trabajo completa para componer **dungeon synth** con filo de black metal: motor de síntesis oscuro, caja de ritmos sintetizada, secuenciador de 16 pasos con modo canción y grabación de la salida maestra a WAV. Todo suena dentro del navegador — cero instalación, cero dependencias, funciona offline.

## Arrancar

Doble clic en **`index.html`** (Chrome, Edge, Firefox o Safari modernos).
Pulsa **ACTIVAR AUDIO** (los navegadores exigen un gesto humano antes de hacer sonar nada) y pulsa **▶**. Con el preset *Mazmorra de Piedra* ya hay una secuencia demo sonando: ora el punto de partida.

## Los seis bloques

| Bloque | Qué hace |
|---|---|
| **SÍNTESIS** | OSC A + OSC B + sub, filtro lowpass con envolvente propia, ADSR de amplitud, LFO (corte/diapasón/amplitud), modo poli (8 voces) o mono con portamento |
| **FX & MASTER** | Drive de cinta, reverb de catedral (convolución generada en el navegador, con predelay), delay sincronizado al tempo, suelo de hiso analógico, limitador y medidor de pico/RMS |
| **SECUENCIADOR** | 16 semicorcheas, 8 patrones, swing, gate por patrón, acentos, cambio de patrón en vivo, modo canción encadenado |
| **BATERÍA** | Kick, snare, tom, hat y crash sintetizados (sin samples), filas silenciables |
| **PRESETS** | 10 sonidos de fábrica + guarda los tuyos (persisten en el navegador) |
| **GRABADORA** | ● REC capta todo el master; exporta WAV de 16 o 24 bits |

## Cómo se toca

- **Teclado en pantalla**: clic o arrastre sobre las teclas.
- **Teclado QWERTY**: fila `Z S X D C V G B H N J M ,` = octava grave · fila `Q 2 W 3 E R 5 T 6 Y 7 U` = octava aguda.
- **MIDI**: si tu navegador lo permite, cualquier controlador MIDI se conecta solo.
- **Knobs**: arrastre vertical · rueda · `Shift` = fino · doble clic = valor por defecto · flechas del teclado cuando está enfocado.

## Pintar una secuencia

1. Elige la nota en la **paleta** (12 notas + octava). El bloque de escala marca las notas que están *fuera* del modo elegido (eolia, doria, frigia, menor armónica).
2. **Clic** sobre un paso = pintar esa nota · **Mayús + clic** = acento (más volumen y gate) · **clic derecho** = borrar · arrastra para pintar varios pasos seguidos.
3. En **BATERÍA**, clic = golpe, Mayús + clic = acento, clic en el nombre de la fila = silenciarla.
4. **Patrones 1–8**: clic para cambiar (en vivo se encola hasta la próxima barra), Copiar/Pegar/Limpiar para construir variaciones.
5. **CANCIÓN**: pulsa una ranura de la cadena para armarla y luego los números de patrón para asignarlos en orden. Con CANCIÓN activo, el transporte recorre la cadena.

## Grabar un tema

1. Deja sonando lo que quieras (secuencia, teclado, los dos a la vez).
2. **● REC** empieza a capturar; el contador corre. **EXPORTAR WAV** descarga `cryptforge_<fecha>_<hora>.wav` (16 o 24 bits, tasa nativa del contexto de audio).
3. Consejo de producción: las tomas dungeon synth viven del *pace* lento — BPM 60–95, ataques largos en los pads, reverb dominante y poca prisa. El modo canción te da estructura intro → desarrollo → cierre sin tener que volver a tocar.

## Receta rápida de dungeon synth (orientación black metal)

- **Pads**: *Mazmorra de Piedra* o *Niebla Negra*, ataque 1–2 s, notas largas, reverb alto. Es la alfombra.
- **Riff**: *Cinta Mordida* o *Cuerno de Guerra* en modo mono con glide, línea sencilla de 4–8 notas en modo menor. Es el hueso.
- **Base**: *Bajo de Cripta* siguiendo la tónica y la quinta.
- **Aire**: *Flauta de Hueso* como contramelodía, *Campana Lejana* en los cambios de sección.
- **Ritmo**: kick lento y seco en los tiempos fuertes, snare en el contratiempo, hat sostenido, crash solo al empezar el patrón. Menos es más.
- **Carácter**: sube DRIVE e HISS para el acabado de cinta/crypt; el delay en 1/8 con puntillo da profundidad sin desordenar.

## Si algo suena raro

- **No se oye nada**: ¿pulsaste ACTIVAR AUDIO? El botón ▶ reanuda el contexto si el navegador lo suspendió.
- **El reverb suena metálico**: es la naturaleza del convolver generado; baja el predelay o el send.
- **Se corta el sonido con muchas notas**: son 8 voces con robo de la más antigua (by design); usa modo mono para líneas.
- **Quieres empezar de cero**: borra los datos del sitio en tu navegador (el estado vive en `localStorage`).

## Arquitectura (para quien quiera mirar dentro)

```
index.html            DOM + orden de scripts
css/style.css         tema oscuro, sin recursos externos
js/wav.js             codificador WAV PCM (16/24 bits, N canales) — probado en test/wav.test.js
js/audio-engine.js    contexto, cadena master, generador de IR, curvas, medidor, ruido
js/synth.js           voz (OSC/SUB/filtro/ADSR/LFO/paneo) + 10 presets
js/drums.js           batería sintetizada
js/sequencer.js       transporte lookahead, 8 patrones, cadena de canción
js/recorder.js        captura AudioWorklet (+ fallback ScriptProcessor) y exportación
js/ui.js              knobs, teclado, QWERTY, MIDI, persistencia, medidor
test/wav.test.js      node test/wav.test.js → 4/4 casos OK
```

Diseño deliberadamente sin frameworks ni bundler: scripts clásicos que funcionan desde `file://`, estado completo en un `localStorage` y sonido 100 % sintetizado. La robustez está en las degradaciones protegidas (Web MIDI opcional, AudioWorklet con caída a ScriptProcessor, almacenamiento con try/catch) y en el reloj de Web Audio del secuenciador, que no depende del hilo principal para el tempo.

Que el Omnissiah bendiga tus frecuencias.
