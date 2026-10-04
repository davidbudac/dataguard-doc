import { useEffect, useRef, useState } from 'preact/hooks';
import { commandOpen } from '@/state/view';
import { commands, filterCommands, runCommand } from './commands';
import { Sheet } from './common/Sheet';
import '@/styles/commands.css';

function CommandSearch() {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement | null>(null);
  const items = filterCommands(commands(), query);
  const at = Math.max(0, Math.min(active, items.length - 1));
  const execute = (id: string): void => {
    if (items.find(c => c.id === id)?.enabled.state === 'off') return;
    commandOpen.value = false;
    // Let the dialog restore focus before an action opens another dialog.
    setTimeout(() => runCommand(id), 0);
  };
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [at, query]);
  return (
    <div class="command-search">
      <input class="command-input" type="search" placeholder="Search actions, presets, panels…"
        aria-label="Search commands" role="combobox" aria-autocomplete="list" aria-expanded="true"
        aria-controls="command-results" aria-activedescendant={items.length ? `command-${at}` : undefined}
        value={query} onInput={e => { setQuery(e.currentTarget.value); setActive(0); }}
        onKeyDown={e => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (items.length) setActive((at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (items[at]) execute(items[at].id);
          }
        }} />
      <div class="command-results" id="command-results" role="listbox" aria-label="Commands" ref={list}>
        {items.map((item, i) => (
          <button type="button" role="option" id={`command-${i}`} key={item.id}
            tabIndex={-1} aria-selected={i === at} aria-disabled={item.enabled.state === 'off'}
            class={`command-option${i === at ? ' is-active' : ''}`}
            onMouseMove={() => setActive(i)} onClick={() => execute(item.id)}>
            <span class="command-description">
              <span class="command-group">{item.group}</span>
              <span>{item.label}</span>
              {item.enabled.state === 'off' ? <span class="command-why">{item.enabled.why}</span> : null}
            </span>
            {item.keyLabel ? <kbd>{item.keyLabel}</kbd> : null}
          </button>
        ))}
        {items.length ? null : <p class="command-empty" role="status">No matching commands.</p>}
      </div>
      <p class="command-foot">↑ ↓ to choose · Enter to run · Esc to close · ⌘/Ctrl K to toggle</p>
    </div>
  );
}

export function CommandPalette() {
  return <Sheet open={commandOpen.value} title="Command palette" variant="card" class="command-palette"
    initialFocus="input" onClose={() => { commandOpen.value = false; }}>
    {commandOpen.value ? <CommandSearch /> : null}
  </Sheet>;
}
