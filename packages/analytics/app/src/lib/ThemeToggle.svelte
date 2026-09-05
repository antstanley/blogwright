<!-- Browser preference control; system mode delegates live changes to CSS color-scheme. -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { Monitor, Moon, Sun } from '@lucide/svelte';

  const STORAGE_KEY = 'blogwright.analytics.theme';
  const THEMES = ['system', 'dark', 'light'] as const;
  type Theme = (typeof THEMES)[number];
  const OPTIONS = {
    system: { label: 'System', icon: Monitor },
    dark: { label: 'Dark', icon: Moon },
    light: { label: 'Light', icon: Sun },
  };

  let theme = $state<Theme>('system');
  let storageMessage = $state('');

  function applyTheme(value: Theme): void {
    theme = value;
    document.documentElement.dataset.theme = value;
  }

  function selectTheme(value: Theme): void {
    applyTheme(value);
    try {
      localStorage.setItem(STORAGE_KEY, value);
      storageMessage = '';
    } catch {
      storageMessage = 'Theme applies to this visit; browser storage is unavailable.';
    }
  }

  onMount(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'system' || saved === 'dark' || saved === 'light') applyTheme(saved);
    } catch {
      storageMessage = 'Theme applies to this visit; browser storage is unavailable.';
    }
  });
</script>

<div class="theme-control">
  <fieldset class="theme-toggle" aria-label="Theme">
    <div class="theme-options">
      {#each THEMES as value (value)}
        {@const Icon = OPTIONS[value].icon}
        <label class="theme-option" title={OPTIONS[value].label}>
          <input
            type="radio"
            name="theme"
            aria-label={OPTIONS[value].label}
            {value}
            checked={theme === value}
            onchange={() => selectTheme(value)}
          />
          <span>
            <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
          </span>
        </label>
      {/each}
    </div>
  </fieldset>
  {#if storageMessage}
    <p class="theme-storage" role="status">{storageMessage}</p>
  {/if}
</div>
