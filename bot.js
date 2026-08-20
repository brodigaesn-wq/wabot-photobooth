/**
 * BOT WA PENGIRIMAN FOLDER FOTO - PHOTOBOOTH (JJIKGO STUDIO)
 * ============================================================
 * Pakai API KEY Google (bukan Service Account) karena folder Drive-nya
 * sudah "Siapapun yang memiliki link".
 *
 * ID folder TEMA (cuma 1 ID per tema, 14 total) di-HARDCODE di bawah —
 * bot otomatis cari sendiri subfolder "Original" dan "Print" di
 * dalamnya tiap ada chat masuk. Lebih cepat & sederhana dibanding
 * cari mulai dari Folder Perusahaan tiap kali.
 *
 * Setup ID folder tiap tema (SEKALI SAJA, di awal):
 * 1. Buka folder TEMA-nya langsung di Drive (bukan folder Original/Print)
 * 2. Lihat URL: drive.google.com/drive/folders/XXXXXXXXXX <- ini ID-nya
 * 3. Tempel ke THEMA_FOLDER_IDS di bawah. Ulangi untuk 14 tema.
 * 4. Pastikan di dalam tiap folder tema ada subfolder "Original" dan
 *    "Print" (family room cukup "Original" saja).
 *
 * FITUR MULTI TEMA:
 * Customer bisa kirim lebih dari 1 tema dalam satu chat, contoh:
 *   "0819 agus vinyl dan album"
 *   "0819 agus vinyl, album dan hotel"
 * Bot akan kirim link untuk semua tema itu sekaligus.
 *
 * Cara pakai:
 * 1. npm install whatsapp-web.js qrcode-terminal googleapis
 * 2. Di Google Cloud Console: buat project, enable "Google Drive API",
 *    lalu di menu Credentials klik "Create Credentials > API Key",
 *    restrict ke Google Drive API saja.
 * 3. Isi GOOGLE_API_KEY dan semua ID folder di THEMA_FOLDER_IDS di bawah.
 * 4. node bot.js -> scan QR
 *
 * ----------------------------------------------------------------
 * CHANGELOG PATCH (fix "folder belum ditemukan" padahal ada di Drive):
 * - cariFolder() sebelumnya pakai exact match `name = '...'` di query
 *   Drive API, yang case-sensitive dan gagal kalau nama folder di
 *   Drive beda dikit (kapitalisasi, spasi ganda, dll) dari yang
 *   di-generate bot.
 * - Sekarang cariFolder() ambil SEMUA subfolder di parent, lalu
 *   dicocokkan manual pakai trim + lowercase -> jauh lebih toleran.
 * - Ditambah console.log saat folder tidak ketemu, isinya daftar
 *   nama folder yang benar-benar terlihat oleh bot di parent itu.
 *   Ini kunci debug: kalau daftarnya KOSONG, berarti masalah
 *   sharing/permission (folder belum "Anyone with the link"),
 *   bukan soal penamaan.
 * ----------------------------------------------------------------
 */

require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');

// ======== 1. API KEY GOOGLE ========
// Diambil dari file .env (JANGAN hardcode key di sini / jangan commit .env ke Git).
// Buat file .env di folder yang sama isinya: GOOGLE_API_KEY=xxxxx
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

if (!GOOGLE_API_KEY) {
  console.error('❌ GOOGLE_API_KEY tidak ditemukan. Pastikan file .env berisi GOOGLE_API_KEY=xxxxx');
  process.exit(1);
}

function getDriveClient() {
  return google.drive({ version: 'v3', auth: GOOGLE_API_KEY });
}

// ======== 2. ID FOLDER TIAP TEMA (isi sekali di awal — cukup 1 ID per tema) ========
// Ambil ID dari URL folder TEMA-nya langsung (bukan folder Original/Print).
// Bot otomatis cari subfolder "Original" dan "Print" di dalamnya sendiri.
const THEMA_FOLDER_IDS = {
  'vinyl': '1xOYt1iUJfApZqJAH2QRsL2Ghs9PhfWZh',
  'elevator': '1mh7ntofy7Vs-OKfY_38eYPMgEaCSoxHR',
  'hotel': '1aem6hISlhW_4alZcma1umnw05WSmWnl-',
  'album': '1tJQl2ylk4-juuU3uRgsw-xEhiEtdR5sN',
  'telephone': '1uOlAkHooRB5FYKhtNx2eojKCIjOfMpkO',
  'cinema': '1DLZl5J3N78Bd2jFystBekvCjJdD8HZJw',
  'supermarket': '1aJTxEmvJ-_WacKCp3kqXDiDRwIeUJ8o1',
  'magazine box': '1fS1IyV0bjYmDJJklrApP_cjsuJQ8cQZd',
  'newspaper': '1EdbRgtstNs9EXS5xlEOhQIxYhKsl4Ndp',
  'vintage room': '1E-3ILnigFKihawO0r5ip4uo7fefUHnXA',
  'subway': '1LFjQBY86yQzPN2dn4URYpMnIA-aXqavq',
  'teddy bear': '1ERrTgGyse5V-WporJy934Rn_4wQn9XQ1',
  'flower': '10SEwXVILyv30adNM3ZD5-R4isdJJhfp3',
  'family room': '1pg2SLPuPu57EiGkZzzBIyZs-_Af5goqP', // di dalamnya cukup ada subfolder "Original"
};

// urutkan dari nama tema 2 kata dulu, biar matching di parser akurat
const DAFTAR_TEMA = Object.keys(THEMA_FOLDER_IDS).sort((a, b) => b.split(' ').length - a.split(' ').length);
const TEMA_ORIGINAL_ONLY = ['family room'];

// ======== 3. PARSER PESAN (support multi tema) ========
// "0819 agus vinyl" -> { tanggal, nama: 'agus', temaList: ['vinyl'] }
// "0819 agus vinyl dan album" -> { tanggal, nama: 'agus', temaList: ['vinyl','album'] }
function cariTemaDiAkhir(text) {
  for (const tema of DAFTAR_TEMA) {
    if (text.endsWith(tema)) {
      const nama = text.slice(0, text.length - tema.length).trim();
      if (nama) return { nama, tema };
    }
  }
  return null;
}

function parseMessage(text) {
  const trimmed = text.trim().toLowerCase();
  const tokens = trimmed.split(/\s+/);
  if (tokens.length < 3) return null;

  const tanggal = tokens[0];
  const sisaText = tokens.slice(1).join(' ');

  // pisah berdasarkan kata "dan" (utuh) atau koma
  const chunks = sisaText
    .split(/\s*(?:\bdan\b|,)\s*/)
    .map((c) => c.trim())
    .filter(Boolean);

  if (chunks.length === 1) {
    const hasil = cariTemaDiAkhir(chunks[0]);
    if (!hasil) return null;
    return { tanggal, nama: hasil.nama, temaList: [hasil.tema] };
  }

  // chunk ke-2 dst harus persis nama tema (murni tema, tanpa nama lagi)
  const temaList = [];
  for (let i = chunks.length - 1; i >= 1; i--) {
    if (!DAFTAR_TEMA.includes(chunks[i])) return null;
    temaList.unshift(chunks[i]);
  }

  // chunk pertama = nama + tema pertama
  const hasilPertama = cariTemaDiAkhir(chunks[0]);
  if (!hasilPertama) return null;
  temaList.unshift(hasilPertama.tema);

  return { tanggal, nama: hasilPertama.nama, temaList };
}

// ======== 4. CARI FOLDER CUSTOMER DI DALAM Original/Print (sudah tahu ID-nya) ========
// VERSI DIPERBAIKI: sebelumnya pakai exact match `name = '...'` di query
// Drive API (case-sensitive, gagal kalau ada beda spasi/kapitalisasi).
// Sekarang ambil semua subfolder lalu cocokkan manual trim+lowercase,
// dan log daftar folder yang terlihat kalau gagal ketemu — biar gampang
// dibedain: ini masalah PENAMAAN atau masalah SHARING/PERMISSION.
// Abaikan besar/kecil huruf, spasi berlebih, DAN beda separator
// spasi vs underscore (folder di Drive ternyata pakai underscore,
// misal "0818_SANDY", sementara bot generate "0818 Sandy" pakai
// spasi) — yang penting kata-katanya sama.
function normalize(str) {
  return str
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, ' '); // spasi & underscore dianggap sama
}

async function cariFolder(drive, namaFolder, parentId) {
  const res = await drive.files.list({
    q: `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name, webViewLink)',
    spaces: 'drive',
    pageSize: 1000,
  });

  const target = normalize(namaFolder);
  const found = res.data.files.find((f) => normalize(f.name) === target);

  if (!found) {
    console.log(
      `[cariFolder] Tidak ketemu "${namaFolder}" di parent ${parentId}. ` +
        `Folder yang ada: ${res.data.files.map((f) => `"${f.name}"`).join(', ') || '(kosong / tidak ada akses)'}`
    );
  }

  return found || null;
}

async function cariLinkSatuTema({ tanggal, nama, tema }) {
  const folderTemaId = THEMA_FOLDER_IDS[tema];
  if (!folderTemaId) return null;

  const drive = getDriveClient();
  const namaFolderCustomer = `${tanggal} ${capitalize(nama)}`;
  const originalOnly = TEMA_ORIGINAL_ONLY.includes(tema);

  if (originalOnly) {
    const folderOriginal = await cariFolder(drive, 'Original', folderTemaId);
    if (!folderOriginal) return { tema, linkOriginal: null, linkPrint: null, originalOnly: true, namaAsli: null };
    const folderCustomer = await cariFolder(drive, namaFolderCustomer, folderOriginal.id);
    return {
      tema,
      linkOriginal: folderCustomer ? folderCustomer.webViewLink : null,
      linkPrint: null,
      originalOnly: true,
      namaAsli: folderCustomer ? folderCustomer.name : null,
    };
  }

  // cari subfolder "Original" dan "Print" dulu di dalam folder tema
  const [folderOriginal, folderPrint] = await Promise.all([
    cariFolder(drive, 'Original', folderTemaId),
    cariFolder(drive, 'Print', folderTemaId),
  ]);

  // lalu cari folder customer di masing-masing
  const [customerOriginal, customerPrint] = await Promise.all([
    folderOriginal ? cariFolder(drive, namaFolderCustomer, folderOriginal.id) : null,
    folderPrint ? cariFolder(drive, namaFolderCustomer, folderPrint.id) : null,
  ]);

  return {
    tema,
    linkOriginal: customerOriginal ? customerOriginal.webViewLink : null,
    linkPrint: customerPrint ? customerPrint.webViewLink : null,
    originalOnly: false,
    // nama folder ASLI di Drive (misal "0818_SANDY"), dipakai buat
    // ambil nama customer yang sebenarnya di template pesan
    namaAsli: customerOriginal ? customerOriginal.name : customerPrint ? customerPrint.name : null,
  };
}

// cari semua tema sekaligus, paralel biar cepat
async function cariLinkSemuaTema({ tanggal, nama, temaList }) {
  return Promise.all(temaList.map((tema) => cariLinkSatuTema({ tanggal, nama, tema })));
}

// Beberapa customer adalah KOL/endorser, dan nama folder/chat-nya suka
// diakhiri kata "kol" sebagai penanda saja (misal "Gesti Kol"), BUKAN
// bagian dari nama asli. Waktu bikin greeting, kata "kol" di akhir ini
// harus dibuang supaya bot sapa "Halo Gesti!", bukan "Halo Kol!".
function stripKolSuffix(nama) {
  return nama.replace(/\s+kol\s*$/i, '').trim();
}

// Dari nama folder asli (misal "0818_SANDY" atau "0725 Caca Cantik"),
// buang bagian tanggal di depan dan rapikan jadi "Sandy" / "Caca Cantik".
// Kalau gagal (folder tidak ketemu di tema manapun), fallback ke nama
// hasil parsing chat customer. Kata "kol" di akhir nama selalu dibuang
// dulu sebelum dipakai sebagai sapaan (lihat stripKolSuffix di atas).
function ambilNamaUntukGreeting(hasilSemuaTema, namaFallback) {
  const namaAsli = hasilSemuaTema.map((h) => h && h.namaAsli).find(Boolean);
  if (!namaAsli) return capitalize(stripKolSuffix(namaFallback));

  // pecah per kata (spasi & underscore dianggap sama), lalu buang token
  // PERTAMA saja (tanggal) — sebelumnya pakai regex greedy yang salah
  // potong kalau nama customernya 2 kata (misal "0722_GESTI KOL" jadi
  // kepotong sisa "KOL" doang, bukan "GESTI KOL").
  const tokens = namaAsli.trim().split(/[\s_]+/);
  tokens.shift(); // buang token tanggal di depan
  const bagianNama = tokens.join(' ').toLowerCase();
  const namaBersih = stripKolSuffix(bagianNama);
  return capitalize(namaBersih);
}

function capitalize(str) {
  return str.replace(/\b\w/g, (c) => c.toUpperCase());
}

// ======== 5. TEMPLATE PESAN ========
const LINK_GOOGLE_MAPS = 'https://maps.app.goo.gl/N25ZMuMFbf8LaggL6';
const INSTAGRAM_HANDLE = '@jjikgostudio.id';

function buatTemplatePesan(hasilSemuaTema, namaGreeting) {
  const bagianTema = hasilSemuaTema
    .map((h) => {
      const barisPrint = h.originalOnly ? '' : `🖨️ File Print: \n${h.linkPrint || '(belum tersedia)'}\n`;
      const judul = hasilSemuaTema.length > 1 ? `*${capitalize(h.tema)}*\n` : '';
      return `${judul}📁 File Original: \n${h.linkOriginal || '(belum tersedia)'}\n${barisPrint}`;
    })
    .join('\n');

  return `Halo ${namaGreeting}! 👋
Terima kasih sudah berfoto di JJIKGO STUDIO ✨
Berikut link soft file kamu:
${bagianTema}
Berikan juga review google mapsnya
📍 ${LINK_GOOGLE_MAPS}

Jangan lupa follow dan tag kami di Instagram ya!
📸 ${INSTAGRAM_HANDLE}
Sampai jumpa lagi! 🙏`;
}

// ======== 6. LOG TRANSAKSI (untuk dashboard pemantauan) ========
const LOG_PATH = path.join(__dirname, 'logs.json');

function tambahLog(entry) {
  let logs = [];
  if (fs.existsSync(LOG_PATH)) {
    logs = JSON.parse(fs.readFileSync(LOG_PATH, 'utf-8'));
  }
  logs.push({ ...entry, waktu: new Date().toISOString() });
  fs.writeFileSync(LOG_PATH, JSON.stringify(logs, null, 2));
}

// ======== 6b. SERVER HTTP UNTUK DASHBOARD ========
// Dashboard di-deploy TERPISAH (Vercel/Netlify) dan panggil endpoint ini
// dari browser -> wajib pakai CORS supaya browser tidak block requestnya.
//
// GANTI '*' di bawah dengan domain dashboard kamu setelah deploy
// (misal 'https://dashboard-photobooth.vercel.app') biar lebih aman,
// jangan biarkan '*' selamanya di production.
const app = express();
app.use(cors({ origin: '*' }));

app.get('/logs', (req, res) => {
  let logs = [];
  if (fs.existsSync(LOG_PATH)) {
    logs = JSON.parse(fs.readFileSync(LOG_PATH, 'utf-8'));
  }
  res.json(logs);
});

// endpoint sederhana buat cek server hidup (dipanggil browser/monitoring)
app.get('/', (req, res) => res.send('Bot photobooth aktif ✅'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server dashboard jalan di port ${PORT}`));

// ======== 7. SETUP CLIENT WHATSAPP ========
// webVersionCache: { type: 'none' } -> fix umum untuk error
// "Execution context was destroyed" / "Protocol error (Runtime.callFunctionOn)"
// yang muncul tepat setelah scan QR, karena whatsapp-web.js sebelumnya
// pakai cache versi WhatsApp Web yang sudah tidak cocok.
const client = new Client({
  authStrategy: new LocalAuth(),
  webVersionCache: { type: 'none' },
  puppeteer: {
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
});

client.on('qr', (qr) => {
  qrcode.generate(qr, { small: true });
  const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`;
  console.log('QR ASCII di atas mungkin tidak terbaca di log Railway.');
  console.log('Buka link berikut di browser buat scan QR-nya:');
  console.log(qrImageUrl);
});

// Listener tambahan ini penting: whatsapp-web.js bisa kehilangan koneksi
// (misal HP di-logout dari WhatsApp Web, kena rate limit, atau sesi
// kadaluarsa) TANPA bikin proses crash — jadi Railway kelihatan
// "normal jalan" padahal bot sudah nggak nerima pesan sama sekali.
// Sebelumnya tidak ada log buat kejadian ini, makanya nggak ketahuan.
client.on('disconnected', (reason) => {
  console.error('❌ Bot WA TERPUTUS dari WhatsApp:', reason);
  console.error('Perlu scan ulang QR atau restart service di Railway.');
});

client.on('auth_failure', (msg) => {
  console.error('❌ Autentikasi WhatsApp GAGAL:', msg);
});

client.on('change_state', (state) => {
  console.log('ℹ️ Status koneksi WA berubah:', state);
});

client.on('ready', () => console.log('Bot WA siap digunakan!'));

client.on('message', async (msg) => {
  console.log(`📩 Pesan masuk dari ${msg.from}: "${msg.body}"`);

  const parsed = parseMessage(msg.body);
  if (!parsed) {
    console.log('   ↳ Tidak diproses: format pesan tidak cocok pola "tanggal nama tema".');
    return;
  }

  const { tanggal, nama, temaList } = parsed;
  const nomorCustomer = msg.from;

  try {
    const hasilSemuaTema = await cariLinkSemuaTema({ tanggal, nama, temaList });
    const adaYangKosong = hasilSemuaTema.some((h) => !h || !h.linkOriginal);

    if (adaYangKosong) {
      const temaBermasalah = hasilSemuaTema
        .filter((h) => !h || !h.linkOriginal)
        .map((h, i) => (h ? h.tema : temaList[i]))
        .join(', ');
      await msg.reply(
        `Maaf kak, folder untuk tema "${temaBermasalah}" belum ditemukan di Drive. Mohon tunggu admin upload dulu ya, atau cek kembali penulisannya.`
      );
      tambahLog({ nomorCustomer, tanggal, nama, tema: temaList.join(', '), status: 'GAGAL - folder tidak ditemukan' });
      return;
    }

    const namaGreeting = ambilNamaUntukGreeting(hasilSemuaTema, nama);
    const pesan = buatTemplatePesan(hasilSemuaTema, namaGreeting);
    await msg.reply(pesan);
    tambahLog({ nomorCustomer, tanggal, nama, tema: temaList.join(', '), status: 'TERKIRIM' });
  } catch (err) {
    console.error('Error handling message:', err);
    await msg.reply('Maaf kak, terjadi kendala teknis. Admin akan segera membantu.');
    tambahLog({ nomorCustomer, tanggal, nama, tema: temaList.join(', '), status: 'ERROR' });
  }
});

client.initialize();

module.exports = { parseMessage, DAFTAR_TEMA, THEMA_FOLDER_IDS };
