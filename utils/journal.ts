import type { DiaryEntry, DiaryObservations, DiaryPage } from '../types';

export const DEFAULT_USER_DIARY_TEMPLATE = `今天的一个不足之处：

今天值得记录的三件好事：

明天最重要的一件事：

今天我学到了这一点：

我想祝福某人变得更好：

今天想要感谢某人或某事：

大脑清仓：`;

export type JournalTemplateMode = 'builtin' | 'custom' | 'blank';

/** 空白起始用空字符串；未设置或内置模式仍用原来的反思模板。 */
export interface JournalTemplateSetting {
    mode: JournalTemplateMode;
    customText?: string;
}

export const JOURNAL_TEMPLATE_STORAGE_KEY = 'journal_default_template_v1';

export function normalizeJournalTemplateSetting(value: unknown): JournalTemplateSetting {
    const raw = value && typeof value === 'object' ? value as { mode?: unknown; customText?: unknown } : {};
    const customText = typeof raw.customText === 'string' ? raw.customText : undefined;
    if (raw.mode === 'blank') return { mode: 'blank', ...(customText !== undefined ? { customText } : {}) };
    if (raw.mode === 'custom') return { mode: 'custom', customText: customText ?? '' };
    return { mode: 'builtin', ...(customText !== undefined ? { customText } : {}) };
}

export function loadJournalTemplateSetting(): JournalTemplateSetting {
    try {
        return normalizeJournalTemplateSetting(JSON.parse(localStorage.getItem(JOURNAL_TEMPLATE_STORAGE_KEY) || ''));
    } catch {
        return { mode: 'builtin' };
    }
}

export function saveJournalTemplateSetting(setting: JournalTemplateSetting): JournalTemplateSetting {
    const normalized = normalizeJournalTemplateSetting(setting);
    localStorage.setItem(JOURNAL_TEMPLATE_STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
}

export function resolveJournalTemplate(setting?: JournalTemplateSetting | null): string {
    const normalized = normalizeJournalTemplateSetting(setting);
    if (normalized.mode === 'blank') return '';
    if (normalized.mode === 'custom') return normalized.customText ?? '';
    return DEFAULT_USER_DIARY_TEMPLATE;
}

export const diaryTextOrTemplate = (text: string, template = DEFAULT_USER_DIARY_TEMPLATE): string =>
    text.trim() ? text : template;

const trimmed = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const PHYSICAL_FIELDS = [
    ['sleep', '睡眠'],
    ['diet', '饮食'],
    ['exercise', '运动'],
    ['body', '身体'],
] as const;

export function normalizeDiaryObservations(
    observations: DiaryObservations | undefined,
): DiaryObservations | undefined {
    if (!observations) return undefined;

    const physicalEntries = PHYSICAL_FIELDS
        .map(([key]) => [key, trimmed(observations.physical?.[key])] as const)
        .filter(([, value]) => value);
    const physical = physicalEntries.length > 0
        ? Object.fromEntries(physicalEntries) as NonNullable<DiaryObservations['physical']>
        : undefined;
    const emotional = trimmed(observations.emotional) || undefined;
    const cognitive = trimmed(observations.cognitive) || undefined;
    const volitional = trimmed(observations.volitional) || undefined;
    const events = Array.isArray(observations.events)
        ? observations.events.map(event => ({
            id: trimmed(event.id),
            ...(trimmed(event.title) ? { title: trimmed(event.title) } : {}),
            body: trimmed(event.body),
        }))
        .filter(event => Boolean(event.title || event.body))
        : undefined;

    if (!physical && !emotional && !cognitive && !volitional && !events?.length) return undefined;
    return {
        ...(physical ? { physical } : {}),
        ...(emotional ? { emotional } : {}),
        ...(cognitive ? { cognitive } : {}),
        ...(volitional ? { volitional } : {}),
        ...(events?.length ? { events } : {}),
    };
}

export function normalizeDiaryPage(page: DiaryPage): DiaryPage {
    const { observations: _observations, ...base } = page;
    const observations = normalizeDiaryObservations(page.observations);
    return observations ? { ...base, observations } : base;
}

export function serializeDiaryObservations(observations: DiaryObservations | undefined): string {
    const normalized = normalizeDiaryObservations(observations);
    if (!normalized) return '';

    const sections: string[] = [];
    if (normalized.physical) {
        const lines = PHYSICAL_FIELDS
            .filter(([key]) => normalized.physical?.[key])
            .map(([key, label]) => `${label}：${normalized.physical?.[key]}`);
        sections.push(`体能\n${lines.join('\n')}`);
    }
    if (normalized.emotional) sections.push(`情感\n${normalized.emotional}`);
    if (normalized.cognitive) sections.push(`思维\n${normalized.cognitive}`);
    if (normalized.volitional) sections.push(`意志\n${normalized.volitional}`);
    normalized.events?.forEach(event => {
        sections.push(`记录一件事情${event.title ? ` · ${event.title}` : ''}${event.body ? `\n${event.body}` : ''}`);
    });
    return sections.join('\n\n');
}

export function serializeUserDiaryForExchange(
    page: Pick<DiaryPage, 'text' | 'observations'>,
): string {
    const text = trimmed(page.text);
    const observationText = serializeDiaryObservations(page.observations);
    if (!observationText) return text;
    return [
        text ? `【我的日记】\n${text}` : '',
        `【今天的一些观察】\n${observationText}`,
    ].filter(Boolean).join('\n\n');
}

/** 只在正在编辑刚结束的自然日时自动翻页；查看更早的历史日记不受午夜影响。 */
export const shouldRollJournalAtMidnight = (
    entryDate: string | undefined,
    previousLocalDate: string,
    nextLocalDate: string,
): boolean => previousLocalDate !== nextLocalDate && entryDate === previousLocalDate;

/** 仅打开过、没有改动的模板页不应在零点被保存成一篇空日记。 */
export const isPristineUserDiaryTemplate = (
    page: DiaryPage,
    template = DEFAULT_USER_DIARY_TEMPLATE,
): boolean =>
    page.text === template
    && page.paperStyle === 'grid'
    && page.stickers.length === 0
    && !normalizeDiaryObservations(page.observations);

/** 未取得角色回复的日记只保留到它所属自然日结束。 */
export const isUnansweredDiaryExpired = (
    entry: DiaryEntry,
    currentLocalDate: string,
): boolean => !entry.charPage && entry.date < currentLocalDate;

/** 跨日记本广播只投递到尚未取得角色回复的目标；不限制用户主动编辑任意日记。 */
export const canReceiveUserDiaryBroadcast = (existing: DiaryEntry | undefined): boolean =>
    !existing?.charPage;

export function syncUserDiaryContent(
    existing: DiaryEntry | undefined,
    charId: string,
    date: string,
    sourcePage: Pick<DiaryPage, 'text' | 'observations'>,
    now = Date.now(),
): DiaryEntry {
    if (existing && !canReceiveUserDiaryBroadcast(existing)) return existing;
    const normalizedSource = normalizeDiaryPage({
        text: sourcePage.text,
        paperStyle: 'grid',
        stickers: [],
        observations: sourcePage.observations,
    });
    if (existing) {
        const { observations: _observations, ...visualPage } = existing.userPage;
        return {
            ...existing,
            userPage: {
                ...visualPage,
                text: normalizedSource.text,
                ...(normalizedSource.observations ? { observations: normalizedSource.observations } : {}),
            },
        };
    }
    return {
        id: `diary-${charId}-${date}`,
        charId,
        date,
        userPage: normalizedSource,
        timestamp: now,
        isArchived: false,
        autoSync: true,
    };
}
