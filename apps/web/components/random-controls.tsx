"use client";

export function RandomControls({ busy, onNext }: { busy: boolean; onNext: () => void }) {
  return <div className="random-match-controls">
    <button className="button button-primary" disabled={busy} onClick={onNext}>Next</button>
    <label className="field">Region<select defaultValue="worldwide" aria-label="Region">
      <option value="worldwide">Worldwide</option>
      <option disabled>Choose a region · Subscription required</option>
    </select></label>
    <label className="field">Gender<select defaultValue="everyone" aria-label="Gender">
      <option value="everyone">Everyone</option>
      <option disabled>Male · Subscription required</option>
      <option disabled>Female · Subscription required</option>
    </select></label>
  </div>;
}
