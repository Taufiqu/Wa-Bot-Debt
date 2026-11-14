const config = require('./config');

const NAMA_BULAN = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

const MONTH_MAP = {
    'jan': 0, 'januari': 0, 'january': 0,
    'feb': 1, 'februari': 1, 'february': 1,
    'mar': 2, 'maret': 2, 'march': 2,
    'apr': 3, 'april': 3,
    'mei': 4, 'may': 4,
    'jun': 5, 'juni': 5, 'june': 5,
    'jul': 6, 'juli': 6, 'july': 6,
    'agu': 7, 'agus': 7, 'agustus': 7, 'aug': 7, 'august': 7,
    'sep': 8, 'sept': 8, 'september': 8,
    'okt': 9, 'oktober': 9, 'oct': 9, 'october': 9,
    'nov': 10, 'november': 10,
    'des': 11, 'desember': 11, 'dec': 11, 'december': 11
};

/**
 * Memformat nominal angka ke format Rupiah Indonesia (contoh: Rp 50.000)
 * @param {number|string} amount 
 * @returns {string}
 */
function formatRupiah(amount) {
    const num = parseInt(amount, 10);
    if (isNaN(num)) return `Rp ${amount}`;
    return `Rp ${num.toLocaleString('id-ID')}`;
}

/**
 * Memparsing input tanggal secara fleksibel dan cerdas:
 * - "25" -> tanggal 25 bulan & tahun saat ini (jika sudah lewat, otomatis bulan depan)
 * - "25 14:00" -> tanggal 25 jam 14:00
 * - "25-12" / "25 des" -> tanggal 25 Desember tahun ini (jika sudah lewat, tahun depan)
 * - "25-12-2026" / "25 des 2026" -> tanggal lengkap
 * - "besok" / "lusa" -> 1 atau 2 hari ke depan
 * 
 * @param {string} dateStr 
 * @returns {Date}
 */
function parseDateString(dateStr) {
    try {
        if (!dateStr || typeof dateStr !== 'string') return new Date(0);
        const now = new Date();
        let str = dateStr.trim();

        // 1. Ekstrak Jam (HH:mm atau HH.mm)
        let hour = 10;
        let minute = 0;
        if (config.DEFAULT_REMINDER_TIME) {
            const [defH, defM] = config.DEFAULT_REMINDER_TIME.split(':');
            hour = parseInt(defH, 10) || 10;
            minute = parseInt(defM, 10) || 0;
        }

        const timeRegex = /(?:^|\s)(\d{1,2})[:.](\d{2})(?:\s|$)/;
        const timeMatch = str.match(timeRegex);
        if (timeMatch) {
            hour = parseInt(timeMatch[1], 10);
            minute = parseInt(timeMatch[2], 10);
            str = str.replace(timeMatch[0], ' ').trim();
        }

        // 2. Dukungan kata relatif: 'besok' atau 'lusa'
        const lowerStr = str.toLowerCase();
        if (lowerStr === 'besok') {
            return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, hour, minute, 0);
        }
        if (lowerStr === 'lusa') {
            return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2, hour, minute, 0);
        }

        // 3. Tokenisasi tanggal (dipisahkan spasi, tanda strip -, atau garis miring /)
        const tokens = str.split(/[\s\-\/]+/).filter(Boolean);
        if (tokens.length === 0) return new Date(0);

        const day = parseInt(tokens[0], 10);
        if (isNaN(day) || day < 1 || day > 31) return new Date(0);

        let month = now.getMonth();
        let year = now.getFullYear();

        if (tokens.length === 1) {
            // Kasus 1: Hanya tanggal saja (contoh: "25")
            // Jika tanggal tersebut sudah lewat di bulan ini, otomatis ke bulan berikutnya
            if (day < now.getDate()) {
                month += 1;
                if (month > 11) {
                    month = 0;
                    year += 1;
                }
            }
        } else if (tokens.length === 2) {
            // Kasus 2: Tanggal + Bulan (contoh: "25-12", "25 des", "25/12")
            const monthKey = tokens[1].toLowerCase();
            if (MONTH_MAP[monthKey] !== undefined) {
                month = MONTH_MAP[monthKey];
            } else {
                const mNum = parseInt(tokens[1], 10);
                if (isNaN(mNum) || mNum < 1 || mNum > 12) return new Date(0);
                month = mNum - 1;
            }

            // Jika tanggal & bulan tersebut di tahun berjalan sudah lewat, lompat ke tahun depan
            const tempDate = new Date(year, month, day, hour, minute, 0);
            if (tempDate < now) {
                year += 1;
            }
        } else if (tokens.length >= 3) {
            // Kasus 3: Tanggal + Bulan + Tahun (contoh: "25-12-2026", "25 des 2026")
            const monthKey = tokens[1].toLowerCase();
            if (MONTH_MAP[monthKey] !== undefined) {
                month = MONTH_MAP[monthKey];
            } else {
                const mNum = parseInt(tokens[1], 10);
                if (isNaN(mNum) || mNum < 1 || mNum > 12) return new Date(0);
                month = mNum - 1;
            }

            let yNum = parseInt(tokens[2], 10);
            if (isNaN(yNum)) return new Date(0);
            if (yNum < 100) yNum += 2000;
            year = yNum;
        }

        const dateObj = new Date(year, month, day, hour, minute, 0);
        if (isNaN(dateObj.getTime())) return new Date(0);

        return dateObj;
    } catch (e) {
        return new Date(0);
    }
}

/**
 * Memformat objek Date / string tanggal ke format Bahasa Indonesia (contoh: 25 Juni 2026 10:00)
 * @param {Date|string} dateInput 
 * @param {boolean} includeTime 
 * @returns {string}
 */
function formatIndonesianDate(dateInput, includeTime = true) {
    try {
        let dateObj;
        if (dateInput instanceof Date) {
            dateObj = dateInput;
        } else {
            dateObj = parseDateString(dateInput);
        }

        if (isNaN(dateObj.getTime()) || dateObj.getTime() === 0) {
            return String(dateInput);
        }

        const d = String(dateObj.getDate()).padStart(2, '0');
        const m = NAMA_BULAN[dateObj.getMonth()];
        const y = dateObj.getFullYear();

        if (includeTime) {
            const hh = String(dateObj.getHours()).padStart(2, '0');
            const mm = String(dateObj.getMinutes()).padStart(2, '0');
            return `${d} ${m} ${y} ${hh}:${mm}`;
        }
        return `${d} ${m} ${y}`;
    } catch (e) {
        return String(dateInput);
    }
}

/**
 * Mengembalikan string timestamp saat ini dengan format DD-MM-YYYY HH:mm
 * @returns {string}
 */
function getNowFormatted() {
    const now = new Date();
    const d = String(now.getDate()).padStart(2, '0');
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const y = now.getFullYear();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    return `${d}-${m}-${y} ${hh}:${mm}`;
}

module.exports = {
    formatRupiah,
    parseDateString,
    formatIndonesianDate,
    getNowFormatted
};
