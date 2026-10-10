// A question the user answers before something happens (a generation that
// costs money): asked in the conversation while the assistant works, in a
// dialog otherwise; the caller waits for the answer. When the assistant works
// on its own (its changes applied without the user), nothing is asked: each
// paid generation counts against the allowance of its turn (Sound settings),
// so a turn left alone never stops on a question.

import { signal } from '@preact/signals';
import { prefs } from './settings.ts';

export interface Question {
  title: string;
  text: string;
  yes: string;
  resolve: (yes: boolean) => void;
  /** asked during a turn of the assistant: shown in the conversation */
  inChat: boolean;
}

/** the question shown, if any */
export const question = signal<Question | null>(null);
/** conversations on screen that show the questions of a turn (otherwise the dialog does) */
export const chatShown = signal(0);

/** the turn of the assistant running, if any; auto when its changes apply without the user */
let turn: { auto: boolean; paid: number } | null = null;

export function turnBegins(auto: boolean) { turn = { auto, paid: 0 }; }
/** the turn is over: a question still open is answered no */
export function turnEnds() {
  turn = null;
  if (question.peek()?.inChat) answer(false);
}

/** asks; a question still open is answered no */
export function confirmWith(title: string, text: string, yes: string): Promise<boolean> {
  return new Promise((resolve) => {
    question.peek()?.resolve(false);
    question.value = { title, text, yes, resolve, inChat: !!turn };
  });
}

export function answer(yes: boolean) {
  const q = question.peek();
  question.value = null;
  q?.resolve(yes);
}

/**
 * A generation that costs money: allowed by the turn's allowance when the
 * assistant works on its own, by the user's yes otherwise (unless the
 * settings say not to ask). Throws when it is not, saying what to do instead.
 */
export async function payFor(title: string, text: string, yes: string, instead: string): Promise<void> {
  const p = prefs.peek();
  if (turn?.auto) {
    if (turn.paid >= p.paidPerTurn) throw new Error(`the allowance of ${p.paidPerTurn} paid generations for this turn is used up (Sound settings): ${instead}, and tell the user what is left to make`);
    turn.paid++;
    return;
  }
  if (p.confirmPaid && !await confirmWith(title, text, yes)) throw new Error(`the user declined (it costs money): ask before trying again, or ${instead}`);
}
