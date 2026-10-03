// Sound: the library, the sound tools of the assistant and the / menu, how a
// sound layer sounds, the mix checked and exported.

import { comp, S, select } from '../state.ts';
import { press, registerTour } from './engine.ts';
import { m } from '../i18n/index.ts';

/** the first sound layer of the open composition, if any */
const firstSound = () => Object.entries(comp.peek().layers).find(([, l]) => l.type === 'audio')?.[0];

registerTour({
  id: 'sound',
  title: m('tours.sound.giveTheVideoIts'),
  summary: m('tours.sound.libraryToolsLayersMix'),
  page: 'editor',
  order: 25,
  steps: [
    {
      title: m('tours.sound.soundInTramme'),
      body: m('tours.sound.everySoundIsA'),
    },
    {
      target: 'assistant-composer', side: 'top', align: 'center',
      title: m('tours.sound.askTheAssistant'),
      body: m('tours.sound.writeSoundDesignOr'),
    },
    {
      target: 'assistant-composer', side: 'top', align: 'center',
      title: m('tours.sound.orOnYourOwn'),
      body: m('tours.sound.typeSfxToSearch'),
    },
    {
      target: 'timeline', side: 'top', align: 'start',
      before: () => press('bottom-tab-timeline'),
      title: m('tours.sound.eachSoundIsA'),
      body: m('tours.sound.itsBarStartsWhere'),
    },
    {
      target: 'inspector', side: 'left', align: 'start',
      before: () => { press('left-tab-layers'); const id = firstSound(); if (id) select([id]); },
      title: m('tours.sound.howItSounds'),
      body: m('tours.sound.volumeAnimateItFor'),
    },
    {
      target: 'transport', side: 'top', align: 'start',
      title: m('tours.sound.listenAndCheck'),
      body: m('tours.sound.playWithSpaceThe'),
    },
    {
      target: 'export', side: 'bottom', align: 'end',
      title: m('tours.sound.exportWithItsSound'),
      body: m('tours.sound.mp4AndWebmCarry'),
    },
  ],
  available: () => S.ready.value,
});
