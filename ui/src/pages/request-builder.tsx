import {
	BookmarkPlus,
	Calendar,
	Check,
	ChevronDown,
	Clock,
	Copy,
	Filter,
	Loader2,
	RotateCcw,
	Save,
	Search,
	Send,
	Trash2,
	X,
} from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { JsonTreeView } from '../components/json-tree-view'
import { KeyValueEditor } from '../components/key-value-editor'
import { SseStreamViewer } from '../components/sse-stream-viewer'
import {
	addRequestHistory,
	clearRequestHistory,
	deleteRequestHistoryEntry,
	deleteSavedRequest,
	getRequestHistory,
	getSavedRequests,
	saveRequest,
	sendHttpRequest,
} from '../lib/tauri-api'
import type {
	HttpMethod,
	HttpRequestConfig,
	HttpResponseData,
	RequestHistoryEntry,
	SavedRequest,
} from '../lib/types'
import { DEFAULT_REQUEST, HTTP_METHODS } from '../lib/types'
import {
	cn,
	formatDuration,
	formatJson,
	formatTimestamp,
	highlightJson,
	methodColor,
	statusColor,
} from '../lib/utils'

type RequestTab = 'params' | 'headers' | 'body'
type ResponseTab = 'pretty' | 'tree' | 'raw' | 'headers' | 'sse'
type SidebarTab = 'history' | 'collections'
type MethodFilter = HttpMethod | 'ALL'
type DateFilter = 'all' | 'today' | 'week' | 'month'

function cloneRequest(config: HttpRequestConfig): HttpRequestConfig {
	return JSON.parse(JSON.stringify(config))
}

function extractUrlPath(url: string): string {
	try {
		const u = new URL(url)
		return u.pathname + u.search
	} catch {
		return url
	}
}

function extractHost(url: string): string {
	try {
		return new URL(url).host
	} catch {
		return ''
	}
}

function isWithinDateFilter(timestamp: string, filter: DateFilter): boolean {
	if (filter === 'all') return true
	const d = new Date(timestamp)
	const now = new Date()
	const diffMs = now.getTime() - d.getTime()
	switch (filter) {
		case 'today':
			return diffMs < 86_400_000
		case 'week':
			return diffMs < 7 * 86_400_000
		case 'month':
			return diffMs < 30 * 86_400_000
	}
}

export function RequestBuilderPage() {
	const [config, setConfig] = useState<HttpRequestConfig>(
		cloneRequest(DEFAULT_REQUEST),
	)
	const [response, setResponse] = useState<HttpResponseData | null>(null)
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [requestTab, setRequestTab] = useState<RequestTab>('params')
	const [responseTab, setResponseTab] = useState<ResponseTab>('pretty')
	const [copied, setCopied] = useState(false)
	const [savedRequests, setSavedRequests] = useState<SavedRequest[]>(() =>
		getSavedRequests(),
	)
	const [requestHistory, setRequestHistory] = useState<RequestHistoryEntry[]>(
		() => getRequestHistory(),
	)
	const [showSidebar, setShowSidebar] = useState(false)
	const [sidebarTab, setSidebarTab] = useState<SidebarTab>('history')
	const [showMethodDropdown, setShowMethodDropdown] = useState(false)
	const [saveDialogOpen, setSaveDialogOpen] = useState(false)
	const [saveName, setSaveName] = useState('')
	const [saveFromHistoryEntry, setSaveFromHistoryEntry] =
		useState<RequestHistoryEntry | null>(null)
	const methodRef = useRef<HTMLDivElement>(null)
	const urlInputRef = useRef<HTMLInputElement>(null)

	// History filters
	const [historySearch, setHistorySearch] = useState('')
	const [historyMethodFilter, setHistoryMethodFilter] =
		useState<MethodFilter>('ALL')
	const [historyDateFilter, setHistoryDateFilter] = useState<DateFilter>('all')
	const [showHistoryMethodDropdown, setShowHistoryMethodDropdown] =
		useState(false)
	const [showHistoryDateDropdown, setShowHistoryDateDropdown] = useState(false)
	const [showClearConfirm, setShowClearConfirm] = useState(false)

	const filteredHistory = useMemo(() => {
		let items = requestHistory
		if (historyMethodFilter !== 'ALL') {
			items = items.filter(h => h.config.method === historyMethodFilter)
		}
		if (historyDateFilter !== 'all') {
			items = items.filter(h =>
				isWithinDateFilter(h.timestamp, historyDateFilter),
			)
		}
		if (historySearch) {
			const q = historySearch.toLowerCase()
			items = items.filter(h => h.config.url.toLowerCase().includes(q))
		}
		return items
	}, [requestHistory, historySearch, historyMethodFilter, historyDateFilter])

	const handleSend = useCallback(async () => {
		if (!config.url.trim()) {
			setError('URL is required')
			return
		}
		setLoading(true)
		setError(null)
		setResponse(null)
		try {
			const result = await sendHttpRequest(config)
			setResponse(result)
			// Auto-save to history
			const entry: RequestHistoryEntry = {
				id: crypto.randomUUID(),
				config: cloneRequest(config),
				response: result,
				error: null,
				timestamp: new Date().toISOString(),
			}
			addRequestHistory(entry)
			setRequestHistory(getRequestHistory())
		} catch (e) {
			const errMsg = e instanceof Error ? e.message : String(e)
			setError(errMsg)
			// Save failed requests too
			const entry: RequestHistoryEntry = {
				id: crypto.randomUUID(),
				config: cloneRequest(config),
				response: null,
				error: errMsg,
				timestamp: new Date().toISOString(),
			}
			addRequestHistory(entry)
			setRequestHistory(getRequestHistory())
		} finally {
			setLoading(false)
		}
	}, [config])

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
				e.preventDefault()
				handleSend()
			}
		},
		[handleSend],
	)

	function updateConfig(patch: Partial<HttpRequestConfig>) {
		setConfig(prev => ({ ...prev, ...patch }))
	}

	// Save to collection
	function handleSaveRequest() {
		if (!saveName.trim()) return
		const configToSave = saveFromHistoryEntry
			? cloneRequest(saveFromHistoryEntry.config)
			: cloneRequest(config)
		const entry: SavedRequest = {
			id: crypto.randomUUID(),
			name: saveName.trim(),
			config: configToSave,
			timestamp: new Date().toISOString(),
		}
		saveRequest(entry)
		setSavedRequests(getSavedRequests())
		setSaveDialogOpen(false)
		setSaveName('')
		setSaveFromHistoryEntry(null)
	}

	function handleLoadRequest(saved: SavedRequest) {
		setConfig(cloneRequest(saved.config))
		setResponse(null)
		setError(null)
	}

	function handleDeleteSaved(id: string) {
		deleteSavedRequest(id)
		setSavedRequests(getSavedRequests())
	}

	// History actions
	function handleLoadFromHistory(entry: RequestHistoryEntry) {
		setConfig(cloneRequest(entry.config))
		setResponse(entry.response)
		setError(entry.error)
	}

	function handleReExecute(entry: RequestHistoryEntry) {
		setConfig(cloneRequest(entry.config))
		setResponse(null)
		setError(null)
		// Trigger send after state update
		setTimeout(async () => {
			const cfg = entry.config
			if (!cfg.url.trim()) return
			setLoading(true)
			try {
				const result = await sendHttpRequest(cfg)
				setResponse(result)
				const newEntry: RequestHistoryEntry = {
					id: crypto.randomUUID(),
					config: cloneRequest(cfg),
					response: result,
					error: null,
					timestamp: new Date().toISOString(),
				}
				addRequestHistory(newEntry)
				setRequestHistory(getRequestHistory())
			} catch (e) {
				const errMsg = e instanceof Error ? e.message : String(e)
				setError(errMsg)
			} finally {
				setLoading(false)
			}
		}, 0)
	}

	function handleSaveHistoryToCollection(entry: RequestHistoryEntry) {
		setSaveFromHistoryEntry(entry)
		setSaveName('')
		setSaveDialogOpen(true)
	}

	function handleDeleteHistory(id: string) {
		deleteRequestHistoryEntry(id)
		setRequestHistory(getRequestHistory())
	}

	function handleClearHistory() {
		clearRequestHistory()
		setRequestHistory([])
		setShowClearConfirm(false)
	}

	function handleCopyResponse() {
		if (!response) return
		navigator.clipboard.writeText(formatJson(response.body))
		setCopied(true)
		setTimeout(() => setCopied(false), 2000)
	}

	const bodyStr = response?.body ?? ''
	const formattedBody = formatJson(bodyStr)

	const enabledParamCount = config.params.filter(
		p => p.enabled && p.key.trim(),
	).length
	const enabledHeaderCount = config.headers.filter(
		p => p.enabled && p.key.trim(),
	).length

	const REQUEST_TABS: { id: RequestTab; label: string; badge?: number }[] = [
		{ id: 'params', label: 'Params', badge: enabledParamCount || undefined },
		{ id: 'headers', label: 'Headers', badge: enabledHeaderCount || undefined },
		{ id: 'body', label: 'Body' },
	]

	const hasSseContent = bodyStr.includes('event:') && bodyStr.includes('data:')
	const RESPONSE_TABS: { id: ResponseTab; label: string; show: boolean }[] = [
		{ id: 'pretty', label: 'Pretty', show: true },
		{ id: 'tree', label: 'Tree', show: true },
		{ id: 'raw', label: 'Raw', show: true },
		{ id: 'headers', label: 'Headers', show: true },
		{ id: 'sse', label: 'SSE', show: hasSseContent },
	]
	const visibleResponseTabs = RESPONSE_TABS.filter(t => t.show)

	const DATE_FILTERS: { value: DateFilter; label: string }[] = [
		{ value: 'all', label: 'All time' },
		{ value: 'today', label: 'Today' },
		{ value: 'week', label: 'This week' },
		{ value: 'month', label: 'This month' },
	]

	const hasActiveFilters =
		historyMethodFilter !== 'ALL' ||
		historyDateFilter !== 'all' ||
		historySearch !== ''

	return (
		<div
			className='h-[calc(100vh-4.25rem)] flex flex-col'
			onKeyDown={handleKeyDown}
		>
			{/* Top bar: method + URL + send */}
			<div className='border-b border-slate-700/50 p-3 flex items-center gap-2 shrink-0'>
				{/* Sidebar toggle */}
				<button
					type='button'
					onClick={() => setShowSidebar(!showSidebar)}
					className={cn(
						'px-2 py-1.5 rounded text-xs transition-colors',
						showSidebar
							? 'text-violet-400 bg-violet-500/10'
							: 'text-slate-400 hover:text-slate-200 hover:bg-slate-800',
					)}
					title='History & Collections'
				>
					<HistoryIcon className='w-4 h-4' />
				</button>

				{/* Method selector */}
				<div className='relative' ref={methodRef}>
					<button
						type='button'
						onClick={() => setShowMethodDropdown(!showMethodDropdown)}
						className={cn(
							'flex items-center gap-1 px-3 py-1.5 rounded text-xs font-bold font-mono min-w-[80px] justify-between',
							methodColor(config.method),
						)}
					>
						{config.method}
						<ChevronDown className='w-3 h-3' />
					</button>
					{showMethodDropdown && (
						<div className='absolute top-full left-0 mt-1 bg-slate-800 border border-slate-700 rounded-md shadow-xl z-50 py-1 min-w-[100px]'>
							{HTTP_METHODS.map(m => (
								<button
									type='button'
									key={m}
									onClick={() => {
										updateConfig({ method: m as HttpMethod })
										setShowMethodDropdown(false)
									}}
									className={cn(
										'w-full px-3 py-1.5 text-left text-xs font-mono font-bold hover:bg-slate-700/50 transition-colors',
										methodColor(m),
									)}
								>
									{m}
								</button>
							))}
						</div>
					)}
				</div>

				{/* URL input */}
				<input
					ref={urlInputRef}
					type='text'
					value={config.url}
					onChange={e => updateConfig({ url: e.target.value })}
					placeholder='https://api.example.com/endpoint'
					className='flex-1 bg-slate-800/50 border border-slate-700/50 rounded px-3 py-1.5 text-sm font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-violet-500/50'
				/>

				{/* Send button */}
				<button
					type='button'
					onClick={handleSend}
					disabled={loading}
					className={cn(
						'flex items-center gap-2 px-4 py-1.5 rounded text-xs font-medium transition-colors',
						loading
							? 'bg-slate-700 text-slate-400 cursor-not-allowed'
							: 'bg-violet-600 hover:bg-violet-500 text-white',
					)}
				>
					{loading ? (
						<Loader2 className='w-3.5 h-3.5 animate-spin' />
					) : (
						<Send className='w-3.5 h-3.5' />
					)}
					Send
				</button>

				{/* Save button */}
				<button
					type='button'
					onClick={() => {
						setSaveFromHistoryEntry(null)
						setSaveDialogOpen(true)
					}}
					className='px-2 py-1.5 rounded text-slate-400 hover:text-violet-400 hover:bg-slate-800 transition-colors'
					title='Save to collection'
				>
					<Save className='w-4 h-4' />
				</button>
			</div>

			{/* Main content */}
			<div className='flex-1 flex overflow-hidden'>
				{/* Sidebar: History & Collections */}
				{showSidebar && (
					<div className='w-72 border-r border-slate-700/50 bg-slate-900/50 flex flex-col shrink-0 overflow-hidden'>
						{/* Sidebar tabs */}
						<div className='border-b border-slate-700/50 flex shrink-0'>
							<button
								type='button'
								onClick={() => setSidebarTab('history')}
								className={cn(
									'flex-1 px-3 py-2 text-xs font-medium transition-colors relative flex items-center justify-center gap-1.5',
									sidebarTab === 'history'
										? 'text-violet-400'
										: 'text-slate-500 hover:text-slate-300',
								)}
							>
								<Clock className='w-3 h-3' />
								History
								{requestHistory.length > 0 && (
									<span className='text-[10px] font-mono text-slate-600'>
										{requestHistory.length}
									</span>
								)}
								{sidebarTab === 'history' && (
									<div className='absolute bottom-0 left-0 right-0 h-0.5 bg-violet-500' />
								)}
							</button>
							<button
								type='button'
								onClick={() => setSidebarTab('collections')}
								className={cn(
									'flex-1 px-3 py-2 text-xs font-medium transition-colors relative flex items-center justify-center gap-1.5',
									sidebarTab === 'collections'
										? 'text-violet-400'
										: 'text-slate-500 hover:text-slate-300',
								)}
							>
								<Save className='w-3 h-3' />
								Collections
								{savedRequests.length > 0 && (
									<span className='text-[10px] font-mono text-slate-600'>
										{savedRequests.length}
									</span>
								)}
								{sidebarTab === 'collections' && (
									<div className='absolute bottom-0 left-0 right-0 h-0.5 bg-violet-500' />
								)}
							</button>
						</div>

						{/* History panel */}
						{sidebarTab === 'history' && (
							<div className='flex-1 flex flex-col overflow-hidden'>
								{/* Search */}
								<div className='p-2 space-y-1.5 border-b border-slate-700/50 shrink-0'>
									<div className='relative'>
										<Search className='absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-600' />
										<input
											type='text'
											placeholder='Filter by URL...'
											value={historySearch}
											onChange={e => setHistorySearch(e.target.value)}
											className='w-full pl-7 pr-6 py-1.5 bg-slate-800/50 border border-slate-700/50 rounded text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-violet-500/50'
										/>
										{historySearch && (
											<button
												type='button'
												onClick={() => setHistorySearch('')}
												className='absolute right-2 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-400'
											>
												<X className='w-3 h-3' />
											</button>
										)}
									</div>

									{/* Filter row */}
									<div className='flex items-center gap-1.5'>
										{/* Method filter */}
										<div className='relative flex-1'>
											<button
												type='button'
												onClick={() => {
													setShowHistoryMethodDropdown(
														!showHistoryMethodDropdown,
													)
													setShowHistoryDateDropdown(false)
												}}
												className={cn(
													'flex items-center gap-1 w-full px-2 py-1 rounded text-[10px] font-mono border transition-colors',
													historyMethodFilter !== 'ALL'
														? 'border-violet-500/50 text-violet-400 bg-violet-500/5'
														: 'border-slate-700/50 text-slate-500 hover:text-slate-300',
												)}
											>
												<Filter className='w-2.5 h-2.5' />
												{historyMethodFilter === 'ALL'
													? 'Method'
													: historyMethodFilter}
												<ChevronDown className='w-2.5 h-2.5 ml-auto' />
											</button>
											{showHistoryMethodDropdown && (
												<div className='absolute top-full left-0 mt-1 bg-slate-800 border border-slate-700 rounded-md shadow-xl z-50 py-1 min-w-full'>
													<button
														type='button'
														onClick={() => {
															setHistoryMethodFilter('ALL')
															setShowHistoryMethodDropdown(false)
														}}
														className={cn(
															'w-full px-2 py-1 text-left text-[10px] font-mono hover:bg-slate-700/50',
															historyMethodFilter === 'ALL'
																? 'text-violet-400'
																: 'text-slate-400',
														)}
													>
														ALL
													</button>
													{HTTP_METHODS.map(m => (
														<button
															type='button'
															key={m}
															onClick={() => {
																setHistoryMethodFilter(m)
																setShowHistoryMethodDropdown(false)
															}}
															className={cn(
																'w-full px-2 py-1 text-left text-[10px] font-mono font-bold hover:bg-slate-700/50',
																methodColor(m),
															)}
														>
															{m}
														</button>
													))}
												</div>
											)}
										</div>

										{/* Date filter */}
										<div className='relative flex-1'>
											<button
												type='button'
												onClick={() => {
													setShowHistoryDateDropdown(!showHistoryDateDropdown)
													setShowHistoryMethodDropdown(false)
												}}
												className={cn(
													'flex items-center gap-1 w-full px-2 py-1 rounded text-[10px] border transition-colors',
													historyDateFilter !== 'all'
														? 'border-violet-500/50 text-violet-400 bg-violet-500/5'
														: 'border-slate-700/50 text-slate-500 hover:text-slate-300',
												)}
											>
												<Calendar className='w-2.5 h-2.5' />
												{DATE_FILTERS.find(f => f.value === historyDateFilter)
													?.label ?? 'Date'}
												<ChevronDown className='w-2.5 h-2.5 ml-auto' />
											</button>
											{showHistoryDateDropdown && (
												<div className='absolute top-full left-0 mt-1 bg-slate-800 border border-slate-700 rounded-md shadow-xl z-50 py-1 min-w-full'>
													{DATE_FILTERS.map(f => (
														<button
															type='button'
															key={f.value}
															onClick={() => {
																setHistoryDateFilter(f.value)
																setShowHistoryDateDropdown(false)
															}}
															className={cn(
																'w-full px-2 py-1 text-left text-[10px] hover:bg-slate-700/50',
																historyDateFilter === f.value
																	? 'text-violet-400'
																	: 'text-slate-400',
															)}
														>
															{f.label}
														</button>
													))}
												</div>
											)}
										</div>

										{/* Clear filters */}
										{hasActiveFilters && (
											<button
												type='button'
												onClick={() => {
													setHistorySearch('')
													setHistoryMethodFilter('ALL')
													setHistoryDateFilter('all')
												}}
												className='p-1 text-slate-600 hover:text-slate-400 transition-colors'
												title='Clear filters'
											>
												<X className='w-3 h-3' />
											</button>
										)}
									</div>
								</div>

								{/* History list */}
								<div className='flex-1 overflow-auto'>
									{filteredHistory.length === 0 ? (
										<div className='p-4 text-center'>
											<Clock className='w-6 h-6 text-slate-700 mx-auto mb-2' />
											<p className='text-xs text-slate-600'>
												{requestHistory.length === 0
													? 'No request history yet'
													: 'No matching requests'}
											</p>
										</div>
									) : (
										filteredHistory.map(entry => (
											<div
												key={entry.id}
												role='button'
												tabIndex={0}
												className='group border-b border-slate-800/50 hover:bg-slate-800/30 cursor-pointer transition-colors'
												onClick={() => handleLoadFromHistory(entry)}
												onKeyDown={e => {
													if (e.key === 'Enter' || e.key === ' ')
														handleLoadFromHistory(entry)
												}}
											>
												<div className='px-2.5 py-2'>
													<div className='flex items-center gap-1.5 mb-0.5'>
														<span
															className={cn(
																'text-[10px] font-bold font-mono shrink-0 px-1 rounded',
																methodColor(entry.config.method),
															)}
														>
															{entry.config.method}
														</span>
														{entry.response && (
															<span
																className={cn(
																	'text-[10px] font-mono px-1 rounded',
																	statusColor(entry.response.status),
																)}
															>
																{entry.response.status}
															</span>
														)}
														{entry.error && (
															<span className='text-[10px] font-mono px-1 rounded text-red-400 bg-red-400/10'>
																ERR
															</span>
														)}
														<span className='text-[10px] text-slate-600 ml-auto shrink-0'>
															{formatTimestamp(entry.timestamp)}
														</span>
													</div>
													<div
														className='text-[11px] text-slate-400 font-mono truncate'
														title={entry.config.url}
													>
														{extractUrlPath(entry.config.url)}
													</div>
													<div className='text-[10px] text-slate-600 font-mono truncate'>
														{extractHost(entry.config.url)}
													</div>
													{entry.response && (
														<div className='text-[10px] text-slate-600 mt-0.5'>
															{formatDuration(entry.response.duration_ms)}
															{' · '}
															{entry.response.size_bytes > 1024
																? `${(entry.response.size_bytes / 1024).toFixed(1)} KB`
																: `${entry.response.size_bytes} B`}
														</div>
													)}
												</div>
												{/* Action buttons on hover */}
												<div className='hidden group-hover:flex items-center gap-1 px-2.5 pb-2 -mt-0.5'>
													<button
														type='button'
														onClick={e => {
															e.stopPropagation()
															handleReExecute(entry)
														}}
														className='flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-slate-500 hover:text-violet-400 hover:bg-violet-500/10 transition-colors'
														title='Re-execute'
													>
														<RotateCcw className='w-2.5 h-2.5' />
														Replay
													</button>
													<button
														type='button'
														onClick={e => {
															e.stopPropagation()
															handleSaveHistoryToCollection(entry)
														}}
														className='flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-slate-500 hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors'
														title='Save to collection'
													>
														<BookmarkPlus className='w-2.5 h-2.5' />
														Save
													</button>
													<button
														type='button'
														onClick={e => {
															e.stopPropagation()
															handleDeleteHistory(entry.id)
														}}
														className='flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors ml-auto'
														title='Delete'
													>
														<Trash2 className='w-2.5 h-2.5' />
													</button>
												</div>
											</div>
										))
									)}
								</div>

								{/* Clear history */}
								{requestHistory.length > 0 && (
									<div className='border-t border-slate-700/50 p-2 shrink-0'>
										{showClearConfirm ? (
											<div className='flex items-center gap-1.5 justify-center'>
												<span className='text-[10px] text-slate-500'>
													Clear all?
												</span>
												<button
													type='button'
													onClick={handleClearHistory}
													className='px-2 py-0.5 text-[10px] bg-red-600 text-white rounded hover:bg-red-500'
												>
													Yes
												</button>
												<button
													type='button'
													onClick={() => setShowClearConfirm(false)}
													className='px-2 py-0.5 text-[10px] border border-slate-700 text-slate-400 rounded hover:bg-slate-800'
												>
													No
												</button>
											</div>
										) : (
											<button
												type='button'
												onClick={() => setShowClearConfirm(true)}
												className='w-full flex items-center justify-center gap-1.5 px-2 py-1 text-[10px] text-slate-600 hover:text-red-400 transition-colors rounded hover:bg-slate-800/50'
											>
												<Trash2 className='w-3 h-3' />
												Clear History
											</button>
										)}
									</div>
								)}
							</div>
						)}

						{/* Collections panel */}
						{sidebarTab === 'collections' && (
							<div className='flex-1 overflow-auto'>
								{savedRequests.length === 0 ? (
									<div className='p-4 text-center'>
										<Save className='w-6 h-6 text-slate-700 mx-auto mb-2' />
										<p className='text-xs text-slate-600'>No saved requests</p>
										<p className='text-[10px] text-slate-700 mt-1'>
											Save requests to quickly access them later
										</p>
									</div>
								) : (
									savedRequests.map(req => (
										<div
											key={req.id}
											className='group flex items-center gap-2 px-3 py-2.5 hover:bg-slate-800/50 cursor-pointer border-b border-slate-800/50'
											onClick={() => handleLoadRequest(req)}
											onKeyDown={e => {
												if (e.key === 'Enter' || e.key === ' ')
													handleLoadRequest(req)
											}}
											role='button'
											tabIndex={0}
										>
											<span
												className={cn(
													'text-[10px] font-bold font-mono shrink-0 px-1 rounded',
													methodColor(req.config.method),
												)}
											>
												{req.config.method}
											</span>
											<div className='flex-1 min-w-0'>
												<div className='text-xs text-slate-300 truncate'>
													{req.name}
												</div>
												<div className='text-[10px] text-slate-600 font-mono truncate'>
													{extractUrlPath(req.config.url)}
												</div>
											</div>
											<button
												type='button'
												onClick={e => {
													e.stopPropagation()
													handleDeleteSaved(req.id)
												}}
												className='opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 transition-all p-1'
											>
												<Trash2 className='w-3 h-3' />
											</button>
										</div>
									))
								)}
							</div>
						)}
					</div>
				)}

				{/* Request panel */}
				<div className='flex-1 flex flex-col min-w-0 border-r border-slate-700/50'>
					{/* Request tabs */}
					<div className='border-b border-slate-700/50 flex px-4 shrink-0'>
						{REQUEST_TABS.map(tab => (
							<button
								type='button'
								key={tab.id}
								onClick={() => setRequestTab(tab.id)}
								className={cn(
									'px-3 py-2 text-xs font-medium transition-colors relative flex items-center gap-1.5',
									requestTab === tab.id
										? 'text-violet-400'
										: 'text-slate-500 hover:text-slate-300',
								)}
							>
								{tab.label}
								{tab.badge != null && tab.badge > 0 && (
									<span className='bg-violet-500/20 text-violet-400 text-[10px] font-mono px-1.5 rounded-full'>
										{tab.badge}
									</span>
								)}
								{requestTab === tab.id && (
									<div className='absolute bottom-0 left-0 right-0 h-0.5 bg-violet-500' />
								)}
							</button>
						))}
					</div>

					{/* Request tab content */}
					<div className='flex-1 overflow-auto p-4'>
						{requestTab === 'params' && (
							<div>
								<div className='mb-2 text-xs text-slate-500'>
									Query Parameters
								</div>
								<KeyValueEditor
									pairs={config.params}
									onChange={params => updateConfig({ params })}
									keyPlaceholder='Parameter'
									valuePlaceholder='Value'
								/>
							</div>
						)}

						{requestTab === 'headers' && (
							<div>
								<div className='mb-2 text-xs text-slate-500'>
									Request Headers
								</div>
								<KeyValueEditor
									pairs={config.headers}
									onChange={headers => updateConfig({ headers })}
									keyPlaceholder='Header'
									valuePlaceholder='Value'
								/>
							</div>
						)}

						{requestTab === 'body' && (
							<div className='space-y-3'>
								{/* Body type selector */}
								<div className='flex items-center gap-3'>
									{(['none', 'json', 'form', 'raw'] as const).map(type => (
										<label
											key={type}
											className='flex items-center gap-1.5 cursor-pointer'
										>
											<input
												type='radio'
												name='bodyType'
												checked={config.bodyType === type}
												onChange={() => updateConfig({ bodyType: type })}
												className='w-3 h-3 text-violet-500 bg-slate-800 border-slate-600'
											/>
											<span className='text-xs text-slate-400 capitalize'>
												{type}
											</span>
										</label>
									))}
								</div>

								{config.bodyType === 'none' && (
									<div className='text-xs text-slate-600 py-8 text-center'>
										This request does not have a body
									</div>
								)}

								{config.bodyType === 'json' && (
									<textarea
										value={config.bodyContent}
										onChange={e =>
											updateConfig({ bodyContent: e.target.value })
										}
										placeholder='{\n  "key": "value"\n}'
										rows={14}
										className='w-full bg-slate-800/50 border border-slate-700/50 rounded px-3 py-2 text-xs font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-violet-500/50 resize-none leading-relaxed'
										spellCheck={false}
									/>
								)}

								{config.bodyType === 'form' && (
									<KeyValueEditor
										pairs={config.formData}
										onChange={formData => updateConfig({ formData })}
										keyPlaceholder='Field'
										valuePlaceholder='Value'
									/>
								)}

								{config.bodyType === 'raw' && (
									<textarea
										value={config.bodyContent}
										onChange={e =>
											updateConfig({ bodyContent: e.target.value })
										}
										placeholder='Raw request body...'
										rows={14}
										className='w-full bg-slate-800/50 border border-slate-700/50 rounded px-3 py-2 text-xs font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-violet-500/50 resize-none leading-relaxed'
										spellCheck={false}
									/>
								)}
							</div>
						)}
					</div>
				</div>

				{/* Response panel */}
				<div className='flex-1 flex flex-col min-w-0'>
					{!response && !error && !loading && (
						<div className='flex-1 flex flex-col items-center justify-center text-slate-600 gap-2 p-8'>
							<Send className='w-8 h-8 mb-2 opacity-30' />
							<p className='text-sm'>No response yet</p>
							<p className='text-xs'>
								Hit{' '}
								<kbd className='px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-[10px] font-mono'>
									Ctrl+Enter
								</kbd>{' '}
								to send
							</p>
						</div>
					)}

					{loading && (
						<div className='flex-1 flex flex-col items-center justify-center text-slate-500 gap-3'>
							<Loader2 className='w-6 h-6 animate-spin text-violet-400' />
							<p className='text-xs'>Sending request...</p>
						</div>
					)}

					{error && !loading && (
						<div className='p-4'>
							<div className='bg-red-500/10 border border-red-500/20 rounded-md p-4'>
								<p className='text-xs font-medium text-red-400 mb-1'>
									Request Error
								</p>
								<p className='text-xs text-red-300 font-mono break-all'>
									{error}
								</p>
							</div>
						</div>
					)}

					{response && !loading && (
						<>
							{/* Response status bar */}
							<div className='border-b border-slate-700/50 px-4 py-2.5 flex items-center gap-3 shrink-0'>
								<span
									className={cn(
										'px-2.5 py-1 rounded text-xs font-bold font-mono',
										statusColor(response.status),
									)}
								>
									{response.status} {response.status_text}
								</span>
								<span className='text-xs text-slate-500 font-mono'>
									{formatDuration(response.duration_ms)}
								</span>
								<span className='text-xs text-slate-600 font-mono'>
									{response.size_bytes > 1024
										? `${(response.size_bytes / 1024).toFixed(1)} KB`
										: `${response.size_bytes} B`}
								</span>
							</div>

							{/* Response tabs */}
							<div className='border-b border-slate-700/50 flex px-4 shrink-0'>
								{visibleResponseTabs.map(tab => (
									<button
										type='button'
										key={tab.id}
										onClick={() => setResponseTab(tab.id)}
										className={cn(
											'px-3 py-2 text-xs font-medium transition-colors relative',
											responseTab === tab.id
												? 'text-violet-400'
												: 'text-slate-500 hover:text-slate-300',
										)}
									>
										{tab.label}
										{responseTab === tab.id && (
											<div className='absolute bottom-0 left-0 right-0 h-0.5 bg-violet-500' />
										)}
									</button>
								))}
							</div>

							{/* Response content */}
							<div className='flex-1 overflow-auto p-4'>
								{responseTab === 'pretty' && (
									<div className='relative'>
										<button
											type='button'
											onClick={handleCopyResponse}
											className='absolute top-2 right-2 p-1.5 rounded bg-slate-700/50 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors z-10'
											title='Copy response'
										>
											{copied ? (
												<Check className='w-3.5 h-3.5 text-emerald-400' />
											) : (
												<Copy className='w-3.5 h-3.5' />
											)}
										</button>
										{/* biome-ignore lint/security/noDangerouslySetInnerHtml: syntax-highlighted JSON output */}
										<pre
											className='bg-slate-900/50 border border-slate-700/50 rounded-md p-3 text-xs font-mono overflow-x-auto leading-relaxed max-h-[calc(100vh-16rem)] overflow-y-auto'
											dangerouslySetInnerHTML={{
												__html: highlightJson(formattedBody),
											}}
										/>
									</div>
								)}

								{responseTab === 'tree' && (
									<div>
										{(() => {
											try {
												const parsed = JSON.parse(bodyStr)
												return (
													<JsonTreeView data={parsed} defaultExpanded={3} />
												)
											} catch {
												return (
													<div className='flex flex-col items-center justify-center py-8 text-slate-600 gap-1'>
														<p className='text-sm'>Not valid JSON</p>
														<p className='text-xs'>
															Tree view requires a valid JSON response body
														</p>
													</div>
												)
											}
										})()}
									</div>
								)}

								{responseTab === 'raw' && (
									<div className='relative'>
										<button
											type='button'
											onClick={handleCopyResponse}
											className='absolute top-2 right-2 p-1.5 rounded bg-slate-700/50 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors z-10'
											title='Copy response'
										>
											{copied ? (
												<Check className='w-3.5 h-3.5 text-emerald-400' />
											) : (
												<Copy className='w-3.5 h-3.5' />
											)}
										</button>
										<pre className='bg-slate-900/50 border border-slate-700/50 rounded-md p-3 text-xs font-mono overflow-x-auto leading-relaxed max-h-[calc(100vh-16rem)] overflow-y-auto text-slate-300 whitespace-pre-wrap break-all'>
											{bodyStr}
										</pre>
									</div>
								)}

								{responseTab === 'headers' && (
									<div>
										{Object.keys(response.headers).length > 0 ? (
											<div className='bg-slate-900/50 border border-slate-700/50 rounded-md overflow-hidden'>
												<table className='w-full text-xs font-mono'>
													<thead>
														<tr className='border-b border-slate-700/50'>
															<th className='px-3 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider w-1/3'>
																Name
															</th>
															<th className='px-3 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider'>
																Value
															</th>
														</tr>
													</thead>
													<tbody>
														{Object.entries(response.headers).map(([k, v]) => (
															<tr
																key={k}
																className='border-b border-slate-800 last:border-0 hover:bg-slate-800/30'
															>
																<td className='px-3 py-2 text-violet-400 whitespace-nowrap font-medium'>
																	{k}
																</td>
																<td className='px-3 py-2 text-slate-300 break-all'>
																	{v}
																</td>
															</tr>
														))}
													</tbody>
												</table>
											</div>
										) : (
											<p className='text-xs text-slate-600'>
												No response headers
											</p>
										)}
									</div>
								)}

								{responseTab === 'sse' && <SseStreamViewer body={bodyStr} />}
							</div>
						</>
					)}
				</div>
			</div>

			{/* Save dialog */}
			{saveDialogOpen && (
				<div className='fixed inset-0 bg-black/50 flex items-center justify-center z-50'>
					<div className='bg-slate-800 border border-slate-700 rounded-lg p-4 w-80 shadow-xl'>
						<h3 className='text-sm font-medium text-slate-200 mb-1'>
							Save to Collection
						</h3>
						{saveFromHistoryEntry && (
							<p className='text-[10px] text-slate-500 mb-3 font-mono truncate'>
								{saveFromHistoryEntry.config.method}{' '}
								{extractUrlPath(saveFromHistoryEntry.config.url)}
							</p>
						)}
						<input
							type='text'
							value={saveName}
							onChange={e => setSaveName(e.target.value)}
							onKeyDown={e => {
								if (e.key === 'Enter') handleSaveRequest()
								if (e.key === 'Escape') {
									setSaveDialogOpen(false)
									setSaveFromHistoryEntry(null)
								}
							}}
							placeholder='Request name...'
							// biome-ignore lint/a11y/noAutofocus: dialog input needs autofocus
							autoFocus
							className='w-full bg-slate-900/50 border border-slate-700/50 rounded px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-violet-500/50 mb-3'
						/>
						<div className='flex justify-end gap-2'>
							<button
								type='button'
								onClick={() => {
									setSaveDialogOpen(false)
									setSaveFromHistoryEntry(null)
								}}
								className='px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors'
							>
								Cancel
							</button>
							<button
								type='button'
								onClick={handleSaveRequest}
								disabled={!saveName.trim()}
								className='px-3 py-1.5 text-xs bg-violet-600 hover:bg-violet-500 text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
							>
								Save
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	)
}

function HistoryIcon({ className }: { className?: string }) {
	return (
		<svg
			xmlns='http://www.w3.org/2000/svg'
			viewBox='0 0 24 24'
			fill='none'
			stroke='currentColor'
			strokeWidth={2}
			strokeLinecap='round'
			strokeLinejoin='round'
			className={className}
		>
			<path d='M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8' />
			<path d='M3 3v5h5' />
			<path d='M12 7v5l4 2' />
		</svg>
	)
}
