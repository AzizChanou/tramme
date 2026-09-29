// Drawn animation: drawings frame by frame, the exposure sheet.

import { comp, S, select } from '../state.ts';
import { press, registerTour } from './engine.ts';
import { m } from '../i18n/index.ts';

/** the first sequence layer of the open composition, if any */
const firstSequence = () => Object.entries(comp.peek().layers).find(([, l]) => l.type === 'sequence')?.[0];

registerTour({
  id: 'drawn-animation',
  title: m('tours.drawn.animateDrawingsFrameBy'),
  summary: m('tours.drawn.imageSequencesHoldExposure'),
  page: 'editor',
  order: 20,
  steps: [
    {
      title: m('tours.drawn.drawnAnimation'),
      body: m('tours.drawn.anImageSequencePlays'),
    },
    {
      target: 'left-panel', side: 'right', align: 'start',
      before: () => press('left-tab-assets'),
      title: m('tours.drawn.n1ImportTheDrawings'),
      body: m('tours.drawn.dropThemHereTogether'),
    },
    {
      target: 'left-panel', side: 'right', align: 'start',
      title: m('tours.drawn.n2AnimateTheFolder'),
      body: m('tours.drawn.rightClickOneOf'),
    },
    {
      target: 'inspector', side: 'left', align: 'start',
      before: () => { press('left-tab-layers'); const id = firstSequence(); if (id) select([id]); },
      title: m('tours.drawn.n3SetTheRhythm'),
      body: m('tours.drawn.hold2GivesThe'),
    },
    {
      target: 'transport', side: 'top', align: 'start',
      title: m('tours.drawn.n4Check'),
      body: m('tours.drawn.playWithSpaceThe'),
    },
  ],
  available: () => S.ready.value,
});
