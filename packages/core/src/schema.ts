// Structure of the document, checked with zod and exported as JSON Schema
// (schema/tramme-1.schema.json) for tools and for the AI. Property values
// are left open here: their types come from the node schemas in the
// registry and are checked by validate.ts.

import { z } from 'zod';
import { SCHEMA_VERSION } from './types.ts';

const finite = z.number().refine(Number.isFinite, 'finite number expected');
const id = z.string().regex(/^[A-Za-z0-9_-]+$/, 'id: letters, digits, _ and - only');
const prop = z.unknown();

const token = z.strictObject({
  type: z.enum(['color', 'number', 'ease', 'string', 'vec2']),
  value: z.unknown(),
  description: z.string().optional(),
});

const asset = z.strictObject({
  type: z.enum(['image', 'font', 'audio', 'video', 'module', 'json']),
  src: z.string().min(1),
  name: z.string().optional(),
  family: z.string().optional(),
  weight: z.string().optional(),
  style: z.string().optional(),
  box: z.tuple([finite, finite, finite, finite]).optional(),
});

const transform = z.strictObject({
  anchor: prop.optional(), position: prop.optional(), scale: prop.optional(),
  rotation: prop.optional(), opacity: prop.optional(),
});

const effect = z.strictObject({
  id,
  type: z.string().min(1),
  enabled: z.boolean().optional(),
  props: z.record(z.string(), prop).optional(),
});

const layer = z.strictObject({
  type: z.string().min(1),
  name: z.string().optional(),
  in: finite.optional(),
  out: finite.optional(),
  visible: z.boolean().optional(),
  locked: z.boolean().optional(),
  clip: id.optional(),
  blend: z.enum(['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'add']).optional(),
  transform: transform.optional(),
  props: z.record(z.string(), prop).optional(),
  effects: z.array(effect).optional(),
  children: z.array(id).optional(),
});

const marker = z.strictObject({
  id,
  t: finite,
  label: z.string().optional(),
  kind: z.string().optional(),
  duration: finite.optional(),
});

const composition = z.strictObject({
  name: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().positive(),
  duration: z.number().positive(),
  background: prop.optional(),
  motionBlur: z.strictObject({ samples: prop, shutter: prop }).optional(),
  markers: z.array(marker).optional(),
  effects: z.array(effect).optional(),
  layers: z.record(id, layer),
  order: z.array(id),
});

export const DocSchema = z.strictObject({
  $schema: z.string().optional(),
  schema: z.literal(SCHEMA_VERSION),
  meta: z.looseObject({ title: z.string(), description: z.string().optional() }),
  tokens: z.record(id, token),
  assets: z.record(id, asset),
  compositions: z.record(id, composition),
  root: id,
  plugins: z.array(id).optional(),
});

export function documentJsonSchema() {
  return z.toJSONSchema(DocSchema, { target: 'draft-2020-12' });
}
