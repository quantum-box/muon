import {
	ChevronDown,
	ChevronRight,
	Download,
	FileDown,
	FileUp,
	Folder,
	FolderPlus,
	Loader2,
	Pencil,
	Play,
	Plus,
	Send,
	Trash2,
	Upload,
	X,
} from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { JsonTreeView } from '../components/json-tree-view'
import { KeyValueEditor } from '../components/key-value-editor'
import { SplitPane } from '../components/split-pane'
import { useBatchRun, useCollections } from '../hooks/use-collections'
import {
	collectionToScenarioYaml,
	exportPostmanCollection,
	findItemById,
	flattenRequests,
	importPostmanCollection,
} from '../lib/collections'
import { sendHttpRequest } from '../lib/tauri-api'
import type {
	Collection,
	CollectionFolder,
	CollectionItem,
	CollectionRequest,
	HttpMethod,
	HttpRequestConfig,
	HttpResponseData,
} from '../lib/types'
import { HTTP_METHODS } from '../lib/types'
import {
	cn,
	formatDuration,
	formatJson,
	highlightJson,
	methodColor,
	statusColor,
} from '../lib/utils'

export function CollectionsPage() {
	const {
		collections,
		activeCollectionId,
		activeRequestId,
		setActiveCollectionId,
		setActiveRequestId,
		addCollection,
		removeCollection,
		updateCollection,
		addFolder,
		addRequest,
		removeItem,
		updateItem,
	} = useCollections()

	const {
		running: batchRunning,
		results: batchResults,
		currentIndex: batchIndex,
		runFolder,
	} = useBatchRun()

	const [showNewCollection, setShowNewCollection] = useState(false)
	const [newName, setNewName] = useState('')
	const [showImport, setShowImport] = useState(false)
	const [showExport, setShowExport] = useState(false)
	const [showBatchResults, setShowBatchResults] = useState(false)
	const [showScenarioExport, setShowScenarioExport] = useState(false)
	const [response, setResponse] = useState<HttpResponseData | null>(null)
	const [sending, setSending] = useState(false)
	const [sendError, setSendError] = useState<string | null>(null)
	const fileInputRef = useRef<HTMLInputElement>(null)

	const activeCollection = collections.find(c => c.id === activeCollectionId)
	const activeRequest =
		activeCollection && activeRequestId
			? (findItemById(
					activeCollection.items,
					activeRequestId,
				) as CollectionRequest | null)
			: null

	const handleCreateCollection = useCallback(() => {
		if (!newName.trim()) return
		addCollection(newName.trim())
		setNewName('')
		setShowNewCollection(false)
	}, [newName, addCollection])

	const handleImportPostman = useCallback(
		(jsonStr: string) => {
			try {
				const collection = importPostmanCollection(jsonStr)
				updateCollection(collection)
				setActiveCollectionId(collection.id)
				setShowImport(false)
			} catch (e) {
				alert(
					`Import failed: ${e instanceof Error ? e.message : 'Invalid JSON'}`,
				)
			}
		},
		[updateCollection, setActiveCollectionId],
	)

	const handleImportFile = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const file = e.target.files?.[0]
			if (!file) return
			const reader = new FileReader()
			reader.onload = () => {
				const text = reader.result as string
				// Detect if Postman or muon scenario
				try {
					const parsed = JSON.parse(text)
					if (parsed.info?.schema?.includes('postman') || parsed.info?.name) {
						handleImportPostman(text)
					} else {
						alert(
							'Unrecognized format. Please use Postman Collection v2.1 JSON.',
						)
					}
				} catch {
					alert('Invalid JSON file.')
				}
			}
			reader.readAsText(file)
			e.target.value = ''
		},
		[handleImportPostman],
	)

	const handleSendRequest = useCallback(async () => {
		if (!activeRequest) return
		setSending(true)
		setSendError(null)
		setResponse(null)
		try {
			const resp = await sendHttpRequest(activeRequest.config)
			setResponse(resp)
		} catch (e) {
			setSendError(e instanceof Error ? e.message : 'Request failed')
		} finally {
			setSending(false)
		}
	}, [activeRequest])

	const handleBatchRun = useCallback(
		async (items: CollectionItem[]) => {
			setShowBatchResults(true)
			await runFolder(items)
		},
		[runFolder],
	)

	return (
		<div className='h-full flex flex-col'>
			{/* Toolbar */}
			<div className='flex items-center gap-2 px-4 py-2 border-b border-slate-700/50'>
				<h1 className='text-sm font-semibold text-slate-200'>Collections</h1>
				<div className='flex-1' />
				<button type="button"
					onClick={() => setShowNewCollection(true)}
					className='flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-violet-500/10 text-violet-400 rounded-md hover:bg-violet-500/20 transition-colors'
				>
					<Plus className='w-3.5 h-3.5' />
					New
				</button>
				<button type="button"
					onClick={() => fileInputRef.current?.click()}
					className='flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-slate-700/50 text-slate-300 rounded-md hover:bg-slate-700 transition-colors'
				>
					<Upload className='w-3.5 h-3.5' />
					Import
				</button>
				<input
					ref={fileInputRef}
					type='file'
					accept='.json'
					onChange={handleImportFile}
					className='hidden'
				/>
			</div>

			{/* Main content split */}
			<div className='flex-1 overflow-hidden'>
				<SplitPane
					direction='vertical'
					defaultSize={28}
					minSize={15}
					maxSize={50}
				>
					{/* Left: Collection tree */}
					<div className='h-full flex flex-col overflow-hidden'>
						<CollectionList
							collections={collections}
							activeCollectionId={activeCollectionId}
							activeRequestId={activeRequestId}
							onSelectCollection={setActiveCollectionId}
							onSelectRequest={(colId, reqId) => {
								setActiveCollectionId(colId)
								setActiveRequestId(reqId)
								setResponse(null)
								setSendError(null)
							}}
							onAddFolder={(colId, parentId) => {
								const name = prompt('Folder name:')
								if (name) addFolder(colId, parentId, name)
							}}
							onAddRequest={(colId, parentId) => {
								const name = prompt('Request name:')
								if (name) addRequest(colId, parentId, name)
							}}
							onRemoveItem={removeItem}
							onRemoveCollection={removeCollection}
							onRenameItem={(colId, itemId, newN) => {
								updateItem(colId, itemId, item => ({ ...item, name: newN }))
							}}
							onExportCollection={col => {
								setActiveCollectionId(col.id)
								setShowExport(true)
							}}
							onExportScenario={col => {
								setActiveCollectionId(col.id)
								setShowScenarioExport(true)
							}}
							onBatchRun={items => handleBatchRun(items)}
							batchRunning={batchRunning}
						/>
					</div>

					{/* Right: Request editor + Response */}
					<div className='h-full overflow-hidden'>
						{activeRequest ? (
							<SplitPane
								direction='horizontal'
								defaultSize={50}
								minSize={25}
								maxSize={75}
							>
								<RequestEditor
									request={activeRequest}
									sending={sending}
									onSend={handleSendRequest}
									onChange={config => {
										if (!activeCollectionId) return
										updateItem(activeCollectionId, activeRequest.id, item =>
											item.type === 'request' ? { ...item, config } : item,
										)
									}}
									onRename={name => {
										if (!activeCollectionId) return
										updateItem(activeCollectionId, activeRequest.id, item => ({
											...item,
											name,
										}))
									}}
								/>
								<ResponseViewer
									response={response}
									error={sendError}
									sending={sending}
								/>
							</SplitPane>
						) : (
							<div className='h-full flex items-center justify-center text-slate-600 text-sm'>
								<div className='text-center space-y-2'>
									<Send className='w-8 h-8 mx-auto opacity-30' />
									<p>Select a request or create one to get started</p>
								</div>
							</div>
						)}
					</div>
				</SplitPane>
			</div>

			{/* New Collection Modal */}
			{showNewCollection && (
				<Modal
					onClose={() => setShowNewCollection(false)}
					title='New Collection'
				>
					<input
						type='text'
						value={newName}
						onChange={e => setNewName(e.target.value)}
						onKeyDown={e => e.key === 'Enter' && handleCreateCollection()}
						placeholder='Collection name'
						className='w-full bg-slate-800/50 border border-slate-700/50 rounded-md px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-violet-500/50'
					/>
					<div className='flex justify-end gap-2 mt-4'>
						<button type="button"
							onClick={() => setShowNewCollection(false)}
							className='px-3 py-1.5 text-xs text-slate-400 hover:text-slate-300'
						>
							Cancel
						</button>
						<button type="button"
							onClick={handleCreateCollection}
							className='px-3 py-1.5 text-xs bg-violet-500/20 text-violet-400 rounded-md hover:bg-violet-500/30'
						>
							Create
						</button>
					</div>
				</Modal>
			)}

			{/* Export Modal */}
			{showExport && activeCollection && (
				<ExportModal
					collection={activeCollection}
					onClose={() => setShowExport(false)}
				/>
			)}

			{/* Scenario Export Modal */}
			{showScenarioExport && activeCollection && (
				<ScenarioExportModal
					collection={activeCollection}
					onClose={() => setShowScenarioExport(false)}
				/>
			)}

			{/* Batch Results */}
			{showBatchResults && (
				<BatchResultsModal
					results={batchResults}
					running={batchRunning}
					currentIndex={batchIndex}
					onClose={() => setShowBatchResults(false)}
				/>
			)}

			{/* Import Modal */}
			{showImport && (
				<ImportModal
					onImport={handleImportPostman}
					onClose={() => setShowImport(false)}
				/>
			)}
		</div>
	)
}

// ── Collection Tree ─────────────────────────────────

interface CollectionListProps {
	collections: Collection[]
	activeCollectionId: string | null
	activeRequestId: string | null
	onSelectCollection: (id: string) => void
	onSelectRequest: (colId: string, reqId: string) => void
	onAddFolder: (colId: string, parentId: string | null) => void
	onAddRequest: (colId: string, parentId: string | null) => void
	onRemoveItem: (colId: string, itemId: string) => void
	onRemoveCollection: (id: string) => void
	onRenameItem: (colId: string, itemId: string, name: string) => void
	onExportCollection: (col: Collection) => void
	onExportScenario: (col: Collection) => void
	onBatchRun: (items: CollectionItem[]) => void
	batchRunning: boolean
}

function CollectionList({
	collections,
	activeCollectionId,
	activeRequestId,
	onSelectCollection,
	onSelectRequest,
	onAddFolder,
	onAddRequest,
	onRemoveItem,
	onRemoveCollection,
	onRenameItem,
	onExportCollection,
	onExportScenario,
	onBatchRun,
	batchRunning,
}: CollectionListProps) {
	const [expandedCollections, setExpandedCollections] = useState<Set<string>>(
		new Set(),
	)
	const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
	const [contextMenu, setContextMenu] = useState<{
		x: number
		y: number
		type: 'collection' | 'folder' | 'request'
		collectionId: string
		itemId?: string
	} | null>(null)

	function toggleCollection(id: string) {
		setExpandedCollections(prev => {
			const next = new Set(prev)
			if (next.has(id)) next.delete(id)
			else next.add(id)
			return next
		})
		onSelectCollection(id)
	}

	function toggleFolder(id: string) {
		setExpandedFolders(prev => {
			const next = new Set(prev)
			if (next.has(id)) next.delete(id)
			else next.add(id)
			return next
		})
	}

	function handleContextMenu(
		e: React.MouseEvent,
		type: 'collection' | 'folder' | 'request',
		collectionId: string,
		itemId?: string,
	) {
		e.preventDefault()
		setContextMenu({ x: e.clientX, y: e.clientY, type, collectionId, itemId })
	}

	return (
		<div
			className='h-full overflow-y-auto py-1'
			onClick={() => setContextMenu(null)}
		>
			{collections.length === 0 ? (
				<div className='flex flex-col items-center justify-center h-full text-slate-600 text-xs px-4 text-center'>
					<Folder className='w-6 h-6 mb-2 opacity-30' />
					<p>No collections yet</p>
					<p className='mt-1 text-slate-700'>
						Create or import a collection to get started
					</p>
				</div>
			) : (
				collections.map(col => (
					<div key={col.id}>
						{/* Collection header */}
						<button type="button"
							onClick={() => toggleCollection(col.id)}
							onContextMenu={e => handleContextMenu(e, 'collection', col.id)}
							className={cn(
								'w-full flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium hover:bg-slate-800/50 transition-colors',
								activeCollectionId === col.id
									? 'text-violet-300 bg-violet-500/5'
									: 'text-slate-400',
							)}
						>
							{expandedCollections.has(col.id) ? (
								<ChevronDown className='w-3.5 h-3.5 shrink-0' />
							) : (
								<ChevronRight className='w-3.5 h-3.5 shrink-0' />
							)}
							<Folder className='w-3.5 h-3.5 shrink-0 text-amber-500/60' />
							<span className='truncate'>{col.name}</span>
							<span className='ml-auto text-[10px] text-slate-600'>
								{flattenRequests(col.items).length}
							</span>
						</button>

						{/* Collection items */}
						{expandedCollections.has(col.id) && (
							<div className='ml-2'>
								<TreeItems
									items={col.items}
									collectionId={col.id}
									depth={1}
									activeRequestId={activeRequestId}
									expandedFolders={expandedFolders}
									onToggleFolder={toggleFolder}
									onSelectRequest={reqId => onSelectRequest(col.id, reqId)}
									onContextMenu={handleContextMenu}
								/>
								{/* Add buttons */}
								<div className='flex items-center gap-1 px-3 py-1'>
									<button type="button"
										onClick={() => onAddRequest(col.id, null)}
										className='flex items-center gap-1 text-[10px] text-slate-600 hover:text-violet-400 transition-colors'
									>
										<Plus className='w-3 h-3' />
										Request
									</button>
									<span className='text-slate-700'>|</span>
									<button type="button"
										onClick={() => onAddFolder(col.id, null)}
										className='flex items-center gap-1 text-[10px] text-slate-600 hover:text-violet-400 transition-colors'
									>
										<FolderPlus className='w-3 h-3' />
										Folder
									</button>
								</div>
							</div>
						)}
					</div>
				))
			)}

			{/* Context Menu */}
			{contextMenu && (
				<ContextMenu
					{...contextMenu}
					collection={collections.find(c => c.id === contextMenu.collectionId)!}
					onAddFolder={onAddFolder}
					onAddRequest={onAddRequest}
					onRemoveItem={onRemoveItem}
					onRemoveCollection={onRemoveCollection}
					onRenameItem={onRenameItem}
					onExportCollection={onExportCollection}
					onExportScenario={onExportScenario}
					onBatchRun={onBatchRun}
					batchRunning={batchRunning}
					onClose={() => setContextMenu(null)}
				/>
			)}
		</div>
	)
}

// ── Tree Items ──────────────────────────────────────

interface TreeItemsProps {
	items: CollectionItem[]
	collectionId: string
	depth: number
	activeRequestId: string | null
	expandedFolders: Set<string>
	onToggleFolder: (id: string) => void
	onSelectRequest: (id: string) => void
	onContextMenu: (
		e: React.MouseEvent,
		type: 'folder' | 'request',
		colId: string,
		itemId: string,
	) => void
}

function TreeItems({
	items,
	collectionId,
	depth,
	activeRequestId,
	expandedFolders,
	onToggleFolder,
	onSelectRequest,
	onContextMenu,
}: TreeItemsProps) {
	return (
		<>
			{items.map(item => {
				if (item.type === 'folder') {
					const expanded = expandedFolders.has(item.id)
					return (
						<div key={item.id}>
							<button type="button"
								onClick={() => onToggleFolder(item.id)}
								onContextMenu={e =>
									onContextMenu(e, 'folder', collectionId, item.id)
								}
								className='w-full flex items-center gap-1.5 px-2 py-1 text-xs text-slate-400 hover:bg-slate-800/50 transition-colors'
								style={{ paddingLeft: `${depth * 12 + 8}px` }}
							>
								{expanded ? (
									<ChevronDown className='w-3 h-3 shrink-0' />
								) : (
									<ChevronRight className='w-3 h-3 shrink-0' />
								)}
								<Folder className='w-3.5 h-3.5 shrink-0 text-amber-500/40' />
								<span className='truncate'>{item.name}</span>
								<span className='ml-auto text-[10px] text-slate-600'>
									{flattenRequests(item.items).length}
								</span>
							</button>
							{expanded && (
								<TreeItems
									items={item.items}
									collectionId={collectionId}
									depth={depth + 1}
									activeRequestId={activeRequestId}
									expandedFolders={expandedFolders}
									onToggleFolder={onToggleFolder}
									onSelectRequest={onSelectRequest}
									onContextMenu={onContextMenu}
								/>
							)}
						</div>
					)
				}

				return (
					<button type="button"
						key={item.id}
						onClick={() => onSelectRequest(item.id)}
						onContextMenu={e =>
							onContextMenu(e, 'request', collectionId, item.id)
						}
						className={cn(
							'w-full flex items-center gap-1.5 px-2 py-1 text-xs transition-colors',
							activeRequestId === item.id
								? 'text-slate-200 bg-violet-500/10'
								: 'text-slate-500 hover:bg-slate-800/50 hover:text-slate-300',
						)}
						style={{ paddingLeft: `${depth * 12 + 8}px` }}
					>
						<span
							className={cn(
								'text-[9px] font-bold font-mono shrink-0 w-8',
								methodColor(item.config.method),
							)}
						>
							{item.config.method.slice(0, 3)}
						</span>
						<span className='truncate'>{item.name}</span>
					</button>
				)
			})}
		</>
	)
}

// ── Context Menu ────────────────────────────────────

interface ContextMenuProps {
	x: number
	y: number
	type: 'collection' | 'folder' | 'request'
	collectionId: string
	itemId?: string
	collection: Collection
	onAddFolder: (colId: string, parentId: string | null) => void
	onAddRequest: (colId: string, parentId: string | null) => void
	onRemoveItem: (colId: string, itemId: string) => void
	onRemoveCollection: (id: string) => void
	onRenameItem: (colId: string, itemId: string, name: string) => void
	onExportCollection: (col: Collection) => void
	onExportScenario: (col: Collection) => void
	onBatchRun: (items: CollectionItem[]) => void
	batchRunning: boolean
	onClose: () => void
}

function ContextMenu({
	x,
	y,
	type,
	collectionId,
	itemId,
	collection,
	onAddFolder,
	onAddRequest,
	onRemoveItem,
	onRemoveCollection,
	onRenameItem,
	onExportCollection,
	onExportScenario,
	onBatchRun,
	batchRunning,
	onClose,
}: ContextMenuProps) {
	function action(fn: () => void) {
		fn()
		onClose()
	}

	const menuItems: {
		label: string
		icon: typeof Plus
		onClick: () => void
		danger?: boolean
	}[] = []

	if (type === 'collection') {
		menuItems.push(
			{
				label: 'Add Request',
				icon: Plus,
				onClick: () => action(() => onAddRequest(collectionId, null)),
			},
			{
				label: 'Add Folder',
				icon: FolderPlus,
				onClick: () => action(() => onAddFolder(collectionId, null)),
			},
			{
				label: 'Run All',
				icon: Play,
				onClick: () => action(() => onBatchRun(collection.items)),
			},
			{
				label: 'Export Postman',
				icon: Download,
				onClick: () => action(() => onExportCollection(collection)),
			},
			{
				label: 'Export as Scenario',
				icon: FileDown,
				onClick: () => action(() => onExportScenario(collection)),
			},
			{
				label: 'Delete Collection',
				icon: Trash2,
				onClick: () => {
					if (confirm(`Delete collection "${collection.name}"?`)) {
						action(() => onRemoveCollection(collectionId))
					}
				},
				danger: true,
			},
		)
	} else if (type === 'folder' && itemId) {
		const folder = findItemById(
			collection.items,
			itemId,
		) as CollectionFolder | null
		menuItems.push(
			{
				label: 'Add Request',
				icon: Plus,
				onClick: () => action(() => onAddRequest(collectionId, itemId)),
			},
			{
				label: 'Add Subfolder',
				icon: FolderPlus,
				onClick: () => action(() => onAddFolder(collectionId, itemId)),
			},
			{
				label: 'Run Folder',
				icon: Play,
				onClick: () => action(() => folder && onBatchRun(folder.items)),
			},
			{
				label: 'Rename',
				icon: Pencil,
				onClick: () => {
					const name = prompt('New name:', folder?.name)
					if (name) action(() => onRenameItem(collectionId, itemId, name))
				},
			},
			{
				label: 'Delete Folder',
				icon: Trash2,
				onClick: () => action(() => onRemoveItem(collectionId, itemId)),
				danger: true,
			},
		)
	} else if (type === 'request' && itemId) {
		const req = findItemById(collection.items, itemId)
		menuItems.push(
			{
				label: 'Rename',
				icon: Pencil,
				onClick: () => {
					const name = prompt('New name:', req?.name)
					if (name) action(() => onRenameItem(collectionId, itemId, name))
				},
			},
			{
				label: 'Delete Request',
				icon: Trash2,
				onClick: () => action(() => onRemoveItem(collectionId, itemId)),
				danger: true,
			},
		)
	}

	return (
		<div
			className='fixed z-50 bg-slate-800 border border-slate-700/50 rounded-lg shadow-xl py-1 min-w-[180px]'
			style={{ left: x, top: y }}
			onClick={e => e.stopPropagation()}
		>
			{menuItems.map((item, i) => (
				<button type="button"
					key={i}
					onClick={item.onClick}
					disabled={item.icon === Play && batchRunning}
					className={cn(
						'w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors',
						item.danger
							? 'text-red-400 hover:bg-red-500/10'
							: 'text-slate-300 hover:bg-slate-700/50',
					)}
				>
					<item.icon className='w-3.5 h-3.5' />
					{item.label}
				</button>
			))}
		</div>
	)
}

// ── Request Editor ──────────────────────────────────

type ReqTab = 'params' | 'headers' | 'body'

function RequestEditor({
	request,
	sending,
	onSend,
	onChange,
	onRename,
}: {
	request: CollectionRequest
	sending: boolean
	onSend: () => void
	onChange: (config: HttpRequestConfig) => void
	onRename: (name: string) => void
}) {
	const [activeTab, setActiveTab] = useState<ReqTab>('params')
	const config = request.config

	function update(partial: Partial<HttpRequestConfig>) {
		onChange({ ...config, ...partial })
	}

	return (
		<div className='h-full flex flex-col overflow-hidden'>
			{/* Request name */}
			<div className='px-3 py-2 border-b border-slate-700/50'>
				<input
					type='text'
					value={request.name}
					onChange={e => onRename(e.target.value)}
					className='text-sm font-medium text-slate-200 bg-transparent border-none outline-none w-full'
				/>
			</div>

			{/* URL bar */}
			<div className='flex items-center gap-2 px-3 py-2 border-b border-slate-700/50'>
				<select
					value={config.method}
					onChange={e => update({ method: e.target.value as HttpMethod })}
					className='bg-slate-800/50 border border-slate-700/50 rounded px-2 py-1.5 text-xs font-bold font-mono text-slate-200 focus:outline-none focus:border-violet-500/50'
				>
					{HTTP_METHODS.map(m => (
						<option key={m} value={m}>
							{m}
						</option>
					))}
				</select>
				<input
					type='text'
					value={config.url}
					onChange={e => update({ url: e.target.value })}
					onKeyDown={e => e.key === 'Enter' && onSend()}
					placeholder='https://api.example.com/endpoint'
					className='flex-1 bg-slate-800/50 border border-slate-700/50 rounded px-2.5 py-1.5 text-xs font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-violet-500/50'
				/>
				<button type="button"
					onClick={onSend}
					disabled={sending || !config.url}
					className={cn(
						'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
						sending
							? 'bg-slate-700 text-slate-500 cursor-wait'
							: 'bg-violet-500/20 text-violet-400 hover:bg-violet-500/30',
					)}
				>
					{sending ? (
						<Loader2 className='w-3.5 h-3.5 animate-spin' />
					) : (
						<Send className='w-3.5 h-3.5' />
					)}
					Send
				</button>
			</div>

			{/* Tabs */}
			<div className='flex border-b border-slate-700/50'>
				{(['params', 'headers', 'body'] as const).map(tab => (
					<button type="button"
						key={tab}
						onClick={() => setActiveTab(tab)}
						className={cn(
							'px-3 py-1.5 text-xs font-medium transition-colors border-b-2',
							activeTab === tab
								? 'text-violet-400 border-violet-500'
								: 'text-slate-500 border-transparent hover:text-slate-400',
						)}
					>
						{tab.charAt(0).toUpperCase() + tab.slice(1)}
					</button>
				))}
			</div>

			{/* Tab content */}
			<div className='flex-1 overflow-auto p-3'>
				{activeTab === 'params' && (
					<KeyValueEditor
						pairs={config.params}
						onChange={params => update({ params })}
						keyPlaceholder='Parameter'
						valuePlaceholder='Value'
					/>
				)}
				{activeTab === 'headers' && (
					<KeyValueEditor
						pairs={config.headers}
						onChange={headers => update({ headers })}
						keyPlaceholder='Header'
						valuePlaceholder='Value'
					/>
				)}
				{activeTab === 'body' && (
					<div className='space-y-2'>
						<div className='flex gap-2'>
							{(['none', 'json', 'form', 'raw'] as const).map(bt => (
								<button type="button"
									key={bt}
									onClick={() => update({ bodyType: bt })}
									className={cn(
										'px-2.5 py-1 text-xs rounded-md transition-colors',
										config.bodyType === bt
											? 'bg-violet-500/20 text-violet-400'
											: 'text-slate-500 hover:text-slate-400',
									)}
								>
									{bt}
								</button>
							))}
						</div>
						{config.bodyType === 'json' || config.bodyType === 'raw' ? (
							<textarea
								value={config.bodyContent}
								onChange={e => update({ bodyContent: e.target.value })}
								placeholder={
									config.bodyType === 'json'
										? '{\n  "key": "value"\n}'
										: 'Raw body content'
								}
								rows={10}
								className='w-full bg-slate-800/50 border border-slate-700/50 rounded-md px-3 py-2 text-xs font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-violet-500/50 resize-none'
							/>
						) : config.bodyType === 'form' ? (
							<KeyValueEditor
								pairs={config.formData}
								onChange={formData => update({ formData })}
								keyPlaceholder='Field'
								valuePlaceholder='Value'
							/>
						) : (
							<p className='text-xs text-slate-600 italic'>
								No body for this request
							</p>
						)}
					</div>
				)}
			</div>
		</div>
	)
}

// ── Response Viewer ─────────────────────────────────

type RespTab = 'pretty' | 'tree' | 'raw' | 'headers'

function ResponseViewer({
	response,
	error,
	sending,
}: {
	response: HttpResponseData | null
	error: string | null
	sending: boolean
}) {
	const [activeTab, setActiveTab] = useState<RespTab>('pretty')

	if (sending) {
		return (
			<div className='h-full flex items-center justify-center'>
				<div className='flex items-center gap-2 text-slate-500 text-xs'>
					<Loader2 className='w-4 h-4 animate-spin' />
					Sending request...
				</div>
			</div>
		)
	}

	if (error) {
		return (
			<div className='h-full flex items-center justify-center'>
				<div className='text-center space-y-2'>
					<X className='w-6 h-6 mx-auto text-red-400' />
					<p className='text-xs text-red-400'>{error}</p>
				</div>
			</div>
		)
	}

	if (!response) {
		return (
			<div className='h-full flex items-center justify-center text-slate-600 text-xs'>
				Response will appear here
			</div>
		)
	}

	let parsedBody: unknown = null
	try {
		parsedBody = JSON.parse(response.body)
	} catch {
		// not JSON
	}

	return (
		<div className='h-full flex flex-col overflow-hidden'>
			{/* Status bar */}
			<div className='flex items-center gap-3 px-3 py-2 border-b border-slate-700/50'>
				<span
					className={cn(
						'px-2 py-0.5 rounded text-xs font-bold font-mono',
						statusColor(response.status),
					)}
				>
					{response.status} {response.status_text}
				</span>
				<span className='text-[10px] text-slate-500'>
					{formatDuration(response.duration_ms)}
				</span>
				<span className='text-[10px] text-slate-600'>
					{response.size_bytes > 1024
						? `${(response.size_bytes / 1024).toFixed(1)} KB`
						: `${response.size_bytes} B`}
				</span>
			</div>

			{/* Tabs */}
			<div className='flex border-b border-slate-700/50'>
				{(['pretty', 'tree', 'raw', 'headers'] as const).map(tab => (
					<button type="button"
						key={tab}
						onClick={() => setActiveTab(tab)}
						className={cn(
							'px-3 py-1.5 text-xs font-medium transition-colors border-b-2',
							activeTab === tab
								? 'text-violet-400 border-violet-500'
								: 'text-slate-500 border-transparent hover:text-slate-400',
						)}
					>
						{tab.charAt(0).toUpperCase() + tab.slice(1)}
					</button>
				))}
			</div>

			{/* Content */}
			<div className='flex-1 overflow-auto p-3'>
				{activeTab === 'pretty' && (
					<pre
						className='text-xs font-mono leading-relaxed whitespace-pre-wrap break-all'
						dangerouslySetInnerHTML={{
							__html: highlightJson(formatJson(response.body)),
						}}
					/>
				)}
				{activeTab === 'tree' && parsedBody != null ? (
					<JsonTreeView data={parsedBody} />
				) : activeTab === 'tree' ? (
					<p className='text-xs text-slate-600 italic'>Response is not JSON</p>
				) : null}
				{activeTab === 'raw' && (
					<pre className='text-xs font-mono text-slate-300 whitespace-pre-wrap break-all'>
						{response.body}
					</pre>
				)}
				{activeTab === 'headers' && (
					<div className='bg-slate-900/50 border border-slate-700/50 rounded-md overflow-hidden'>
						<table className='w-full text-xs font-mono'>
							<tbody>
								{Object.entries(response.headers).map(([k, v]) => (
									<tr
										key={k}
										className='border-b border-slate-800 last:border-0'
									>
										<td className='px-3 py-1.5 text-violet-400 whitespace-nowrap'>
											{k}
										</td>
										<td className='px-3 py-1.5 text-slate-300 break-all'>
											{v}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</div>
		</div>
	)
}

// ── Modals ──────────────────────────────────────────

function Modal({
	title,
	onClose,
	children,
	wide,
}: {
	title: string
	onClose: () => void
	children: React.ReactNode
	wide?: boolean
}) {
	return (
		<div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm'>
			<div
				className={cn(
					'bg-slate-800 border border-slate-700/50 rounded-lg shadow-xl p-4',
					wide ? 'w-[640px] max-h-[80vh] flex flex-col' : 'w-96',
				)}
			>
				<div className='flex items-center justify-between mb-3'>
					<h2 className='text-sm font-semibold text-slate-200'>{title}</h2>
					<button type="button"
						onClick={onClose}
						className='text-slate-500 hover:text-slate-300'
					>
						<X className='w-4 h-4' />
					</button>
				</div>
				{children}
			</div>
		</div>
	)
}

function ExportModal({
	collection,
	onClose,
}: {
	collection: Collection
	onClose: () => void
}) {
	const json = exportPostmanCollection(collection)

	function download() {
		const blob = new Blob([json], { type: 'application/json' })
		const url = URL.createObjectURL(blob)
		const a = document.createElement('a')
		a.href = url
		a.download = `${collection.name.replace(/\s+/g, '-').toLowerCase()}.postman_collection.json`
		a.click()
		URL.revokeObjectURL(url)
	}

	function copyToClipboard() {
		navigator.clipboard.writeText(json)
	}

	return (
		<Modal title='Export Postman Collection' onClose={onClose} wide>
			<pre className='flex-1 overflow-auto bg-slate-900/50 border border-slate-700/50 rounded-md p-3 text-xs font-mono text-slate-300 max-h-[400px]'>
				{json}
			</pre>
			<div className='flex justify-end gap-2 mt-3'>
				<button type="button"
					onClick={copyToClipboard}
					className='px-3 py-1.5 text-xs text-slate-400 hover:text-slate-300 bg-slate-700/50 rounded-md'
				>
					Copy
				</button>
				<button type="button"
					onClick={download}
					className='px-3 py-1.5 text-xs bg-violet-500/20 text-violet-400 rounded-md hover:bg-violet-500/30'
				>
					<Download className='w-3.5 h-3.5 inline mr-1' />
					Download
				</button>
			</div>
		</Modal>
	)
}

function ScenarioExportModal({
	collection,
	onClose,
}: {
	collection: Collection
	onClose: () => void
}) {
	const yaml = collectionToScenarioYaml(collection)

	function download() {
		const blob = new Blob([yaml], { type: 'text/yaml' })
		const url = URL.createObjectURL(blob)
		const a = document.createElement('a')
		a.href = url
		a.download = `${collection.name.replace(/\s+/g, '-').toLowerCase()}.yaml`
		a.click()
		URL.revokeObjectURL(url)
	}

	function copyToClipboard() {
		navigator.clipboard.writeText(yaml)
	}

	return (
		<Modal title='Export as Muon Scenario' onClose={onClose} wide>
			<pre className='flex-1 overflow-auto bg-slate-900/50 border border-slate-700/50 rounded-md p-3 text-xs font-mono text-slate-300 max-h-[400px]'>
				{yaml}
			</pre>
			<div className='flex justify-end gap-2 mt-3'>
				<button type="button"
					onClick={copyToClipboard}
					className='px-3 py-1.5 text-xs text-slate-400 hover:text-slate-300 bg-slate-700/50 rounded-md'
				>
					Copy
				</button>
				<button type="button"
					onClick={download}
					className='px-3 py-1.5 text-xs bg-violet-500/20 text-violet-400 rounded-md hover:bg-violet-500/30'
				>
					<FileDown className='w-3.5 h-3.5 inline mr-1' />
					Download YAML
				</button>
			</div>
		</Modal>
	)
}

function ImportModal({
	onImport,
	onClose,
}: {
	onImport: (json: string) => void
	onClose: () => void
}) {
	const [text, setText] = useState('')

	return (
		<Modal title='Import Postman Collection' onClose={onClose} wide>
			<textarea
				value={text}
				onChange={e => setText(e.target.value)}
				placeholder='Paste Postman Collection v2.1 JSON here...'
				rows={12}
				className='w-full bg-slate-900/50 border border-slate-700/50 rounded-md px-3 py-2 text-xs font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-violet-500/50 resize-none'
			/>
			<div className='flex justify-end gap-2 mt-3'>
				<button type="button"
					onClick={onClose}
					className='px-3 py-1.5 text-xs text-slate-400 hover:text-slate-300'
				>
					Cancel
				</button>
				<button type="button"
					onClick={() => onImport(text)}
					disabled={!text.trim()}
					className='px-3 py-1.5 text-xs bg-violet-500/20 text-violet-400 rounded-md hover:bg-violet-500/30 disabled:opacity-50'
				>
					<FileUp className='w-3.5 h-3.5 inline mr-1' />
					Import
				</button>
			</div>
		</Modal>
	)
}

function BatchResultsModal({
	results,
	running,
	currentIndex,
	onClose,
}: {
	results: import('../lib/types').BatchRunResult[]
	running: boolean
	currentIndex: number
	onClose: () => void
}) {
	const passed = results.filter(
		r => r.response && r.response.status >= 200 && r.response.status < 300,
	).length
	const failed = results.filter(
		r => r.error || (r.response && r.response.status >= 400),
	).length
	const totalDuration = results.reduce((sum, r) => sum + r.duration_ms, 0)

	return (
		<Modal title='Batch Run Results' onClose={onClose} wide>
			{/* Summary */}
			<div className='flex items-center gap-4 mb-3'>
				{running && (
					<span className='flex items-center gap-1.5 text-xs text-blue-400'>
						<Loader2 className='w-3.5 h-3.5 animate-spin' />
						Running ({currentIndex + 1}/{results.length + (running ? 1 : 0)})
					</span>
				)}
				{!running && results.length > 0 && (
					<>
						<span className='text-xs text-emerald-400'>{passed} passed</span>
						{failed > 0 && (
							<span className='text-xs text-red-400'>{failed} failed</span>
						)}
						<span className='text-xs text-slate-500'>
							{formatDuration(totalDuration)}
						</span>
					</>
				)}
			</div>

			{/* Results list */}
			<div className='max-h-[400px] overflow-auto space-y-1'>
				{results.map((r, i) => (
					<div
						key={r.request_id}
						className='flex items-center gap-2 px-3 py-2 bg-slate-900/50 rounded-md'
					>
						<span className='text-xs text-slate-500 w-4'>{i + 1}</span>
						{r.error ? (
							<span className='px-1.5 py-0.5 rounded text-[10px] font-bold font-mono text-red-400 bg-red-500/10'>
								ERR
							</span>
						) : r.response ? (
							<span
								className={cn(
									'px-1.5 py-0.5 rounded text-[10px] font-bold font-mono',
									statusColor(r.response.status),
								)}
							>
								{r.response.status}
							</span>
						) : null}
						<span className='flex-1 text-xs text-slate-300 truncate'>
							{r.name}
						</span>
						<span className='text-[10px] text-slate-500'>
							{formatDuration(r.duration_ms)}
						</span>
					</div>
				))}
			</div>
		</Modal>
	)
}
