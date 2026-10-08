<script lang="ts" generics="T extends string">
  import { onMount } from 'svelte';
  // One dropdown for the whole admin, replacing native <select> (whose open
  // list is drawn by the OS and cannot match the public map). ARIA
  // "select-only combobox": focus stays on the button, the highlighted
  // option is announced through aria-activedescendant.
  // The list is a popover, so it renders in the top layer: not clipped by
  // the scrolling panels, and not shifted by the sheet's translate.
  let { value = $bindable(), options, variant = 'field', label, id, onchange }:
    { value: T; options: { value: T; label: string }[]; variant?: 'field' | 'pill'; label?: string; id?: string; onchange?: (value: T) => void } = $props();
  const uid = `select-${Math.random().toString(36).slice(2, 9)}`;
  let trigger: HTMLButtonElement, menu: HTMLDivElement;
  let open = $state(false);
  let active = $state(0);
  let current = $derived(options.find(option => option.value === value) ?? options[0]);

  // Below the button first (synchronously, before the list paints), then
  // flipped above once its real height is known if it would not fit.
  function anchor() {
    const rect = trigger.getBoundingClientRect();
    menu.style.minWidth = `${rect.width}px`;
    menu.style.top = `${rect.bottom + 6}px`;
    menu.style.left = `${Math.max(8, rect.left)}px`;
  }
  function place() {
    const rect = trigger.getBoundingClientRect();
    const height = menu.offsetHeight, width = menu.offsetWidth;
    const below = innerHeight - rect.bottom - 12;
    const top = height > below && rect.top - 12 > below ? rect.top - 6 - height : rect.bottom + 6;
    menu.style.top = `${Math.max(8, top)}px`;
    menu.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - width - 8))}px`;
  }
  const isOpen = () => menu.matches(':popover-open');
  function show() { if (!isOpen()) { menu.showPopover(); place(); } }
  function choose(index: number) {
    const next = options[index];
    menu.hidePopover();
    if (next && next.value !== value) { value = next.value; onchange?.(next.value); }
  }
  function key(event: KeyboardEvent) {
    const last = options.length - 1;
    if (!isOpen()) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) { event.preventDefault(); show(); }
      return;
    }
    if (event.key === 'ArrowDown') active = Math.min(last, active + 1);
    else if (event.key === 'ArrowUp') active = Math.max(0, active - 1);
    else if (event.key === 'Home') active = 0;
    else if (event.key === 'End') active = last;
    else if (event.key === 'Enter' || event.key === ' ') choose(active);
    else if (event.key === 'Escape') menu.hidePopover();
    else if (event.key === 'Tab') { menu.hidePopover(); return; }
    else if (event.key.length === 1) {
      const start = options.findIndex((option, index) => index > active && option.label.toLowerCase().startsWith(event.key.toLowerCase()));
      const found = start >= 0 ? start : options.findIndex(option => option.label.toLowerCase().startsWith(event.key.toLowerCase()));
      if (found >= 0) active = found;
      else return;
    } else return;
    event.preventDefault();
    menu.querySelector(`#${uid}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }
  onMount(() => {
    // beforetoggle runs synchronously inside showPopover, so a key pressed
    // right after opening already sees the list as open.
    const before = (event: Event) => {
      open = (event as ToggleEvent).newState === 'open';
      if (open) { active = Math.max(0, options.findIndex(option => option.value === value)); anchor(); }
    };
    const toggle = (event: Event) => { if ((event as ToggleEvent).newState === 'open') place(); };
    menu.addEventListener('beforetoggle', before);
    // Any scroll outside the list would leave it floating away from its button.
    const scrolled = (event: Event) => { if (open && !menu.contains(event.target as Node)) menu.hidePopover(); };
    menu.addEventListener('toggle', toggle);
    addEventListener('scroll', scrolled, true);
    addEventListener('resize', scrolled);
    return () => { menu.removeEventListener('beforetoggle', before); menu.removeEventListener('toggle', toggle); removeEventListener('scroll', scrolled, true); removeEventListener('resize', scrolled); };
  });
</script>
<button bind:this={trigger} type="button" class="select select--{variant}" {id} role="combobox" aria-label={label}
  aria-haspopup="listbox" aria-expanded={open} aria-controls={`${uid}-list`} aria-activedescendant={open ? `${uid}-${active}` : undefined}
  popovertarget={`${uid}-list`} onkeydown={key}>
  <span class="select__value">{current?.label}</span>
  <svg class="select__chevron" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="m2.5 4.5 3.5 3.5 3.5-3.5"/></svg>
</button>
<!-- preventDefault: the dropdown often sits inside a <label>, which would
     otherwise re-click its button when an option is chosen. -->
<div bind:this={menu} id={`${uid}-list`} class="select-menu" popover="auto" role="listbox" tabindex="-1" aria-label={label}
  onclick={event => event.preventDefault()} onkeydown={key}>
  {#each options as option, index (option.value)}
    <div id={`${uid}-${index}`} class="select-option" class:is-active={index === active} role="option" aria-selected={option.value === value}
      onpointermove={() => active = index} onclick={event => { event.preventDefault(); choose(index); }} onkeydown={key} tabindex="-1">
      <span>{option.label}</span>
      <svg class="select-option__check" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>
    </div>
  {/each}
</div>
