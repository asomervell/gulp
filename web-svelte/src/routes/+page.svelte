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
	let wpm = $state(450);
	let errorMessage = $state('');
	let hasSavedSession = $state(false);
	let savedSessionPreview = $state('');
	let isDragging = $state(false);

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

	// Timer management with punctuation pauses
	function getWordDelay(word: string): number {
		const baseDelay = msPerWord;
		// Add extra pause for sentence-ending punctuation
		if (/[.!?]$/.test(word)) {
			return baseDelay * 1.5; // 50% longer pause
		}
		// Slight pause for clause boundaries
		if (/[,;:]$/.test(word)) {
			return baseDelay * 1.2; // 20% longer pause
		}
		return baseDelay;
	}

	function scheduleNextWord() {
		if (wordIndex < tokens.length - 1) {
			const delay = getWordDelay(tokens[wordIndex]);
			timerId = setTimeout(() => {
				wordIndex++;
				persistState();
				if (appState === 'playing') {
					scheduleNextWord();
				}
			}, delay);
		} else {
			appState = 'finished';
		}
	}

	function startTimer() {
		stopTimer();
		if (tokens.length === 0) return;
		scheduleNextWord();
	}

	function stopTimer() {
		if (timerId) {
			clearTimeout(timerId);
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

	// Handle file drop (whole page is drop target)
	function handleDragOver(event: DragEvent) {
		event.preventDefault();
		if (appState === 'input') {
			isDragging = true;
		}
	}

	function handleDragLeave(event: DragEvent) {
		event.preventDefault();
		// Only set to false if leaving the window
		if (event.relatedTarget === null) {
			isDragging = false;
		}
	}

	async function handleDrop(event: DragEvent) {
		event.preventDefault();
		isDragging = false;

		if (appState !== 'input') return;

		const files = event.dataTransfer?.files;
		if (!files || files.length === 0) return;

		const file = files[0];

		// Check if it's a supported document format
		const supportedExtensions = /\.(txt|md|markdown|html|htm|pdf|docx|doc|rtf|csv|json|xml|yaml|yml|log|rst|tex|png|jpg|jpeg|gif|webp)$/i;
		if (!file.type.startsWith('text/') &&
			!file.type.startsWith('image/') &&
			!file.type.includes('pdf') &&
			!file.type.includes('word') &&
			!file.type.includes('rtf') &&
			!supportedExtensions.test(file.name)) {
			errorMessage = 'Unsupported format. Try PDF, DOCX, TXT, MD, HTML, images, or CSV.';
			return;
		}

		errorMessage = '';
		appState = 'loading';

		try {
			// Send file to API for parsing and summarization
			const formData = new FormData();
			formData.append('file', file);

			const response = await fetch('/api/summarize', {
				method: 'POST',
				body: formData
			});

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				throw new Error(errorData.message || 'Failed to summarize content');
			}

			const data = await response.json();
			const text = data.text;

			sourceText = text;
			tokens = tokenize(text);
			wordIndex = 0;

			if (tokens.length === 0) {
				throw new Error('No readable content found');
			}

			persistState();
			await startCountdown();
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Failed to process file';
			appState = 'input';
		}
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

	// Resume a saved session
	function resumeSession() {
		const saved = loadState();
		if (saved.sourceText) {
			sourceText = saved.sourceText;
			tokens = tokenize(sourceText);
			wordIndex = Math.min(saved.wordIndex, tokens.length - 1);
			if (tokens.length > 0) {
				appState = 'paused';
			}
		}
		hasSavedSession = false;
	}

	// Lifecycle
	onMount(() => {
		const saved = loadState();
		wpm = Math.min(saved.wpm || 300, 900);

		// Check if we have saved content, but don't auto-restore
		if (saved.sourceText) {
			hasSavedSession = true;
			// Create a preview (first few words)
			const previewTokens = tokenize(saved.sourceText).slice(0, 8);
			savedSessionPreview = previewTokens.join(' ') + (previewTokens.length >= 8 ? '...' : '');
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

<div
	class="h-screen w-screen flex items-center justify-center bg-background overflow-hidden"
	ondragover={handleDragOver}
	ondragleave={handleDragLeave}
	ondrop={handleDrop}
>

	{#if appState === 'input' || appState === 'loading'}
		<!-- Input Screen -->
		<div
			class="flex flex-col items-center w-full max-w-lg px-6 transition-opacity duration-300"
			class:opacity-50={appState === 'loading'}
		>
			<!-- Tiny bolt logo -->
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-6 h-6 mb-6 text-muted-foreground">
				<path d="M11.983 1.907a.75.75 0 0 0-1.292-.657l-8.5 9.5A.75.75 0 0 0 2.75 12h6.572l-1.305 6.093a.75.75 0 0 0 1.292.657l8.5-9.5A.75.75 0 0 0 17.25 8h-6.572l1.305-6.093Z" />
			</svg>

			<textarea
				bind:this={inputRef}
				bind:value={inputValue}
				onpaste={handlePaste}
				onkeydown={handleInputKeydown}
				disabled={appState === 'loading'}
				placeholder="Paste any URL, text, or drop a file to begin..."
				rows="3"
				class="w-full bg-transparent border-none outline-none resize-none text-center text-xl text-muted-foreground placeholder:text-border leading-relaxed transition-colors {isDragging ? 'text-foreground/80' : ''}"
			></textarea>

			{#if appState === 'loading'}
				<p class="mt-4 text-sm text-muted-foreground">
					Preparing...
				</p>
			{/if}

			{#if errorMessage}
				<p class="mt-4 text-sm text-destructive">
					{errorMessage}
				</p>
			{/if}

			{#if hasSavedSession}
				<button
					onclick={resumeSession}
					class="mt-6 px-4 py-2 text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg hover:border-muted-foreground transition-colors"
				>
					Resume reading: <span class="italic">{savedSessionPreview}</span>
				</button>
			{/if}

			<p class="mt-6 text-xs text-muted-foreground text-center max-w-xs">
				Tip: 250-400 wpm gives best comprehension. Higher speeds are better for skimming.
			</p>
		</div>

	{:else if appState === 'countdown'}
		<!-- Countdown Screen -->
		{#key countdownValue}
			<div
				bind:this={countdownRef}
				class="font-geist-mono text-8xl text-muted-foreground select-none animate-countdown"
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
				<div class="w-px h-5 bg-border"></div>

				<!-- RSVP Word -->
				<div class="h-20 md:h-24 flex items-center justify-center my-1">
					<div class="font-geist-mono text-5xl md:text-7xl select-none whitespace-nowrap">
						<span
							class="inline-block text-right text-muted-foreground"
							style="width: 6ch;"
						>{wordParts.left}</span><!--
						--><span class="text-foreground font-medium">{wordParts.pivot}</span><!--
						--><span
							class="inline-block text-left text-muted-foreground"
							style="width: 6ch;"
						>{wordParts.right}</span>
					</div>
				</div>

				<!-- Bottom centerline marker -->
				<div class="w-px h-5 bg-border"></div>
			</div>

			<!-- Controls Bar -->
				<div class="flex flex-col sm:flex-row items-center gap-3 sm:gap-4 px-4 sm:px-5 py-3 sm:py-2.5 mt-8 sm:mt-10 rounded-2xl sm:rounded-full bg-secondary mx-4 sm:mx-0">
					<!-- Top row on mobile: main controls -->
					<div class="flex items-center gap-4">
						<button
							onclick={goBack}
							class="text-sm text-muted-foreground hover:text-foreground transition-colors"
						>
							Back
						</button>

						<button
							onclick={togglePlay}
							class="px-5 py-1.5 text-sm font-medium rounded-full bg-border text-foreground hover:opacity-80 transition-opacity"
						>
							{appState === 'playing' ? 'Pause' : 'Start'}
						</button>

						<button
							onclick={restart}
							class="text-sm text-muted-foreground hover:text-foreground transition-colors"
						>
							Restart
						</button>
					</div>

					<!-- Bottom row on mobile: progress and speed -->
					<div class="flex items-center gap-4">
						<span class="text-sm text-muted-foreground font-mono tabular-nums">
							{progress}
						</span>

						<div class="flex items-center gap-2">
							<input
								type="range"
								min="100"
								max="900"
								step="25"
								bind:value={wpm}
								oninput={handleWpmChange}
								class="w-20 h-1 rounded-full appearance-none cursor-pointer"
								style="accent-color: var(--foreground); background-color: var(--muted-foreground);"
							/>
							<span class="text-sm text-muted-foreground font-mono tabular-nums w-10">
								{wpm}
							</span>
						</div>
					</div>
				</div>
		</div>
	{/if}
</div>
