<script>
  import { toasts, dismiss } from "./toast.svelte.js";
  let list = $derived(toasts());
</script>

<div class="fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
  {#each list as t (t.id)}
    <div class="toast {t.kind === 'error' ? 'toast-error' : t.kind === 'success' ? 'toast-success' : ''}">
      <span class="flex-1">{t.text}</span>
      {#if t.action}
        <button class="btn btn-sm" onclick={() => { t.action.fn(); dismiss(t.id); }}>{t.action.label}</button>
      {/if}
      <button class="btn btn-ghost btn-sm" onclick={() => dismiss(t.id)} aria-label="关闭">✕</button>
    </div>
  {/each}
</div>