import { readFileSync } from 'node:fs';

const schema = JSON.parse(readFileSync(new URL('./schema.json', import.meta.url), 'utf8'));
const filename = process.argv[2];
if (!filename) { console.error('Usage: node validate.mjs <script.json>'); process.exit(2); }
let value;
try { value = JSON.parse(readFileSync(filename, 'utf8')); }
catch (error) { console.error(`Cannot read JSON: ${error.message}`); process.exit(2); }
const errors = [];
function walk(item, rule, path) {
  if (rule.$ref) return walk(item, schema.$defs[rule.$ref.split('/').pop()], path);
  if ('const' in rule && item !== rule.const) errors.push(`${path}: expected ${JSON.stringify(rule.const)}`);
  if (rule.enum && !rule.enum.includes(item)) errors.push(`${path}: expected ${rule.enum.join(' / ')}`);
  if (rule.type === 'object') {
    if (!item || typeof item !== 'object' || Array.isArray(item)) { errors.push(`${path}: expected object`); return; }
    for (const key of rule.required || []) if (!(key in item)) errors.push(`${path}.${key}: required`);
    for (const [key, child] of Object.entries(item)) {
      if (rule.properties?.[key]) walk(child, rule.properties[key], `${path}.${key}`);
      else if (rule.additionalProperties === false) errors.push(`${path}.${key}: unknown field`);
    }
  } else if (rule.type === 'array') {
    if (!Array.isArray(item)) { errors.push(`${path}: expected array`); return; }
    if (item.length < (rule.minItems || 0)) errors.push(`${path}: too few items`);
    item.forEach((child, index) => walk(child, rule.items, `${path}[${index}]`));
  } else if (rule.type === 'string' && (typeof item !== 'string' || (rule.minLength && !item.trim()))) errors.push(`${path}: expected non-empty string`);
  else if (rule.type === 'boolean' && typeof item !== 'boolean') errors.push(`${path}: expected boolean`);
  else if (rule.type === 'integer' && (!Number.isInteger(item) || item < (rule.minimum ?? -Infinity))) errors.push(`${path}: expected integer >= ${rule.minimum ?? '-Infinity'}`);
}
walk(value, schema, '$');
if (!errors.length) {
  const unique = (items, path) => { const ids = new Set(); items.forEach((item, i) => { if (ids.has(item.id)) errors.push(`${path}[${i}].id: duplicate`); ids.add(item.id); }); };
  unique(value.seats, '$.seats'); unique(value.phases, '$.phases');
  for (const key of ['objectiveFacts', 'clues', 'deliverables', 'abilities', 'victoryConditions', 'endings']) unique(value[key], `$.${key}`);
  for (const seat of value.seats) { unique(seat.beliefs, `$.seats.${seat.id}.beliefs`); unique(seat.privateKnowledge, `$.seats.${seat.id}.privateKnowledge`); }
  const seats = new Set(value.seats.map(item => item.id));
  if (value.investigator && seats.has(value.investigator.id)) errors.push('investigator.id: duplicate suspect seat');
  for (const id of value.humanSeatIds || []) if (!seats.has(id)) errors.push(`humanSeatIds: unknown seat ${id}`);
  for (const item of value.investigator?.openingStatements || []) if (!seats.has(item.seatId)) errors.push(`openingStatements: unknown seat ${item.seatId}`);
  for (const phase of value.phases) {
    for (const id of [...(phase.yesNoSeatIds || []), ...(phase.fourChoiceSeatIds || [])]) if (!seats.has(id)) errors.push(`phases.${phase.id}: unknown seat ${id}`);
    for (const id of phase.fourChoiceSeatIds || []) if (phase.yesNoSeatIds?.includes(id)) errors.push(`phases.${phase.id}: conflicting answer options for ${id}`);
  }
  const phases = new Set(value.phases.map(item => item.id));
  for (const [key, audienceKey] of [['clues', 'audience'], ['deliverables', 'audience'], ['abilities', 'holderSeatIds'], ['victoryConditions', 'beneficiarySeatIds']]) {
    for (const item of value[key]) for (const id of item[audienceKey] || []) if (!seats.has(id) && !(key !== 'victoryConditions' && id === value.investigator?.id)) errors.push(`${key}.${item.id}: unknown seat ${id}`);
  }
  for (const key of ['clues', 'deliverables', 'abilities']) for (const item of value[key]) {
    if (item.grant.kind === 'phase' && !phases.has(item.grant.phaseId)) errors.push(`${key}.${item.id}: unknown phase`);
    if (item.grant.kind === 'event' && !item.grant.eventId) errors.push(`${key}.${item.id}: eventId required`);
  }
}
if (errors.length) { errors.forEach(error => console.error(error)); process.exit(1); }
console.log(`Valid structure: ${value.title}. Review narrative diagnostics separately.`);
