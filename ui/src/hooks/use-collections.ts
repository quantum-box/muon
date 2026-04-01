import { useCallback, useState } from 'react'
import {
	addItemToFolder,
	createEmptyCollection,
	createFolder,
	createRequest,
	flattenRequests,
	getCollections,
	deleteCollection as removeCollection,
	removeItemById,
	saveCollection,
	updateItemInTree,
} from '../lib/collections'
import { sendHttpRequest } from '../lib/tauri-api'
import type {
	BatchRunResult,
	Collection,
	CollectionItem,
	CollectionRequest,
} from '../lib/types'

export function useCollections() {
	const [collections, setCollections] = useState<Collection[]>(getCollections)
	const [activeCollectionId, setActiveCollectionId] = useState<string | null>(
		null,
	)
	const [activeRequestId, setActiveRequestId] = useState<string | null>(null)

	const refresh = useCallback(() => {
		setCollections(getCollections())
	}, [])

	const addCollection = useCallback((name: string) => {
		const c = createEmptyCollection(name)
		saveCollection(c)
		setCollections(getCollections())
		setActiveCollectionId(c.id)
		return c
	}, [])

	const removeCol = useCallback(
		(id: string) => {
			removeCollection(id)
			setCollections(getCollections())
			if (activeCollectionId === id) {
				setActiveCollectionId(null)
				setActiveRequestId(null)
			}
		},
		[activeCollectionId],
	)

	const updateCollection = useCallback((collection: Collection) => {
		saveCollection(collection)
		setCollections(getCollections())
	}, [])

	const addFolder = useCallback(
		(collectionId: string, parentFolderId: string | null, name: string) => {
			const col = collections.find(c => c.id === collectionId)
			if (!col) return
			const folder = createFolder(name)
			const updated = { ...col }
			if (parentFolderId) {
				updated.items = addItemToFolder(col.items, parentFolderId, folder)
			} else {
				updated.items = [...col.items, folder]
			}
			saveCollection(updated)
			setCollections(getCollections())
		},
		[collections],
	)

	const addRequest = useCallback(
		(collectionId: string, parentFolderId: string | null, name: string) => {
			const col = collections.find(c => c.id === collectionId)
			if (!col) return
			const req = createRequest(name)
			const updated = { ...col }
			if (parentFolderId) {
				updated.items = addItemToFolder(col.items, parentFolderId, req)
			} else {
				updated.items = [...col.items, req]
			}
			saveCollection(updated)
			setCollections(getCollections())
			setActiveRequestId(req.id)
		},
		[collections],
	)

	const removeItem = useCallback(
		(collectionId: string, itemId: string) => {
			const col = collections.find(c => c.id === collectionId)
			if (!col) return
			const updated = { ...col, items: removeItemById(col.items, itemId) }
			saveCollection(updated)
			setCollections(getCollections())
			if (activeRequestId === itemId) setActiveRequestId(null)
		},
		[collections, activeRequestId],
	)

	const updateItem = useCallback(
		(
			collectionId: string,
			itemId: string,
			updater: (item: CollectionItem) => CollectionItem,
		) => {
			const col = collections.find(c => c.id === collectionId)
			if (!col) return
			const updated = {
				...col,
				items: updateItemInTree(col.items, itemId, updater),
			}
			saveCollection(updated)
			setCollections(getCollections())
		},
		[collections],
	)

	return {
		collections,
		activeCollectionId,
		activeRequestId,
		setActiveCollectionId,
		setActiveRequestId,
		refresh,
		addCollection,
		removeCollection: removeCol,
		updateCollection,
		addFolder,
		addRequest,
		removeItem,
		updateItem,
	}
}

export function useBatchRun() {
	const [running, setRunning] = useState(false)
	const [results, setResults] = useState<BatchRunResult[]>([])
	const [currentIndex, setCurrentIndex] = useState(-1)

	const run = useCallback(async (requests: CollectionRequest[]) => {
		setRunning(true)
		setResults([])
		setCurrentIndex(0)

		const allResults: BatchRunResult[] = []
		for (let i = 0; i < requests.length; i++) {
			setCurrentIndex(i)
			const req = requests[i]!
			const start = performance.now()
			try {
				const resp = await sendHttpRequest(req.config)
				allResults.push({
					request_id: req.id,
					name: req.name,
					response: resp,
					error: null,
					duration_ms: Math.round(performance.now() - start),
				})
			} catch (err) {
				allResults.push({
					request_id: req.id,
					name: req.name,
					response: null,
					error: err instanceof Error ? err.message : 'Unknown error',
					duration_ms: Math.round(performance.now() - start),
				})
			}
			setResults([...allResults])
		}

		setRunning(false)
		setCurrentIndex(-1)
	}, [])

	const runFolder = useCallback(
		async (items: CollectionItem[]) => {
			const requests = flattenRequests(items)
			await run(requests)
		},
		[run],
	)

	return { running, results, currentIndex, run, runFolder }
}
