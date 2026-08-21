/**
 * Lucca Sync Engine
 * Offline-first sync with Supabase
 * Records all changes in a queue, syncs when online
 */
(function(){
    'use strict';

    const QUEUE_KEY = 'lucca_sync_queue';
    const LAST_SYNC_KEY = 'lucca_last_sync';
    const DEVICE_ID_KEY = 'lucca_device_id';
    const DB_VERSION_KEY = 'lucca_sync_db_version';

    // Generate unique device ID
    function getDeviceId(){
        let id = localStorage.getItem(DEVICE_ID_KEY);
        if(!id){
            id = 'device_' + Date.now() + '_' + Math.random().toString(36).slice(2,8);
            localStorage.setItem(DEVICE_ID_KEY, id);
        }
        return id;
    }

    // Synced tables in priority order
    const SYNC_TABLES = [
        'categories', 'products', 'payment_methods', 'tables', 'taxes',
        'customers', 'orders', 'order_items', 'payments', 'invoices',
        'expenses', 'inventory', 'purchases', 'employees', 'attendance',
        'shifts', 'users', 'settings', 'audit_logs', 'order_status_history',
        'refunds', 'inventory_items', 'suppliers', 'stock_movements',
        'product_recipes', 'waste_log', 'knowledge_documents', 'knowledge_chunks'
    ];

    // Read queue from localStorage
    function readQueue(){
        try {
            return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
        } catch(e) { return []; }
    }

    // Write queue to localStorage
    function writeQueue(queue){
        try {
            localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
        } catch(e) {
            // localStorage full - trim old items
            const trimmed = queue.slice(-500);
            localStorage.setItem(QUEUE_KEY, JSON.stringify(trimmed));
        }
    }

    // Add item to sync queue
    function enqueue(tableName, operation, recordId, data){
        const queue = readQueue();
        const item = {
            id: 'sync_' + Date.now() + '_' + Math.random().toString(36).slice(2,6),
            table: tableName,
            op: operation, // 'insert', 'update', 'delete'
            recordId: recordId,
            data: data || null,
            deviceId: getDeviceId(),
            timestamp: new Date().toISOString(),
            retries: 0,
            status: 'pending' // pending, syncing, failed, done
        };
        queue.push(item);
        writeQueue(queue);
        return item;
    }

    // Get pending items count
    function getPendingCount(){
        return readQueue().filter(i => i.status === 'pending').length;
    }

    // Get sync status summary
    function getSyncStatus(){
        const queue = readQueue();
        return {
            pending: queue.filter(i => i.status === 'pending').length,
            syncing: queue.filter(i => i.status === 'syncing').length,
            failed: queue.filter(i => i.status === 'failed').length,
            done: queue.filter(i => i.status === 'done').length,
            total: queue.length,
            lastSync: localStorage.getItem(LAST_SYNC_KEY) || null,
            deviceId: getDeviceId(),
            isOnline: navigator.onLine
        };
    }

    // Clear completed items older than 24 hours
    function cleanupQueue(){
        const queue = readQueue();
        const cutoff = Date.now() - 24*60*60*1000;
        const cleaned = queue.filter(i => {
            if(i.status === 'done'){
                const t = new Date(i.timestamp).getTime();
                return t > cutoff;
            }
            return true;
        });
        writeQueue(cleaned);
    }

    // ===== CORE SYNC FUNCTION =====
    async function syncToSupabase(supabase){
        if(!supabase || !navigator.onLine) return { synced: 0, errors: 0 };

        const queue = readQueue();
        const pending = queue.filter(i => i.status === 'pending' || i.status === 'failed');
        if(pending.length === 0) return { synced: 0, errors: 0 };

        let synced = 0, errors = 0;

        for(const item of pending.slice(0, 50)){ // Process max 50 at a time
            try {
                item.status = 'syncing';
                writeQueue(queue);

                const table = item.table;
                let result;

                if(item.op === 'delete'){
                    result = await supabase.from(table).delete().eq('id', item.recordId);
                } else if(item.op === 'insert'){
                    const payload = { ...item.data, id: item.recordId, _synced: true, _device_id: getDeviceId() };
                    result = await supabase.from(table).upsert(payload, { onConflict: 'id' });
                } else if(item.op === 'update'){
                    const payload = { ...item.data, _synced: true, _device_id: getDeviceId(), _synced_at: new Date().toISOString() };
                    result = await supabase.from(table).update(payload).eq('id', item.recordId);
                }

                if(result && result.error) throw result.error;

                item.status = 'done';
                synced++;
            } catch(e) {
                item.retries = (item.retries || 0) + 1;
                item.status = item.retries >= 3 ? 'failed' : 'pending';
                item.lastError = e.message || String(e);
                errors++;
            }
        }

        writeQueue(queue);
        localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());
        return { synced, errors };
    }

    // ===== PULL FROM SUPABASE =====
    async function pullFromSupabase(supabase, tableName, localDB){
        if(!supabase || !navigator.onLine) return 0;

        const lastSync = localStorage.getItem(LAST_SYNC_KEY);
        let query = supabase.from(tableName).select('*');

        if(lastSync){
            query = query.gt('_synced_at', lastSync).or('_synced_at.is.null');
        }

        const { data, error } = await query.limit(500);
        if(error || !data) return 0;

        let count = 0;
        for(const record of data){
            if(record.id && localDB){
                try {
                    const existing = await localDB.get(tableName, record.id);
                    if(!existing || (record._synced_at && record._synced_at > (existing._synced_at || ''))){
                        // Remove Supabase metadata before storing locally
                        const clean = { ...record };
                        delete clean._synced;
                        delete clean._device_id;
                        delete clean._synced_at;
                        await localDB.put(tableName, clean);
                        count++;
                    }
                } catch(e) {}
            }
        }
        return count;
    }

    // ===== FULL SYNC (Push + Pull) =====
    async function fullSync(supabase, localDB){
        if(!supabase || !navigator.onLine) return { push: { synced: 0, errors: 0 }, pull: 0 };

        // Push local changes
        const pushResult = await syncToSupabase(supabase);

        // Pull remote changes
        let pullCount = 0;
        for(const table of SYNC_TABLES){
            try {
                const count = await pullFromSupabase(supabase, table, localDB);
                pullCount += count;
            } catch(e) {}
        }

        cleanupQueue();
        return { push: pushResult, pull: pullCount };
    }

    // ===== AUTO SYNC MANAGER =====
    let _syncInterval = null;
    let _supabaseClient = null;
    let _localDB = null;
    let _onStatusChange = null;
    let _isSyncing = false;

    function startAutoSync(supabase, localDB, options){
        _supabaseClient = supabase;
        _localDB = localDB;
        _onStatusChange = (options && options.onStatusChange) || null;

        const interval = (options && options.interval) || 30000; // 30 seconds default

        // Sync on startup after 3 seconds
        setTimeout(()=> triggerSync(), 3000);

        // Auto sync interval
        _syncInterval = setInterval(()=> triggerSync(), interval);

        // Sync on reconnect
        window.addEventListener('online', ()=> {
            setTimeout(()=> triggerSync(), 1000);
        });

        // Status check every 5 seconds
        setInterval(()=> {
            if(_onStatusChange) _onStatusChange(getSyncStatus());
        }, 5000);

        return { stop: stopAutoSync, trigger: triggerSync };
    }

    function stopAutoSync(){
        if(_syncInterval){
            clearInterval(_syncInterval);
            _syncInterval = null;
        }
    }

    async function triggerSync(){
        if(_isSyncing || !navigator.onLine || !_supabaseClient) return;
        _isSyncing = true;
        try {
            const result = await fullSync(_supabaseClient, _localDB);
            if(_onStatusChange) _onStatusChange(getSyncStatus());
            return result;
        } catch(e) {
            return { push: { synced: 0, errors: 1 }, pull: 0 };
        } finally {
            _isSyncing = false;
        }
    }

    // ===== WRAPPER: Auto-enqueue on DB writes =====
    function wrapDBOperations(db, supabase){
        // Intercept put/add/delete to auto-enqueue
        const originalPut = db.put.bind(db);
        const originalAdd = db.add.bind(db);
        const originalDelete = db.delete.bind(db);

        db.put = async function(storeName, data){
            const result = await originalPut(storeName, data);
            if(SYNC_TABLES.includes(storeName) && data && data.id){
                enqueue(storeName, 'update', data.id, data);
                if(navigator.onLine && _supabaseClient){
                    setTimeout(()=> triggerSync(), 500);
                }
            }
            return result;
        };

        db.add = async function(storeName, data){
            const result = await originalAdd(storeName, data);
            if(SYNC_TABLES.includes(storeName)){
                const id = result || data.id;
                if(id){
                    enqueue(storeName, 'insert', id, { ...data, id });
                    if(navigator.onLine && _supabaseClient){
                        setTimeout(()=> triggerSync(), 500);
                    }
                }
            }
            return result;
        };

        db.delete = async function(storeName, id){
            const result = await originalDelete(storeName, id);
            if(SYNC_TABLES.includes(storeName)){
                enqueue(storeName, 'delete', id, null);
                if(navigator.onLine && _supabaseClient){
                    setTimeout(()=> triggerSync(), 500);
                }
            }
            return result;
        };
    }

    // ===== EXPORT =====
    window.SyncEngine = {
        getDeviceId,
        enqueue,
        readQueue,
        getPendingCount,
        getSyncStatus,
        syncToSupabase,
        pullFromSupabase,
        fullSync,
        startAutoSync,
        stopAutoSync,
        triggerSync,
        wrapDBOperations,
        cleanupQueue,
        SYNC_TABLES
    };

})();
