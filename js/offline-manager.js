/**
 * HEXINDO FLEET - OFFLINE MANAGER SYSTEM
 * Version: 2.0 (Support Form Sync + PDF Caching)
 * * Fitur:
 * 1. Menyimpan data form saat offline (IndexedDB: pending_uploads)
 * 2. Menyimpan file PDF manual saat didownload (IndexedDB: cached_manuals)
 * 3. Sinkronisasi otomatis saat online
 * 4. UI Status & Toast Notification
 */

class HexindoOfflineManager {
        constructor() {
        this.dbName = 'HexindoFleetDB';
        this.dbVersion = 2; 
        this.storeUploads = 'pending_uploads';
        this.storeManuals = 'cached_manuals';

        // --- TAMBAHAN BARU: Buat koneksi database sendiri ---
        if (typeof CONFIG !== 'undefined') {
            this.sbClient = supabase.createClient(CONFIG.SB_URL, CONFIG.SB_KEY);
        }

        this.initDB();
        this.initUI();
        this.registerSW();

        window.addEventListener('online', () => this.handleConnectionChange(true));
        window.addEventListener('offline', () => this.handleConnectionChange(false));
    }

    // ============================================================
    // 1. DATABASE LOGIC (INDEXED DB)
    // ============================================================

    async initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onupgradeneeded = (e) => {
                const db = e.target.result;

                // Store 1: Antrian Upload (Laporan)
                if (!db.objectStoreNames.contains(this.storeUploads)) {
                    db.createObjectStore(this.storeUploads, { keyPath: 'id', autoIncrement: true });
                }

                // Store 2: Cache PDF Manual (Agar hemat kuota)
                if (!db.objectStoreNames.contains(this.storeManuals)) {
                    db.createObjectStore(this.storeManuals, { keyPath: 'url' });
                }
            };

            request.onsuccess = () => resolve(request.result);
            request.onerror = (e) => {
                console.error("Database Error:", e);
                reject(e);
            };
        });
    }

    async openDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(this.dbName, this.dbVersion);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    // ============================================================
    // 2. FORM SYNC LOGIC (Laporan Harian, PPU, dll)
    // ============================================================

    // Fungsi Utama: Dipanggil dari halaman HTML saat tombol simpan diklik
        async submitData(tableName, payload) {
        if (navigator.onLine) {
            try {
                this.showToast('Mengirim ke Server...', 'info');
                
                // PERBAIKAN DI SINI (Gunakan this.sbClient)
                const { error } = await this.sbClient
                    .from(tableName)
                    .insert([payload]);

                if (error) throw error;

                this.showToast('Data Berhasil Disimpan (Server)', 'success');
                return true;

            } catch (error) {
                console.warn("Gagal kirim ke server, beralih ke offline...", error);
                await this.saveToOutbox(tableName, payload);
                return false;
            }
        } else {
            await this.saveToOutbox(tableName, payload);
            return false;
        }
    }


    // Simpan ke Outbox (IndexedDB)
    async saveToOutbox(tableName, payload) {
        const db = await this.openDB();
        const tx = db.transaction(this.storeUploads, 'readwrite');
        
        await tx.objectStore(this.storeUploads).add({
            table: tableName,
            payload: payload,
            timestamp: new Date().toISOString()
        });

        this.showToast('Offline: Data Disimpan di HP', 'warning');
    }

    // Proses Sinkronisasi (Dijalankan saat sinyal kembali)
    async syncData() {
        const db = await this.openDB();
        const tx = db.transaction(this.storeUploads, 'readonly');
        const store = tx.objectStore(this.storeUploads);
        const request = store.getAll();

        request.onsuccess = async () => {
            const items = request.result;
            if (items.length === 0) return; // Tidak ada antrian

            this.showToast(`Sinkronisasi ${items.length} data tertunda...`, 'info');
            let successCount = 0;

            for (const item of items) {
                try {
                    // PERBAIKAN DI SINI (Gunakan this.sbClient)
                    const { error } = await this.sbClient
                        .from(item.table)
                        .insert([item.payload]);

                    if (!error) {
                        // Jika sukses di Supabase, hapus dari brankas HP
                        const delTx = db.transaction(this.storeUploads, 'readwrite');
                        delTx.objectStore(this.storeUploads).delete(item.id);
                        successCount++;
                    } else {
                        console.error('Error Supabase:', error);
                    }
                } catch (err) {
                    console.error('Gagal sync item:', item.id, err);
                }
            }
            
            if (successCount > 0) {
                this.showToast(`${successCount} data berhasil disinkronisasi ke Cloud!`, 'success');
            }
        };
    }


    // ============================================================
    // 3. PDF CACHE LOGIC (Smart Troubleshoot)
    // ============================================================

    /**
     * Mengambil file PDF.
     * Cek dulu di DB Lokal -> Kalau ada, ambil.
     * Kalau tidak ada -> Download dari Supabase -> Simpan di DB Lokal -> Ambil.
     */
    async getOrDownloadManual(fileUrl, progressCallback) {
        const db = await this.openDB();
        
        // 1. Cek Ketersediaan di Lokal
        const tx = db.transaction(this.storeManuals, 'readonly');
        const store = tx.objectStore(this.storeManuals);
        
        const cachedItem = await new Promise(resolve => {
            const req = store.get(fileUrl);
            req.onsuccess = () => resolve(req.result);
        });

        if (cachedItem) {
            console.log("[Cache] PDF diambil dari memori HP");
            if (progressCallback) progressCallback("Membuka dari Cache...");
            return cachedItem.blob;
        }

        // 2. Jika Tidak Ada, Download Baru
        if (!navigator.onLine) {
            throw new Error("Anda Offline dan manual ini belum pernah didownload.");
        }

        console.log("[Network] Mendownload PDF baru...");
        if (progressCallback) progressCallback("Downloading PDF (Hemat Kuota)...");

        const response = await fetch(fileUrl);
        if (!response.ok) throw new Error("Gagal download file");
        
        const blob = await response.blob();

        // 3. Simpan ke Lokal
        const txSave = db.transaction(this.storeManuals, 'readwrite');
        txSave.objectStore(this.storeManuals).put({
            url: fileUrl,
            blob: blob,
            downloaded_at: new Date().toISOString()
        });

        return blob;
    }

    // Hapus Cache Manual (Untuk bersih-bersih memori HP)
    async clearManualCache() {
        const db = await this.openDB();
        const tx = db.transaction(this.storeManuals, 'readwrite');
        tx.objectStore(this.storeManuals).clear();
        this.showToast('Cache Manual berhasil dikosongkan.', 'warning');
    }

    // ============================================================
    // 4. UI & UTILITIES
    // ============================================================

    registerSW() {
        if ('serviceWorker' in navigator) {
            // Pastikan path sw.js sesuai lokasi Anda
            navigator.serviceWorker.register('/sw.js') 
                .then(() => console.log('[Hexindo SW] Ready'))
                .catch(err => console.error('[Hexindo SW] Fail', err));
        }
    }

        handleConnectionChange(isOnline) {
        const badge = document.getElementById('hexindo-status-badge');
        
        if (isOnline) {
            badge.className = 'fixed bottom-4 left-4 px-3 py-1 rounded-full border border-emerald-500/50 bg-emerald-500/10 text-emerald-400 text-xs font-rajdhani font-bold backdrop-blur-md transition-all z-50';
            badge.innerHTML = '<i class="fas fa-wifi"></i> SYSTEM ONLINE';
            this.syncData(); // Trigger sync
        } else {
            badge.className = 'fixed bottom-4 left-4 px-3 py-1 rounded-full border border-red-500/50 bg-red-500/10 text-red-400 text-xs font-rajdhani font-bold backdrop-blur-md transition-all z-50';
            badge.innerHTML = '<i class="fas fa-plane"></i> OFFLINE MODE';
            this.showToast('Koneksi Terputus. Mode Offline Aktif.', 'warning');
        }
    }

        initUI() {
        // Hapus elemen lama jika ada (biar gak duplikat)
        const oldBadge = document.getElementById('hexindo-status-badge');
        if (oldBadge) oldBadge.remove();
        const oldToast = document.getElementById('hexindo-toast');
        if (oldToast) oldToast.remove();

        // 1. Buat Status Badge (Pojok Kiri Bawah)
        const badge = document.createElement('div');
        badge.id = 'hexindo-status-badge';
        // Default state (Cek saat init)
        const isOnline = navigator.onLine;
        badge.className = isOnline 
            ? 'fixed bottom-4 left-4 px-3 py-1 rounded-full border border-emerald-500/50 bg-emerald-500/10 text-emerald-400 text-xs font-rajdhani font-bold backdrop-blur-md transition-all z-[9999]'
            : 'fixed bottom-4 left-4 px-3 py-1 rounded-full border border-red-500/50 bg-red-500/10 text-red-400 text-xs font-rajdhani font-bold backdrop-blur-md transition-all z-[9999]';
        badge.innerHTML = isOnline ? '<i class="fas fa-wifi"></i> SYSTEM ONLINE' : '<i class="fas fa-plane"></i> OFFLINE MODE';
        document.body.appendChild(badge);

        // 2. Buat Toast Container (Tengah Bawah)
        const toast = document.createElement('div');
        toast.id = 'hexindo-toast';
        toast.className = 'fixed bottom-10 left-1/2 transform -translate-x-1/2 px-6 py-3 rounded-lg border backdrop-blur-xl text-sm font-rajdhani font-semibold transition-all duration-300 opacity-0 translate-y-10 z-[100] shadow-[0_0_20px_rgba(0,0,0,0.5)] pointer-events-none';
        document.body.appendChild(toast);
    }


    showToast(msg, type = 'info') {
        const toast = document.getElementById('hexindo-toast');
        const styles = {
            success: 'border-emerald-500/50 bg-slate-900/90 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.2)]',
            warning: 'border-amber-500/50 bg-slate-900/90 text-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.2)]',
            info: 'border-cyan-500/50 bg-slate-900/90 text-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.2)]'
        };
        
        toast.className = `fixed bottom-10 left-1/2 transform -translate-x-1/2 px-6 py-3 rounded-lg border backdrop-blur-xl text-sm font-rajdhani font-semibold transition-all duration-300 z-[100] ${styles[type]} opacity-100 translate-y-0`;
        toast.innerHTML = msg;

        // Auto hide setelah 3 detik
        setTimeout(() => {
            toast.classList.remove('opacity-100', 'translate-y-0');
            toast.classList.add('opacity-0', 'translate-y-10');
        }, 3000);
    }
}

// Inisialisasi Global
// Agar bisa dipanggil di HTML via window.HexindoFleet
window.HexindoFleet = new HexindoOfflineManager();
