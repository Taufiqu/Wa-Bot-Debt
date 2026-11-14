const fs = require('fs');
const config = require('./config');

/**
 * Membaca data hutang dari file JSON secara aman
 * @returns {Array}
 */
function loadData() {
    try {
        if (!fs.existsSync(config.DATA_FILE)) {
            fs.writeFileSync(config.DATA_FILE, JSON.stringify([], null, 4), 'utf8');
            return [];
        }
        const rawContent = fs.readFileSync(config.DATA_FILE, 'utf8');
        if (!rawContent.trim()) return [];
        return JSON.parse(rawContent);
    } catch (error) {
        console.error('[DATABASE ERROR] Gagal membaca file data.json:', error.message);
        return [];
    }
}

/**
 * Menyimpan data hutang ke file JSON secara aman
 * @param {Array} data 
 * @returns {boolean}
 */
function saveData(data) {
    try {
        fs.writeFileSync(config.DATA_FILE, JSON.stringify(data, null, 4), 'utf8');
        return true;
    } catch (error) {
        console.error('[DATABASE ERROR] Gagal menyimpan file data.json:', error.message);
        return false;
    }
}

/**
 * Menambah atau memperbarui catatan hutang kontak
 * @param {Object} newEntry 
 * @returns {boolean}
 */
function upsertDebt(newEntry) {
    const data = loadData();
    const cleanNumber = newEntry.nomor.split('@')[0];

    const existingIndex = data.findIndex(h => h.nomor === newEntry.nomor || h.nomor.startsWith(cleanNumber));

    if (existingIndex !== -1) {
        data[existingIndex] = { ...data[existingIndex], ...newEntry };
    } else {
        data.push(newEntry);
    }

    return saveData(data);
}

/**
 * Menghapus catatan hutang berdasarkan nomor/JID kontak (Lunas)
 * @param {string} targetJid 
 * @returns {{ success: boolean, removed: boolean }}
 */
function removeDebt(targetJid) {
    const data = loadData();
    const cleanNumber = targetJid.split('@')[0];

    const filteredData = data.filter(h => h.nomor !== targetJid && !h.nomor.startsWith(cleanNumber));
    const removed = data.length !== filteredData.length;

    if (removed) {
        saveData(filteredData);
    }

    return { success: true, removed };
}

module.exports = {
    loadData,
    saveData,
    upsertDebt,
    removeDebt
};
