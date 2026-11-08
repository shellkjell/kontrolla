// Single import point for rp2040js (plus a clock type: RP2040 exposes it as the narrower IClock).
export { ConsoleLogger, createSetupPacket, DataDirection, LogLevel, RP2040, SetupRecipient, SetupType } from 'rp2040js';
export interface SimulationClockLike {
  nanos: number;
  nanosToNextAlarm: number;
  tick(deltaNanos: number): void;
}
