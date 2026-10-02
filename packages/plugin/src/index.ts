// Writing a tramme plugin: every type a plugin module exports, and
// definePlugin() for autocompletion and checks while writing one. A plugin is
// a JavaScript module of a project (plugins/*.js, listed in the document's
// "plugins"); this package only brings types, nothing runs from it.
//
//   // plugins/stars.js
//   /** @type {import('@tramme/plugin').Plugin} */
//   export default ... // or named exports: nodes, effects, tools...
//
//   // in TypeScript
//   import { definePlugin } from '@tramme/plugin';
//   export const { meta, nodes, tools } = definePlugin({ meta: { name: 'stars', api: 1 }, nodes: [...], tools: [...] });

import type { PluginModule } from '@tramme/core';

export type {
  AiNotes, AudioReader, CheckContext, CheckType, EffectType, Handle, Host, JsonSchema, KitType, ModifierType, NodeType,
  PlacedLayer, PluginMeta, PluginModule, PresetType, PromptType, PropDef, PropSchema, QualityIssue, Sample, ToolContext, ToolOutput, ToolType,
} from '@tramme/core';
export { PLUGIN_API } from '@tramme/core';

/** everything a plugin module can export, with the guided tours and translations the editor reads too */
export interface Plugin extends PluginModule {
  /** guided tours of the plugin's nodes (see docs/tours.md) */
  tours?: unknown[];
  /** translations: { fr: { 'Text as written': 'Traduction' } } */
  messages?: Record<string, Record<string, string>>;
}

/** the plugin as given, typed: autocompletion and checks while writing it */
export const definePlugin = <P extends Plugin>(plugin: P): P => plugin;
