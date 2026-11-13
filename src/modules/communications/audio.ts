import { useEffect, useState } from 'react';

let context: AudioContext | null = null;
const eventName = 'communications-audio-state';
export function audioState() { return context?.state || 'suspended'; }
function changed() { window.dispatchEvent(new Event(eventName)); }
export function useAudioState() {
    const [state, setState] = useState(audioState);
    useEffect(() => { const update = () => setState(audioState()); window.addEventListener(eventName, update); return () => window.removeEventListener(eventName, update); }, []);
    return state;
}
export async function enableAudio() {
    if (!context || context.state === 'closed') {
        if (!window.AudioContext) throw new Error('Este navegador no admite audio. Prueba otro navegador.');
        context = new AudioContext({ latencyHint: 'interactive' });
        context.onstatechange = changed;
    }
    // Called synchronously from a real gesture; do not mark audio ready while resume is pending.
    if (context.state !== 'running') {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try { await Promise.race([context.resume(), new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Pulsa Activar timbre para permitir el audio de este navegador.')), 1500); })]); }
        finally { clearTimeout(timeout); changed(); }
    }
    if (context.state !== 'running') throw new Error('El audio está suspendido. Pulsa Activar timbre y comprueba el volumen.');
    changed();
    return context;
}

// Install before authentication so the ordinary login click/typing can unlock audio.
// No operational activate/mute switch: playback follows the saved corporate policy.
if (typeof window !== 'undefined') {
    const unlock = () => { if (audioState() !== 'running') void enableAudio().catch(() => {}); };
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') unlock(); });
}

/** Inharmonic bell partials, long decay and repeated strikes instead of a short quiet sine beep. */
export async function sound(priority: string) {
    const ctx = await enableAudio();
    const urgent = priority === 'urgent', important = priority === 'important';
    const strikes = urgent ? [0, .36, .72, 1.08] : important ? [0, .48] : [0];
    const decay = urgent ? 1.25 : important ? 1.05 : .45;
    const base = urgent ? 740 : important ? 620 : 880;
    const partials = urgent || important ? [[1, .50], [2.76, .24], [5.40, .13], [8.93, .07]] : [[1, .22], [2, .06]];
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8; limiter.knee.value = 6; limiter.ratio.value = 8;
    limiter.attack.value = .002; limiter.release.value = .12;
    const master = ctx.createGain(); master.gain.value = urgent ? .95 : important ? .82 : .45;
    limiter.connect(master); master.connect(ctx.destination);
    const start = ctx.currentTime + .015;
    for (const strike of strikes) for (const [ratio, amplitude] of partials) {
        const oscillator = ctx.createOscillator(), envelope = ctx.createGain();
        oscillator.type = 'sine'; oscillator.frequency.value = base * ratio;
        const at = start + strike;
        envelope.gain.setValueAtTime(.0001, at);
        envelope.gain.exponentialRampToValueAtTime(amplitude, at + .004);
        envelope.gain.exponentialRampToValueAtTime(.0001, at + decay / (ratio > 5 ? 1.6 : 1));
        oscillator.connect(envelope); envelope.connect(limiter);
        oscillator.start(at); oscillator.stop(at + decay + .03);
        oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
    }
    const duration = strikes[strikes.length - 1] + decay + .08;
    setTimeout(() => { limiter.disconnect(); master.disconnect(); }, duration * 1000 + 150);
    window.dispatchEvent(new CustomEvent('communications-audio-played', { detail: { priority, duration, state: ctx.state } }));
    return { duration, state: ctx.state };
}
