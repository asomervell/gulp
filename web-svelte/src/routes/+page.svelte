<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { tokenize } from '$lib/rsvp/tokenize';
	import { splitAtPivot } from '$lib/rsvp/pivot';
	import { loadState, createDebouncedSave, type RsvpPersistedState } from '$lib/storage';

	// App states
	type AppState = 'input' | 'loading' | 'countdown' | 'playing' | 'paused' | 'finished';
	let appState = $state<AppState>('input');

	// Content state
	let inputValue = $state('');
	let sourceText = $state('');
	let tokens = $state<string[]>([]);
	let wordIndex = $state(0);
	let wpm = $state(600);
	let errorMessage = $state('');

	// Countdown state
	let countdownValue = $state<number | null>(null);

	// Timer
	let timerId: ReturnType<typeof setInterval> | null = null;

	// DOM refs (not reactive, just for binding)
	let inputRef: HTMLTextAreaElement | undefined;
	let countdownRef: HTMLDivElement | undefined;

	// Derived
	let currentWord = $derived(tokens[wordIndex] ?? '');
	let wordParts = $derived(splitAtPivot(currentWord));
	let msPerWord = $derived(60000 / wpm);
	let progress = $derived(tokens.length > 0 ? `${wordIndex + 1} / ${tokens.length}` : '0 / 0');
	let isReading = $derived(appState === 'playing' || appState === 'paused' || appState === 'countdown' || appState === 'finished');

	// Persistence
	let debouncedSave: (state: RsvpPersistedState) => void;

	function persistState() {
		if (debouncedSave) {
			debouncedSave({ url: '', sourceText, wpm, wordIndex });
		}
	}

	// Detect input type
	function isUrl(str: string): boolean {
		try {
			const parsed = new URL(str.trim());
			return ['http:', 'https:'].includes(parsed.protocol);
		} catch {
			return false;
		}
	}

	// Timer management
	function startTimer() {
		stopTimer();
		if (tokens.length === 0) return;

		timerId = setInterval(() => {
			if (wordIndex < tokens.length - 1) {
				wordIndex++;
				persistState();
			} else {
				appState = 'finished';
				stopTimer();
			}
		}, msPerWord);
	}

	function stopTimer() {
		if (timerId) {
			clearInterval(timerId);
			timerId = null;
		}
	}

	// Countdown sequence
	async function startCountdown() {
		appState = 'countdown';

		for (let i = 3; i >= 1; i--) {
			countdownValue = i;
			await new Promise(resolve => setTimeout(resolve, 500));
		}

		countdownValue = null;
		appState = 'playing';
		startTimer();
	}

	// Process input and start reading
	async function processInput() {
		const value = inputValue.trim();
		if (!value) return;

		errorMessage = '';
		appState = 'loading';

		try {
			let text: string;

			if (isUrl(value)) {
				// Extract from URL
				const response = await fetch('/api/extract', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ url: value })
				});

				if (!response.ok) {
					const errorData = await response.json().catch(() => ({}));
					throw new Error(errorData.message || 'Failed to extract content');
				}

				const data = await response.json();
				text = data.text;
			} else {
				// Use as plain text
				text = value;
			}

			sourceText = text;
			tokens = tokenize(text);
			wordIndex = 0;

			if (tokens.length === 0) {
				throw new Error('No readable content found');
			}

			persistState();
			await startCountdown();

		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Something went wrong';
			appState = 'input';
		}
	}

	// Handle paste
	function handlePaste(event: ClipboardEvent) {
		// Let the paste complete, then process
		setTimeout(() => {
			if (inputValue.trim()) {
				processInput();
			}
		}, 50);
	}

	// Handle keyboard in input
	function handleInputKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			processInput();
		}
	}

	// Playback controls
	function togglePlay() {
		if (appState === 'playing') {
			appState = 'paused';
			stopTimer();
		} else if (appState === 'paused' || appState === 'finished') {
			if (wordIndex >= tokens.length - 1) {
				wordIndex = 0;
			}
			appState = 'playing';
			startTimer();
		}
	}

	function restart() {
		wordIndex = 0;
		persistState();
		if (appState === 'playing') {
			startTimer();
		} else if (appState === 'finished') {
			appState = 'playing';
			startTimer();
		}
	}

	function goBack() {
		stopTimer();
		sourceText = '';
		tokens = [];
		wordIndex = 0;
		inputValue = '';
		appState = 'input';

		// Focus input after transition
		setTimeout(() => {
			inputRef?.focus();
		}, 100);
	}

	// WPM change
	function handleWpmChange() {
		persistState();
		if (appState === 'playing') {
			startTimer();
		}
	}

	// Global keyboard shortcuts
	function handleKeydown(event: KeyboardEvent) {
		if (appState === 'input' || appState === 'loading' || appState === 'countdown') return;

		const target = event.target as HTMLElement;
		if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

		switch (event.key) {
			case ' ':
				event.preventDefault();
				togglePlay();
				break;
			case 'ArrowLeft':
				event.preventDefault();
				wordIndex = Math.max(0, wordIndex - (event.shiftKey ? 10 : 1));
				persistState();
				break;
			case 'ArrowRight':
				event.preventDefault();
				wordIndex = Math.min(tokens.length - 1, wordIndex + (event.shiftKey ? 10 : 1));
				persistState();
				break;
			case 'ArrowUp':
				event.preventDefault();
				wpm = Math.min(2000, wpm + 25);
				handleWpmChange();
				break;
			case 'ArrowDown':
				event.preventDefault();
				wpm = Math.max(50, wpm - 25);
				handleWpmChange();
				break;
			case 'Escape':
				event.preventDefault();
				goBack();
				break;
		}
	}

	// Lifecycle
	onMount(() => {
		const saved = loadState();
		wpm = saved.wpm || 600;

		// If we have saved content, restore it
		if (saved.sourceText) {
			sourceText = saved.sourceText;
			tokens = tokenize(sourceText);
			wordIndex = Math.min(saved.wordIndex, tokens.length - 1);
			if (tokens.length > 0) {
				appState = 'paused';
			}
		}

		debouncedSave = createDebouncedSave(500);
		window.addEventListener('keydown', handleKeydown);

		// Focus input on start
		if (appState === 'input') {
			setTimeout(() => inputRef?.focus(), 100);
		}
	});

	onDestroy(() => {
		stopTimer();
		if (typeof window !== 'undefined') {
			window.removeEventListener('keydown', handleKeydown);
		}
	});
</script>

<svelte:head>
	<title>Gulp</title>
</svelte:head>

<style>
	@keyframes countdown {
		0% {
			opacity: 0;
			transform: scale(0.5);
		}
		30% {
			opacity: 1;
			transform: scale(1);
		}
		80% {
			opacity: 1;
			transform: scale(1);
		}
		100% {
			opacity: 0;
			transform: scale(0.8);
		}
	}

	@keyframes fade-in {
		from {
			opacity: 0;
			transform: translateY(10px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.animate-countdown {
		animation: countdown 0.5s ease-out forwards;
	}

	.animate-fade-in {
		animation: fade-in 0.4s ease-out forwards;
	}
</style>

<div class="h-screen w-screen flex items-center justify-center bg-white dark:bg-zinc-950 overflow-hidden">

	{#if appState === 'input' || appState === 'loading'}
		<!-- Input Screen -->
		<div class="flex flex-col items-center w-full max-w-lg px-6 transition-opacity duration-300" class:opacity-50={appState === 'loading'}>
			<textarea
				bind:this={inputRef}
				bind:value={inputValue}
				onpaste={handlePaste}
				onkeydown={handleInputKeydown}
				disabled={appState === 'loading'}
				placeholder="Paste any URL, text, or drop a file to begin..."
				rows="3"
				class="w-full bg-transparent border-none outline-none resize-none text-center text-xl text-zinc-600 dark:text-zinc-400 placeholder:text-zinc-300 dark:placeholder:text-zinc-700 leading-relaxed"
			></textarea>

			{#if appState === 'loading'}
				<p class="mt-4 text-sm text-zinc-400 dark:text-zinc-600">
					Preparing...
				</p>
			{/if}

			{#if errorMessage}
				<p class="mt-4 text-sm text-red-500 dark:text-red-400">
					{errorMessage}
				</p>
			{/if}
		</div>

	{:else if appState === 'countdown'}
		<!-- Countdown Screen -->
		{#key countdownValue}
			<div
				bind:this={countdownRef}
				class="font-geist-mono text-8xl text-zinc-300 dark:text-zinc-700 select-none animate-countdown"
			>
				{countdownValue}
			</div>
		{/key}

	{:else}
		<!-- Reading Screen -->
		<div class="flex flex-col items-center w-full animate-fade-in">
			<!-- Word Display -->
			<div class="flex flex-col items-center">
				<!-- Top centerline marker -->
				<div class="w-px h-5 bg-zinc-300 dark:bg-zinc-700"></div>

				<!-- RSVP Word -->
				<div class="h-20 md:h-24 flex items-center justify-center my-1">
					<div class="font-geist-mono text-5xl md:text-7xl select-none whitespace-nowrap">
						<span
							class="inline-block text-right text-zinc-900 dark:text-zinc-100"
							style="width: 6ch;"
						>{wordParts.left}</span><!--
						--><span class="text-indigo-600 dark:text-indigo-400">{wordParts.pivot}</span><!--
						--><span
							class="inline-block text-left text-zinc-900 dark:text-zinc-100"
							style="width: 6ch;"
						>{wordParts.right}</span>
					</div>
				</div>

				<!-- Bottom centerline marker -->
				<div class="w-px h-5 bg-zinc-300 dark:bg-zinc-700"></div>
			</div>

			<!-- Controls Bar -->
			<div class="flex items-center gap-4 px-5 py-2.5 mt-10 rounded-full bg-zinc-100 dark:bg-zinc-900">
				<button
					onclick={goBack}
					class="text-sm text-zinc-500 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
				>
					Back
				</button>

				<button
					onclick={restart}
					class="text-sm text-zinc-500 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
				>
					Restart
				</button>

				<button
					onclick={togglePlay}
					class="px-4 py-1.5 text-sm font-medium rounded-full bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors"
				>
					{appState === 'playing' ? 'Pause' : 'Start'}
				</button>

				<span class="text-sm text-zinc-500 dark:text-zinc-500 font-mono tabular-nums min-w-[5rem] text-center">
					{progress}
				</span>

				<div class="flex items-center gap-2">
					<input
						type="range"
						min="100"
						max="1200"
						step="25"
						bind:value={wpm}
						oninput={handleWpmChange}
						class="w-20 h-1 bg-zinc-300 dark:bg-zinc-700 rounded-full appearance-none cursor-pointer accent-zinc-600 dark:accent-zinc-400"
					/>
					<span class="text-sm text-zinc-500 dark:text-zinc-500 font-mono tabular-nums w-10">
						{wpm}
					</span>
				</div>
			</div>
		</div>
	{/if}
</div>
