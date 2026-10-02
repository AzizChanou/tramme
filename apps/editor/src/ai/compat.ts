// Models in the OpenAI chat format (OpenAI, Gemini, OpenRouter, Z.AI through the
// server, Ollama or LM Studio on this machine). The conversation is kept in one
// form, the Messages API's (so the model can change during a conversation):
// it is translated for each request, and the streamed answer comes back as the
// same content blocks (text, tool calls). Gemini 3 signs its tool calls
// (extra_content.google.thought_signature) and wants each signature back with
// its call: it is kept on the tool_use block and sent to Gemini only.

import type { Message } from './server.ts';

type Block = { type: string; [k: string]: any };

const NO_IMAGE = '[image this model cannot read]';

const imagePart = (b: Block) => ({ type: 'image_url', image_url: { url: `data:${b.source?.media_type ?? 'image/jpeg'};base64,${b.source?.data ?? ''}` } });
const textOf = (parts: Block[]) => parts.map((p) => p.text).join('\n');
/** text alone as a plain string: some local servers take nothing else */
const shape = (parts: Block[]) => (parts.every((p) => p.type === 'text') ? textOf(parts) : parts);

/** a call that Gemini did not sign (made by another model): the placeholder Gemini accepts for it */
const UNSIGNED = { google: { thought_signature: 'skip_thought_signature_validator' } };

/** the conversation in the chat format; `vision: false` replaces the images by a note, `gemini` sends the calls' signatures back */
export function toChat(messages: Message[], system: string, vision = true, gemini = false): any[] {
  const out: any[] = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'assistant') {
      const text = textOf(m.content.filter((b) => b.type === 'text'));
      const calls = m.content.filter((b) => b.type === 'tool_use').map((b) => ({
        id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
        ...(gemini ? { extra_content: b.extra_content ?? UNSIGNED } : {}),
      }));
      out.push({ role: 'assistant', content: text || (calls.length ? null : '…'), ...(calls.length ? { tool_calls: calls } : {}) });
      continue;
    }
    // a user message: tool results first (each its own message, right after the calls), then what the user wrote
    const parts: Block[] = [], shown: Block[] = [];
    for (const b of m.content) {
      if (b.type === 'tool_result') {
        const content: Block[] = typeof b.content === 'string' ? [{ type: 'text', text: b.content }] : b.content ?? [];
        const images = content.filter((c) => c.type === 'image');
        const text = textOf(content.filter((c) => c.type === 'text')) || (images.length ? 'Image below.' : '(empty)');
        out.push({ role: 'tool', tool_call_id: b.tool_use_id, content: b.is_error ? `Error: ${text}` : text });
        shown.push(...images);
      } else if (b.type === 'text') parts.push({ type: 'text', text: b.text });
      else if (b.type === 'image') parts.push(b);
    }
    // a tool message holds text only: the images it returned follow as a user message
    const all = [...(shown.length ? [{ type: 'text', text: 'Frames rendered by the tools:' }, ...shown] : []), ...parts];
    if (!all.length) continue;
    out.push({ role: 'user', content: shape(all.map((b) => (b.type === 'image' ? (vision ? imagePart(b) : { type: 'text', text: NO_IMAGE }) : b))) });
  }
  return out;
}

/** the tools in the chat format */
export const chatTools = (specs: { name: string; description: string; input_schema: Record<string, unknown> }[]) =>
  specs.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));

/**
 * A streamed answer, read event by event: each event gives the text and
 * reasoning that came with it; at the end, the content blocks and the reason
 * it stopped (with the Messages API's names).
 */
export class ChatReader {
  private text = '';
  private finish = '';
  private calls: { id: string; name: string; args: string; extra?: Record<string, any> }[] = [];

  push(ev: any): { text: string; reasoning: string } {
    if (ev.error) throw new Error(ev.error.message ?? String(ev.error));
    const choice = ev.choices?.[0];
    if (!choice) return { text: '', reasoning: '' };
    const d = choice.delta ?? {};
    // reasoning, for the models that show it (DeepSeek, OpenRouter, some local ones)
    const reasoning = typeof d.reasoning_content === 'string' ? d.reasoning_content : typeof d.reasoning === 'string' ? d.reasoning : '';
    const text = typeof d.content === 'string' ? d.content : '';
    this.text += text;
    for (const tc of d.tool_calls ?? []) {
      // the index says which call a piece belongs to; some servers send each call whole, without it
      let i = typeof tc.index === 'number' ? tc.index : tc.id ? this.calls.findIndex((c) => c?.id === tc.id) : this.calls.length - 1;
      if (i < 0) i = this.calls.length;
      const call = (this.calls[i] ??= { id: '', name: '', args: '' });
      if (tc.id) call.id = tc.id;
      if (tc.function?.name) call.name += tc.function.name;
      if (tc.function?.arguments) call.args += typeof tc.function.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function.arguments);
      // Gemini's signature of the call, to be sent back with it
      if (tc.extra_content && typeof tc.extra_content === 'object') call.extra = { ...call.extra, ...tc.extra_content };
    }
    if (choice.finish_reason) this.finish = choice.finish_reason;
    return { text, reasoning };
  }

  result(): { content: Block[]; stop: string } {
    const content: Block[] = [];
    if (this.text) content.push({ type: 'text', text: this.text });
    this.calls.filter(Boolean).forEach((c, i) => {
      let input: unknown = {};
      try { input = c.args ? JSON.parse(c.args) : {}; } catch { input = {}; }
      content.push({ type: 'tool_use', id: c.id || `call_${Date.now().toString(36)}_${i}`, name: c.name, input, ...(c.extra ? { extra_content: c.extra } : {}) });
    });
    const tools = content.some((b) => b.type === 'tool_use');
    return { content, stop: tools ? 'tool_use' : this.finish === 'length' ? 'max_tokens' : 'end_turn' };
  }
}
