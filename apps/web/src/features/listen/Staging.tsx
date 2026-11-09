import type { ChannelStats, EngineStats, StageStat } from '@kontrolla/audio';
import type { DeviceSpec } from '@kontrolla/core';
import type { Chan, Rig } from './rig';

const FLOOR = -60;
const fmt = (db: number) => (db > FLOOR ? `${db.toFixed(0)}` : '–∞');
const pct = (db: number) => `${Math.max(0, Math.min(1, (db - FLOOR) / -FLOOR)) * 100}%`;

type Level = 'idle' | 'ok' | 'low' | 'clip';
interface Advice {
  level: Level;
  text: string;
}

/** Plain-language verdict for one channel from what the engine measured at each stage. */
export function advise(label: string, c: Chan, s: ChannelStats | undefined, playing: boolean): Advice {
  const m = c.module;
  if (!s) return { level: 'idle', text: 'Waiting for the engine…' };
  if ((s as { active?: boolean }).active === false)
    return { level: 'clip', text: `${label} has no codec input on this board: the 6-channel design needs the two-codec board.` };
  const quiet = s.adc.peakDb < -90;
  if (quiet) return { level: 'idle', text: c.sources[c.active].kind === 'none' ? `${label}: no source. Pick one on the strip.` : playing ? `${label}: silence at the input.` : 'Press Play to see levels.' };
  const inp = m.inputs?.find((i) => i.id === c.active) ?? m.inputs?.[0];
  const other = m.inputs?.find((i) => i.id !== inp?.id);
  if (s.adc.clip) {
    const over = Math.ceil(s.adc.peakDb + 6);
    if (other && inp && other.padDb < inp.padDb) return { level: 'clip', text: `${label} clips at the ADC (peak ${fmt(s.adc.peakDb)} dBFS): switch to input ${other.id} (${other.label}), it has a ${-other.padDb} dB pad.` };
    const now = c.preampDb ?? inp?.preampDb ?? 0;
    if (m.gainRangeDb && now > m.gainRangeDb[0]) {
      return { level: 'clip', text: `${label}: the mic preamp is too hot (${now} dB). Lower it to about ${Math.max(m.gainRangeDb[0], now - over)} dB, or move the mic back.` };
    }
    return { level: 'clip', text: `${label} clips at the ADC (peak ${fmt(s.adc.peakDb)} dBFS). The source is about ${over} dB too hot for this input${inp && inp.padDb < 0 ? ` even with its ${-inp.padDb} dB pad` : ', and this module has no pad'}: turn the source down${inp && inp.padDb < 0 ? '' : ', or use a 6.3 mm TRS plate (it has a 12 dB pad)'}.` };
  }
  if (s.pre.clip) return { level: 'clip', text: `${label} goes over full scale after GAIN / EQ / filter. Turn GAIN down or cut the EQ boosts: a real Teensy saturates here.` };
  if (s.post.clip) return { level: 'clip', text: `${label} clips after the fader. Pull the fader back to 0 dB or below.` };
  if (s.adc.peakDb < -36) {
    if (m.gainRangeDb) return { level: 'low', text: `${label} is very quiet at the ADC (peak ${fmt(s.adc.peakDb)} dBFS). Raise the mic preamp (now ${c.preampDb ?? inp?.preampDb ?? 0} dB, up to ${m.gainRangeDb[1]}) for a cleaner signal.` };
    return { level: 'low', text: `${label} is quiet at the ADC (peak ${fmt(s.adc.peakDb)} dBFS). A 16-bit signal this low is noisier: turn the source up.` };
  }
  return { level: 'ok', text: `${label} is healthy: peaks ${fmt(s.adc.peakDb)} dBFS at the ADC, ${Math.max(0, Math.round(-s.adc.peakDb))} dB of headroom.` };
}

function Bar({ stat, label }: { stat: StageStat; label: string }) {
  return (
    <span className={`stage${stat.clip ? ' clip' : ''}`} role="meter" aria-label={`${label} peak ${fmt(stat.peakDb)} dBFS${stat.clip ? ', clipping' : ''}`} aria-valuemin={FLOOR} aria-valuemax={0} aria-valuenow={Math.max(FLOOR, stat.peakDb)}>
      <i style={{ width: pct(stat.peakDb) }} />
      <b>{fmt(stat.peakDb)}</b>
      <u aria-hidden />
    </span>
  );
}

/** Per channel: where the level is at the ADC, after gain/EQ/filter, and after the fader, with clip lights and what to do about it. */
export function Staging({ spec, rig, stats }: { spec: DeviceSpec; rig: Rig; stats: EngineStats | null }) {
  const chans = rig.channels();
  const playing = rig.playing();
  const color = (id: string) => spec.groups?.find((g) => g.id === id)?.color ?? '#8b8470';
  const master = stats?.master;
  const masterClip = master && (master.left.clip || master.right.clip);
  const masterLoud = master && Math.max(master.left.peakDb, master.right.peakDb) > -3;
  return (
    <div className="staging" aria-label="Gain staging">
      <div className="shead" aria-hidden>
        <span>Channel</span><span>At the ADC</span><span>After gain · EQ</span><span>After fader</span><span>What to do</span>
      </div>
      {spec.audio!.channels.map((ch, i) => {
        const s = stats?.channels[i];
        const adv = advise(ch.label, chans[i]!, s, playing);
        return (
          <div key={ch.id} className={`srow ${adv.level}`} style={{ '--g': color(ch.id) } as React.CSSProperties}>
            <span className="name"><i aria-hidden />{ch.label}</span>
            {s ? <Bar stat={s.adc} label={`${ch.label} at the ADC`} /> : <span />}
            {s ? <Bar stat={s.pre} label={`${ch.label} after gain and EQ`} /> : <span />}
            {s ? <Bar stat={s.post} label={`${ch.label} after the fader`} /> : <span />}
            <p className="advice">{adv.text}</p>
          </div>
        );
      })}
      <div className={`srow master ${masterClip ? 'clip' : masterLoud ? 'low' : master && master.left.peakDb > -90 ? 'ok' : 'idle'}`} style={{ '--g': '#8899aa' } as React.CSSProperties}>
        <span className="name"><i aria-hidden />Master L / R</span>
        {master ? <Bar stat={master.left} label="Master left" /> : <span />}
        {master ? <Bar stat={master.right} label="Master right" /> : <span />}
        <span />
        <p className="advice">
          {masterClip
            ? 'The master bus clips. Pull a few channel faders down, or the master fader. Summed channels add up faster than you expect.'
            : masterLoud
              ? 'The master is within 3 dB of full scale: little headroom for a louder passage.'
              : master && master.left.peakDb > -90
                ? 'Master level is comfortable.'
                : 'No signal on the master.'}
        </p>
      </div>
    </div>
  );
}
