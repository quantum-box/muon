import {
	Check,
	Copy,
	Download,
	Eye,
	EyeOff,
	FileUp,
	Globe,
	Plus,
	Save,
	Settings2,
	Trash2,
	Upload,
	X,
} from 'lucide-react'
import { useRef, useState } from 'react'
import {
	useEnvironments,
	notifyEnvironmentChange,
} from '../hooks/use-environments'
import {
	createEnvironment,
	deleteEnvironmentStore,
	duplicateEnvironment,
	parseDotEnv,
	updateEnvironmentStore,
} from '../lib/environments'
import type { EnvironmentVariable, MuonEnvironment } from '../lib/types'
import { cn } from '../lib/utils'

export function EnvironmentsPage() {
	const { environments, activeId, setActive } = useEnvironments()
	const [selectedId, setSelectedId] = useState<string | null>(null)
	const [showNewDialog, setShowNewDialog] = useState(false)
	const [newEnvName, setNewEnvName] = useState('')
	const [showImportDialog, setShowImportDialog] = useState(false)
	const [importContent, setImportContent] = useState('')
	const [importName, setImportName] = useState('')
	const fileInputRef = useRef<HTMLInputElement>(null)

	const selectedEnv = selectedId
		? environments.find(e => e.id === selectedId) ?? null
		: null

	function handleCreate() {
		if (!newEnvName.trim()) return
		const env = createEnvironment(newEnvName.trim())
		notifyEnvironmentChange()
		setSelectedId(env.id)
		setShowNewDialog(false)
		setNewEnvName('')
	}

	function handleDelete(id: string) {
		if (!confirm('Delete this environment?')) return
		deleteEnvironmentStore(id)
		notifyEnvironmentChange()
		if (selectedId === id) setSelectedId(null)
	}

	function handleDuplicate(id: string) {
		const env = duplicateEnvironment(id)
		if (env) {
			notifyEnvironmentChange()
			setSelectedId(env.id)
		}
	}

	function handleImportDotEnv() {
		if (!importContent.trim()) return
		const vars = parseDotEnv(importContent)
		const name = importName.trim() || 'Imported'
		const env = createEnvironment(name, vars)
		notifyEnvironmentChange()
		setSelectedId(env.id)
		setShowImportDialog(false)
		setImportContent('')
		setImportName('')
	}

	function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
		const file = e.target.files?.[0]
		if (!file) return
		const reader = new FileReader()
		reader.onload = () => {
			const content = reader.result as string
			setImportContent(content)
			setImportName(file.name.replace(/^\.env\.?/, '').replace(/\.env$/, '') || 'Imported')
		}
		reader.readAsText(file)
		e.target.value = ''
	}

	return (
		<div className='flex flex-col h-[calc(100vh-3.5rem)]'>
			{/* Header */}
			<div className='border-b border-slate-700/50 bg-slate-800/30 px-6 py-3 flex items-center justify-between shrink-0'>
				<div className='flex items-center gap-2'>
					<Settings2 className='w-4 h-4 text-violet-400' />
					<h1 className='text-sm font-semibold text-slate-200'>
						Environments
					</h1>
					<span className='text-[10px] text-slate-600'>
						{environments.length} environment
						{environments.length !== 1 ? 's' : ''}
					</span>
				</div>
				<div className='flex items-center gap-2'>
					<button
						onClick={() => setShowImportDialog(true)}
						className='flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors'
					>
						<Upload className='w-3 h-3' />
						Import .env
					</button>
					<button
						onClick={() => setShowNewDialog(true)}
						className='flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-violet-600 hover:bg-violet-500 text-white transition-colors'
					>
						<Plus className='w-3 h-3' />
						New Environment
					</button>
				</div>
			</div>

			<div className='flex flex-1 overflow-hidden'>
				{/* Sidebar: environment list */}
				<div className='w-56 border-r border-slate-700/50 overflow-y-auto shrink-0'>
					{environments.length === 0 ? (
						<div className='px-4 py-8 text-center'>
							<Globe className='w-6 h-6 text-slate-700 mx-auto mb-2' />
							<p className='text-xs text-slate-500'>No environments</p>
							<p className='text-[10px] text-slate-600 mt-1'>
								Create one to get started
							</p>
						</div>
					) : (
						<div className='py-2'>
							{environments.map(env => (
								<button
									key={env.id}
									onClick={() => setSelectedId(env.id)}
									className={cn(
										'w-full text-left px-4 py-2.5 text-xs transition-colors group',
										selectedId === env.id
											? 'bg-violet-500/10 text-violet-300 border-r-2 border-violet-500'
											: 'text-slate-400 hover:text-slate-300 hover:bg-slate-800/50',
									)}
								>
									<div className='flex items-center gap-1.5'>
										<span className='font-medium truncate flex-1'>
											{env.name}
										</span>
										{activeId === env.id && (
											<span className='text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-medium'>
												active
											</span>
										)}
									</div>
									<div className='text-[10px] text-slate-600 mt-0.5'>
										{env.variables.filter(v => v.enabled).length} variable
										{env.variables.filter(v => v.enabled).length !== 1
											? 's'
											: ''}
									</div>
								</button>
							))}
						</div>
					)}
				</div>

				{/* Main: variable editor */}
				<div className='flex-1 overflow-auto'>
					{!selectedEnv ? (
						<div className='flex flex-col items-center justify-center h-full text-slate-600 gap-2'>
							<Settings2 className='w-8 h-8 text-slate-700' />
							<p className='text-sm'>Select an environment</p>
							<p className='text-xs'>
								or create a new one to manage variables
							</p>
						</div>
					) : (
						<EnvironmentEditor
							env={selectedEnv}
							isActive={activeId === selectedEnv.id}
							onActivate={() => setActive(selectedEnv.id)}
							onDeactivate={() => setActive(null)}
							onDelete={() => handleDelete(selectedEnv.id)}
							onDuplicate={() => handleDuplicate(selectedEnv.id)}
						/>
					)}
				</div>
			</div>

			{/* New environment dialog */}
			{showNewDialog && (
				<Dialog onClose={() => setShowNewDialog(false)}>
					<h3 className='text-sm font-semibold text-slate-200 mb-4'>
						New Environment
					</h3>
					<input
						type='text'
						value={newEnvName}
						onChange={e => setNewEnvName(e.target.value)}
						placeholder='Environment name (e.g. production)'
						autoFocus
						onKeyDown={e => e.key === 'Enter' && handleCreate()}
						className='w-full bg-slate-900/50 border border-slate-700/50 rounded-md px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-violet-500/50 mb-4'
					/>
					<div className='flex justify-end gap-2'>
						<button
							onClick={() => setShowNewDialog(false)}
							className='px-3 py-1.5 rounded-md text-xs font-medium text-slate-400 hover:text-slate-300 transition-colors'
						>
							Cancel
						</button>
						<button
							onClick={handleCreate}
							disabled={!newEnvName.trim()}
							className='flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-violet-600 hover:bg-violet-500 text-white transition-colors disabled:opacity-50'
						>
							Create
						</button>
					</div>
				</Dialog>
			)}

			{/* Import .env dialog */}
			{showImportDialog && (
				<Dialog onClose={() => setShowImportDialog(false)} wide>
					<h3 className='text-sm font-semibold text-slate-200 mb-4'>
						Import .env File
					</h3>
					<div className='space-y-3 mb-4'>
						<input
							type='text'
							value={importName}
							onChange={e => setImportName(e.target.value)}
							placeholder='Environment name'
							className='w-full bg-slate-900/50 border border-slate-700/50 rounded-md px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-violet-500/50'
						/>
						<div className='flex gap-2'>
							<button
								onClick={() => fileInputRef.current?.click()}
								className='flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors'
							>
								<FileUp className='w-3 h-3' />
								Choose File
							</button>
							<input
								ref={fileInputRef}
								type='file'
								accept='.env,.env.*,text/plain'
								onChange={handleFileUpload}
								className='hidden'
							/>
							<span className='text-[10px] text-slate-600 self-center'>
								or paste content below
							</span>
						</div>
						<textarea
							value={importContent}
							onChange={e => setImportContent(e.target.value)}
							placeholder={`# Paste .env content here\nAPI_KEY=your-key\nBASE_URL=https://api.example.com`}
							rows={10}
							className='w-full bg-slate-900/50 border border-slate-700/50 rounded-md px-3 py-2 text-xs font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-violet-500/50 resize-none'
						/>
						{importContent && (
							<p className='text-[10px] text-slate-500'>
								{parseDotEnv(importContent).length} variable(s) detected
							</p>
						)}
					</div>
					<div className='flex justify-end gap-2'>
						<button
							onClick={() => {
								setShowImportDialog(false)
								setImportContent('')
								setImportName('')
							}}
							className='px-3 py-1.5 rounded-md text-xs font-medium text-slate-400 hover:text-slate-300 transition-colors'
						>
							Cancel
						</button>
						<button
							onClick={handleImportDotEnv}
							disabled={!importContent.trim()}
							className='flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-violet-600 hover:bg-violet-500 text-white transition-colors disabled:opacity-50'
						>
							<Download className='w-3 h-3' />
							Import
						</button>
					</div>
				</Dialog>
			)}
		</div>
	)
}

// ── Environment Editor ──────────────────────────────

function EnvironmentEditor({
	env,
	isActive,
	onActivate,
	onDeactivate,
	onDelete,
	onDuplicate,
}: {
	env: MuonEnvironment
	isActive: boolean
	onActivate: () => void
	onDeactivate: () => void
	onDelete: () => void
	onDuplicate: () => void
}) {
	const [editingName, setEditingName] = useState(env.name)
	const [editingVars, setEditingVars] = useState<EnvironmentVariable[]>([
		...env.variables.map(v => ({ ...v })),
	])
	const [newVarKey, setNewVarKey] = useState('')
	const [newVarValue, setNewVarValue] = useState('')
	const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set())
	const [isDirty, setIsDirty] = useState(false)
	const [copied, setCopied] = useState(false)

	// Reset when switching environments
	const [prevEnvId, setPrevEnvId] = useState(env.id)
	if (env.id !== prevEnvId) {
		setPrevEnvId(env.id)
		setEditingName(env.name)
		setEditingVars([...env.variables.map(v => ({ ...v }))])
		setIsDirty(false)
		setRevealedKeys(new Set())
		setNewVarKey('')
		setNewVarValue('')
	}

	function isSensitive(key: string): boolean {
		const lower = key.toLowerCase()
		return /secret|password|token|key|auth/.test(lower)
	}

	function handleVarChange(
		index: number,
		field: 'key' | 'value',
		val: string,
	) {
		setEditingVars(prev => {
			const next = [...prev]
			const cur = next[index]
			if (!cur) return next
			next[index] = { key: cur.key, value: cur.value, enabled: cur.enabled, [field]: val }
			return next
		})
		setIsDirty(true)
	}

	function handleToggleVar(index: number) {
		setEditingVars(prev => {
			const next = [...prev]
			const cur = next[index]
			if (!cur) return next
			next[index] = { key: cur.key, value: cur.value, enabled: !cur.enabled }
			return next
		})
		setIsDirty(true)
	}

	function handleDeleteVar(index: number) {
		setEditingVars(prev => prev.filter((_, i) => i !== index))
		setIsDirty(true)
	}

	function handleAddVar() {
		if (!newVarKey.trim()) return
		setEditingVars(prev => [
			...prev,
			{ key: newVarKey, value: newVarValue, enabled: true },
		])
		setNewVarKey('')
		setNewVarValue('')
		setIsDirty(true)
	}

	function handleSave() {
		updateEnvironmentStore(env.id, {
			name: editingName.trim() || env.name,
			variables: editingVars,
		})
		notifyEnvironmentChange()
		setIsDirty(false)
	}

	function handleExportDotEnv() {
		const lines = editingVars
			.filter(v => v.key.trim())
			.map(v => `${v.key}=${v.value}`)
			.join('\n')
		navigator.clipboard.writeText(lines)
		setCopied(true)
		setTimeout(() => setCopied(false), 2000)
	}

	return (
		<div className='p-6'>
			{/* Env header */}
			<div className='flex items-center justify-between mb-6'>
				<div className='flex-1 mr-4'>
					<input
						type='text'
						value={editingName}
						onChange={e => {
							setEditingName(e.target.value)
							setIsDirty(true)
						}}
						className='text-lg font-semibold text-slate-200 bg-transparent border-0 border-b border-transparent hover:border-slate-700 focus:border-violet-500 focus:outline-none transition-colors w-full'
					/>
					<p className='text-xs text-slate-500 mt-1'>
						{editingVars.filter(v => v.enabled).length} active /{' '}
						{editingVars.length} total variables
					</p>
				</div>
				<div className='flex items-center gap-2 shrink-0'>
					{isDirty && (
						<span className='text-[10px] text-amber-400 font-medium'>
							Unsaved
						</span>
					)}
					<button
						onClick={isActive ? onDeactivate : onActivate}
						className={cn(
							'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
							isActive
								? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
								: 'bg-slate-700 text-slate-400 hover:bg-slate-600',
						)}
					>
						{isActive ? (
							<>
								<Check className='w-3 h-3' />
								Active
							</>
						) : (
							<>
								<Globe className='w-3 h-3' />
								Set Active
							</>
						)}
					</button>
					<button
						onClick={handleSave}
						disabled={!isDirty}
						className={cn(
							'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
							isDirty
								? 'bg-violet-600 hover:bg-violet-500 text-white'
								: 'bg-slate-700 text-slate-500 cursor-not-allowed',
						)}
					>
						<Save className='w-3 h-3' />
						Save
					</button>
					<button
						onClick={handleExportDotEnv}
						className='flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-slate-700 text-slate-400 hover:bg-slate-600 transition-colors'
						title='Copy as .env format'
					>
						{copied ? (
							<Check className='w-3 h-3 text-emerald-400' />
						) : (
							<Copy className='w-3 h-3' />
						)}
						.env
					</button>
					<button
						onClick={onDuplicate}
						className='flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-slate-700 text-slate-400 hover:bg-slate-600 transition-colors'
					>
						<Copy className='w-3 h-3' />
					</button>
					<button
						onClick={onDelete}
						className='flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors'
					>
						<Trash2 className='w-3 h-3' />
					</button>
				</div>
			</div>

			{/* Variables table */}
			<div className='bg-slate-800/50 border border-slate-700/50 rounded-lg overflow-hidden'>
				<table className='w-full'>
					<thead>
						<tr className='border-b border-slate-700/50'>
							<th className='w-10 px-3 py-2.5' />
							<th className='text-left px-4 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider w-1/3'>
								Variable
							</th>
							<th className='text-left px-4 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider'>
								Value
							</th>
							<th className='w-20' />
						</tr>
					</thead>
					<tbody>
						{editingVars.map((v, i) => (
							<tr
								key={`${v.key}-${i}`}
								className={cn(
									'border-b border-slate-700/30 group',
									!v.enabled && 'opacity-40',
								)}
							>
								<td className='px-3 py-2 text-center'>
									<input
										type='checkbox'
										checked={v.enabled}
										onChange={() => handleToggleVar(i)}
										className='w-3.5 h-3.5 rounded border-slate-600 bg-slate-900 text-violet-500 focus:ring-0 focus:ring-offset-0 cursor-pointer'
									/>
								</td>
								<td className='px-4 py-2'>
									<input
										type='text'
										value={v.key}
										onChange={e =>
											handleVarChange(i, 'key', e.target.value)
										}
										className='w-full bg-transparent border-0 text-xs font-mono text-violet-400 focus:outline-none focus:ring-0 p-0'
										placeholder='KEY'
									/>
								</td>
								<td className='px-4 py-2'>
									<div className='flex items-center gap-2'>
										<input
											type={
												isSensitive(v.key) && !revealedKeys.has(v.key)
													? 'password'
													: 'text'
											}
											value={v.value}
											onChange={e =>
												handleVarChange(i, 'value', e.target.value)
											}
											className='flex-1 bg-transparent border-0 text-xs font-mono text-slate-300 focus:outline-none focus:ring-0 p-0'
											placeholder='value'
										/>
										{isSensitive(v.key) && (
											<button
												onClick={() =>
													setRevealedKeys(prev => {
														const next = new Set(prev)
														if (next.has(v.key)) next.delete(v.key)
														else next.add(v.key)
														return next
													})
												}
												className='text-slate-600 hover:text-slate-400 transition-colors'
											>
												{revealedKeys.has(v.key) ? (
													<EyeOff className='w-3.5 h-3.5' />
												) : (
													<Eye className='w-3.5 h-3.5' />
												)}
											</button>
										)}
									</div>
								</td>
								<td className='px-4 py-2 text-right'>
									<button
										onClick={() => handleDeleteVar(i)}
										className='opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 transition-all p-1'
									>
										<Trash2 className='w-3.5 h-3.5' />
									</button>
								</td>
							</tr>
						))}
					</tbody>
				</table>

				{/* Add new variable row */}
				<div className='flex items-center gap-2 px-4 py-2.5 border-t border-slate-700/30 bg-slate-800/30'>
					<div className='w-10 shrink-0' />
					<input
						type='text'
						value={newVarKey}
						onChange={e => setNewVarKey(e.target.value)}
						placeholder='Variable name'
						onKeyDown={e => e.key === 'Enter' && handleAddVar()}
						className='w-1/3 bg-slate-900/50 border border-slate-700/50 rounded px-2.5 py-1.5 text-xs font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-violet-500/50'
					/>
					<input
						type='text'
						value={newVarValue}
						onChange={e => setNewVarValue(e.target.value)}
						placeholder='Value'
						onKeyDown={e => e.key === 'Enter' && handleAddVar()}
						className='flex-1 bg-slate-900/50 border border-slate-700/50 rounded px-2.5 py-1.5 text-xs font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-violet-500/50'
					/>
					<button
						onClick={handleAddVar}
						disabled={!newVarKey.trim()}
						className='flex items-center gap-1 px-2.5 py-1.5 rounded text-xs text-violet-400 hover:text-violet-300 hover:bg-violet-500/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
					>
						<Plus className='w-3.5 h-3.5' />
						Add
					</button>
				</div>
			</div>

			{/* Usage hint */}
			<div className='mt-4 p-3 bg-slate-800/30 border border-slate-700/30 rounded-md'>
				<p className='text-[10px] text-slate-500'>
					<span className='text-slate-400 font-medium'>Usage:</span> Reference
					variables in your requests using{' '}
					<code className='text-violet-400 bg-slate-800 px-1 rounded'>
						{'{{variable_name}}'}
					</code>{' '}
					syntax. Variables are expanded in URL, headers, query params, and
					body.
				</p>
			</div>
		</div>
	)
}

// ── Dialog ──────────────────────────────────────────

function Dialog({
	children,
	onClose,
	wide,
}: {
	children: React.ReactNode
	onClose: () => void
	wide?: boolean
}) {
	return (
		<div className='fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50'>
			<div
				className={cn(
					'bg-slate-800 border border-slate-700 rounded-lg shadow-2xl p-6',
					wide ? 'w-full max-w-lg' : 'w-full max-w-sm',
				)}
			>
				<div className='absolute top-4 right-4'>
					<button
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
