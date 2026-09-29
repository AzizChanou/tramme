// The home screen, the first time it opens.

import { registerTour } from './engine.ts';
import { m } from '../i18n/index.ts';

registerTour({
  id: 'home',
  title: m('tours.home.discoverTheHomeScreen'),
  summary: m('tours.home.createOpenAndFind'),
  page: 'home',
  auto: true,
  order: 10,
  steps: [
    {
      title: m('tours.home.welcomeToTramme'),
      body: m('tours.home.trammeIsAMotion'),
    },
    {
      target: 'home-new', side: 'bottom', align: 'end',
      title: m('common.newProject'),
      body: m('tours.home.chooseAFormatLandscape'),
    },
    {
      target: 'home-video', side: 'bottom', align: 'end',
      title: m('tours.home.startFromAVideo'),
      body: m('tours.home.aVideoWhereYou'),
    },
    {
      target: 'home-open', side: 'bottom', align: 'end',
      title: m('common.openAFile'),
      body: m('tours.home.aTrammeProjectSaved'),
    },
    {
      target: 'home-projects', side: 'bottom', align: 'start',
      when: () => !!document.querySelector('.card:not(.ghost-card)'),
      title: m('tours.home.yourProjects'),
      body: m('tours.home.mostRecentFirstWith'),
    },
    {
      target: 'home-examples', side: 'top', align: 'start',
      title: m('tours.home.startFromAnExample'),
      body: m('tours.home.eachExampleBecomesYour'),
    },
    {
      target: 'settings', side: 'bottom', align: 'end',
      title: m('common.settings'),
      body: m('tours.home.themePreviewQualityFor'),
    },
    {
      target: 'help', side: 'bottom', align: 'end',
      title: m('tours.home.replayATour'),
      body: m('tours.home.allGuidedToursAre'),
    },
  ],
});
