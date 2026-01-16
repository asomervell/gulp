<script lang="ts">
	import type { HTMLTextareaAttributes } from 'svelte/elements';

	interface Props extends HTMLTextareaAttributes {
		label?: string;
		error?: string;
		value?: string;
	}

	let {
		label,
		error,
		disabled = false,
		class: className = '',
		id,
		value = $bindable(''),
		...rest
	}: Props = $props();

	let textareaClasses = $derived(
		`block w-full rounded-lg border px-3 py-2 text-zinc-900 dark:text-zinc-100 bg-white dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed resize-none ${error ? 'border-red-500 dark:border-red-400' : ''} ${className}`
	);

	let textareaId = $derived(id ?? `textarea-${Math.random().toString(36).slice(2, 9)}`);
</script>

{#if label}
	<label for={textareaId} class="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
		{label}
	</label>
{/if}

<textarea id={textareaId} class={textareaClasses} {disabled} bind:value {...rest}></textarea>

{#if error}
	<p class="mt-1 text-sm text-red-600 dark:text-red-400">{error}</p>
{/if}
