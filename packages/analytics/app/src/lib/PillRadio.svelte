<!--
  Compact native radio group with a sliding highlight. Options must have unique
  values. Bind value to the selected option; label names the group for assistive
  technology. Each option can provide a longer accessibleLabel than its caption.
  Separate instances get independent radio names unless a name is supplied.
-->
<script lang="ts" generics="T extends string">
  const id = $props.id();
  let {
    label,
    options,
    value = $bindable(),
    name = id,
  }: {
    label: string;
    options: readonly { value: T; label: string; accessibleLabel?: string }[];
    value: T;
    name?: string;
  } = $props();

  const selectedIndex = $derived(options.findIndex((option) => option.value === value));
</script>

<fieldset class="pill-radio" aria-label={label} {name}
  style:--option-count={Math.max(1, options.length)}
  style:--selected-index={selectedIndex}>
  <span class="pill-highlight" class:unselected={selectedIndex < 0} aria-hidden="true"></span>
  {#each options as option (option.value)}
    <label class="pill-option" title={option.accessibleLabel ?? option.label}>
      <input type="radio" {name} value={option.value} bind:group={value}
        aria-label={option.accessibleLabel ?? option.label} />
      <span>{option.label}</span>
    </label>
  {/each}
</fieldset>

<style>
  .pill-radio {
    position: relative;
    display: grid;
    grid-template-columns: repeat(var(--option-count), minmax(0, 1fr));
    width: calc(var(--option-count) * var(--pill-option-width, 60px));
    max-width: 100%;
    min-width: 0;
    margin: 0;
    padding: 4px;
    border: 1px solid var(--color-surface-border);
    border-radius: 999px;
    background: var(--color-surface-100);
  }

  .pill-highlight {
    position: absolute;
    top: 4px;
    bottom: 4px;
    left: 4px;
    width: calc((100% - 8px) / var(--option-count));
    border-radius: 999px;
    background: var(--color-surface-200);
    box-shadow: inset 0 0 0 1px var(--color-surface-border);
    transform: translateX(calc(var(--selected-index) * 100%));
    transition: transform 180ms ease-out;
    pointer-events: none;
  }

  .pill-option {
    position: relative;
    min-width: 0;
    cursor: pointer;
  }

  .pill-option input {
    position: absolute;
    opacity: 0;
    width: 1px;
    height: 1px;
  }

  .pill-option span {
    display: grid;
    place-items: center;
    min-height: 32px;
    border-radius: 999px;
    font-size: 13px;
    font-weight: 550;
    color: var(--color-surface-muted);
    transition: color 180ms ease-out;
  }

  .pill-option input:checked + span {
    color: var(--color-primary);
  }

  .pill-option input:focus-visible + span {
    outline: 2px solid var(--color-primary);
    outline-offset: 1px;
  }

  @media (prefers-reduced-motion: reduce) {
    .pill-highlight,
    .pill-option span {
      transition: none;
    }
  }

  .pill-highlight.unselected {
    visibility: hidden;
  }
</style>
