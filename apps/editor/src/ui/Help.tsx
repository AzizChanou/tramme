// The help button: the guided tours of the page, whoever declared them (the
// editor, a project's plugins, a script), and whether they open on their own.

import type { MenuItem } from './controls.tsx';
import { openMenu } from './controls.tsx';
import { Icon } from './icons.tsx';
import { isSeen, resetSeen, setAutoTours, startTour, toursFor, toursState, toursVersion, type TourPage } from '../tours/engine.ts';
import { t } from '../i18n/index.ts';

export function helpMenu(e: MouseEvent, page: TourPage) {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const tours = toursFor(page);
  const items: MenuItem[] = [{ section: t('common.guidedTours') }];
  if (!tours.length) items.push({ label: t('help.noTourForThis'), disabled: true, onClick: () => {} });
  for (const tour of tours) {
    items.push({ label: t(tour.title), icon: isSeen(tour) ? 'check' : 'play', hint: tour.source && tour.source !== 'tramme' ? tour.source : undefined, onClick: () => startTour(tour.id) });
  }
  const auto = toursState.peek().auto;
  items.push('sep',
    { label: auto ? t('help.stopOfferingThemOn') : t('help.offerThemOnOpening'), icon: auto ? 'x' : 'check', onClick: () => setAutoTours(!auto) },
    { label: t('help.replayEverythingAsThe'), icon: 'undo', onClick: resetSeen });
  openMenu({ clientX: Math.max(8, r.right - 260), clientY: r.bottom + 4 }, items);
}

export function HelpButton({ page }: { page: TourPage }) {
  void toursVersion.value;
  return <button class="icon-btn" data-tour="help" title={t('common.helpAndGuidedTours')} onClick={(e) => helpMenu(e as unknown as MouseEvent, page)}><Icon name="help" /></button>;
}
