# Slime avatar & motion study

A liquid slime on a WebGL2 canvas, in two pages that share one renderer:

- **`index.html` – the avatar.** A round little slime with a face, seven moods, five one-shot
  animations, and it reacts to you: it watches your cursor, wobbles when poked and stretches when
  dragged. Its body is a soft skin that sloshes, ripples and splats, drawn flat with a barely-there
  outline and a subtle shadow along its lower right, and every mood plays out in liquid. It comes in
  six colours.
- **`study.html` – the motion study.** The original 1.8 s loop: a drop swells, pinches in two, flings
  both halves round tilted 3D orbits as comets and merges back.

## Run

```bash
npm start
```

Then open http://localhost:5173. ES modules don't load from `file://`, so use a server (any static server
works, e.g. `python3 -m http.server`). There are no dependencies.

## The avatar

| Moods (stay until changed) | What it does |
| --- | --- |
| Idle | breathes, blinks, glances about, watches the cursor; left alone it bounces or wiggles |
| Happy | bounces on the beat and sways, ^ ^ eyes in the air |
| Talk | mouth flaps through random syllables, body bobs on each one |
| Think | a drop buds off the top of its head and circles it as a little comet; its eyes follow it |
| Sad | turns a cooler, duller shade and slumps; a tear wells up in one eye after the other and runs down its body as liquid, leaving a wet streak, then soaks back in (it never leaves the body) |
| Angry | flushes red and trembles, steam drops boil off its head; it stomps |
| Sleep | melts flat, eyes closed, a bubble swells on its head and pops |

| Animations (one-shot) | What it does |
| --- | --- |
| Yay! | crouch, jump, a fountain of drops, a landing that splats out wide |
| Whoa! | startled stretch, drops pop off the top |
| Wave | a stubby little arm pops out of its side, swings up beside its head and waves, then sinks back in; it squashes, leans and flops along with the body |
| Split | splits into two halves with their own faces on a neck that pinches off, they dance round each other squashing and stretching, and run back together |
| Spin | twirls once round: the face swings round the back, speed lines wrap the body |

Interactions: **click** to poke it (its skin bulges and ripples; poke it four times quickly and it boils
over), **drag** to pull a glob out on a gooey strand that sags, swings behind your moves and thins as it
stretches (let go and it whips back in; pull too far and it snaps off). Drops that fly off splat on the
floor, crawl back and melt into it; drops that meet run together. The circles in the corner are the
same frame cropped at profile-picture sizes.

Colours: pink, peach, lemon, mint, sky and grape, from the swatches under the controls. Each has its
own sad and angry shades, the body blends over when you switch, and the page remembers your pick.

Keys: `1`–`7` moods, `Q` `W` `E` `R` `T` animations, `C` the next colour.
URL options: `?mood=sad&color=mint`, or `?sheet` for every mood, animation and interaction side by side.

## The motion study

Scrub the loop, step frames with `←` `→`, change speed, and toggle 3D shading, a face and guides that show
the 3D orbits. URL options: `?t=1.2&paused=1&speed=0.5&shaded=1&face=1&guides=1&zoom=1.5`, or
`?sheet&n=24&cols=6&from=0.6&to=1.8` for a contact sheet.

## How it works

- **`src/renderer.js`** draws everything in one full-screen fragment shader. Shapes are tapered round
  segments; segments of a body are hard-unioned and bodies are smooth-unioned (`smin`), which gives the
  gooey necks, bridges and snaps. A filled body's segments trace a closed outline that is filled in,
  which is how the avatar's soft body is drawn. Each segment also yields the normal of a round tube, so
  the study's flat shapes get glints and optional 3D shading (the avatar draws flat, without either).
  It can also draw a thin outline just inside the silhouette, so everything merged into one blob gets
  one outline with no seams, and an overlay scene drawn over the main one and clipped to it (liquid
  running over the body, like the tear). Its subtle shadow darkens the part of the shape that the
  shape itself, nudged towards the light, doesn't cover: a crescent along the lower right of the body,
  every drop and the strand, which follows them however they deform. It also draws soft shadows on
  the floor (`Slime.shadows`): one under the body and one under every drop, the pulled glob and the
  split halves, each right below its part and darker and tighter the nearer the floor it is. Every
  body comes with a circle round it, so each pixel skips the bodies too far away to matter.
- **`src/prims.js`** packs those segments for the shader (`PrimBuffer`).
- **`src/avatar/slime.js`** is the character. Springs drive squash & stretch, bend, melt and a hop; a skin
  of 20 soft nodes chases that rig with a lag, passes dents and bulges round to its neighbours and keeps
  the body's volume, so it wobbles, sloshes and splats. Also here: the drag strand (a sagging rope with a
  glob on the end), droplets that fly with comet tails, splat, crawl home and merge, and the face rig.
- **`src/avatar/behaviors.js`** holds the moods and animations. Each one sets body and face targets every
  physics step and can add liquid entities (thought drop, bubble, tear, arm, split halves, speed lines).
  The arm is a short stub laid out on the body's rest shape, so it moves with the body; its swing and
  tip chase the wave on springs.
  Adding a mood or animation is one entry in `MOODS` or `EMOTES`; the buttons are built from them.
- **`src/avatar/face.js`** draws the face and the split halves' faces on a 2D canvas that turns,
  squashes and tilts with the body.
- **`src/study/choreography.js`** is the study loop, written as pure functions of time so it scrubs and loops.

## Tweaking

- Colours: `COLORS` in `slime.js`, each a calm colour with its sad and angry shades (add one and it
  gets a swatch); `DARK`, `CHEEK` and `TONGUE` in `face.js`.
- Look: `LOOK` in `src/avatar/main.js`: the outline's width (in body radii) and how much darker than the
  body it is, how much lighter a tear is, and the shadow: how much darker (`shade`), how deep
  (`shadeDepth`) and how soft (`shadeSoft`). `AWAY_FROM_LIGHT` sets which side it falls on.
- Shape: `BODY` in `slime.js` (how wide and tall it is, and how far it has settled into the floor).
- Springiness: the `Spring` frequencies and damping in the `Slime` constructor.
- Wobble: `SKIN_HZ`, `LAG`, `TENSION`, `VOLUME` and `VISCOSITY` in `slime.js` (lower frequencies or more
  lag make it sloppier).
- The drag: `SNAP` (how far it stretches before it snaps) and `GLOB` in `slime.js`.
- Timings and moves: each entry of `MOODS` / `EMOTES` in `behaviors.js`.
