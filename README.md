# 🤖 Wa-Bot-Debt (WhatsApp Debt Reminder Bot)

Bot WhatsApp otomatis super ringan (*lightweight*, berbasis **Baileys**) untuk mencatat, mengelola, dan mengingatkan tagihan/hutang secara otomatis maupun manual.

> **Kenapa Baileys?**
> Tidak menggunakan browser Chromium/Puppeteer sama sekali! Menggunakan koneksi socket native WhatsApp sehingga hanya memakan RAM ~40-70 MB (hemat 90%+ dibandingkan versi browser), sangat cocok di-deploy di hosting gratisan seperti **Discloud**, VPS murah, atau perangkat mini.

---

## 🚀 Fitur Utama

- **Ultra Ringan**: Tanpa browser headless, RAM hanya ~50 MB.
- **Pencatatan Otomatis**: Cukup ketik `!set [nominal] [tanggal]` langsung di WhatsApp pada ruang chat kontak peminjam.
- **Rupiah & Tanggal Indonesia**: Format mata uang otomatis `Rp 50.000` dan tanggal `25 Desember 2026 10:00`.
- **Pengingat Rutin & Spesifik**: Mendukung jadwal pengingat satu kali (tanggal spesifik) dan pengingat rutin mingguan (Jumat 15:00).
- **Cron Job Otomatis**: Bot akan memeriksa jadwal setiap menit (`Asia/Jakarta`) dan mengirimkan pesan jika waktu pengingat telah tiba.
- **Pencatatan Status Lunas**: Perintah `!lunas` untuk menghapus tagihan secara instan.
- **Dua Metode Login**: Bisa via **Scan QR Code** di terminal atau **Pairing Code** (8 digit nomor telepon).
- **Kontrol Terminal**: Dapat memicu pengiriman pengingat (`kirim`) atau melihat daftar tagihan (`cek`) langsung dari konsol/terminal.

---

## 📋 Perintah WhatsApp

Kirimkan perintah berikut di ruang chat WhatsApp yang ingin dicatat/dikelola:

| Perintah | Deskripsi & Contoh |
| :--- | :--- |
| `!set [jumlah] [tanggal] [jam]` | **Format Cerdas & Fleksibel:**<br>• Cuma tanggal: `!set 50000 25` (otomatis bulan & tahun ini)<br>• Kata relatif: `!set 50000 besok` atau `!set 50000 lusa`<br>• Tanggal & bulan: `!set 50000 25 des` atau `!set 50000 25-12`<br>• Dengan jam: `!set 50000 25 des 14:00`<br>• Format lengkap: `!set 50000 25-12-2026 15:30` |
| `!set [jumlah] rutin` | Mengatur tagihan rutin mingguan.<br>_Contoh:_ `!set 25000 rutin` |
| `!lunas` | Menandai tagihan kontak tersebut LUNAS dan menghapusnya dari daftar. |
| `!cek` | Menampilkan catatan tagihan **hanya untuk kontak ruang chat saat ini** (privasi aman). |
| `!cek all` | Menampilkan rekap **seluruh tagihan semua orang** (dapat digunakan di mana saja / chat pribadi). |
| `!kirim` | Mengirimkan pesan pengingat secara manual saat itu juga ke semua target. |
| `!bantuan` / `!help` | Menampilkan panduan bantuan perintah di WhatsApp. |

---

## 💻 Perintah Terminal

Saat bot sedang berjalan di terminal, Anda juga bisa mengetik perintah berikut lalu tekan **Enter**:

- `kirim` -> Memicu pengiriman pengingat manual.
- `cek` -> Menampilkan data JSON tagihan di konsol.
- `help` -> Menampilkan menu bantuan terminal.

---

## 🛠️ Cara Menjalankan Lokal

### 1. Install Dependensi
```bash
npm install
```

### 2. Jalankan Bot
```bash
npm start
```

### 3. Login
- **Metode QR (Default)**: Pindai QR Code yang muncul di terminal via WhatsApp (**Perangkat Tertaut -> Tautkan Perangkat**).
- **Metode Pairing Code**: Isi nomor HP Anda di file `config.js` pada opsi `PAIRING_NUMBER` (misal: `'628123456789'`). Saat bot dijalankan, kode 8 digit akan muncul di terminal untuk dimasukkan ke WhatsApp.

---

## ☁️ Cara Deploy ke Discloud

Karena bot ini sekarang sangat ringan (~50 MB RAM), bot ini **100% aman dan stabil** di Discloud (bahkan di paket RAM 100 MB).

1. Pastikan file `discloud.config` sudah ada di root folder:
   ```ini
   ID=bot-hutang-wa
   TYPE=bot
   MAIN=index.js
   NAME=bot-hutang-wa
   RAM=100
   AUTORESTART=true
   VERSION=latest
   ```
2. Compress seluruh file proyek ke dalam file `.zip` (Kecuali folder `node_modules` dan `baileys_auth`).
3. Buka dashboard [Discloud](https://discloud.com/) atau via bot Discord Discloud.
4. Upload file `.zip` tersebut dan jalankan bot.
5. Cek tab terminal / logs di Discloud untuk scan QR code atau masukkan Pairing Code.

---

## 📂 Struktur Proyek

```
bot-hutang-WA/
├── config.js         # Konfigurasi aplikasi & timezone
├── database.js       # Modul pembacaan & penulisan data JSON
├── formatter.js      # Modul format mata uang & tanggal Indonesia
├── index.js          # File utama (Baileys client, cron job, handler pesan)
├── data.json         # Tempat penyimpanan data tagihan lokal
├── discloud.config   # Konfigurasi deployment Discloud
├── package.json      # Informasi dependensi npm
└── README.md         # Dokumentasi petunjuk penggunaan
```
