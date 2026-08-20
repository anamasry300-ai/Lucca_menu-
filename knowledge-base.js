/* =====================================================
   KNOWLEDGE BASE / RAG SYSTEM
   Client-side document storage, chunking, and search
   ===================================================== */
(function(){
    'use strict';

    const KB_DB_NAME = 'lucca_knowledge_db';
    const KB_DB_VERSION = 1;
    let kbDb = null;

    function openKB(){
        return new Promise((resolve, reject) => {
            if(kbDb) return resolve(kbDb);
            const req = indexedDB.open(KB_DB_NAME, KB_DB_VERSION);
            req.onupgradeneeded = e => {
                const db = e.target.result;
                if(!db.objectStoreNames.contains('documents')){
                    const ds = db.createObjectStore('documents', {keyPath:'id', autoIncrement:true});
                    ds.createIndex('type','type',{unique:false});
                    ds.createIndex('name','name',{unique:false});
                }
                if(!db.objectStoreNames.contains('chunks')){
                    const cs = db.createObjectStore('chunks', {keyPath:'id', autoIncrement:true});
                    cs.createIndex('documentId','documentId',{unique:false});
                }
            };
            req.onsuccess = e => { kbDb = e.target.result; resolve(kbDb); };
            req.onerror = e => reject(e.target.error);
        });
    }

    function tx(store, mode){
        return kbDb.transaction(store, mode).objectStore(store);
    }

    // ===== TEXT CHUNKING =====
    const CHUNK_SIZE = 500;
    const CHUNK_OVERLAP = 100;

    function chunkText(text, maxLen, overlap){
        maxLen = maxLen || CHUNK_SIZE;
        overlap = overlap || CHUNK_OVERLAP;
        if(!text || text.length === 0) return [];
        
        const chunks = [];
        const sentences = text.split(/(?<=[.!?\n])\s+/);
        let current = '';
        
        for(const sentence of sentences){
            if((current + ' ' + sentence).length > maxLen && current.length > 0){
                chunks.push(current.trim());
                // Keep overlap from end of current chunk
                const words = current.split(/\s+/);
                const overlapWords = words.slice(-Math.ceil(overlap / 5));
                current = overlapWords.join(' ') + ' ' + sentence;
            } else {
                current = current ? current + ' ' + sentence : sentence;
            }
        }
        if(current.trim()) chunks.push(current.trim());
        return chunks;
    }

    function estimateTokens(text){
        return Math.ceil((text || '').split(/\s+/).length * 1.3);
    }

    // ===== DOCUMENTS =====
    const Documents = {
        async add(doc){
            const db = await openKB();
            const entry = {
                name: doc.name || 'Untitled',
                type: doc.type || 'text',
                content: doc.content || '',
                chunksCount: 0,
                tags: doc.tags || '',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            const id = await new Promise((res, rej) => {
                const req = tx('documents','readwrite').add(entry);
                req.onsuccess = () => res(req.result);
                req.onerror = () => rej(req.error);
            });
            entry.id = id;

            // Create chunks
            const chunks = chunkText(entry.content);
            const chunkStore = tx('chunks','readwrite');
            for(let i = 0; i < chunks.length; i++){
                chunkStore.add({
                    documentId: id,
                    content: chunks[i],
                    chunkIndex: i,
                    tokensEstimate: estimateTokens(chunks[i]),
                    createdAt: new Date().toISOString()
                });
            }
            entry.chunksCount = chunks.length;
            await new Promise((res, rej) => {
                const req = tx('documents','readwrite').put(entry);
                req.onsuccess = () => res();
                req.onerror = () => rej(req.error);
            });
            return entry;
        },

        async getAll(){
            const db = await openKB();
            return new Promise((res, rej) => {
                const req = tx('documents','readonly').getAll();
                req.onsuccess = () => res(req.result);
                req.onerror = () => rej(req.error);
            });
        },

        async get(id){
            const db = await openKB();
            return new Promise((res, rej) => {
                const req = tx('documents','readonly').get(id);
                req.onsuccess = () => res(req.result);
                req.onerror = () => rej(req.error);
            });
        },

        async remove(id){
            const db = await openKB();
            // Delete chunks first
            const chunks = await Chunks.getByDocument(id);
            const chunkStore = tx('chunks','readwrite');
            for(const c of chunks){
                chunkStore.delete(c.id);
            }
            // Delete document
            return new Promise((res, rej) => {
                const req = tx('documents','readwrite').delete(id);
                req.onsuccess = () => res();
                req.onerror = () => rej(req.error);
            });
        },

        async search(query){
            const chunks = await Chunks.search(query);
            // Group by document and return top results
            const docMap = {};
            for(const chunk of chunks){
                if(!docMap[chunk.documentId]){
                    docMap[chunk.documentId] = {
                        documentId: chunk.documentId,
                        chunks: [],
                        score: 0
                    };
                }
                docMap[chunk.documentId].chunks.push(chunk);
                docMap[chunk.documentId].score += chunk.score;
            }
            return Object.values(docMap).sort((a,b) => b.score - a.score).slice(0, 10);
        },

        async getStats(){
            const docs = await this.getAll();
            let totalChunks = 0;
            let totalTokens = 0;
            for(const doc of docs){
                const chunks = await Chunks.getByDocument(doc.id);
                totalChunks += chunks.length;
                totalTokens += chunks.reduce((s,c) => s + (c.tokensEstimate||0), 0);
            }
            return {
                documents: docs.length,
                chunks: totalChunks,
                tokens: totalTokens
            };
        }
    };

    // ===== CHUNKS =====
    const Chunks = {
        async getByDocument(documentId){
            const db = await openKB();
            return new Promise((res, rej) => {
                const idx = tx('chunks','readonly').index('documentId');
                const req = idx.getAll(documentId);
                req.onsuccess = () => res(req.result);
                req.onerror = () => rej(req.error);
            });
        },

        async search(query){
            const db = await openKB();
            const allChunks = await new Promise((res, rej) => {
                const req = tx('chunks','readonly').getAll();
                req.onsuccess = () => res(req.result);
                req.onerror = () => rej(req.error);
            });

            const terms = query.toLowerCase().split(/[\s,.\-!?]+/).filter(t => t.length > 1);
            const scored = [];

            for(const chunk of allChunks){
                const content = (chunk.content || '').toLowerCase();
                let score = 0;
                for(const term of terms){
                    if(content.includes(term)){
                        score += 1;
                        // Bonus for multiple occurrences
                        const count = (content.match(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
                        if(count > 1) score += 0.5 * (count - 1);
                    }
                }
                // Exact phrase bonus
                if(content.includes(query.toLowerCase())){
                    score += 5;
                }
                if(score > 0){
                    scored.push({...chunk, score});
                }
            }

            return scored.sort((a,b) => b.score - a.score).slice(0, 20);
        }
    };

    // ===== Quick text ingestion =====
    async function ingestText(name, text, tags){
        return Documents.add({
            name: name,
            type: 'text',
            content: text,
            tags: tags || ''
        });
    }

    async function ingestFile(file){
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const text = e.target.result;
                    const doc = await Documents.add({
                        name: file.name,
                        type: file.type || 'text/plain',
                        content: text,
                        tags: ''
                    });
                    resolve(doc);
                } catch(err) {
                    reject(err);
                }
            };
            reader.onerror = reject;
            reader.readAsText(file);
        });
    }

    // ===== Initialize =====
    async function init(){
        await openKB();
    }

    // ===== Expose API =====
    window.KnowledgeBase = {
        init,
        Documents,
        Chunks,
        ingestText,
        ingestFile,
        chunkText,
        search: async function(query){
            const results = await Documents.search(query);
            if(results.length === 0) return null;
            // Build context string from top results
            let context = '';
            for(const r of results.slice(0, 3)){
                for(const chunk of r.chunks.slice(0, 2)){
                    context += chunk.content + '\n---\n';
                }
            }
            return {
                results,
                context: context.trim(),
                count: results.length
            };
        }
    };
})();
