// A question the user answers before something happens (a sound that costs
// money): the editor shows it in a dialog, the caller waits for the answer.

import { signal } from '@preact/signals';

export interface Question { title: string; text: string; yes: string; resolve: (yes: boolean) => void }

/** the question shown, if any */
export const question = signal<Question | null>(null);

/** asks; a question still open is answered no */
export function confirmWith(title: string, text: string, yes: string): Promise<boolean> {
  return new Promise((resolve) => {
    question.peek()?.resolve(false);
    question.value = { title, text, yes, resolve };
  });
}

export function answer(yes: boolean) {
  const q = question.peek();
  question.value = null;
  q?.resolve(yes);
}
