import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('my schedule app backup wiring', () => {
  it('includes the entire my_schedule store in full and text backups under the import field', () => {
    const source = readFileSync(fileURLToPath(new URL('../context/OSContext.tsx', import.meta.url)), 'utf8');
    const allStores = source.slice(source.indexOf('const allStores = ['), source.indexOf('if (mode === \'full\')'));
    expect(allStores).toContain("'my_schedule'");
    expect(source).toContain("my_schedule: 'myScheduleRecords'");
    expect(source).toContain("case 'my_schedule': backupData.myScheduleRecords = processedData; break;");
  });
});
