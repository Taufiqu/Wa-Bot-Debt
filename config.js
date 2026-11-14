const path = require('path');

module.exports = {
    // Timezone & Jadwal Default
    TIMEZONE: 'Asia/Jakarta',
    DEFAULT_REMINDER_TIME: '10:00', // Jam default jika jam tidak ditulis saat !set

    // Path File Database
    DATA_FILE: path.join(__dirname, 'data.json'),

    // Direktori penyimpanan sesi login Baileys
    AUTH_DIR: path.join(__dirname, 'baileys_auth'),

    // (Opsional) Nomor HP jika ingin login menggunakan 8-digit Pairing Code
    // Contoh: '628123456789' (kosongkan string jika ingin tetap pakai QR Code di terminal)
    PAIRING_NUMBER: process.env.PAIRING_NUMBER || ''
};
