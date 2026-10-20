export interface QixiResponseChannel {
    name: string;
    text: string;
}

export interface QixiResponseInspection {
    channels: QixiResponseChannel[];
    candidates: QixiResponseChannel[];
    finishReason: string;
}

const responseFragment = (value: unknown): string => {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) return value.map(responseFragment).join('');
    if (!value || typeof value !== 'object') return '';
    const record = value as Record<string, unknown>;
    return responseFragment(record.text ?? record.content ?? record.value);
};

const responseText = (value: unknown): string => responseFragment(value).trim();

const blockReasoningText = (value: unknown): string => {
    if (!Array.isArray(value)) return '';
    return value.map(part => {
        if (!part || typeof part !== 'object') return '';
        const record = part as Record<string, unknown>;
        return responseFragment(record.reasoning_content ?? record.reasoning ?? record.thinking);
    }).join('').trim();
};

const responseChannels = (data: any): QixiResponseChannel[] => {
    const choice = data?.choices?.[0];
    const message = choice?.message;
    return [
        { name: 'content', text: responseText(message?.content) },
        { name: 'content_reasoning', text: blockReasoningText(message?.content) },
        { name: 'reasoning_content', text: responseText(message?.reasoning_content) },
        { name: 'reasoning', text: responseText(message?.reasoning) },
        { name: 'thinking', text: responseText(message?.thinking) },
        { name: 'choice_text', text: responseText(choice?.text) },
        { name: 'output_text', text: responseText(data?.output_text) },
        { name: 'data_content', text: responseText(data?.data?.choices?.[0]?.message?.content) },
    ];
};

export const inspectQixiResponse = (data: any): QixiResponseInspection => {
    const channels = responseChannels(data);
    const nonEmpty = channels.filter(channel => channel.text);
    const candidates = nonEmpty.filter((candidate, index) => (
        nonEmpty.findIndex(other => other.text === candidate.text) === index
    ));
    return {
        channels,
        candidates,
        finishReason: data?.choices?.[0]?.finish_reason || 'unknown',
    };
};

const responsePreview = (text: string): string => text.replace(/\s+/g, ' ').slice(0, 100);

export const warnQixiResponseRejected = (
    label: string,
    data: any,
    inspection = inspectQixiResponse(data),
): void => {
    const message = data?.choices?.[0]?.message;
    const messageKeys = message && typeof message === 'object' && !Array.isArray(message)
        ? Object.keys(message).join(',')
        : '(none)';
    const channelDiagnostics = inspection.channels.flatMap(channel => [
        `${channel.name}_chars=${channel.text.length}`,
        ...(channel.text ? [`${channel.name}_preview=${responsePreview(channel.text)}`] : []),
    ]);
    console.warn(
        `[Qixi] ${label} response rejected:`,
        `finish_reason=${inspection.finishReason}; message_keys=${messageKeys}; ${channelDiagnostics.join('; ') || 'no_text_candidates'}`,
    );
};
