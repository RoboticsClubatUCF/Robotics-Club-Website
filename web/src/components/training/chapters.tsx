import type { Focus } from '../../lib/slicer/scene'
import { type Aim, addSelectionAims, panelAims, partAims, settingAims } from '../../lib/training/aim'
import type { Chapter } from '../../lib/training/curriculum'
import {
  type Goal,
  type PracticeState,
  anyOverlap,
  atOpeningView,
  cameraOffset,
  changed,
  fits,
  isSliced,
  near,
  objectOf,
  pointing,
  restsOn,
  setting,
  sizeOf,
} from '../../lib/training/goals'
import { PRACTICE_PETG } from '../../lib/training/practiceProfiles'
import { placed, turn } from '../../lib/training/practiceParts'
import {
  BracketDiagram,
  BrimSkirtDiagram,
  CrossSectionDiagram,
  InfillTiles,
  LayerHeightDiagram,
  LayersDiagram,
  MushroomDiagram,
  OverhangDiagram,
  PlateAxes,
  SeamDiagram,
  StrengthDiagram,
  ThresholdDiagram,
} from './Diagrams'
import { Careful, H, Kbd, List, Name, P, PreviewCompare, SliceNumbers, Terms } from './LessonParts'
import { WorkspaceMap } from './WorkspaceMap'

/**
 * The slicer training, start to finish. Written for somebody who has never used a slicer: short
 * sentences, the screen's own names for things, and every setting the workspace offers either
 * explained here or changed in a task (`lib/slicer/processSettings.ts` is the list; the test
 * beside the page checks none is missed).
 *
 * Tasks run on the practice plate, the real workspace with nothing saved or sent. Their goals are
 * checked as the member works (`lib/training/goals.ts`), and each points at what to use next
 * (`lib/training/aim.ts`).
 */

const is = (key: string, value: number | boolean | string, text: string): Goal => ({
  text,
  done: (state) => setting(state, key) === value,
  aim: settingAims(key),
})

/** The member put this setting back with its reset arrow, after changing it. */
const reset = (key: string, text: string): Goal => ({
  text,
  done: (state) => !changed(state, key),
  aim: settingAims(key, 'reset'),
})

const count = (state: PracticeState) => state.plate.objects.length

/** A field of `id`'s in the object panel: the part until it's the one selected, then the field. */
const field =
  (id: string, ...fields: string[]) =>
  (state: PracticeState): Aim[] =>
    state.selected.length === 1 && state.selected[0] === id ? panelAims(...fields) : partAims(id)

/** A tool that works on the selection: the part until something's selected, then the tool. */
const tool =
  (name: string, id: (state: PracticeState) => string | undefined) =>
  (state: PracticeState): Aim[] =>
    state.selected.length > 0 ? [{ at: `tool:${name}` }] : partAims(id(state) ?? '')

/** Bare plate to drag on, wherever the camera has it: the first of these that's in view. */
const EMPTY: Aim[] = [
  { spot: [56, 200, 0] },
  { spot: [56, 56, 0] },
  { spot: [200, 76, 0] },
  { spot: [200, 220, 0] },
]

const MIDDLE = 128

// Close-ups for the lesson previews: the practice slices sit in the middle of the plate.
const MUSHROOM_FOCUS: Focus = { min: [110, 110, 0], max: [146, 146, 19] }
const TOWER_FOCUS: Focus = { min: [118, 118, 0], max: [138, 138, 60] }
const BLOCK_FOCUS: Focus = { min: [108, 108, 0], max: [148, 148, 12] }

export const CHAPTERS: Chapter[] = [
  {
    id: 'basics',
    title: 'What a slicer does',
    steps: [
      {
        kind: 'read',
        id: 'what-slicing-is',
        title: 'What a slicer does',
        body: (
          <>
            <P>
              A 3D printer can&rsquo;t read a 3D model. All it can do is follow a list of moves: go here, push out
              this much plastic, go there.
            </P>
            <P>
              The club&rsquo;s filament printers melt a thin plastic thread, called <Name>filament</Name>, and lay it
              down in lines about half a millimetre wide. They build the part one flat layer at a time, from the
              plate up.
            </P>
            <LayersDiagram />
            <P>
              A <Name>slicer</Name> is the program that makes that list of moves. It cuts your model into layers
              and works out the nozzle&rsquo;s path for every one of them. The list it writes is the file the printer
              runs.
            </P>
            <P>
              How you set up the slice decides whether the print works, how strong it is, how long it takes and
              how much plastic it uses. That&rsquo;s what this training is about.
            </P>
          </>
        ),
      },
      {
        kind: 'read',
        id: 'how-requests-work',
        title: 'How a print request works here',
        body: (
          <>
            <List ordered>
              <li>You open the slicer from the printing page and put your model on the plate.</li>
              <li>You choose the plastic and how it prints.</li>
              <li>
                You press <Name>SLICE PLATE</Name>. The club&rsquo;s slicer makes the file and shows you what it
                will print.
              </li>
              <li>
                You check it and press <Name>REQUEST PRINT</Name>.
              </li>
              <li>An officer opens your file, prints it and marks it done.</li>
            </List>
            <P>
              Prints for yourself come out of your allowance, a set amount of plastic each semester. The printing
              page shows what you have left. Prints for a club project you&rsquo;re on don&rsquo;t count against it.
            </P>
            <P>
              Resin prints work differently: an officer slices those for you, from the form on the printing page.
              This training is about filament.
            </P>
            <Careful>
              The tasks in this training use a practice copy of the slicer. Nothing you do in it is saved,
              uploaded or printed, so try anything.
            </Careful>
          </>
        ),
      },
      {
        kind: 'check',
        id: 'check-what-slicer-makes',
        title: 'Check: what the slicer makes',
        question: 'What does the slicer make?',
        options: [
          { text: 'A 3D model of your part', why: 'You bring the model. The slicer turns it into moves.' },
          {
            text: 'The list of moves the printer follows, layer by layer',
            right: true,
            why: 'Right. The printer only follows moves, and the slicer writes them.',
          },
          {
            text: 'A photo of the finished print',
            why: 'The preview shows you what it will print, but the file it makes is the list of moves.',
          },
        ],
      },
      {
        kind: 'check',
        id: 'check-who-prints',
        title: 'Check: after you send it',
        question: 'You press REQUEST PRINT. What happens next?',
        options: [
          { text: 'A printer starts right away', why: 'Nothing reaches a printer on its own. An officer prints it.' },
          { text: 'An officer opens your file and prints it', right: true, why: 'Right. It waits in the queue until an officer gets to it.' },
          { text: 'Your plate is deleted', why: 'It goes into the queue and stays on your printing page.' },
        ],
      },
    ],
  },

  {
    id: 'screen',
    title: 'Finding your way around',
    steps: [
      {
        kind: 'read',
        id: 'the-screen',
        title: 'The slicer screen',
        body: (
          <>
            <WorkspaceMap />
            <List ordered>
              <li>
                <Name>PREPARE</Name> is where you set up the plate. <Name>PREVIEW</Name> shows the sliced result.
              </li>
              <li>
                The status line says where the plate is: not sliced, slicing, or how long it will take and how much
                plastic it needs.
              </li>
              <li>
                <Name>SLICE PLATE</Name> and <Name>REQUEST PRINT</Name>. Whichever you should press next is gold.
              </li>
              <li>
                Settings: the printer, the plastic (filament), the process, and the settings under them. They apply
                to everything on the plate.
              </li>
              <li>
                The plate, drawn to size: 256 by 256 mm, and parts can be up to 256 mm tall. <Name>FRONT</Name> marks
                the side facing the printer&rsquo;s door. The hatched corner at the front right is where the printer
                cleans its nozzle, so nothing can go there.
              </li>
              <li>
                The toolbar: add a model, arrange, auto-orient, copy, delete, then the four modes: move, rotate,
                scale and lay on face. Hold the pointer over a button to see its name and its key.
              </li>
              <li>Objects: everything on the plate, and the exact place, turn and size of the one you&rsquo;ve selected.</li>
            </List>
            <P>
              On a phone, the two side columns open with the <Name>SETTINGS</Name> and <Name>OBJECTS</Name> buttons
              over the plate, and the toolbar runs along the bottom.
            </P>
          </>
        ),
      },
      {
        kind: 'try',
        id: 'try-the-screen',
        title: 'Look around',
        setUp: { objects: () => [placed('mushroom', 'mushroom', MIDDLE, MIDDLE)] },
        goals: [
          // Met once PREVIEW has opened on the slice, so going back to PREPARE can't tick with it.
          {
            text: 'Press SLICE PLATE. When it’s done, PREVIEW opens on the layers it made.',
            done: (s) => isSliced(s) && s.tab === 'preview',
            aim: [{ at: 'slice' }],
          },
          { text: 'Go back to PREPARE.', done: (s) => s.tab === 'prepare', aim: [{ at: 'tab:prepare' }] },
          {
            text: 'Click or tap the mushroom to select it. It turns gold.',
            done: (s) => s.selected.includes('mushroom'),
            aim: partAims('mushroom'),
          },
          { text: 'Click empty plate, or press Escape, to select nothing.', done: (s) => s.selected.length === 0, aim: EMPTY },
        ],
      },
    ],
  },

  {
    id: 'camera',
    title: 'Moving the view',
    steps: [
      {
        kind: 'read',
        id: 'camera-controls',
        title: 'Moving the view',
        body: (
          <>
            <P>
              The view turns around the middle of the plate, like walking around a table. Moving the view never
              moves your parts.
            </P>
            <H>With a mouse or a touch screen</H>
            <Terms
              items={[
                ['Turn the view', 'Drag on empty space with the left mouse button. On a touch screen, drag with one finger.'],
                [
                  'Slide the view',
                  'Drag with the right mouse button, or hold Shift and drag. On a touch screen, drag with two fingers.',
                ],
                ['Zoom', 'Scroll the mouse wheel, or scroll with two fingers on a trackpad. On a touch screen, pinch.'],
                ['Start over', 'Press the house button at the top right of the plate.'],
              ]}
            />
            <Careful>
              A drag that starts on a part moves the part. Start on empty space to turn the view. If you move a part
              by mistake, <Kbd>Ctrl</Kbd> + <Kbd>Z</Kbd> puts it back.
            </Careful>
            <H>With the keyboard</H>
            <Terms
              items={[
                [
                  '1 to 6',
                  <>
                    Look straight at one side: <Kbd>1</Kbd> from above, <Kbd>2</Kbd> from below, <Kbd>3</Kbd> from the
                    front, <Kbd>4</Kbd> from behind, <Kbd>5</Kbd> from the left, <Kbd>6</Kbd> from the right.
                  </>,
                ],
                [
                  'I and O',
                  <>
                    The letters <Kbd>I</Kbd> and <Kbd>O</Kbd>: I zooms in, O zooms out.
                  </>,
                ],
                [
                  'Zero',
                  <>
                    The number <Kbd>0</Kbd> goes back to the view the plate opened with.
                  </>,
                ],
                [
                  'The house button',
                  <>
                    Press <Kbd>Tab</Kbd> until the house button at the top right of the plate is outlined. While it
                    is, the arrow keys turn the view a little at a time, and <Kbd>Shift</Kbd> with the arrow keys
                    slides it. The keys are listed under the button.
                  </>,
                ],
              ]}
            />
            <Careful>
              Away from the house button, the arrow keys move the selected parts, not the view. Press{' '}
              <Kbd>Escape</Kbd> to select nothing first if you&rsquo;re not sure.
            </Careful>
            <P>
              The numbers, <Kbd>I</Kbd> and <Kbd>O</Kbd> work while you&rsquo;re on the plate: after you click it,
              or once <Kbd>Tab</Kbd> has reached the house button or another of the plate&rsquo;s buttons. They
              don&rsquo;t work while you&rsquo;re typing in a box. In the pictures in these lessons, <Kbd>Tab</Kbd>{' '}
              to the picture&rsquo;s own house button first.
            </P>
            <P>
              Using a screen reader? Switch it to focus mode first (in NVDA, <Kbd>Insert</Kbd> +{' '}
              <Kbd>Space</Kbd>), or it keeps these keys for itself.
            </P>
            <P>
              Desktop OrcaSlicer, which the officers print from, uses the same numbers with <Kbd>Ctrl</Kbd> held
              down, and the same <Kbd>I</Kbd> and <Kbd>O</Kbd>.
            </P>
            <P>
              You can turn the view all the way under the plate. From below the plate is see-through, so you can
              check what&rsquo;s touching it.
            </P>
          </>
        ),
      },
      {
        kind: 'try',
        id: 'try-camera',
        title: 'Move the view',
        brief: 'Get to know the camera, with the mouse, the touch screen or the keys. Start every drag on empty space.',
        setUp: { objects: () => [placed('cube', 'cube', MIDDLE, MIDDLE), placed('bracket', 'bracket', 190, 190)] },
        goals: [
          {
            text: 'Turn the view to look from behind the plate.',
            needs3d: true,
            done: (s) => (cameraOffset(s)?.direction[1] ?? -1) > 0.3,
            aim: EMPTY,
          },
          {
            text: 'Look straight down from above.',
            needs3d: true,
            done: (s) => (cameraOffset(s)?.direction[2] ?? 0) > 0.95,
            aim: EMPTY,
          },
          {
            text: 'Turn under the plate and look up at it from below.',
            needs3d: true,
            done: (s) => (cameraOffset(s)?.direction[2] ?? 0) < -0.3,
            aim: EMPTY,
          },
          {
            text: 'Zoom in close to the parts.',
            needs3d: true,
            done: (s) => (cameraOffset(s)?.distance ?? Infinity) < 250,
            aim: [{ part: 'cube' }, ...EMPTY],
          },
          {
            text: 'Slide the view sideways so the middle of the plate moves off centre.',
            needs3d: true,
            done: (s) =>
              !!s.camera && Math.hypot(s.camera.target[0] - MIDDLE, s.camera.target[1] - MIDDLE, s.camera.target[2]) > 30,
            aim: EMPTY,
          },
          {
            text: 'Press the house button, or zero, to put the view back.',
            needs3d: true,
            done: atOpeningView,
            aim: [{ at: 'house' }],
          },
        ],
        hint: (
          <>
            On a laptop trackpad, drag with one finger to turn, hold Shift and drag to slide, and scroll with two
            fingers to zoom. With the keyboard, <Kbd>4</Kbd> looks from behind, <Kbd>1</Kbd> from above and{' '}
            <Kbd>2</Kbd> from below, and <Kbd>I</Kbd> zooms in. To slide, <Kbd>Tab</Kbd> to the house button and
            press <Kbd>Shift</Kbd> with an arrow key.
          </>
        ),
      },
    ],
  },

  {
    id: 'placing',
    title: 'Selecting and moving parts',
    steps: [
      {
        kind: 'read',
        id: 'placing-parts',
        title: 'Selecting and moving parts',
        body: (
          <>
            <H>Selecting</H>
            <P>
              Click or tap a part to select it; it turns gold. Hold <Kbd>Shift</Kbd> or <Kbd>Ctrl</Kbd> and click to
              add another. On a touch screen, turn on <Name>SELECT SEVERAL</Name> in <Name>OBJECTS</Name>, then tap
              parts in the list to add or remove them. Turn it off to select just one. Click empty plate to
              select nothing. <Kbd>Ctrl</Kbd> + <Kbd>A</Kbd> selects everything and{' '}
              <Kbd>Esc</Kbd> lets go. The list in <Name>OBJECTS</Name> selects too.
            </P>
            <H>Moving</H>
            <P>
              In <Name>MOVE</Name> mode (the four arrows, or <Kbd>M</Kbd>) drag a part across the plate. Selected
              parts move together. With a
              keyboard, the arrow keys nudge the selected parts 1 mm, or 10 mm with <Kbd>Shift</Kbd>.
            </P>
            <H>Putting it exactly somewhere</H>
            <P>
              With one part selected, <Name>POSITION</Name> on the right shows where its middle is. Type a number and
              press <Kbd>Enter</Kbd>. <Name>X</Name> runs left to right, <Name>Y</Name> from the front to the back,
              and 0, 0 is the front left corner.
            </P>
            <PlateAxes />
            <P>
              There&rsquo;s no height to set: every part sits on the plate.
            </P>
            <H>Adding your own model</H>
            <P>
              <Name>ADD A MODEL</Name> (the upload button, first on the toolbar) takes <Name>STL</Name> and{' '}
              <Name>STEP</Name> files, the two kinds most design programs export. You can also drop files onto an
              empty plate. A STEP file takes a moment to convert before it can be sliced. Several models can share
              one plate.
            </P>
          </>
        ),
      },
      {
        kind: 'try',
        id: 'try-placing',
        title: 'Select and move',
        brief: 'A cube and a block. Move them around.',
        setUp: { objects: () => [placed('cube', 'cube', 64, 64), placed('block', 'block', 190, 80)] },
        goals: [
          { text: 'Select the cube.', done: (s) => s.selected.includes('cube'), aim: partAims('cube') },
          {
            text: 'In OBJECTS, turn on SELECT SEVERAL and tap Block. Or hold Shift and click the block. Keep both selected.',
            done: (s) => s.selected.includes('cube') && s.selected.includes('block'),
            aim: addSelectionAims('block'),
          },
          {
            text: 'Drag the block into the back half of the plate, away from FRONT.',
            done: (s) => (objectOf(s, 'block')?.y ?? 0) > 140 && fits(s, 'block'),
            aim: partAims('block'),
          },
          {
            text: 'Turn off SELECT SEVERAL if it’s on. Select only the cube, then type 128 in POSITION X and 128 in Y, pressing Enter after each.',
            done: (s) => {
              const cube = objectOf(s, 'cube')
              return !!cube && near(cube.x, MIDDLE, 0.05) && near(cube.y, MIDDLE, 0.05)
            },
            aim: (s) => s.selected.length === 1 && s.selected[0] === 'cube'
              ? panelAims('position')
              : [{ at: 'select-several:on', side: 'left' }, ...partAims('cube')],
          },
        ],
      },
    ],
  },

  {
    id: 'turning',
    title: 'Turning and resizing',
    steps: [
      {
        kind: 'read',
        id: 'turn-and-size',
        title: 'Turning and resizing',
        body: (
          <>
            <H>Rotate</H>
            <P>
              In <Name>ROTATE</Name> mode (<Kbd>R</Kbd>) rings appear around the selected part. Drag a ring to turn
              the part around that direction: red around X, green around Y, and blue around Z, which spins it flat on
              the plate.
            </P>
            <P>
              For an exact turn, type degrees in <Name>ROTATION</Name> on the right. <Name>RESET</Name> turns the part
              back to how it came in.
            </P>
            <H>Scale</H>
            <P>
              In <Name>SCALE</Name> mode (<Kbd>S</Kbd>) drag the handles, or type percentages in <Name>SCALE</Name>.
              With <Name>UNIFORM</Name> on, all three change together and the part keeps its shape. Click it to
              switch to <Name>PER AXIS</Name> and stretch one direction on its own.
            </P>
            <P>
              <Name>SIZE ON THE PLATE</Name> sets a measurement in millimetres instead: width, depth and height. It
              needs <Name>UNIFORM</Name> on.
            </P>
            <Careful>
              Models are measured in millimetres. If a part comes in tiny, it was probably drawn in inches: scale it
              by 2540%. And size costs: twice as big in every direction is eight times the space, so it takes several
              times the plastic and time.
            </Careful>
          </>
        ),
      },
      {
        kind: 'try',
        id: 'try-rotate',
        title: 'Turn a part',
        brief: 'Turn the bracket, then put it back.',
        setUp: { objects: () => [placed('bracket', 'bracket', MIDDLE, MIDDLE)] },
        goals: [
          {
            text: 'Switch to ROTATE: the button with the curved arrows, or press R.',
            done: (s) => s.mode === 'rotate',
            aim: [{ at: 'tool:rotate' }],
          },
          {
            text: 'Turn the bracket a quarter turn around Z so it faces another way. Drag the blue ring, or type 90 in ROTATION Z.',
            done: (s) => {
              const bracket = objectOf(s, 'bracket')
              return !!bracket && Math.abs(pointing(bracket, [1, 0, 0])[1]) > 0.985 && pointing(bracket, [0, 0, 1])[2] > 0.985
            },
            aim: partAims('bracket'),
          },
          {
            text: 'Press RESET next to ROTATION to turn it back.',
            done: (s) => {
              const bracket = objectOf(s, 'bracket')
              return !!bracket && pointing(bracket, [1, 0, 0])[0] > 0.9999 && pointing(bracket, [0, 0, 1])[2] > 0.9999
            },
            aim: field('bracket', 'rotation-reset'),
          },
        ],
      },
      {
        kind: 'try',
        id: 'try-scale',
        title: 'Resize a part',
        brief: 'Change the cube’s size by measurement and by percentage.',
        setUp: { objects: () => [placed('cube', 'cube', MIDDLE, MIDDLE)] },
        goals: [
          {
            text: 'Make the cube 30 mm tall: select it and type 30 in SIZE ON THE PLATE, H.',
            done: (s) => {
              const cube = objectOf(s, 'cube')
              return !!cube && near(sizeOf(s, 'cube')?.[2] ?? 0, 30, 0.3) && near(cube.sx, cube.sz, 0.001)
            },
            aim: field('cube', 'size-h'),
          },
          {
            text: 'Click UNIFORM so it says PER AXIS, then type 200 in SCALE X.',
            done: (s) => {
              const cube = objectOf(s, 'cube')
              return !!cube && near(cube.sx, 2, 0.01) && Math.abs(cube.sy - cube.sx) > 0.1
            },
            // UNIFORM until it's switched, then SCALE X.
            aim: field('cube', 'uniform', 'scale-x'),
          },
          {
            text: 'Put all three SCALE boxes back to 100.',
            done: (s) => {
              const cube = objectOf(s, 'cube')
              return !!cube && [cube.sx, cube.sy, cube.sz].every((v) => near(v, 1, 0.001))
            },
            aim: field('cube', 'scale'),
          },
        ],
      },
    ],
  },

  {
    id: 'copies',
    title: 'Copies, arranging and undo',
    steps: [
      {
        kind: 'read',
        id: 'copies',
        title: 'Copies, arranging and undo',
        body: (
          <>
            <Terms
              items={[
                ['COPY', <>Puts another of each selected part on the plate. <Kbd>Ctrl</Kbd> + <Kbd>D</Kbd>.</>],
                ['DELETE', <>Takes the selected parts off the plate. The <Kbd>Delete</Kbd> key.</>],
                ['ARRANGE', <>Spreads everything out with a gap between, so nothing touches. <Kbd>A</Kbd>.</>],
                [
                  'Undo and redo',
                  <>
                    <Kbd>Ctrl</Kbd> + <Kbd>Z</Kbd> undoes your last change to the plate, up to 30 steps back.{' '}
                    <Kbd>Ctrl</Kbd> + <Kbd>Y</Kbd> puts it back again. Settings aren&rsquo;t part of undo; each has its
                    own reset arrow.
                  </>,
                ],
              ]}
            />
            <P>
              On a Mac, use <Kbd>⌘</Kbd> wherever it says <Kbd>Ctrl</Kbd>.
            </P>
            <P>
              Parts that overlap print stuck together as one lump. The slicer warns you above the plate, and the list
              marks them <Name>OVERLAPS</Name>.
            </P>
            <P>
              Several parts on one plate usually print faster than one at a time. The catch: if one comes loose, it
              can knock the others over.
            </P>
          </>
        ),
      },
      {
        kind: 'try',
        id: 'try-copies',
        title: 'Copy, arrange, undo',
        brief: 'Four cubes, all on top of each other.',
        setUp: {
          objects: () => [
            placed('cube', 'c1', 120, 120),
            placed('cube', 'c2', 130, 126),
            placed('cube', 'c3', 124, 134),
            placed('cube', 'c4', 134, 116),
          ],
        },
        goals: [
          {
            text: 'Press ARRANGE (the grid button, or A) to spread them out.',
            done: (s) => count(s) === 4 && !anyOverlap(s) && s.plate.objects.every((o) => fits(s, o.id)),
            aim: [{ at: 'tool:arrange' }],
          },
          {
            text: 'Select a cube and press COPY (or Ctrl+D) to make a fifth.',
            done: (s) => count(s) === 5,
            aim: tool('copy', (s) => s.plate.objects[0]?.id),
          },
          {
            text: 'Delete one: select it and press DELETE (or the Delete key).',
            done: (s) => count(s) === 4,
            aim: tool('delete', (s) => s.plate.objects.at(-1)?.id),
          },
          { text: 'Undo that with Ctrl+Z. No keyboard? Copy one instead.', done: (s) => count(s) === 5 },
        ],
      },
    ],
  },

  {
    id: 'fitting',
    title: 'Fitting on the plate',
    steps: [
      {
        kind: 'read',
        id: 'fitting',
        title: 'Fitting on the plate',
        body: (
          <>
            <P>A part turns red, and SLICE PLATE stays grey, when it:</P>
            <List>
              <li>hangs off the edge of the plate,</li>
              <li>is taller than the printer can print (256 mm), or</li>
              <li>touches the hatched corner at the front right, where the printer cleans its nozzle.</li>
            </List>
            <P>
              The line under the top bar names the part and says why. Fix it by moving, turning or shrinking it until
              it&rsquo;s grey again.
            </P>
            <P>
              Overlapping parts are a warning rather than a block: the slicer lets you, but they print as one lump.
              Leave a little room at the edges too, so a brim has space.
            </P>
          </>
        ),
      },
      {
        kind: 'try',
        id: 'try-fitting',
        title: 'Make it fit',
        brief: 'Three parts can’t be printed where they are. Fix all three.',
        setUp: {
          objects: () => [
            placed('cube', 'off', 252, MIDDLE),
            placed('cube', 'corner', 240, 18),
            placed('tower', 'tall', 70, 180, { scale: 4.5 }),
          ],
        },
        goals: [
          {
            text: 'Bring the cube hanging off the right edge back onto the plate.',
            done: (s) => fits(s, 'off'),
            aim: partAims('off'),
          },
          { text: 'Move the other cube out of the hatched corner.', done: (s) => fits(s, 'corner'), aim: partAims('corner') },
          { text: 'The tower is too tall. Shrink it until it fits.', done: (s) => fits(s, 'tall'), aim: partAims('tall') },
        ],
        hint: 'Zoom out to see the whole tower. SCALE or SIZE ON THE PLATE, H will shrink it.',
      },
      {
        kind: 'check',
        id: 'check-red-part',
        title: 'Check: a red part',
        question: 'A part on your plate has turned red. What does that mean?',
        options: [
          { text: 'It’s selected', why: 'Selected parts are gold, not red.' },
          {
            text: 'It can’t be printed where or how it is',
            right: true,
            why: 'Right. Move it, turn it or shrink it until it’s grey. The line above the plate says what’s wrong.',
          },
          { text: 'It needs supports', why: 'The plate doesn’t show supports. You see those in PREVIEW, after slicing.' },
        ],
      },
    ],
  },

  {
    id: 'orientation',
    title: 'Which way up',
    steps: [
      {
        kind: 'read',
        id: 'why-orientation',
        title: 'Which way up',
        body: (
          <>
            <P>
              The way a part sits on the plate matters more than any setting. Four things decide it.
            </P>
            <H>1. Overhangs</H>
            <P>
              Every layer has to rest on the one below it. A wall can lean out to about 45° from straight up and
              still print, because each new line rests half on the line under it. Lean further and the plastic
              droops into the air. That&rsquo;s an <Name>overhang</Name>, and it needs support.
            </P>
            <OverhangDiagram />
            <H>2. A flat face down</H>
            <P>
              The first layer has to stick to the plate. A big flat face sticks well. A point, an edge or a curve
              barely touches it.
            </P>
            <H>3. Strength</H>
            <P>
              Layers stick to each other less well than a line of plastic holds together, so a print breaks most
              easily between layers, the way a stack of paper peels apart. Turn the part so the force on it runs
              along the layers, not across them.
            </P>
            <StrengthDiagram />
            <H>4. Looks</H>
            <P>
              Top surfaces come out smoothest. Curved and sloped sides show small steps between layers. The bottom
              takes on the plate&rsquo;s texture. Anything with supports under it comes out rough where they touched.
            </P>
          </>
        ),
      },
      {
        kind: 'read',
        id: 'orient-tools',
        title: 'The tools for it',
        body: (
          <>
            <Terms
              items={[
                [
                  'LAY ON FACE',
                  <>
                    <Kbd>F</Kbd>. Select a part and the flat faces it could sit on light up. Click one and the part
                    turns to put that face down. The mode stays on, so you can try another face.
                  </>,
                ],
                [
                  'AUTO-ORIENT',
                  'The wand. Turns the selected parts, or all of them, to the way with the least overhang and the most contact with the plate. It doesn’t know what your part is for, so check its choice against strength.',
                ],
                ['ROTATE', 'For anything else: the rings, or exact degrees in ROTATION.'],
              ]}
            />
          </>
        ),
      },
      {
        kind: 'try',
        id: 'try-lay-flat',
        title: 'Lay it on a face',
        brief: 'The bracket is tipped over at an angle. Put it down properly.',
        setUp: { objects: () => [placed('bracket', 'bracket', MIDDLE, MIDDLE, { turns: [turn('x', 35), turn('y', 20)] })] },
        goals: [
          {
            text: 'Switch to LAY ON FACE: the arrow pointing down to a line, or press F.',
            done: (s) => s.mode === 'flat',
            aim: [{ at: 'tool:lay-on-face' }],
          },
          {
            text: 'Click the bracket. The faces it could sit on light up.',
            done: (s) => s.selected.includes('bracket'),
            aim: partAims('bracket'),
          },
          {
            text: 'Click one of its two biggest flat sides to put that side down.',
            done: (s) => restsOn(objectOf(s, 'bracket'), [0, -1, 0]) || restsOn(objectOf(s, 'bracket'), [0, 0, -1]),
            aim: partAims('bracket'),
          },
          {
            text: 'Now stand it on one of its L-shaped ends instead.',
            done: (s) => restsOn(objectOf(s, 'bracket'), [1, 0, 0]) || restsOn(objectOf(s, 'bracket'), [-1, 0, 0]),
            aim: partAims('bracket'),
          },
        ],
        hint: 'Turn the view to reach a face on the far side. Without the 3D view, type angles in ROTATION instead.',
      },
      {
        kind: 'check',
        id: 'check-bracket-strength',
        title: 'Check: the strongest way up',
        question:
          'This bracket will hold up a shelf: its long side is screwed to a wall and the shelf pushes down on the short side. Which way should it print to be strongest?',
        picture: <BracketDiagram />,
        options: [
          {
            text: 'Standing on its foot',
            why: 'The layers run across the bend, so the corner can split along a layer when the shelf pushes down.',
          },
          { text: 'Lying on its back', why: 'Same problem: the layers cross the bend at the corner.' },
          {
            text: 'Standing on one of its L-shaped ends',
            right: true,
            why: 'Right. Every layer is a whole L, so the corner is solid plastic in every layer. It’s a small face to stand on, so it wants a brim, which comes later.',
          },
        ],
      },
      {
        kind: 'check',
        id: 'check-mushroom-orient',
        title: 'Check: no supports needed',
        question: 'Which way up does the mushroom print without supports?',
        picture: <MushroomDiagram />,
        options: [
          { text: 'Standing on its stem, cap on top', why: 'The cap’s underside hangs out flat over nothing. That needs supports.' },
          {
            text: 'Upside down, cap on the plate',
            right: true,
            why: 'Right. Every layer sits on the one below, and the cap is a big flat face to stick with.',
          },
        ],
      },
      {
        kind: 'try',
        id: 'try-auto-orient',
        title: 'Auto-orient',
        brief: 'Let the slicer pick a way up for the mushroom.',
        setUp: { objects: () => [placed('mushroom', 'mushroom', MIDDLE, MIDDLE)] },
        goals: [
          {
            text: 'Select the mushroom and press AUTO-ORIENT (the wand).',
            done: (s) => restsOn(objectOf(s, 'mushroom'), [0, 0, 1]),
            aim: tool('auto-orient', () => 'mushroom'),
          },
        ],
        hint: 'It should turn the mushroom over onto its cap. You could also type 180 in ROTATION X.',
      },
    ],
  },

  {
    id: 'supports',
    title: 'Supports, and needing fewer',
    steps: [
      {
        kind: 'read',
        id: 'what-supports-are',
        title: 'What supports are',
        body: (
          <>
            <P>
              Supports are throwaway scaffolding the slicer adds under overhangs, so they have something to print on.
              You snap or peel them off afterwards.
            </P>
            <P>
              They cost plastic and time, leave rough marks where they touched, and in tight spots they can be hard to
              get out. The fewer the better.
            </P>
            <Careful>
              The club&rsquo;s processes come with supports switched on, so the slicer adds them wherever it thinks
              they&rsquo;re needed. A part with no overhangs gets none.
            </Careful>
            <PreviewCompare
              focus={MUSHROOM_FOCUS}
              options={[
                { name: 'mushroom-up-none', label: 'No supports' },
                { name: 'mushroom-up-normal', label: 'Normal' },
                { name: 'mushroom-up-tree', label: 'Tree' },
                { name: 'mushroom-down', label: 'Upside down' },
              ]}
              caption="The same mushroom sliced four ways by the club’s slicer. Supports are green. Drag the layer slider to watch it build, and turn the view. With no supports the cap starts in mid-air; upside down it needs none and uses the least plastic."
            />
          </>
        ),
      },
      {
        kind: 'read',
        id: 'support-settings',
        title: 'The Support tab',
        body: (
          <>
            <Terms
              items={[
                ['Supports', 'On or off: whether the slicer adds any at all.'],
                [
                  'Support type',
                  'Normal builds straight columns under the whole overhang. Tree grows thin branches up from the plate that reach out to hold it. Tree usually uses less plastic and comes off more easily, especially under curved parts. Normal handles big flat overhangs well.',
                ],
                [
                  'Threshold angle',
                  'How steep an underside can be before it gets supports, measured from flat: 0° is a flat ceiling, 90° is a straight wall. At 30°, only undersides flatter than 30° get supports. Raise it for more supports, lower it for fewer. At 0 the slicer decides by itself from how far each layer hangs past the one below.',
                ],
                [
                  'On build plate only',
                  'Supports may only stand on the plate, never on your part. It keeps support marks off the part, but an overhang above another bit of the part then gets none.',
                ],
                [
                  'Raft layers',
                  'A few throwaway layers printed under the whole part, with the part on top. It helps tiny parts and ones that curl up at the corners stick, but it uses plastic and leaves a rough bottom. 0 means no raft. The club’s plates rarely need one.',
                ],
              ]}
            />
            <ThresholdDiagram />
          </>
        ),
      },
      {
        kind: 'read',
        id: 'fewer-supports',
        title: 'How to need fewer supports',
        body: (
          <>
            <List ordered>
              <li>
                <Name>Turn the part first.</Name> Most supports disappear with a better way up.
              </li>
              <li>
                <Name>Use the 45° rule.</Name> If you&rsquo;re drawing the part yourself, a sloped edge (a chamfer)
                instead of a flat ledge prints without help.
              </li>
              <li>
                <Name>Bridges are fine.</Name> A flat span held up at both ends prints across a short gap, up to about
                2 cm, without supports.
              </li>
              <li>
                <Name>Split it.</Name> A part that needs supports every way up can often be cut into two flat-bottomed
                pieces and glued.
              </li>
              <li>
                <Name>Use Tree supports</Name> for curved or organic shapes.
              </li>
              <li>
                <Name>Switch on On build plate only</Name> when supports would land on a surface you care about.
              </li>
            </List>
          </>
        ),
      },
      {
        kind: 'try',
        id: 'try-supports',
        title: 'Support settings',
        brief: 'Open the Support tab in the settings column and work through it.',
        setUp: { objects: () => [placed('mushroom', 'mushroom', MIDDLE, MIDDLE)] },
        goals: [
          is('enable_support', false, 'Switch Supports off.'),
          {
            text: 'Switch Supports back on, and set Support type to Normal.',
            done: (s) => setting(s, 'enable_support') === true && setting(s, 'support_type') === 'normal(auto)',
            aim: (s) => settingAims(setting(s, 'enable_support') === true ? 'support_type' : 'enable_support'),
          },
          is('support_threshold_angle', 45, 'Set Threshold angle to 45, and press Enter.'),
          is('support_on_build_plate_only', true, 'Switch on On build plate only.'),
          is('raft_layers', 2, 'Set Raft layers to 2.'),
          reset('raft_layers', 'Press the gold reset arrow beside Raft layers to put it back to 0.'),
        ],
        hint: 'A changed setting turns gold, with a reset arrow to put it back.',
      },
      {
        kind: 'check',
        id: 'check-fewer-supports',
        title: 'Check: fewer supports',
        question: 'What saves the most supports?',
        options: [
          { text: 'Tree supports', why: 'Tree supports use less than normal ones, but none at all is less still.' },
          { text: 'Turning the part so it doesn’t need them', right: true, why: 'Right. Orientation first, always.' },
          { text: 'A higher threshold angle', why: 'A higher angle supports more, not less.' },
        ],
      },
    ],
  },

  {
    id: 'adhesion',
    title: 'Sticking to the plate',
    steps: [
      {
        kind: 'read',
        id: 'adhesion',
        title: 'Brim, skirt and raft',
        body: (
          <>
            <P>
              If the first layer comes loose, the whole print fails, often into a tangle of plastic. Most parts stick
              fine on their own. A few need help.
            </P>
            <BrimSkirtDiagram />
            <Terms
              items={[
                [
                  'Brim',
                  'Extra rings of plastic around the bottom of the part, on the first layer only, joined to it. More grip for tall thin parts, small feet and sharp corners that lift. Peel it off afterwards. Auto adds one where the slicer thinks it’s needed. Outer only goes around the outside, Inner only inside holes, Outer and inner both. None is off.',
                ],
                ['Brim width', 'How far the brim reaches out from the part, in mm. 3 to 8 mm is usual.'],
                [
                  'Skirt loops',
                  'Lines drawn around everything before the print starts, not touching it. They get the plastic flowing smoothly. They don’t help anything stick. 0 means none.',
                ],
                ['Raft layers', 'In the Support tab: a whole base under the part. Rarely needed.'],
                [
                  'First layer height',
                  'In the Quality tab. A slightly thicker first layer is more forgiving of a plate that isn’t perfectly flat.',
                ],
              ]}
            />
            <PreviewCompare
              focus={TOWER_FOCUS}
              options={[
                { name: 'tower-none', label: 'No brim' },
                { name: 'tower-brim', label: '5 mm brim' },
              ]}
              caption="An 8 mm tower, 60 mm tall, sliced without and with a brim. Drag the slider to layer 1 to see it. A few grams more and it won’t wobble loose."
            />
          </>
        ),
      },
      {
        kind: 'try',
        id: 'try-brim',
        title: 'Add a brim',
        brief: 'The tower needs help standing up. The brim and skirt are in the Others tab.',
        setUp: { objects: () => [placed('tower', 'tower', MIDDLE, MIDDLE)] },
        goals: [
          is('brim_type', 'outer_only', 'Set Brim to Outer only.'),
          is('brim_width', 8, 'Set Brim width to 8.'),
          is('skirt_loops', 2, 'Set Skirt loops to 2.'),
        ],
      },
      {
        kind: 'check',
        id: 'check-brim',
        title: 'Check: who needs a brim',
        question: 'Which of these most needs a brim?',
        options: [
          { text: 'A flat plate, 10 cm across', why: 'A big flat bottom grips well on its own.' },
          { text: 'A tall, thin tower', right: true, why: 'Right. A small foot and a lot of height to wobble.' },
          { text: 'A 2 cm cube', why: 'A cube sits on a whole flat face. It’s fine.' },
        ],
      },
    ],
  },

  {
    id: 'materials',
    title: 'Printer, filament and process',
    steps: [
      {
        kind: 'read',
        id: 'profiles',
        title: 'Printer, filament and process',
        body: (
          <>
            <H>Printer</H>
            <P>
              Which machine prints it. The club&rsquo;s is the <Name>CC1</Name>, an Elegoo Centauri Carbon: 256 mm
              each way to print in, a 0.4 mm nozzle, and a textured PEI plate, a sheet that parts stick to while
              it&rsquo;s hot and come off once it cools. When there&rsquo;s more than one printer, you choose here,
              and the plate drawn changes to match.
            </P>
            <H>Filament</H>
            <Terms
              items={[
                [
                  'PLA',
                  'Stiff, easy to print and good at detail. The right choice for most things. It softens at about 55 °C, so not for a hot car or next to a motor.',
                ],
                [
                  'PETG',
                  'Tougher: it bends a little before it breaks, and takes more heat. A bit stringier. For parts that get knocked about, sit outside or get warm.',
                ],
              ]}
            />
            <P>
              The list shows what the club has. Officers take a filament off when the spool runs out. Changing the
              filament changes the temperatures and speeds for you. Colour isn&rsquo;t a setting: ask for one in{' '}
              <Name>SPECIAL REQUESTS</Name> when you send the print.
            </P>
            <H>Process</H>
            <P>
              A ready-made set of settings. The line under it says what it&rsquo;s set to. All three of the
              club&rsquo;s use 0.2 mm layers:
            </P>
            <Terms
              items={[
                ['Standard', '2 walls and 15% infill in lines. Right for most prints.'],
                ['Q', '3 walls and 10% gyroid infill. A bit stronger all round.'],
                ['Q-S', '6 walls and 6% 3D honeycomb. Thick walls for parts that take a beating.'],
              ]}
            />
            <P>
              Change a setting under the process and it becomes yours: it turns gold, with a reset arrow beside it to
              go back to the process&rsquo;s value, and its tab shows how many you&rsquo;ve changed. Temperatures,
              speeds and cooling come with the filament and process, and can&rsquo;t be changed.
            </P>
          </>
        ),
      },
      {
        kind: 'try',
        id: 'try-profiles',
        title: 'Choose a filament and process',
        brief: 'The top of the settings column.',
        setUp: { objects: () => [placed('cube', 'cube', MIDDLE, MIDDLE)] },
        goals: [
          {
            text: 'Change FILAMENT to PETG.',
            done: (s) => s.plate.filamentId === PRACTICE_PETG,
            aim: [{ at: 'filament', side: 'right' }, { at: 'drawer:settings' }],
          },
          {
            text: 'Change PROCESS to Q-S.',
            done: (s) => s.plate.processId === 'practice-qs',
            aim: [{ at: 'process', side: 'right' }, { at: 'drawer:settings' }],
          },
          {
            text: 'In the Strength tab, change Walls to 4 and press Enter.',
            done: (s) => s.plate.overrides['wall_loops'] === 4,
            aim: settingAims('wall_loops'),
          },
          reset('wall_loops', 'Press the gold reset arrow beside Walls to go back to the process’s 6.'),
        ],
      },
      {
        kind: 'check',
        id: 'check-filament',
        title: 'Check: choosing a filament',
        question: 'You’re printing a mount for a robot that will sit outside in the sun. Which filament?',
        options: [
          { text: 'PLA', why: 'PLA softens in the heat and can sag in the sun.' },
          { text: 'PETG', right: true, why: 'Right. It takes the heat and the knocks better.' },
        ],
      },
    ],
  },

  {
    id: 'quality',
    title: 'Quality settings',
    steps: [
      {
        kind: 'read',
        id: 'quality',
        title: 'The Quality tab',
        body: (
          <>
            <H>Layer height</H>
            <P>
              How thick each layer is. Thinner layers give smoother sides and finer detail, but there are more of
              them, so the print takes longer. 0.2 mm suits most prints, 0.12 mm fine detail, 0.28 mm quick rough
              parts.
            </P>
            <LayerHeightDiagram />
            <SliceNumbers
              rows={[
                { name: 'block-layer-0.12', label: '0.12 mm layers' },
                { name: 'block-standard', label: '0.20 mm layers' },
                { name: 'block-layer-0.28', label: '0.28 mm layers' },
              ]}
              caption="A 30 × 30 × 12 mm block in the club’s slicer. Same plastic, very different time."
            />
            <Terms
              items={[
                ['First layer height', 'The thickness of the very first layer. A bit thicker sticks better and hides small dips in the plate.'],
                [
                  'Wall generator',
                  'How walls are drawn. Classic uses lines of one width. Arachne changes the width of its lines to fill thin bits, so thin walls and small text come out fuller. Arachne is usually better for small detail.',
                ],
                [
                  'Seam position',
                  'Each layer’s outer loop starts and stops somewhere, and that spot leaves a tiny bump. Nearest puts it wherever is quickest, often in a corner. Aligned lines them up in one place, easy to find and sand. Back lines them up at the back of the part. Random scatters them: no line, but small bumps all over.',
                ],
                [
                  'Ironing',
                  'After a flat top is printed, the hot nozzle goes over it again with a trickle of plastic to smooth it. Top surfaces irons every flat area facing up. Topmost surface irons only the very top. All solid layers irons every solid layer. None is off. It looks great on flat tops and adds time.',
                ],
              ]}
            />
            <SeamDiagram />
          </>
        ),
      },
      {
        kind: 'try',
        id: 'try-quality',
        title: 'Quality settings',
        brief: 'The Quality tab. Numbers save when you press Enter or click away.',
        setUp: { objects: () => [placed('block', 'block', MIDDLE, MIDDLE)] },
        goals: [
          is('layer_height', 0.12, 'Set Layer height to 0.12.'),
          is('initial_layer_print_height', 0.25, 'Set First layer height to 0.25.'),
          is('wall_generator', 'arachne', 'Set Wall generator to Arachne.'),
          is('seam_position', 'back', 'Set Seam position to Back.'),
          is('ironing_type', 'topmost', 'Set Ironing to Topmost surface.'),
        ],
      },
    ],
  },

  {
    id: 'strength',
    title: 'Strength settings',
    steps: [
      {
        kind: 'read',
        id: 'walls-and-shells',
        title: 'Walls, tops and bottoms',
        body: (
          <>
            <CrossSectionDiagram />
            <Terms
              items={[
                [
                  'Walls',
                  'How many lines go around the outside of each layer. Most of a part’s strength is in its walls. 2 is fine for something that sits on a shelf; 3 or 4 for parts that take a load. More walls is the best way to make a part stronger.',
                ],
                [
                  'Top layers and Top thickness',
                  'The solid layers that close off the top, as a count and as a thickness. The slicer uses whichever comes out thicker. Too few and the top shows gaps or bumps.',
                ],
                ['Bottom layers and Bottom thickness', 'The same for the bottom.'],
              ]}
            />
            <PreviewCompare
              focus={BLOCK_FOCUS}
              options={[
                { name: 'block-standard', label: '2 walls' },
                { name: 'block-walls-5', label: '5 walls' },
              ]}
              caption="The block with the Standard process’s 2 walls and with 5. Drag the slider to the middle to see inside."
            />
          </>
        ),
      },
      {
        kind: 'read',
        id: 'infill',
        title: 'Infill',
        body: (
          <>
            <H>Infill density</H>
            <P>
              How full the inside is: 0% is hollow, 100% is solid. 10 to 20% suits most prints, 30 to 50% strong
              parts. Past about 40%, more infill costs plastic faster than it adds strength. More walls helps more.
            </P>
            <SliceNumbers
              rows={[
                { name: 'block-infill-0', label: '0%' },
                { name: 'block-standard', label: '15%' },
                { name: 'block-infill-40', label: '40%' },
                { name: 'block-infill-100', label: '100%' },
              ]}
              caption="The 30 × 30 × 12 mm block at four densities."
            />
            <H>Infill pattern</H>
            <P>The shape the inside is filled with.</P>
            <InfillTiles />
            <Terms
              items={[
                ['Rectilinear', 'Straight lines that change direction each layer. Quick.'],
                ['Aligned rectilinear', 'The same, with every layer going the same way.'],
                ['Zig zag', 'Lines joined end to end, so the nozzle doesn’t stop.'],
                ['Line', 'Straight lines. Quick. The Standard process uses it.'],
                ['Grid', 'Lines crossing on every layer. Strong, but the nozzle crosses its own lines.'],
                ['Triangles', 'A mesh of triangles. Stiff from side to side.'],
                ['Tri-hexagon', 'Triangles and hexagons together. Also stiff from side to side.'],
                ['Cubic', 'Tilted cubes stacked up. Strong in every direction.'],
                ['Adaptive cubic', 'Cubic that gets sparser in the middle of big parts. Saves plastic.'],
                ['Quarter cubic', 'A finer cubic.'],
                ['Support cubic', 'Only as much as the top needs to rest on. Saves the most plastic, but the part is weak.'],
                ['Lightning', 'Thin branches that only hold up the top. Fastest and weakest: for models that just sit there.'],
                ['Honeycomb', 'Hexagons. Strong and slow.'],
                ['3D honeycomb', 'Hexagons that shift as they go up. Strong in every direction. Q-S uses it.'],
                ['Cross hatch', 'Crossing lines that change direction as the print rises.'],
                ['Gyroid', 'A wavy pattern, strong in every direction and quick. A good all-rounder. Q uses it.'],
                ['Concentric', 'Rings that follow the outline. Good for bendy parts.'],
              ]}
            />
            <PreviewCompare
              focus={BLOCK_FOCUS}
              options={[
                { name: 'block-standard', label: '15% line' },
                { name: 'block-infill-40', label: '40% line' },
                { name: 'block-gyroid', label: '15% gyroid' },
              ]}
              caption="Drag the layer slider to the middle of the block to see the infill."
            />
            <H>Top surface pattern and Bottom surface pattern</H>
            <P>
              How the visible top and bottom are filled. <Name>Monotonic</Name> lays every line in the same order so
              the surface shines evenly; <Name>Monotonic line</Name>, <Name>Rectilinear</Name> and{' '}
              <Name>Aligned rectilinear</Name> are other straight-line fills. <Name>Concentric</Name> draws rings
              that follow the outline. <Name>Hilbert curve</Name>, <Name>Archimedean chords</Name> and{' '}
              <Name>Octagram spiral</Name> are decorative patterns.
            </P>
          </>
        ),
      },
      {
        kind: 'try',
        id: 'try-strength',
        title: 'Strength settings',
        brief: 'The Strength tab.',
        setUp: { objects: () => [placed('block', 'block', MIDDLE, MIDDLE)] },
        goals: [
          is('wall_loops', 3, 'Set Walls to 3.'),
          is('top_shell_layers', 6, 'Set Top layers to 6.'),
          is('sparse_infill_density', 25, 'Set Infill density to 25%.'),
          is('sparse_infill_pattern', 'gyroid', 'Set Infill pattern to Gyroid.'),
          is('top_surface_pattern', 'concentric', 'Set Top surface pattern to Concentric.'),
        ],
      },
      {
        kind: 'check',
        id: 'check-strength',
        title: 'Check: a part that snaps',
        question: 'Your part keeps snapping. What helps most?',
        options: [
          { text: 'More walls', right: true, why: 'Right. The walls carry most of the load.' },
          { text: '100% infill', why: 'It helps a little and costs a lot of plastic. Walls first.' },
          { text: 'Thinner layers', why: 'Thinner layers look better but aren’t stronger.' },
        ],
      },
    ],
  },

  {
    id: 'others',
    title: 'Vase mode and fuzzy skin',
    steps: [
      {
        kind: 'read',
        id: 'others',
        title: 'The rest of the Others tab',
        body: (
          <>
            <Terms
              items={[
                [
                  'Vase mode',
                  'Prints one wall that spirals up without stopping: a solid bottom, no top and nothing inside. Fast and smooth for cups, vases and lamp shades. Only for one part on the plate; the slicer refuses more. Don’t count on it holding water.',
                ],
                [
                  'Fuzzy skin',
                  'Shakes the outer wall a tiny bit as it prints, for a rough, grippy finish that hides layer lines. Outer walls does the outside only; All walls does holes too. Off is off.',
                ],
              ]}
            />
            <P>Brim, Brim width and Skirt loops are in this tab too.</P>
          </>
        ),
      },
      {
        kind: 'try',
        id: 'try-others',
        title: 'Others',
        brief: 'The Others tab.',
        setUp: { objects: () => [placed('tower', 'tower', MIDDLE, MIDDLE)] },
        goals: [
          is('spiral_mode', true, 'Switch on Vase mode.'),
          is('spiral_mode', false, 'Switch it off again.'),
          is('fuzzy_skin', 'external', 'Set Fuzzy skin to Outer walls.'),
        ],
      },
      {
        kind: 'check',
        id: 'check-vase',
        title: 'Check: vase mode',
        question: 'When does vase mode make sense?',
        options: [
          { text: 'A pencil cup, on its own on the plate', right: true, why: 'Right. One part, one thin wall, open at the top.' },
          { text: 'A gear', why: 'Vase mode prints one thin wall with nothing inside. A gear needs to be solid.' },
          { text: 'Four parts at once', why: 'Vase mode takes one part on the plate.' },
        ],
      },
    ],
  },

  {
    id: 'slicing',
    title: 'Slicing and the preview',
    steps: [
      {
        kind: 'read',
        id: 'slice-and-preview',
        title: 'Slicing and checking the preview',
        body: (
          <>
            <H>Slicing</H>
            <P>
              <Name>SLICE PLATE</Name> sends the plate to the club&rsquo;s slicer. It takes from a few seconds to a
              minute. When it&rsquo;s done, the status line shows the print time and the plastic in grams and metres,
              and <Name>PREVIEW</Name> opens.
            </P>
            <P>
              Change anything after slicing and the status line says so. Slice again before you send it.
            </P>
            <P>
              <Name>SLICE PLATE</Name> stays grey while something is wrong: nothing on the plate, a red part, a STEP
              file still converting, or a printer, filament or process to pick. The line under the top bar says which.
            </P>
            <H>The preview</H>
            <Terms
              items={[
                [
                  'Layer slider',
                  'Up the right side, or along the bottom on a phone. Drag it down to watch the print build layer by layer and to see inside. It shows the layer number and its height.',
                ],
                [
                  'PATHS',
                  'What the colours mean: outer wall (gold), inner wall (grey), sparse infill (blue), solid infill (red), support (green), and skirt, brim and purge (pale blue). The purge is a line the printer draws near the edge of the plate to clean the nozzle before it starts. Click a kind to hide it. The grams beside each say where your plastic goes. On a phone, tap PATHS to open the list.',
                ],
              ]}
            />
            <H>What to check before you send it</H>
            <List>
              <li>Layer 1: is everything that should touch the plate touching it?</li>
              <li>Is anything printed in mid-air, with nothing under it?</li>
              <li>Are supports where you expect them, and nowhere you don&rsquo;t?</li>
              <li>Did thin bits make it? A wall thinner than the nozzle can disappear.</li>
              <li>Do the time and grams make sense?</li>
            </List>
          </>
        ),
      },
      {
        kind: 'try',
        id: 'try-slice',
        title: 'Slice and look',
        brief: 'The mushroom standing on its stem, with the Standard process. Slice it and look at the result.',
        setUp: { objects: () => [placed('mushroom', 'mushroom', MIDDLE, MIDDLE)] },
        goals: [
          { text: 'Press SLICE PLATE.', done: isSliced, aim: [{ at: 'slice' }] },
          {
            text: 'In PREVIEW, drag the layer slider all the way down to layer 1.',
            done: (s) => s.tab === 'preview' && s.layers?.top === 0,
            aim: (s) => [{ at: s.tab === 'preview' ? 'layers' : 'tab:preview' }],
          },
          {
            text: 'In PATHS, click Support to hide it. On a phone, tap PATHS to open it first.',
            done: (s) => s.layers?.hidden.includes('support') ?? false,
            aim: (s) => (s.tab === 'preview' ? [{ at: 'path:support' }, { at: 'paths' }] : [{ at: 'tab:preview' }]),
          },
        ],
        hint: 'Practice slices are made ahead of time by the club’s slicer, for this mushroom.',
      },
      {
        kind: 'try',
        id: 'try-fix-slice',
        title: 'Fix it and slice again',
        brief: 'Those supports cost plastic. Get rid of them and compare.',
        setUp: { objects: () => [placed('mushroom', 'mushroom', MIDDLE, MIDDLE)] },
        goals: [
          { text: 'Slice it as it is, and note the grams.', done: isSliced, aim: [{ at: 'slice' }] },
          {
            text: 'Back in PREPARE, turn the mushroom upside down.',
            done: (s) => restsOn(objectOf(s, 'mushroom'), [0, 0, 1]),
            aim: (s) => (s.tab === 'prepare' ? tool('auto-orient', () => 'mushroom')(s) : [{ at: 'tab:prepare' }]),
          },
          {
            text: 'Slice it again. Fewer grams?',
            done: (s) => isSliced(s) && s.sliced?.name.startsWith('mushroom-down') === true,
            aim: [{ at: 'slice' }],
          },
          {
            text: 'Set Brim to Outer only and slice once more.',
            done: (s) => isSliced(s) && s.sliced?.name === 'mushroom-down-brim',
            aim: (s) => (setting(s, 'brim_type') === 'outer_only' ? [{ at: 'slice' }] : settingAims('brim_type')),
          },
        ],
      },
      {
        kind: 'check',
        id: 'check-preview-green',
        title: 'Check: the green paths',
        question: 'In PREVIEW, what are the green paths?',
        options: [
          { text: 'The outer wall', why: 'The outer wall is gold.' },
          { text: 'Support', right: true, why: 'Right. Green is support, which comes off afterwards.' },
          { text: 'Infill', why: 'Sparse infill is blue and solid infill is red.' },
        ],
      },
    ],
  },

  {
    id: 'sending',
    title: 'Sending it to print',
    steps: [
      {
        kind: 'read',
        id: 'sending',
        title: 'Sending it to print',
        body: (
          <>
            <P>
              Once the plate is sliced, <Name>REQUEST PRINT</Name> turns gold. It opens a short form:
            </P>
            <Terms
              items={[
                [
                  'What it is for',
                  'A personal print comes out of your allowance for the semester, and the form says what you’ll have left. A club project you’re on doesn’t count against it.',
                ],
                ['Special requests', 'Anything the officer should know, like a colour.'],
              ]}
            />
            <P>
              <Name>SEND IT</Name> puts it in the queue. It shows on the printing page as <Name>WAITING</Name>. Until
              an officer starts it, <Name>EDIT</Name> takes it back to the slicer; send it again when you&rsquo;re done.
            </P>
            <P>
              Plates you haven&rsquo;t sent are drafts. They save as you go and are listed on the printing page under{' '}
              <Name>MY DRAFTS</Name>. A draft left alone for a while is deleted, and the list says when.
            </P>
            <P>
              Going over your allowance is allowed; an officer decides whether to print it. Officers may also turn
              down a plate that won&rsquo;t print well, and they&rsquo;ll say why.
            </P>
          </>
        ),
      },
      {
        kind: 'try',
        id: 'try-send',
        title: 'Send it',
        brief: 'The whole thing, start to finish. Practice sends nothing.',
        setUp: { objects: () => [placed('mushroom', 'mushroom', MIDDLE, MIDDLE, { turns: [turn('x', 180)] })] },
        goals: [
          {
            text: 'Slice the plate.',
            done: (s, memory) => {
              memory['sent'] = s.sent
              return isSliced(s)
            },
            aim: [{ at: 'slice' }],
          },
          {
            text: 'Press REQUEST PRINT, choose what it’s for and press SEND IT.',
            done: (s, memory) => s.sent > Number(memory['sent'] ?? s.sent),
            aim: [{ at: 'request' }],
          },
        ],
      },
      {
        kind: 'check',
        id: 'check-allowance',
        title: 'Check: going over',
        question: 'You have 100 g of your allowance left and send a personal print that needs 120 g. What happens?',
        options: [
          { text: 'It’s refused', why: 'Going over is allowed. An officer decides.' },
          { text: 'It’s sent, and an officer decides whether to print it', right: true, why: 'Right. The form warns you first.' },
          { text: 'It’s charged to a project', why: 'Only if you choose a project you’re on.' },
        ],
      },
      {
        kind: 'check',
        id: 'check-edit',
        title: 'Check: fixing a sent plate',
        question: 'You spot a mistake right after sending. What do you do?',
        options: [
          { text: 'Send another one', why: 'That puts two in the queue.' },
          {
            text: 'Press EDIT on the printing page, fix it and send it again',
            right: true,
            why: 'Right. That works until an officer starts printing it. After that, talk to them.',
          },
          { text: 'Nothing can be done', why: 'EDIT takes it back while it’s still waiting.' },
        ],
      },
    ],
  },

  {
    id: 'finish',
    title: 'Finish',
    steps: [{ kind: 'finish', id: 'finish', title: 'You’re ready' }],
  },
]
