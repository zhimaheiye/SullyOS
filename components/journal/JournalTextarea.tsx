import React, { useLayoutEffect, useRef } from 'react';

// Diary text belongs to the paper's scroll flow, not a nested input viewport.
export default function JournalTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
    const ref = useRef<HTMLTextAreaElement>(null);
    const fitContent = () => {
        const input = ref.current;
        if (!input || !input.clientWidth) return; // Collapsed details / inactive spread page.
        const paper = input.closest('.sully-journal-page-content');
        const scrollTop = paper?.scrollTop;
        const css = getComputedStyle(input);
        const borders = (parseFloat(css.borderTopWidth) || 0) + (parseFloat(css.borderBottomWidth) || 0);
        input.style.height = '0px'; // Also shrink after deleting text.
        input.style.height = `${input.scrollHeight + borders}px`;
        // Measuring a collapsed input must not jump the paper back up.
        if (paper && scrollTop !== undefined) paper.scrollTop = scrollTop;
    };

    useLayoutEffect(fitContent);
    useLayoutEffect(() => {
        const input = ref.current;
        if (!input) return;
        let width = input.clientWidth;
        const observer = new ResizeObserver(() => {
            if (input.clientWidth === width) return; // Ignore our own height changes.
            width = input.clientWidth;
            fitContent(); // Includes reopening details and narrow/wide layouts.
        });
        observer.observe(input);
        return () => observer.disconnect();
    }, []);

    return <textarea {...props} ref={ref} rows={1} style={{ ...props.style, boxSizing: 'border-box', overflow: 'hidden', resize: 'none' }} />;
}
