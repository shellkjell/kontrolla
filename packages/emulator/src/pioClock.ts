// rp2040js 1.4.1 clocks PIO from a wall-clock setTimeout loop and ignores instruction delays. That makes WS2812
// pulse widths meaningless and the result non-deterministic, so we switch that loop off and step each state machine
// from the simulation clock instead: one instruction per SM clock (sysclk / clkdiv), plus its [delay] cycles.
import type { RP2040 } from './rp2040js';

type Pio = RP2040['pio'][number];
type Sm = Pio['machines'][number];

const NS_PER_SYSCLK = 8; // 125 MHz
// rp2040js WaitType values (enum not exported): txFIFO = 3, Out = 5. An SM parked on these has nothing to do until the FIFO is written.
const parkedOnTxFifo = (m: Sm) => m.waiting && (m.waitType === 3 || m.waitType === 5);

export function runPioInSimTime(rp: RP2040) {
  const clock = rp.clock;
  for (const pio of rp.pio) {
    const arms: ((delayNs: number) => void)[] = [];
    const period = (m: Sm) => ((m.clockDivInt || 65536) + m.clockDivFrac / 256) * NS_PER_SYSCLK;
    pio.machines.forEach((m, i) => {
      let scheduled = false;
      const alarm = clock.createAlarm(() => {
        scheduled = false;
        if (!m.enabled) return;
        const before = m.cycles;
        m.step();
        pio.checkChangedPins();
        if (parkedOnTxFifo(m)) return;
        arm(Math.max(1, m.cycles - before) * period(m));
      });
      const arm = (delayNs: number) => {
        if (scheduled) return;
        scheduled = true;
        alarm.schedule(delayNs);
      };
      arms[i] = arm;
      const write = m.writeFIFO.bind(m);
      m.writeFIFO = (v: number) => {
        write(v);
        if (m.enabled) arm(period(m));
      };
    });
    // Called by rp2040js when an SM gets enabled: replaces its wall-clock loop.
    (pio as unknown as { run: () => void }).run = () => pio.machines.forEach((m, i) => m.enabled && arms[i]!(period(m)));
  }
}
