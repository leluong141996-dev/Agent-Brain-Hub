// Simulated clock so TTL / staleness / tiering can be demoed by "time travel".
const DAY = 24 * 3600 * 1000;

export class Clock {
  constructor(offsetMs = 0) {
    this.offsetMs = offsetMs;
  }
  now() {
    return Date.now() + this.offsetMs;
  }
  advanceDays(days) {
    this.offsetMs += days * DAY;
  }
  daysSince(ts) {
    return (this.now() - ts) / DAY;
  }
}

export { DAY };
