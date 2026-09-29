// The editor, the first time a project opens.

import { press, registerTour } from './engine.ts';
import { m } from '../i18n/index.ts';

registerTour({
  id: 'editor',
  title: m('tours.editor.discoverTheEditor'),
  summary: m('tours.editor.theEditorSPanels'),
  page: 'editor',
  auto: true,
  order: 10,
  steps: [
    {
      title: m('tours.editor.theEditor'),
      body: m('tours.editor.everythingYouDoHere'),
    },
    {
      target: 'viewport', side: 'left', align: 'center',
      title: m('tours.editor.thePreview'),
      body: m('tours.editor.theSameEngineAs'),
    },
    {
      target: 'quality', side: 'bottom', align: 'center',
      title: m('tours.editor.previewQuality'),
      body: m('tours.editor.thePreviewCanLighten'),
    },
    {
      target: 'left-panel', side: 'right', align: 'start',
      before: () => press('left-tab-layers'),
      title: m('tours.editor.theLayersPanel'),
      body: m('tours.editor.dragToReorderOr'),
    },
    {
      target: 'left-panel', side: 'right', align: 'start',
      before: () => press('left-tab-assets'),
      title: m('tours.editor.assetsAndCompositions'),
      body: m('tours.editor.importImagesFontsSounds'),
    },
    {
      target: 'transport', side: 'top', align: 'start',
      before: () => press('left-tab-layers'),
      title: m('tours.editor.playback'),
      body: m('tours.editor.spaceToPlayOr'),
    },
    {
      target: 'timeline', side: 'top', align: 'center',
      before: () => press('bottom-tab-timeline'),
      title: m('tours.editor.theTimeline'),
      body: m('tours.editor.moveOrTrimThe'),
    },
    {
      target: 'bottom-tab-graph', side: 'top', align: 'center',
      title: m('tours.editor.theCurveEditor'),
      body: m('tours.editor.valuesOverTimeWith'),
    },
    {
      target: 'inspector', side: 'left', align: 'start',
      title: m('tours.editor.theInspector'),
      body: m('tours.editor.thePropertiesOfThe'),
    },
    {
      target: 'assistant', side: 'left', align: 'end',
      title: m('common.theAssistant'),
      body: m('tours.editor.askForAChange'),
    },
    {
      target: 'export', side: 'bottom', align: 'end',
      title: m('common.export'),
      body: m('tours.editor.mp4WebmWithTransparency'),
    },
    {
      target: 'help', side: 'bottom', align: 'end',
      title: m('tours.editor.letSGo'),
      body: m('tours.editor.moreToursAreHere'),
    },
  ],
});
