import { groupOf } from '@kontrolla/core';
import type { DeviceSpec, Group } from '@kontrolla/core';
import { Editor, MeterEditor } from '../Editor';
import { GroupPanel, SelectionCard } from './GroupPanel';
import { IoModuleCard } from './IoModuleCard';
import { applyStripPattern, stripInfo } from './ops';
import { MODULE_SHORT, isSlotId, slotOfGroup } from './rear';

interface Props {
  spec: DeviceSpec;
  allocated: DeviceSpec;
  selected: string[];
  commit: (s: DeviceSpec) => void;
  onSelect: (ids: string[]) => void;
  onRemove: (ids: string[]) => void;
  onSay: (text: string, undoTo?: DeviceSpec) => void;
  onReveal: (id: string, fit?: boolean) => void; // bring a part (or the whole panel) into view
  onModuleChange: (next: DeviceSpec) => void; // a plate was swapped
  onGoSlot: (slotId: string) => void;
}

/** Whatever is selected, edited next to the drawing: a part, a strip, several parts, or a rear plate. */
export function Inspector({ spec, allocated, selected, commit, onSelect, onRemove, onSay, onReveal, onModuleChange, onGoSlot }: Props) {
  const one = selected.length === 1 ? selected[0]! : undefined;
  const control = spec.controls.find((c) => c.id === one);
  const meter = spec.meters?.find((m) => m.id === one);
  const slotSel = one && isSlotId(spec, one) ? one : undefined;
  const sameGroup = selected.length > 0 ? groupOf(spec, selected[0]!) : undefined;
  const inOne = sameGroup && selected.every((id) => sameGroup.members.includes(id)) ? sameGroup : undefined;
  const wholeGroup = !!inOne && inOne.members.length === selected.length;
  const stripSlot = inOne && wholeGroup && inOne.kind === 'strip' ? slotOfGroup(spec, inOne.id) : undefined;
  const itemGroup = one ? groupOf(spec, one) : undefined;
  const pattern = one ? stripInfo(spec, one) : undefined;

  const groupCard = (g: Group, compact: boolean) => {
    const slot = g.kind === 'strip' ? slotOfGroup(spec, g.id) : undefined;
    const mod = slot ? spec.ioSlots?.find((x) => x.id === slot)?.module : undefined;
    const extra = compact && slot && mod ? <button className="btn" onClick={() => onGoSlot(slot)} title="Choose what plugs into this channel">Input: {MODULE_SHORT[mod] ?? mod}</button> : undefined;
    return <GroupPanel key={g.id} compact={compact} extra={extra} spec={spec} group={g} onChange={commit} onSelect={onSelect} onSay={onSay} onReveal={(id) => onReveal(id, true)} />;
  };
  const applyPattern = () => {
    if (!one || !pattern) return;
    commit(applyStripPattern(spec, one));
    onSay(`Copied to the matching part in ${pattern.strips.length - 1} other strips.`, spec);
  };

  if (selected.length === 0) {
    const none = spec.controls.length + (spec.meters?.length ?? 0) === 0;
    return (
      <div className="dsg-empty">
        <h2>{none ? 'Start with a control' : 'Nothing selected'}</h2>
        <p>{none ? 'Add a knob, fader or pad from the Parts list. Pins are handed out for you.' : 'Click a part on the drawing or in the list and its settings open here.'}</p>
        {!none && <p>To work on several at once, drag a box round them or Shift-click, then group them as a strip.</p>}
      </div>
    );
  }
  return (
    <div className="dsg-inspector">
      {selected.length > 1 && !selected.some((id) => isSlotId(spec, id)) && (
        <>
          {inOne && groupCard(inOne, false)}
          {stripSlot && <IoModuleCard spec={spec} slotId={stripSlot} onChange={onModuleChange} onSelect={onSelect} />}
          {!wholeGroup && <SelectionCard spec={spec} selected={selected} onChange={commit} onRemove={onRemove} onSay={onSay} />}
        </>
      )}
      {slotSel && <IoModuleCard key={slotSel} spec={spec} slotId={slotSel} onChange={onModuleChange} onSelect={onSelect} />}
      {control && (
        <>
          {itemGroup && groupCard(itemGroup, true)}
          <Editor
            key={control.id}
            control={control}
            placed={allocated.controls.find((c) => c.id === control.id) ?? control}
            allocated={allocated}
            group={itemGroup}
            strips={pattern || undefined}
            onApplyPattern={applyPattern}
            onChange={(c) => commit({ ...spec, controls: spec.controls.map((x) => (x.id === c.id ? c : x)) })}
            onRemove={() => onRemove([control.id])}
          />
        </>
      )}
      {meter && (
        <>
          {itemGroup && groupCard(itemGroup, true)}
          <MeterEditor
            key={meter.id}
            meter={meter}
            placed={allocated.meters?.find((m) => m.id === meter.id) ?? meter}
            group={itemGroup}
            strips={pattern || undefined}
            onApplyPattern={applyPattern}
            onChange={(m) => commit({ ...spec, meters: spec.meters!.map((x) => (x.id === m.id ? m : x)) })}
            onRemove={() => onRemove([meter.id])}
          />
        </>
      )}
      {one && !control && !meter && !slotSel && <p className="empty-note">This part has no settings of its own.</p>}
    </div>
  );
}
