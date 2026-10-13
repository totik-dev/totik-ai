# Totik Murloc Bot (totik-ai)

Totik Channel Discord sunucusunda WoW Forever sorularını cevaplayan bot. Soru kanalında `!soru <soru>` yazılınca cevap verir; görsel eklenebilir veya bir mesaja yanıt olarak sorulabilir.

## Nasıl çalışır

- Cloudflare Worker + tek bir Durable Object (`DiscordGateway`). Bot Discord'a sürekli bağlı değildir; 10–30 saniyede bir soru kanalındaki yeni mesajları okur.
- Bot kimliği, guild/Totik bilgisi ve kaynak önerisi gibi sorular AI kullanılmadan sabit metinle cevaplanır.
- Soru bir sınıf rehberiyle eşleşirse (sınıf, spec, konu) rehber kanalındaki PNG'ler okunur, cevap bu rehbere dayanarak yazılır ve görseller mesaja eklenir.
- Eşleşme yoksa WoW AI servisi (`WOW_AI_URL`), o da cevap vermezse Gemini kullanılır.
- Bekleme süresi: YouTube Katıl / Twitch Sub / premium rolü 1 dakika, diğer üyeler 15 dakika. Cevap verilemezse hak geri verilir.
- Cooldown, mesaj durumu ve rehber görsellerinden okunan metin Durable Object depolamasında tutulur; ayrı veritabanı yoktur.

## Dosyalar

| Dosya | Ne |
|---|---|
| `src/index.js` | Çalışan botun tamamı. Deploy edilen dosya budur. |
| `src/class-guide-catalog.js` | Rehber kataloğunun (`build_catalog.py` çıktısı) ayrı kopyası. `index.js`'in başındaki katalogla aynı olmalı; test bunu kontrol eder. |
| `tests/` | Otomatik testler. Ağ kullanmaz; Discord ve AI servisleri sahte cevaplarla taklit edilir. |

## Değişiklik yaparken

```sh
npm install
npm test        # soru eşleştirme ve bot davranışı testleri
npm run check   # Worker'ı deploy etmeden derler
```

GitHub'a gönderilen her değişiklikte bu iki adım otomatik çalışır (Actions → Test). Kırmızı görünürse değişiklik bir şeyi bozmuş demektir.

Yeni bir soru kalıbının doğru rehbere gitmesini istiyorsan `tests/routing.test.mjs` içindeki `GUIDE_CASES` listesine ekle.

## Ayarlar (Cloudflare değişkenleri)

Zorunlu gizli değerler: `DISCORD_BOT_TOKEN`, `GEMINI_API_KEY`, `ADMIN_API_KEY` (en az 32 karakter).

İsteğe bağlı: `DISCORD_GUILD_ID`, `WOW_AI_URL`, `WOW_AI_METHOD` (`POST` ya da boş = GET), `WOW_AI_API_KEY`, `GEMINI_TEXT_MODEL`, `GEMINI_VISION_MODEL`, `TOTIK_PROFILE_JSON`, `YOUTUBE_MEMBER_ROLE_IDS`, `TWITCH_SUB_ROLE_IDS`, `PREMIUM_ROLE_IDS`, `COMMUNITY_EDITOR_IDS`, `SPECIAL_GUIDE_CHANNEL_ID`.

`TOTIK_PROFILE_JSON` alanları: `about`, `guildName`, `realm`, `ruleset`, `faction`, `guildRequirements`, `applicationInstructions`, `guildContacts`, `streamSchedule`.

Kanal, sunucu ve sahip ID'leri `src/index.js` içinde sabittir (`QUESTION_CHANNEL_ID`, `GUILD_ID`, `OWNER_ID` vb.).

## Çalıştırma

1. `npm run deploy`
2. Botu başlat: `POST https://<worker-adresi>/start` ve başlık `Authorization: Bearer <ADMIN_API_KEY>`
3. Durum: `GET /status`, rehber görsel kontrolü: `GET /guide-check` (aynı başlıkla). Durdurmak için `POST /stop`.
