import { useEffect, useRef, useState } from 'react';
import { CONVERSATION_PINS_EPOCH, CONVERSATION_PINS_EVENT, CONVERSATION_PINS_KEY, conversationPinsEpoch,
    pruneConversationPins, readConversationPins, setConversationPinned, type ConversationPin } from '../utils/conversationPins';

export function useConversationPins(identityToken: unknown) {
    const [state, setState] = useState(readConversationPins);
    const [pending, setPending] = useState(false);
    const [notice, setNotice] = useState('');
    const active = useRef(false), saving = useRef(false);
    useEffect(() => {
        active.current = true;
        const refresh = () => setState(readConversationPins());
        const storage = (event: StorageEvent) => {
            if (event.key === null || [CONVERSATION_PINS_KEY, CONVERSATION_PINS_EPOCH].includes(event.key)) refresh();
        };
        window.addEventListener(CONVERSATION_PINS_EVENT, refresh);
        window.addEventListener('storage', storage);
        refresh();
        return () => {
            active.current = false;
            window.removeEventListener(CONVERSATION_PINS_EVENT, refresh);
            window.removeEventListener('storage', storage);
        };
    }, []);
    useEffect(() => {
        let live = true;
        try {
            void pruneConversationPins(conversationPinsEpoch()).catch(error => {
                if (live) setNotice(error instanceof Error ? error.message : '置顶设置核对失败，可重试');
            });
        } catch { setNotice('置顶设置暂不可保存，可重试'); }
        return () => { live = false; };
    }, [identityToken]);
    const change = async (target: ConversationPin, pinned: boolean) => {
        if (saving.current) return false;
        saving.current = true;
        setPending(true);
        setNotice('');
        try {
            await setConversationPinned(target, pinned, conversationPinsEpoch());
            if (active.current) setState(readConversationPins());
            return true;
        } catch (error) {
            if (active.current) setNotice(`置顶未保存，可重试。${error instanceof Error ? error.message : ''}`);
            return false;
        } finally {
            saving.current = false;
            if (active.current) setPending(false);
        }
    };
    return { pins: state.pins, notice: notice || state.problem, pending, change };
}
