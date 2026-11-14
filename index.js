const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const cron = require('node-cron');
const config = require('./config');
const db = require('./database');
const { formatRupiah, parseDateString, formatIndonesianDate, getNowFormatted } = require('./formatter');

let sock = null;
const contactsCache = new Map();

/**
 * Format target JID agar sesuai dengan format Baileys (@s.whatsapp.net)
 * @param {string} jid 
 * @returns {string}
 */
function formatJid(jid) {
    if (!jid) return '';
    if (jid.includes('@')) {
        return jid.replace('@c.us', '@s.whatsapp.net');
    }
    return `${jid}@s.whatsapp.net`;
}

/**
 * Mengirim pesan teks ke JID target
 * @param {string} targetJid 
 * @param {string} text 
 * @param {Object|null} quoted 
 */
async function sendTextMessage(targetJid, text, quoted = null) {
    if (!sock) throw new Error('WhatsApp socket belum terhubung');
    const jid = formatJid(targetJid);
    return await sock.sendMessage(jid, { text }, quoted ? { quoted } : {});
}

/**
 * Inisialisasi dan jalankan WhatsApp Client menggunakan Baileys
 */
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState(config.AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({
        version: [2, 3000, 1015901307]
    }));

    sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        auth: state,
        printQRInTerminal: false,
        browser: ['Wa-Bot-Debt', 'Chrome', '1.0.0']
    });

    // Simpan kredensial sesi setiap kali diperbarui
    sock.ev.on('creds.update', saveCreds);

    // Handler status koneksi & QR Code
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        // Render QR Code jika belum login dan tidak menggunakan pairing code
        if (qr && !config.PAIRING_NUMBER) {
            console.log('\n===================================================');
            console.log('[WHATSAPP BOT] Silakan pindai (scan) QR Code berikut:');
            console.log('===================================================\n');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

            console.log(`\n[KONEKSI] Terputus (status code: ${statusCode || 'unknown'}).`);

            if (shouldReconnect) {
                console.log('[KONEKSI] Menghubungkan ulang dalam 3 detik...');
                setTimeout(startBot, 3000);
            } else {
                console.log('[KONEKSI] Sesi telah logout. Silakan hapus folder baileys_auth dan mulai ulang bot.');
            }
        } else if (connection === 'open') {
            console.log('\n===================================================');
            console.log('✅ Wa-Bot-Debt (WhatsApp Debt Reminder) BERHASIL AKTIF!');
            console.log('---------------------------------------------------');
            console.log('Daftar perintah yang bisa diketik via WhatsApp (pada chat target):');
            console.log(' • !set [jumlah] [tanggal] [jam]  -> Atur tagihan baru (misal: !set 50000 25-12-2026 10:00)');
            console.log(' • !set [jumlah] rutin            -> Atur pengingat rutin mingguan');
            console.log(' • !lunas                         -> Tandai tagihan kontak ini LUNAS');
            console.log(' • !cek                           -> Lihat rekap seluruh tagihan');
            console.log(' • !kirim                         -> Kirim pengingat manual sekarang');
            console.log(' • !bantuan                       -> Tampilkan panduan penggunaan');
            console.log('---------------------------------------------------');
            console.log('Perintah Terminal: ketik "kirim", "cek", atau "help" lalu tekan Enter.');
            console.log('===================================================\n');
        }
    });

    // Fitur Pairing Code opsional (jika nomor diisi di config.js atau env PAIRING_NUMBER)
    if (config.PAIRING_NUMBER && !state.creds.registered) {
        setTimeout(async () => {
            try {
                const cleanPairingNumber = config.PAIRING_NUMBER.replace(/[^0-9]/g, '');
                const code = await sock.requestPairingCode(cleanPairingNumber);
                console.log('\n===================================================');
                console.log(`🔑 KODE PAIRING WHATSAPP: ${code}`);
                console.log('Buka WhatsApp -> Perangkat Tertaut -> Tautkan Perangkat -> Tautkan dengan nomor telepon');
                console.log('===================================================\n');
            } catch (err) {
                console.error('[PAIRING ERROR] Gagal meminta kode pairing:', err.message);
            }
        }, 3000);
    }

    // Cache kontak
    sock.ev.on('contacts.upsert', (newContacts) => {
        for (const c of newContacts) {
            if (c.id) {
                const name = c.name || c.notify || c.verifiedName;
                if (name) contactsCache.set(c.id, name);
            }
        }
    });

    sock.ev.on('contacts.update', (updates) => {
        for (const c of updates) {
            if (c.id) {
                const name = c.name || c.notify || c.verifiedName;
                if (name) contactsCache.set(c.id, name);
            }
        }
    });

    // Penanganan pesan masuk
    sock.ev.on('messages.upsert', handleIncomingMessages);
}

/**
 * Fungsi untuk memproses pengecekan jadwal otomatis (dijalankan oleh Cron Job setiap menit)
 */
async function prosesPenjadwalan() {
    try {
        if (!sock) return;

        const data = db.loadData();
        if (!data || data.length === 0) return;

        let adaPerubahan = false;
        const now = new Date();
        const hariSekarang = now.getDay();   // 0 = Minggu, 5 = Jumat
        const jamSekarang = now.getHours();
        const menitSekarang = now.getMinutes();

        for (const hutang of data) {
            if (hutang.rutin === false) {
                // Jadwal Spesifik / Sekali Kirim
                const jadwalDate = parseDateString(hutang.jadwal);
                if (hutang.status === 'pending' && now >= jadwalDate) {
                    const formatTanggalMasehi = formatIndonesianDate(jadwalDate, false);
                    const formatJumlahRupiah = formatRupiah(hutang.jumlah);

                    const pesan = `Halo ${hutang.nama}, pengingat tagihan/hutang sebesar *${formatJumlahRupiah}* sejak tanggal *${formatTanggalMasehi}*.\n\nMohon untuk dapat segera diselesaikan ya. Terima kasih! 🙏\n\n_(Dikirim otomatis melalui Bot Pengingat)_`;

                    try {
                        await sendTextMessage(hutang.nomor, pesan);
                        console.log(`[PENJADWALAN AUTOMATIS] Pesan pengingat berhasil dikirim ke ${hutang.nama} (${hutang.nomor.split('@')[0]})`);

                        hutang.status = 'sukses';
                        hutang.waktu_terkirim = getNowFormatted();
                        adaPerubahan = true;
                    } catch (err) {
                        console.error(`[PENJADWALAN ERROR] Gagal mengirim pengingat ke ${hutang.nama}:`, err.message);
                    }
                }
            } else if (hutang.rutin === true) {
                // Jadwal Rutin Mingguan (Default: Hari Jumat jam 15:00)
                if (hutang.jadwal === 'mingguan') {
                    if (hariSekarang === 5 && jamSekarang === 15 && menitSekarang === 0) {
                        const formatJumlahRupiah = formatRupiah(hutang.jumlah);
                        const pesan = `Halo ${hutang.nama}, pengingat rutin mingguan tagihan/hutang sebesar *${formatJumlahRupiah}*.\n\nMohon untuk dapat segera diselesaikan ya. Terima kasih! 🙏\n\n_(Dikirim otomatis melalui Bot Pengingat)_`;

                        try {
                            await sendTextMessage(hutang.nomor, pesan);
                            console.log(`[PENJADWALAN RUTIN] Pesan rutin terkirim ke ${hutang.nama} (${hutang.nomor.split('@')[0]})`);
                        } catch (err) {
                            console.error(`[PENJADWALAN RUTIN ERROR] Gagal mengirim ke ${hutang.nama}:`, err.message);
                        }
                    }
                }
            }
        }

        if (adaPerubahan) {
            db.saveData(data);
        }
    } catch (error) {
        console.error('[CRON ERROR] Gagal mengeksekusi prosesPenjadwalan:', error.message);
    }
}

/**
 * Fungsi untuk memicu pengiriman pengingat secara manual
 */
async function kirimPengingatManual() {
    console.log('\n[MANUAL] Memulai pengiriman pengingat manual...');
    try {
        if (!sock) {
            console.log('[MANUAL] WhatsApp belum terhubung.');
            return;
        }

        const data = db.loadData();
        if (!data || data.length === 0) {
            console.log('[MANUAL] Tidak ada data tagihan yang tersimpan.');
            return;
        }

        let adaPerubahan = false;
        const waktuSekarangStr = getNowFormatted();

        for (const hutang of data) {
            let harusKirim = false;
            let detailJadwal = '';

            if (hutang.rutin === true) {
                harusKirim = true;
                detailJadwal = 'Rutin Mingguan';
            } else if (hutang.rutin === false && hutang.status === 'pending') {
                harusKirim = true;
                detailJadwal = 'Jadwal Spesifik (Pending)';
            }

            if (harusKirim) {
                let formatTanggalText = hutang.tanggal;
                if (hutang.rutin === false) {
                    formatTanggalText = formatIndonesianDate(hutang.tanggal, false);
                }
                const formatJumlahRupiah = formatRupiah(hutang.jumlah);

                const pesan = `Halo ${hutang.nama}, pengingat tagihan/hutang sebesar *${formatJumlahRupiah}* (${detailJadwal}).\n\nMohon untuk dapat segera diselesaikan ya. Terima kasih! 🙏\n\n_(Dikirim melalui Bot Pengingat)_`;

                try {
                    await sendTextMessage(hutang.nomor, pesan);
                    console.log(`[MANUAL - ${detailJadwal}] Pesan berhasil dikirim ke ${hutang.nama} (${hutang.nomor.split('@')[0]})`);

                    if (hutang.rutin === false) {
                        hutang.status = 'sukses';
                        hutang.waktu_terkirim = waktuSekarangStr;
                        adaPerubahan = true;
                    }
                } catch (err) {
                    console.error(`[MANUAL ERROR] Gagal mengirim ke ${hutang.nama}:`, err.message);
                }
            }
        }

        if (adaPerubahan) {
            db.saveData(data);
        }
        console.log('[MANUAL] Pengiriman pengingat manual selesai.\n');
    } catch (error) {
        console.error('[MANUAL ERROR] Gagal memproses pengiriman manual:', error.message);
    }
}

// Menjalankan Cron Job Setiap Menit (Timezone: Asia/Jakarta)
cron.schedule('* * * * *', () => {
    prosesPenjadwalan();
}, {
    scheduled: true,
    timezone: config.TIMEZONE
});

/**
 * Event penanganan pesan masuk
 */
async function handleIncomingMessages({ messages, type }) {
    if (!messages || !messages.length) return;

    for (const m of messages) {
        if (!m.key) continue;

        const msgContent = m.message;
        if (!msgContent) continue;

        const body = msgContent.conversation ||
                     msgContent.extendedTextMessage?.text ||
                     '';
        const bodyTrim = body.trim();
        if (!bodyTrim) continue;

        const remoteJid = m.key.remoteJid;
        if (!remoteJid) continue;

        const cleanNumber = remoteJid.split('@')[0];
        const botUserNumber = sock.user?.id ? sock.user.id.split(':')[0].split('@')[0] : '';
        const isFromMe = Boolean(m.key.fromMe);

        // Helper reply ke chat
        const reply = async (text) => {
            try {
                await sock.sendMessage(remoteJid, { text }, { quoted: m });
            } catch (err) {
                console.error('[REPLY ERROR] Gagal membalas pesan:', err.message);
            }
        };

        // JIKA PESAN DARI ORANG LAIN (PEMINJAM)
        if (!isFromMe) {
            // Peminjam hanya boleh mengecek tagihan mereka sendiri dengan !cek atau cek
            if (bodyTrim.toLowerCase() === '!cek' || bodyTrim.toLowerCase() === 'cek') {
                try {
                    const data = db.loadData();
                    const userDebts = data.filter(h => h.nomor === remoteJid || h.nomor.startsWith(cleanNumber));

                    if (!userDebts || userDebts.length === 0) {
                        await reply('ℹ️ Anda tidak memiliki catatan tagihan hutang aktif.');
                        return;
                    }

                    let rekap = `📋 *CATATAN TAGIHAN ANDA*\n\n`;
                    userDebts.forEach((h) => {
                        const tipe = h.rutin ? `Rutin (${h.jadwal})` : `Sekali (${formatIndonesianDate(h.jadwal, true)})`;
                        let statusTagihan = h.rutin 
                            ? '🟢 AKTIF' 
                            : (h.status === 'sukses' ? `✅ TERKIRIM (${formatIndonesianDate(h.waktu_terkirim, true)})` : '⏳ PENDING');

                        rekap += `👤 *Nama:* ${h.nama}\n`;
                        rekap += `💰 *Jumlah:* ${formatRupiah(h.jumlah)}\n`;
                        rekap += `📅 *Jadwal:* ${tipe}\n`;
                        rekap += `📊 *Status:* ${statusTagihan}\n\n`;
                    });
                    rekap += `_Mohon segera diselesaikan ya jika sudah jatuh tempo. Terima kasih! 🙏_`;

                    await reply(rekap.trim());
                } catch (err) {
                    console.error('[COMMAND ERROR] Gagal memproses cek peminjam:', err.message);
                }
            }
            // Abaikan pesan selain cek dari orang lain
            continue;
        }

        // --- DI BAWAH INI HANYA PERINTAH DARI PEMILIK BOT (fromMe) ---

        // Command: !bantuan / !help
        if (bodyTrim === '!bantuan' || bodyTrim === '!help') {
            const bantuanText = `📌 *PANDUAN PERINTAH BOT HUTANG WA*\n\n` +
                `1️⃣ *Tambah/Ubah Tagihan Spesifik:*\n` +
                `   \`!set [jumlah] [tanggal] [jam-opsional]\` \n` +
                `   _Contoh Cepat:_ \`!set 50000 25\` (tgl 25 bulan ini)\n` +
                `   _Contoh Cepat:_ \`!set 50000 besok\` / \`!set 50000 lusa\`\n` +
                `   _Contoh Bulan:_ \`!set 50000 25 des\` / \`!set 50000 25-12\`\n` +
                `   _Contoh Lengkap:_ \`!set 50000 25-12-2026 15:30\`\n\n` +
                `2️⃣ *Tambah Tagihan Rutin Mingguan:*\n` +
                `   \`!set [jumlah] rutin\`\n\n` +
                `3️⃣ *Tandai Lunas & Hapus Tagihan:*\n` +
                `   \`!lunas\` (Kirim di ruang chat kontak peminjam)\n\n` +
                `4️⃣ *Cek Tagihan Kontak Ini:*\n` +
                `   \`!cek\` (Hanya menampilkan hutang kontak pada chat saat ini)\n\n` +
                `5️⃣ *Cek Semua Tagihan:*\n` +
                `   \`!cek all\` (Rekap seluruh daftar hutang semua orang)\n\n` +
                `6️⃣ *Kirim Pengingat Manual Sekarang:*\n` +
                `   \`!kirim\``;

            await reply(bantuanText);
        }

        // Command: !kirim
        else if (bodyTrim === '!kirim') {
            console.log(`[COMMAND] Menerima perintah !kirim dari WhatsApp`);
            await kirimPengingatManual();
            await reply('✅ Pengingat hutang telah diproses secara manual.');
        }

        // Command: !set
        else if (bodyTrim.startsWith('!set ')) {
            console.log(`[COMMAND] Menerima perintah !set dari WhatsApp`);

            if (remoteJid.endsWith('@g.us')) {
                await reply('⚠️ Perintah `!set` hanya dapat digunakan di chat pribadi kontak peminjam.');
                return;
            }

            if (botUserNumber && cleanNumber === botUserNumber) {
                await reply('⚠️ Tidak dapat mengatur tagihan untuk nomor diri sendiri.');
                return;
            }

            const parts = bodyTrim.split(/\s+/);
            if (parts.length < 3) {
                await reply(
                    '⚠️ *Format Salah!*\n\n' +
                    'Penggunaan:\n' +
                    '• `!set [jumlah] [tanggal] [jam-opsional]`\n' +
                    '• `!set [jumlah] rutin`\n\n' +
                    'Contoh Fleksibel:\n' +
                    '• `!set 50000 25` (otomatis tgl 25 bulan ini)\n' +
                    '• `!set 50000 besok` / `!set 50000 lusa`\n' +
                    '• `!set 50000 25 des` / `!set 50000 25-12`\n' +
                    '• `!set 50000 25 des 14:00`\n' +
                    '• `!set 50000 25-12-2026 15:30`\n' +
                    '• `!set 25000 rutin`'
                );
                return;
            }

            const jumlahRaw = parts[1];
            const jadwalRaw = parts.slice(2).join(' ');

            let rutin = false;
            let jadwal = '';
            let tanggal = '';
            let status = undefined;
            let parsedDate = null;

            if (jadwalRaw.toLowerCase() === 'rutin') {
                rutin = true;
                jadwal = 'mingguan';
                tanggal = 'Rutin Mingguan';
            } else {
                rutin = false;
                parsedDate = parseDateString(jadwalRaw);
                if (isNaN(parsedDate.getTime()) || parsedDate.getTime() === 0) {
                    await reply(
                        '⚠️ Format tanggal tidak dikenali!\n\n' +
                        'Contoh yang didukung:\n' +
                        '• Tanggal saja: `25`\n' +
                        '• Kata relatif: `besok` / `lusa`\n' +
                        '• Tanggal & Bulan: `25 des` atau `25-12`\n' +
                        '• Lengkap: `25-12-2026` atau `25-12-2026 15:00`'
                    );
                    return;
                }

                const targetY = parsedDate.getFullYear();
                const targetM = String(parsedDate.getMonth() + 1).padStart(2, '0');
                const targetD = String(parsedDate.getDate()).padStart(2, '0');
                const targetH = String(parsedDate.getHours()).padStart(2, '0');
                const targetMin = String(parsedDate.getMinutes()).padStart(2, '0');

                jadwal = `${targetD}-${targetM}-${targetY} ${targetH}:${targetMin}`;
                tanggal = `${targetD}-${targetM}-${targetY}`;
                status = 'pending';
            }

            try {
                const existingData = db.loadData();
                const existingEntry = existingData.find(h => h.nomor === remoteJid || h.nomor.startsWith(cleanNumber));
                const nama = contactsCache.get(remoteJid) || (existingEntry ? existingEntry.nama : cleanNumber);

                const newEntry = {
                    nama,
                    nomor: remoteJid,
                    jumlah: jumlahRaw,
                    tanggal,
                    rutin,
                    jadwal
                };
                if (status) newEntry.status = status;

                db.upsertDebt(newEntry);

                const formatJadwalRespon = rutin ? 'Rutin (Mingguan)' : formatIndonesianDate(parsedDate, true);
                const formatNominalRespon = formatRupiah(jumlahRaw);

                await reply(
                    `✅ *Tagihan Berhasil Disimpan!*\n\n` +
                    `👤 *Nama:* ${nama}\n` +
                    `💰 *Jumlah:* ${formatNominalRespon}\n` +
                    `📅 *Jadwal Pengingat:* ${formatJadwalRespon}`
                );
            } catch (err) {
                console.error('[COMMAND ERROR] Gagal memproses !set:', err.message);
                await reply('❌ Gagal menyimpan data tagihan ke database.');
            }
        }

        // Command: !lunas
        else if (bodyTrim === '!lunas') {
            console.log(`[COMMAND] Menerima perintah !lunas dari WhatsApp`);

            if (remoteJid.endsWith('@g.us')) {
                await reply('⚠️ Perintah `!lunas` hanya dapat digunakan di chat pribadi kontak peminjam.');
                return;
            }

            try {
                const result = db.removeDebt(remoteJid);
                if (result.removed) {
                    await reply('🎉 *LUNAS!* Tagihan untuk kontak ini telah ditandai lunas dan dihapus dari daftar.');
                    console.log(`[LUNAS] Tagihan untuk nomor ${cleanNumber} telah dihapus.`);
                } else {
                    await reply('ℹ️ Kontak ini tidak ditemukan dalam daftar tagihan aktif.');
                }
            } catch (err) {
                console.error('[COMMAND ERROR] Gagal memproses !lunas:', err.message);
                await reply('❌ Gagal memperbarui status lunas.');
            }
        }

        // Command: !cek / !cek all
        else if (bodyTrim === '!cek' || bodyTrim === '!cek all') {
            console.log(`[COMMAND] Menerima perintah ${bodyTrim} dari WhatsApp`);
            try {
                const data = db.loadData();
                if (!data || data.length === 0) {
                    await reply('📋 *DAFTAR TAGIHAN HUTANG*\n\n_(Database kosong / tidak ada tagihan aktif)_');
                    return;
                }

                // Cek apakah perintah dikirim di chat dengan diri sendiri atau minta !cek all
                const isSelfChat = botUserNumber && cleanNumber === botUserNumber;
                const showAll = bodyTrim === '!cek all' || isSelfChat;

                if (!showAll) {
                    // Filter HANYA untuk kontak di ruang chat saat ini
                    const userDebts = data.filter(h => h.nomor === remoteJid || h.nomor.startsWith(cleanNumber));

                    if (userDebts.length === 0) {
                        await reply(
                            `ℹ️ Kontak ini (*${cleanNumber}*) tidak memiliki catatan tagihan aktif.\n\n` +
                            `_💡 Ketik \`!cek all\` jika ingin melihat rekap semua orang._`
                        );
                        return;
                    }

                    let rekap = `📋 *CATATAN TAGIHAN KONTAK INI*\n\n`;
                    userDebts.forEach((h) => {
                        const tipe = h.rutin ? `Rutin (${h.jadwal})` : `Sekali (${formatIndonesianDate(h.jadwal, true)})`;
                        let statusTagihan = '';
                        if (h.rutin) {
                            statusTagihan = '🟢 AKTIF';
                        } else {
                            statusTagihan = h.status === 'sukses' 
                                ? `✅ TERKIRIM (${formatIndonesianDate(h.waktu_terkirim, true)})` 
                                : '⏳ PENDING';
                        }

                        rekap += `👤 *Nama:* ${h.nama}\n`;
                        rekap += `💰 *Jumlah:* ${formatRupiah(h.jumlah)}\n`;
                        rekap += `📅 *Tipe & Jadwal:* ${tipe}\n`;
                        rekap += `📊 *Status:* ${statusTagihan}\n\n`;
                    });
                    rekap += `_💡 Ketik \`!cek all\` untuk melihat rekap seluruh kontak._`;

                    await reply(rekap.trim());
                } else {
                    // Tampilkan SEMUA tagihan
                    let rekap = '📋 *DAFTAR SEMUA TAGIHAN HUTANG*\n\n';
                    data.forEach((h, index) => {
                        const tipe = h.rutin ? `Rutin (${h.jadwal})` : `Sekali (${formatIndonesianDate(h.jadwal, true)})`;
                        let statusTagihan = '';
                        if (h.rutin) {
                            statusTagihan = '🟢 AKTIF';
                        } else {
                            statusTagihan = h.status === 'sukses' 
                                ? `✅ TERKIRIM (${formatIndonesianDate(h.waktu_terkirim, true)})` 
                                : '⏳ PENDING';
                        }

                        rekap += `*${index + 1}. ${h.nama}*\n`;
                        rekap += `   • Nomor: ${h.nomor.split('@')[0]}\n`;
                        rekap += `   • Jumlah: ${formatRupiah(h.jumlah)}\n`;
                        rekap += `   • Tipe: ${tipe}\n`;
                        rekap += `   • Status: ${statusTagihan}\n\n`;
                    });

                    await reply(rekap.trim());
                }
            } catch (err) {
                console.error('[COMMAND ERROR] Gagal memproses !cek:', err.message);
                await reply('❌ Gagal mengambil daftar tagihan.');
            }
        }
    }
}

// Pemicu Perintah via Terminal Konsol
process.stdin.on('data', (data) => {
    const input = data.toString().trim();
    if (input === 'kirim') {
        kirimPengingatManual();
    } else if (input === 'cek') {
        const dataHutang = db.loadData();
        console.log('\n--- REKAP TAGIHAN DATA.JSON ---');
        console.dir(dataHutang, { depth: null });
        console.log('--------------------------------\n');
    } else if (input === 'help') {
        console.log('\n--- PERINTAH TERMINAL ---');
        console.log(' • kirim -> Kirim pengingat manual sekarang');
        console.log(' • cek   -> Tampilkan data tagihan di konsol');
        console.log(' • help  -> Tampilkan bantuan terminal');
        console.log('--------------------------\n');
    }
});

// Jalankan Bot
startBot();
